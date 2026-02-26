/* ===================================
   HAMILTON COUNTY DISPATCH — App Logic
   Live Map + Real Incident Feed
   HamCoDispatch.com
   =================================== */

// ── Constants ──
const HAMCO_CENTER = [40.0100, -86.0600]; // Center of Hamilton County
const DEFAULT_ZOOM = 12;
const API_BASE = '';
const POLL_INTERVAL_MS = 60 * 1000;
const SCOPE_KEY = 'hamcoSiren_scope';

const INCIDENT_TYPES = {
    traffic: { label: 'Traffic', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71L12 2z" /></svg>', color: '#94a3b8' },
    fire: { label: 'Fire', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-flame"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a6 6 0 1 0 12 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -4 2z" /></svg>', color: '#ff6b35' },
    police: { label: 'Police', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-shield-half"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3" /><path d="M12 3v18" /></svg>', color: '#4ea8ff' },
    ems: { label: 'EMS', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-ambulance"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path d="M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path d="M5 17h-2v-11a1 1 0 0 1 1 -1h9v12m-4 0h6m4 0h2v-6h-8m0 -5h5l3 5" /><path d="M6 10h4m-2 -2v4" /></svg>', color: '#4ade80' }
};

// ── State ──
let map;
let markers = [];
let stationMarkers = [];
let incidents = [];
let visibleCats = { traffic: false, ems: true, fire: true, police: true }; // Master visibility toggles
let miniMap = null;
let isLoading = false;
let lastUpdated = null;
let showStations = false;
let knownIncidentIds = new Set();
let isFirstLoad = true;

// ── New Features State ──
let isHistoryMode = false;
let historyDate = null;
let heatLayer = null;
let showHeatmap = false;
let currentHistoryTime = 1440;
const HISTORY_DURATIONS = { traffic: 60, fire: 240, police: 120, ems: 60 };

// ── Utility ──
function timeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}



function formatAddress(address) {
    if (!address || address === '<UNKNOWN>' || address === 'Address Pending') return 'Address Pending';
    const abbrevs = ['BLK', 'ST', 'RD', 'DR', 'CT', 'LN', 'AVE', 'PKWY', 'BLVD', 'CIR', 'PL', 'WAY', 'TRL', 'SR', 'NE', 'NW', 'SE', 'SW', 'N', 'S', 'E', 'W'];
    return address.replace(/\b\w+/g, w => {
        if (abbrevs.includes(w.toUpperCase())) return w.toUpperCase();
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
}

// ── Persistence ──
function saveSettings() {
    localStorage.setItem(SCOPE_KEY, JSON.stringify({
        visibleCats: visibleCats,
        showStations: showStations
    }));
}

function loadSettings() {
    const saved = localStorage.getItem(SCOPE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            if (parsed.visibleCats) visibleCats = parsed.visibleCats;
            if (typeof parsed.showStations === 'boolean') {
                showStations = parsed.showStations;
            }
        } catch (e) {
            console.warn("Failed to load settings", e);
        }
    }
}

// ── Map Setup ──
function initMap() {
    // Hamilton County Boundaries (approximate precise rectangle)
    const hamcoBounds = L.latLngBounds(
        L.latLng(39.9272, -86.2366), // SouthWest (96th st / County Line Rd)
        L.latLng(40.2268, -85.8744)  // NorthEast (296th st / Madison border)
    );

    map = L.map('map', {
        center: HAMCO_CENTER,
        zoom: DEFAULT_ZOOM,
        minZoom: 11,
        maxBounds: hamcoBounds.pad(0.05), // Allow slight panning outside
        maxBoundsViscosity: 0.9,
        zoomControl: false,
        attributionControl: true
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    // Create an inverted polygon to darken everything outside Hamilton County
    const outerBounds = [
        [-90, -180],
        [90, -180],
        [90, 180],
        [-90, 180]
    ];

    const innerBounds = [
        [39.9272, -86.2366], // SW
        [40.2268, -86.2366], // NW
        [40.2268, -85.8744], // NE
        [39.9272, -85.8744], // SE
    ];

    L.polygon([outerBounds, innerBounds], {
        color: 'transparent',
        fillColor: '#0a0a0f', // Match app background
        fillOpacity: 0.85,    // Fade out surrounding counties
        stroke: false,
        interactive: false
    }).addTo(map);

    // Hamilton County boundary hint
    L.rectangle(innerBounds, {
        color: 'rgba(255, 255, 255, 0.1)',
        fill: false,
        weight: 1,
        dashArray: '4 4'
    }).addTo(map);

    // Controls
    document.getElementById('zoomInBtn').addEventListener('click', () => map.zoomIn());
    document.getElementById('zoomOutBtn').addEventListener('click', () => map.zoomOut());
    document.getElementById('recenterBtn').addEventListener('click', () => {
        map.flyTo(HAMCO_CENTER, DEFAULT_ZOOM, { duration: 1.2 });
    });

    // Station toggle
    document.getElementById('stationsToggleBtn').addEventListener('click', () => {
        showStations = !showStations;
        const btn = document.getElementById('stationsToggleBtn');
        btn.classList.toggle('active', showStations);
        saveSettings();
        if (showStations) loadFireStations();
        else clearFireStations();
    });

    const heatmapBtn = document.getElementById('heatmapToggleBtn');
    if (heatmapBtn) {
        heatmapBtn.addEventListener('click', () => {
            showHeatmap = !showHeatmap;
            heatmapBtn.classList.toggle('active', showHeatmap);
            renderMapLayers();
        });
    }

}

// ── Fire Stations ──
async function loadFireStations() {
    try {
        const res = await fetch(`${API_BASE}/api/stations`);
        const data = await res.json();
        if (data.success) {
            data.stations.forEach(station => {
                const icon = L.divIcon({
                    html: `<div class="station-marker">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff6b35" stroke-width="2.5">
                            <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"></path>
                        </svg>
                    </div>`,
                    className: 'station-icon',
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                });

                const marker = L.marker([station.lat, station.lng], { icon }).addTo(map);
                marker.bindPopup(`
                    <div class="popup-title">${station.name}</div>
                    <div class="popup-address">${station.address}</div>
                    <div class="popup-badge fire">Fire Station</div>
                `, { closeButton: false, offset: [0, -8], className: 'custom-popup' });
                marker.on('mouseover', function () { this.openPopup(); });
                marker.on('mouseout', function () { this.closePopup(); });
                stationMarkers.push(marker);
            });
        }
    } catch (e) {
        console.warn('Failed to load fire stations:', e);
    }
}

function clearFireStations() {
    stationMarkers.forEach(m => map.removeLayer(m));
    stationMarkers = [];
}

// ── Incident Markers ──
function createMarker(incident) {
    if (!incident.lat || !incident.lng) return null;
    const type = incident.type;

    // In live mode, calculate actual age. In history mode, age relative to the timeline slider
    let ageMs = 0;
    if (isHistoryMode) {
        const incMin = incident.timestamp.getHours() * 60 + incident.timestamp.getMinutes();
        ageMs = (currentHistoryTime - incMin) * 60000;
    } else {
        ageMs = Date.now() - incident.timestamp.getTime();
    }

    // Time tiers for visual staleness
    const isNew = ageMs < 1800000; // Under 30 mins
    const isActive = ageMs < 3600000; // Under 1 hour
    const isStale = ageMs >= 3600000; // Over 1 hour

    let staleClass = '';
    if (!isHistoryMode && isStale) staleClass = 'stale';

    const markerHtml = `
        <div class="map-marker-container ${staleClass}">
            ${isActive ? `<div class="marker-pulse-ring ${type} ${isNew ? 'fast-pulse' : ''}"></div>` : ''}
            <div class="map-marker-badge ${type}">
                ${INCIDENT_TYPES[type].icon}
            </div>
            ${isNew ? `<div class="map-marker-new-dot"></div>` : ''}
            <div class="map-marker-pointer ${type}"></div>
        </div>
    `;

    const icon = L.divIcon({
        html: markerHtml,
        className: 'custom-marker',
        iconSize: [36, 44],
        iconAnchor: [18, 44]
    });

    const marker = L.marker([incident.lat, incident.lng], { icon }).addTo(map);

    const agencyLine = incident.agency ? `<div style="font-size:0.7rem;color:rgba(240,240,245,0.4);margin-top:2px;">${incident.agency}</div>` : '';
    marker.bindPopup(`
        <div class="popup-title">${incident.description}</div>
        <div class="popup-address">${formatAddress(incident.address)}</div>
        ${agencyLine}
        <div class="popup-badge ${type}">${INCIDENT_TYPES[type].label}</div>
    `, { closeButton: false, offset: [0, -8], className: 'custom-popup' });

    marker.on('mouseover', function () { this.openPopup(); });
    marker.on('mouseout', function () { this.closePopup(); });
    marker.on('click', function () { openModal(incident); });

    marker.incidentId = incident.id;
    marker.incidentType = type;
    markers.push(marker);
    return marker;
}

function removeAllMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
}

function updateMarkersVisibility() {
    markers.forEach(m => {
        let opacity = visibleCats[m.incidentType] ? 1 : 0;

        if (isHistoryMode) {
            const inc = incidents.find(i => i.id === m.incidentId);
            if (inc) {
                const incMin = inc.timestamp.getHours() * 60 + inc.timestamp.getMinutes();
                if (incMin > currentHistoryTime) {
                    opacity = 0;
                } else if (currentHistoryTime - incMin > HISTORY_DURATIONS[inc.type]) {
                    opacity = 0;
                }
            }
        }

        if (showHeatmap) {
            m.setOpacity(0);
        } else {
            m.setOpacity(opacity);
        }
    });
}

function renderMapLayers() {
    if (heatLayer) {
        map.removeLayer(heatLayer);
        heatLayer = null;
    }

    if (showHeatmap && L.heatLayer) {
        let heatIncidents = incidents
            .filter(inc => inc.lat && inc.lng)
            .filter(inc => visibleCats[inc.type]);

        if (isHistoryMode) {
            heatIncidents = heatIncidents.filter(inc => {
                const incMin = inc.timestamp.getHours() * 60 + inc.timestamp.getMinutes();
                return incMin <= currentHistoryTime && (currentHistoryTime - incMin) <= HISTORY_DURATIONS[inc.type];
            });
        } else {
            heatIncidents = heatIncidents.filter(inc => {
                const ageMs = Date.now() - inc.timestamp.getTime();
                return ageMs <= 3600000;
            });
        }

        const heatData = heatIncidents.map(inc => [inc.lat, inc.lng, 1]);

        heatLayer = L.heatLayer(heatData, {
            radius: 20,
            blur: 15,
            maxZoom: 14,
            gradient: { 0.4: 'blue', 0.6: 'cyan', 0.7: 'lime', 0.8: 'yellow', 1.0: 'red' }
        }).addTo(map);
    }
    updateMarkersVisibility();
}

// ── Data Fetching ──
async function fetchIncidents() {
    if (isLoading) return;
    isLoading = true;
    updateStatusBadge('loading');

    try {
        const params = new URLSearchParams();

        if (isHistoryMode && historyDate) {
            const start = new Date(historyDate + 'T00:00:00');
            start.setHours(0, 0, 0, 0);
            const end = new Date(historyDate + 'T00:00:00');
            end.setHours(23, 59, 59, 999);
            params.set('start', start.toISOString());
            params.set('end', end.toISOString());
            params.set('limit', '5000'); // fetch more for historical mode
        } else {
            const start = new Date();
            start.setHours(start.getHours() - 12); // Reverted back to 12h to ensure data loads when slow
            params.set('start', start.toISOString());
            params.set('limit', '500'); // Increased from 200 to 500
        }

        const response = await fetch(`${API_BASE}/api/incidents?${params.toString()}`);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!data.success) throw new Error('API error');

        lastUpdated = new Date(data.lastUpdated);

        const newIds = [];
        data.incidents.forEach(inc => {
            if (!knownIncidentIds.has(inc.id)) {
                newIds.push(inc.id);
                knownIncidentIds.add(inc.id);
            }
        });

        incidents = data.incidents.map(inc => {
            let type = inc.type;
            if (inc.raw_call_type && inc.raw_call_type.includes('Traffic Stop')) {
                type = 'traffic';
            }
            return {
                ...inc,
                type: type,
                timestamp: new Date(inc.timestamp),
                _isNew: newIds.includes(inc.id) && !isFirstLoad
            };
        });

        removeAllMarkers();
        incidents.forEach(inc => createMarker(inc));
        renderIncidentList();
        if (typeof renderTimelineTicks === 'function') renderTimelineTicks();
        updateStats();
        renderMapLayers(); // Update the heatmap and markers
        updateStatusBadge(isHistoryMode ? 'history' : 'live');

        if (!isFirstLoad && newIds.length > 0) flashNewIncidents(newIds);
        isFirstLoad = false;

        console.log(`[${formatTime(new Date())}] Updated: ${incidents.length} incidents (${newIds.length} new)`);
    } catch (err) {
        console.error('Fetch failed:', err);
        updateStatusBadge('error');
        if (incidents.length === 0) showOfflineNotice();
    } finally {
        isLoading = false;
    }
}
// ── Audio Context for Chimes ──
let audioCtx;
function playChime() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1); // A5

        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.8);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.8);
    } catch (e) { console.warn("Audio chime failed"); }
}

function flashNewIncidents(newIds) {
    let playSound = false;
    const criticalTypes = ['Structure Fire', 'Fire Alarm', 'Person with Gun', 'Traffic Accident', 'Injury Accident', 'Cardiac', 'Overdose', 'Unconscious', 'Fatality', 'Emergency', 'Water Rescue'];

    newIds.forEach(id => {
        const inc = incidents.find(i => id === i.id);
        if (inc) {
            // Check if critical
            if (criticalTypes.some(t => inc.description.toLowerCase().includes(t.toLowerCase()))) {
                playSound = true;
                if (Notification.permission === 'granted') {
                    new Notification('HamCoDispatch Alert', {
                        body: `${inc.description} - ${formatAddress(inc.address)}`,
                        icon: '/favicon.ico'
                    });
                }
            }
        }
    });

    if (playSound) playChime();

    const newest = incidents.find(i => newIds.includes(i.id));
    if (newest && newest.lat && newest.lng) {
        const marker = markers.find(m => m.incidentId === newest.id);
        if (marker) {
            const ageMs = Date.now() - newest.timestamp.getTime();
            if (ageMs < 300000) {
                setTimeout(() => {
                    marker.openPopup();
                    setTimeout(() => marker.closePopup(), 4000);
                }, 500);
            }
        }
    }
}

// ── Status Badge ──
function updateStatusBadge(state) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    if (!dot || !text) return;

    dot.style.animation = 'none';

    if (state === 'live') {
        dot.style.background = '#4ade80';
        dot.style.boxShadow = '0 0 8px rgba(74,222,128,0.6)';
        text.textContent = 'LIVE';
        text.style.color = 'inherit';
        dot.style.animation = 'livePulse 2s ease-in-out infinite';
    } else if (state === 'history') {
        dot.style.background = 'transparent';
        dot.style.boxShadow = 'none';
        text.textContent = 'LIVE';
        text.style.color = 'inherit';
    } else if (state === 'loading') {
        dot.style.background = '#facc15';
        dot.style.boxShadow = '0 0 8px rgba(250,204,21,0.6)';
        text.textContent = 'UPDATING';
        text.style.color = '#facc15';
    } else if (state === 'error') {
        dot.style.background = '#f87171';
        dot.style.boxShadow = '0 0 8px rgba(248,113,113,0.6)';
        text.textContent = 'OFFLINE';
        text.style.color = '#f87171';
    }
}

function showOfflineNotice() {
    document.getElementById('incidentMarquee').innerHTML = `
        <div style="color:var(--text-secondary); padding: 10px; font-size: 0.8rem; font-weight: 500;">
            Unable to Connect — Retrying...
        </div>
    `;
}

// ── Incident Feed ──
function renderIncidentCard(incident, index) {
    const typeData = INCIDENT_TYPES[incident.type];
    const card = document.createElement('div');
    card.className = `incident-card ${incident.type}${incident._isNew ? ' is-new' : ''}`;
    card.dataset.id = incident.id;
    card.dataset.type = incident.type;

    const ageMs = Date.now() - incident.timestamp.getTime();
    const isActive = ageMs < 3600000;
    const status = ageMs < 1800000 ? 'Active' : ageMs < 3600000 ? 'On Scene' : 'Cleared';

    card.innerHTML = `
        <div class="incident-indicator">
            <div class="incident-type-icon">${typeData.icon}</div>
        </div>
        <div class="incident-content">
            <div class="incident-header">
                <span class="incident-title">${incident.description}</span>
                <span class="incident-time">${formatTime(incident.timestamp)}</span>
            </div>
            <div class="incident-address">${formatAddress(incident.address)}</div>
            <div class="incident-meta">
                <span class="incident-badge">${typeData.label}</span>
                <span class="incident-agency">${incident.agency || ''}</span>
                <span class="incident-status ${isActive ? 'active' : ''}">
                    <span class="incident-status-dot" style="background: ${isActive ? '#4ade80' : 'var(--text-tertiary)'}"></span>
                    ${status}
                </span>
            </div>
        </div>
    `;

    card.addEventListener('click', () => {
        if (incident.lat && incident.lng) {
            map.flyTo([incident.lat, incident.lng], 16, { duration: 1.2 });
            const marker = markers.find(m => m.incidentId === incident.id);
            if (marker) {
                setTimeout(() => marker.openPopup(), 1200);
            }
            setTimeout(() => openModal(incident), 1800);
        } else {
            openModal(incident);
        }
    });

    card.style.animationDelay = `${index * 25}ms`;
    return card;
}

function renderIncidentList() {
    const list = document.getElementById('incidentList');
    if (!list) return;
    list.innerHTML = '';

    // Unified multi-select filtering logic
    let filtered = incidents.filter(inc => {
        if (inc.type === 'traffic') return visibleCats.traffic;
        if (inc.type === 'ems') return visibleCats.ems;
        if (inc.type === 'fire') return visibleCats.fire;
        if (inc.type === 'police') return visibleCats.police;
        return true;
    });

    if (isHistoryMode) {
        filtered = filtered.filter(inc => {
            const incMin = inc.timestamp.getHours() * 60 + inc.timestamp.getMinutes();
            return incMin <= currentHistoryTime;
        });
    }

    // Sort by timestamp descending (newest first)
    filtered.sort((a, b) => b.timestamp - a.timestamp);

    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="empty-state" style="padding: 40px 20px; text-align: center; opacity: 0.5;">
                <p style="font-size: 0.85rem;">No recent incidents found for selected filters.</p>
            </div>
        `;
        document.getElementById('sidebarCount').textContent = '0 total';
        return;
    }

    filtered.forEach((incident, index) => {
        list.appendChild(renderIncidentCard(incident, index));
    });

    document.getElementById('sidebarCount').textContent = `${filtered.length} total`;
}

function updateStats() {
    animateCounter('allCount', incidents.length);
    animateCounter('trafficCount', incidents.filter(i => i.type === 'traffic').length);
    animateCounter('fireCount', incidents.filter(i => i.type === 'fire').length);
    animateCounter('policeCount', incidents.filter(i => i.type === 'police').length);
    animateCounter('emsCount', incidents.filter(i => i.type === 'ems').length);

    // Also refresh the list if filter changed
    renderIncidentList();
}

function animateCounter(id, target) {
    const el = document.getElementById(id);
    const current = parseInt(el.textContent) || 0;
    if (current === target) return;
    const duration = 400, startTime = performance.now();
    function step(ts) {
        const p = Math.min((ts - startTime) / duration, 1);
        el.textContent = Math.round(current + (target - current) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// ── Modal ──
function openModal(incident) {
    const overlay = document.getElementById('modalOverlay');
    const typeData = INCIDENT_TYPES[incident.type];

    document.getElementById('modalBadge').textContent = typeData.label.toUpperCase();
    document.getElementById('modalBadge').className = `modal-badge ${incident.type}`;
    document.getElementById('modalTitle').textContent = incident.description;
    document.getElementById('modalTime').textContent = `${timeAgo(incident.timestamp)} · ${formatTime(incident.timestamp)}`;
    document.getElementById('modalLocation').textContent = formatAddress(incident.address);
    document.getElementById('modalUnits').textContent = incident.agency || '—';
    document.getElementById('modalStatus').textContent = incident.incidentNumber || '—';
    document.getElementById('modalReported').textContent = incident.timestamp.toLocaleString();

    // Setup Share Button
    const shareBtn = document.getElementById('modalShareBtn');
    if (shareBtn) {
        shareBtn.onclick = () => {
            const url = window.location.origin + window.location.pathname + '?id=' + incident.id;
            navigator.clipboard.writeText(url).then(() => {
                shareBtn.innerHTML = '<span style="font-size:0.65rem; color:var(--text-accent); font-weight:700;">Copied!</span>';
                setTimeout(() => {
                    shareBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>`;
                }, 2000);
            });
        };
    }

    // Start Duration Interval
    if (modalDurationInterval) clearInterval(modalDurationInterval);
    updateModalDuration(incident.timestamp);
    modalDurationInterval = setInterval(() => updateModalDuration(incident.timestamp), 1000);

    const previewEl = document.getElementById('modalMapPreview');
    previewEl.innerHTML = '';
    overlay.classList.add('active');

    if (incident.lat && incident.lng) {
        setTimeout(() => {
            if (miniMap) { miniMap.remove(); miniMap = null; }
            miniMap = L.map('modalMapPreview', {
                center: [incident.lat, incident.lng], zoom: 15,
                zoomControl: false, dragging: false, scrollWheelZoom: false,
                attributionControl: false, doubleClickZoom: false, touchZoom: false,
            });
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(miniMap);
            const dotIcon = L.divIcon({
                html: `<div class="marker-dot ${incident.type}" style="width:14px;height:14px;border:2px solid white;"></div>`,
                className: 'custom-marker', iconSize: [14, 14], iconAnchor: [7, 7]
            });
            L.marker([incident.lat, incident.lng], { icon: dotIcon }).addTo(miniMap);
        }, 100);
    } else {
        previewEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:rgba(240,240,245,0.3);font-size:0.8rem;">Location not available</div>';
    }
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
    if (modalDurationInterval) clearInterval(modalDurationInterval);
    if (miniMap) { setTimeout(() => { miniMap.remove(); miniMap = null; }, 300); }
}

// ── Filters ──
function initFilters() {
    updateFilterUI();
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const filter = tab.dataset.filter;
            if (filter === 'all') {
                const areAllOn = visibleCats.traffic && visibleCats.fire && visibleCats.police && visibleCats.ems;
                if (areAllOn) {
                    // If all on, set to default (Traffic OFF)
                    visibleCats = { traffic: false, fire: true, police: true, ems: true };
                } else {
                    // Turn all on
                    visibleCats = { traffic: true, fire: true, police: true, ems: true };
                }
            } else {
                visibleCats[filter] = !visibleCats[filter];
            }

            saveSettings();
            updateFilterUI();
            renderIncidentList();
            renderMapLayers();
            updateStats();
        });
    });
}

function updateFilterUI() {
    const areAllOn = visibleCats.traffic && visibleCats.fire && visibleCats.police && visibleCats.ems;
    document.querySelectorAll('.filter-tab').forEach(tab => {
        const filter = tab.dataset.filter;
        if (filter === 'all') {
            tab.classList.toggle('active', areAllOn);
        } else {
            tab.classList.toggle('active', visibleCats[filter]);
        }
    });
}

function renderTimelineTicks() {
    const ticksContainer = document.getElementById('timelineTicks');
    if (!ticksContainer) return;
    ticksContainer.innerHTML = '';

    if (!isHistoryMode) return;

    incidents.forEach(inc => {
        const incMin = inc.timestamp.getHours() * 60 + inc.timestamp.getMinutes();
        const percent = (incMin / 1440) * 100;
        const tick = document.createElement('div');
        tick.className = `timeline-tick ${inc.type}`;
        tick.style.left = `${percent}%`;
        ticksContainer.appendChild(tick);
    });
}

function updateHistoryUI() {
    // Safely parse YYYY-MM-DD as local date
    const [year, month, day] = historyDate.split('-').map(Number);
    const localDate = new Date(year, month - 1, day);
    const today = new Date();

    const isToday = localDate.toDateString() === today.toDateString();
    const lbl = document.getElementById('historyDateLabel');
    const sub = document.getElementById('historyDateSub');
    if (lbl) lbl.textContent = isToday ? 'Today' : localDate.toLocaleDateString('en-US', { weekday: 'short' });
    if (sub) sub.textContent = localDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    const hours = Math.floor(currentHistoryTime / 60);
    const mins = currentHistoryTime % 60;
    const isPM = hours >= 12;
    const displayHours = (hours % 12) || 12; // 0 should be 12
    const strTime = `${displayHours}:${mins.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
    const timeLbl = document.getElementById('historyTimeLabel');
    if (timeLbl) timeLbl.textContent = strTime;

    const percent = (currentHistoryTime / 1440) * 100;
    const fill = document.getElementById('sliderFill');
    if (fill) fill.style.width = `${percent}%`;
    const slider = document.getElementById('historySlider');
    if (slider) slider.value = currentHistoryTime;
}

function initTimeFilter() {
    const liveBtn = document.getElementById('liveModeBtn');
    const historyBtn = document.getElementById('historyModeBtn');
    const heatmapBtn = document.getElementById('heatmapToggleBtn');

    const audioBarWrapper = document.getElementById('audioBarWrapper');
    const historyPanel = document.getElementById('historyPanel');
    const prevDateBtn = document.getElementById('prevDateBtn');
    const nextDateBtn = document.getElementById('nextDateBtn');
    const historySlider = document.getElementById('historySlider');

    if (!liveBtn || !historyBtn) return;

    liveBtn.addEventListener('click', () => {
        isHistoryMode = false;
        liveBtn.classList.add('active');
        historyBtn.classList.remove('active');

        if (audioBarWrapper) audioBarWrapper.style.display = 'flex';
        if (historyPanel) historyPanel.style.display = 'none';

        if (heatmapBtn) {
            heatmapBtn.style.display = 'none';
            showHeatmap = false;
            heatmapBtn.classList.remove('active');
        }

        knownIncidentIds.clear();
        isFirstLoad = true;
        fetchIncidents();
        renderIncidentList(); // Immediate refresh
        renderMapLayers();    // Refresh markers
    });

    historyBtn.addEventListener('click', () => {
        isHistoryMode = true;
        historyBtn.classList.add('active');
        liveBtn.classList.remove('active');

        if (audioBarWrapper) audioBarWrapper.style.display = 'none';
        if (historyPanel) historyPanel.style.display = 'flex';

        if (heatmapBtn) {
            heatmapBtn.style.display = 'none';
            showHeatmap = false;
            heatmapBtn.classList.remove('active');
        }

        if (!historyDate) {
            const d = new Date();
            const pad = n => n.toString().padStart(2, '0');
            historyDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        }

        currentHistoryTime = 1440; // Default to end of day
        updateHistoryUI();

        knownIncidentIds.clear();
        isFirstLoad = true;
        fetchIncidents();
        renderIncidentList(); // Immediate refresh
        renderMapLayers();    // Refresh markers
    });

    if (prevDateBtn && nextDateBtn) {
        prevDateBtn.addEventListener('click', () => {
            const [year, month, day] = historyDate.split('-').map(Number);
            const d = new Date(year, month - 1, day - 1);
            const pad = n => n.toString().padStart(2, '0');
            historyDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

            updateHistoryUI();
            knownIncidentIds.clear();
            isFirstLoad = true;
            fetchIncidents();
        });

        nextDateBtn.addEventListener('click', () => {
            const [year, month, day] = historyDate.split('-').map(Number);
            const currentD = new Date(year, month - 1, day);
            const today = new Date();
            if (currentD.toDateString() === today.toDateString()) return; // Don't allow future

            const nextD = new Date(year, month - 1, day + 1);
            const pad = n => n.toString().padStart(2, '0');
            historyDate = `${nextD.getFullYear()}-${pad(nextD.getMonth() + 1)}-${pad(nextD.getDate())}`;

            updateHistoryUI();
            knownIncidentIds.clear();
            isFirstLoad = true;
            fetchIncidents();
        });
    }

    if (historySlider) {
        historySlider.addEventListener('input', (e) => {
            currentHistoryTime = parseInt(e.target.value, 10);
            updateHistoryUI();
            renderMapLayers(); // Re-render for new time
            renderIncidentList(); // Sync list with slider
        });
    }
}



// ── Sidebar Toggle ──
function initSidebarToggle() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    const closeBtn = document.getElementById('sidebarClose');
    if (!sidebar) return;

    if (toggle) {
        toggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            sidebar.classList.toggle('collapsed');
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebar.classList.add('collapsed');
        });
    }
}

// ── Audio & Data Panels ──
function initPanels() {
    const audioToggle = document.getElementById('audioPanelToggle');
    const audioDrawer = document.getElementById('openmhzDrawer');
    const closeAudioBtn = document.getElementById('closeDrawerBtn');

    if (audioToggle && audioDrawer) {
        audioToggle.addEventListener('click', () => {
            audioDrawer.classList.toggle('open');
            audioToggle.classList.toggle('active');
        });
        if (closeAudioBtn) {
            closeAudioBtn.addEventListener('click', () => {
                audioDrawer.classList.remove('open');
                audioToggle.classList.remove('active');
            });
        }
    }

    const dataToggle = document.getElementById('dataInsightsBtn');
    const dataDrawer = document.getElementById('dataInsightsDrawer');
    const closeDataBtn = document.getElementById('closeDataInsightsBtn');

    if (dataToggle && dataDrawer) {
        dataToggle.addEventListener('click', () => {
            const isOpen = dataDrawer.classList.contains('open');
            if (!isOpen) {
                renderDataInsights(); // re-render charts when opening
            }
            dataDrawer.classList.toggle('open');
            dataToggle.classList.toggle('active');
        });
        if (closeDataBtn) {
            closeDataBtn.addEventListener('click', () => {
                dataDrawer.classList.remove('open');
                dataToggle.classList.remove('active');
            });
        }
    }
}

// ── Chart JS Insights ──
let typeChartInstance = null;
let agenciesChartInstance = null;

function renderDataInsights() {
    // Pie chart for Types
    const typeEl = document.getElementById('typePieChart');
    if (!typeEl) return;
    const ctx1 = typeEl.getContext('2d');

    const fireCount = incidents.filter(i => i.type === 'fire').length;
    const policeCount = incidents.filter(i => i.type === 'police').length;
    const emsCount = incidents.filter(i => i.type === 'ems').length;
    const trafficCount = incidents.filter(i => i.type === 'traffic').length;

    // Chart default settings for dark theme
    Chart.defaults.color = '#A0A0B0';
    Chart.defaults.font.family = 'Inter, sans-serif';

    if (typeChartInstance) typeChartInstance.destroy();
    typeChartInstance = new Chart(ctx1, {
        type: 'doughnut',
        data: {
            labels: ['Fire', 'Police', 'EMS', 'Traffic'],
            datasets: [{
                data: [fireCount, policeCount, emsCount, trafficCount],
                backgroundColor: ['#ef4444', '#3b82f6', '#facc15', '#a855f7'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right' },
                title: {
                    display: true,
                    text: 'Incident Types (Current View)',
                    color: '#ffffff',
                    font: { size: 14, weight: 600 }
                }
            }
        }
    });

    // Bar chart for Agencies
    const agencyEl = document.getElementById('busiestAgenciesChart');
    if (!agencyEl) return;
    const ctx2 = agencyEl.getContext('2d');

    const agencyCounts = {};
    incidents.forEach(inc => {
        const ag = inc.agency || 'Unknown';
        agencyCounts[ag] = (agencyCounts[ag] || 0) + 1;
    });

    const sortedAgencies = Object.entries(agencyCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    if (agenciesChartInstance) agenciesChartInstance.destroy();
    agenciesChartInstance = new Chart(ctx2, {
        type: 'bar',
        data: {
            labels: sortedAgencies.map(a => a[0].replace(/ Police| Fire| EMS/gi, '')),
            datasets: [{
                label: 'Calls',
                data: sortedAgencies.map(a => a[1]),
                backgroundColor: '#ff6b35',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: {
                    display: true,
                    text: 'Top 5 Busiest Agencies',
                    color: '#ffffff',
                    font: { size: 14, weight: 600 }
                }
            },
            scales: {
                y: { ticks: { precision: 0 }, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } }
            }
        }
    });
}

// ── Init ──
async function init() {
    loadSettings();
    initMap();
    initFilters();
    initTimeFilter();
    initPanels();
    initSidebarToggle();

    // Check if stations should be shown from persisted settings
    if (showStations) {
        const btn = document.getElementById('stationsToggleBtn');
        if (btn) btn.classList.add('active');
        loadFireStations();
    }

    document.getElementById('incidentList').innerHTML = `
        <div style="color:var(--text-secondary); padding: 40px 20px; text-align: center; font-size: 0.85rem; font-weight: 500;">Connecting to Siren Feed...</div>
    `;

    await fetchIncidents();
    setInterval(fetchIncidents, POLL_INTERVAL_MS);

    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalOverlay').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    // Check for Deep Link parameters
    const urlParams = new URLSearchParams(window.location.search);
    const deepLinkId = urlParams.get('id');
    if (deepLinkId) {
        const targetInc = incidents.find(i => i.id === deepLinkId);
        if (targetInc) {
            if (targetInc.lat && targetInc.lng) {
                map.flyTo([targetInc.lat, targetInc.lng], 16, { duration: 1.5 });
            }
            openModal(targetInc);
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    // Softly ask for Notifications on the first interaction
    document.body.addEventListener('click', () => {
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, { once: true });

    console.log('%c🚨 Hamilton County Dispatch — Live', 'color: #ff6b35; font-size: 14px; font-weight: bold;');
    console.log('%cHamCoDispatch.com — Hamilton County, IN', 'color: #888; font-size: 11px;');
}

document.addEventListener('DOMContentLoaded', init);
