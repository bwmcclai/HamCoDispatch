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
    fire: { label: 'Fire', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-flame"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 12c2 -2.96 0 -7 -1 -8c0 3.038 -1.773 4.741 -3 6c-1.226 1.26 -2 3.24 -2 5a6 6 0 1 0 12 0c0 -1.532 -1.056 -3.94 -2 -5c-1.786 3 -2.791 3 -4 2z" /></svg>', color: '#ff6b35' },
    police: { label: 'Police', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-shield-half"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3" /><path d="M12 3v18" /></svg>', color: '#4ea8ff' },
    ems: { label: 'EMS', icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-ambulance"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M7 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path d="M17 17m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" /><path d="M5 17h-2v-11a1 1 0 0 1 1 -1h9v12m-4 0h6m4 0h2v-6h-8m0 -5h5l3 5" /><path d="M6 10h4m-2 -2v4" /></svg>', color: '#4ade80' }
};

// ── State ──
let map;
let markers = [];
let stationMarkers = [];
let incidents = [];
let currentFilter = 'all';
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

function formatClockTime() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    return `${dateStr} · ${timeStr}`;
}

function formatAddress(address) {
    if (!address || address === '<UNKNOWN>' || address === 'Address Pending') return 'Address Pending';
    const abbrevs = ['BLK', 'ST', 'RD', 'DR', 'CT', 'LN', 'AVE', 'PKWY', 'BLVD', 'CIR', 'PL', 'WAY', 'TRL', 'SR', 'NE', 'NW', 'SE', 'SW', 'N', 'S', 'E', 'W'];
    return address.replace(/\b\w+/g, w => {
        if (abbrevs.includes(w.toUpperCase())) return w.toUpperCase();
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
}

// ── Map Setup ──
function initMap() {
    map = L.map('map', {
        center: HAMCO_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: false,
        attributionControl: true
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    // Hamilton County boundary hint
    L.circle(HAMCO_CENTER, {
        radius: 18000,
        color: 'rgba(255, 255, 255, 0.03)',
        fillColor: 'rgba(255, 255, 255, 0.005)',
        fillOpacity: 1,
        weight: 1,
        dashArray: '8 4'
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
        if (showStations) loadFireStations();
        else clearFireStations();
    });

    // Heatmap toggle
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
    const ageMs = Date.now() - new Date(incident.timestamp).getTime();
    const isRecent = ageMs < 3600000;

    const markerHtml = `
        <div class="marker-pulse">
            <div class="marker-pulse-ring ${type}" style="${isRecent ? '' : 'display:none'}"></div>
            <div class="marker-dot ${type}"></div>
        </div>
    `;

    const icon = L.divIcon({
        html: markerHtml,
        className: 'custom-marker',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
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
    if (showHeatmap) {
        markers.forEach(m => m.setOpacity(0)); // Hidden when heatmap is active
        return;
    }
    markers.forEach(m => {
        m.setOpacity(currentFilter === 'all' || m.incidentType === currentFilter ? 1 : 0.12);
    });
}

function renderMapLayers() {
    if (heatLayer) {
        map.removeLayer(heatLayer);
        heatLayer = null;
    }

    if (showHeatmap && L.heatLayer) {
        const heatData = incidents
            .filter(inc => inc.lat && inc.lng)
            .filter(inc => currentFilter === 'all' || inc.type === currentFilter)
            .map(inc => [inc.lat, inc.lng, 1]); // default intensity

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
        const cityFilter = document.getElementById('cityFilter').value;
        if (cityFilter !== 'all') {
            params.set('city', cityFilter);
        }

        if (isHistoryMode && historyDate) {
            const start = new Date(historyDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(historyDate);
            end.setHours(23, 59, 59, 999);
            params.set('start', start.toISOString());
            params.set('end', end.toISOString());
            params.set('limit', '5000'); // fetch more for historical mode
        } else {
            params.set('limit', '200');
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

        incidents = data.incidents.map(inc => ({
            ...inc,
            timestamp: new Date(inc.timestamp),
            _isNew: newIds.includes(inc.id) && !isFirstLoad
        }));

        removeAllMarkers();
        incidents.forEach(inc => createMarker(inc));
        renderMarquee();
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

function flashNewIncidents(newIds) {
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
    const badge = document.getElementById('statusBadge');
    const dot = badge.querySelector('.status-dot');
    const text = badge.querySelector('.status-text');
    const styles = {
        live: { bg: '#4ade80', shadow: 'rgba(74,222,128,0.6)', label: 'LIVE', border: 'rgba(74,222,128,0.2)', bgBadge: 'rgba(74,222,128,0.08)' },
        history: { bg: '#8b5cf6', shadow: 'rgba(139,92,246,0.6)', label: 'HISTORY', border: 'rgba(139,92,246,0.2)', bgBadge: 'rgba(139,92,246,0.08)' },
        loading: { bg: '#facc15', shadow: 'rgba(250,204,21,0.6)', label: 'UPDATING', border: 'rgba(250,204,21,0.2)', bgBadge: 'rgba(250,204,21,0.08)' },
        error: { bg: '#f87171', shadow: 'rgba(248,113,113,0.6)', label: 'OFFLINE', border: 'rgba(248,113,113,0.2)', bgBadge: 'rgba(248,113,113,0.08)' }
    };
    const s = styles[state];
    dot.style.background = s.bg;
    dot.style.boxShadow = `0 0 8px ${s.shadow}`;
    text.textContent = s.label;
    text.style.color = s.bg;
    badge.style.borderColor = s.border;
    badge.style.background = s.bgBadge;
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

function renderMarquee() {
    const track = document.getElementById('incidentMarquee');
    track.innerHTML = '';
    const filtered = currentFilter === 'all' ? incidents : incidents.filter(i => i.type === currentFilter);

    if (filtered.length === 0) {
        track.innerHTML = `
            <div style="color:var(--text-secondary); padding: 10px; font-size: 0.8rem; font-weight: 500;">
                ${currentFilter !== 'all' ? `No ${currentFilter} incidents.` : 'Monitoring Hamilton County...'}
            </div>
        `;
        return;
    }

    const createCards = () => {
        filtered.forEach((incident, index) => {
            track.appendChild(renderIncidentCard(incident, index));
        });
    };

    const copies = Math.max(2, Math.ceil(15 / Math.max(1, filtered.length)));
    for (let i = 0; i < copies; i++) createCards();

    const duration = Math.max(20, filtered.length * copies * 4) + 's';
    track.style.animationDuration = duration;
}

function updateStats() {
    animateCounter('allCount', incidents.length);
    animateCounter('fireCount', incidents.filter(i => i.type === 'fire').length);
    animateCounter('policeCount', incidents.filter(i => i.type === 'police').length);
    animateCounter('emsCount', incidents.filter(i => i.type === 'ems').length);
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
    if (miniMap) { setTimeout(() => { miniMap.remove(); miniMap = null; }, 300); }
}

// ── Filters ──
function initFilters() {
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderMarquee();
            renderMapLayers(); // Update layers instead of just markers
        });
    });
}

function initTimeFilter() {
    const liveBtn = document.getElementById('liveModeBtn');
    const historyBtn = document.getElementById('historyModeBtn');
    const dateInput = document.getElementById('historyDate');
    const heatmapBtn = document.getElementById('heatmapToggleBtn');

    if (!liveBtn || !historyBtn || !dateInput) return;

    liveBtn.addEventListener('click', () => {
        isHistoryMode = false;
        liveBtn.classList.add('active');
        historyBtn.classList.remove('active');
        dateInput.style.display = 'none';

        if (heatmapBtn) {
            heatmapBtn.style.display = 'none';
            showHeatmap = false;
            heatmapBtn.classList.remove('active');
        }

        knownIncidentIds.clear();
        isFirstLoad = true;
        fetchIncidents();
    });

    historyBtn.addEventListener('click', () => {
        isHistoryMode = true;
        historyBtn.classList.add('active');
        liveBtn.classList.remove('active');
        dateInput.style.display = 'inline-block';

        if (heatmapBtn) {
            heatmapBtn.style.display = 'inline-flex';
            showHeatmap = true; // Auto enable heatmap for history
            heatmapBtn.classList.add('active');
        }

        if (!dateInput.value) {
            // Set to yesterday by default when entering history mode
            const d = new Date();
            d.setDate(d.getDate() - 1);
            dateInput.value = d.toISOString().split('T')[0];
            historyDate = dateInput.value;
        } else {
            historyDate = dateInput.value;
        }

        knownIncidentIds.clear();
        isFirstLoad = true;
        fetchIncidents();
    });

    dateInput.addEventListener('change', (e) => {
        historyDate = e.target.value;
        if (isHistoryMode) {
            knownIncidentIds.clear();
            isFirstLoad = true;
            fetchIncidents();
        }
    });
}

// ── City Filter ──
function initCityFilter() {
    const cityFilter = document.getElementById('cityFilter');
    if (!cityFilter) return;

    const saved = localStorage.getItem('hamcoSiren_city');
    if (saved) {
        cityFilter.value = saved;
    }

    cityFilter.addEventListener('change', () => {
        localStorage.setItem('hamcoSiren_city', cityFilter.value);
        knownIncidentIds.clear();
        isFirstLoad = true;
        fetchIncidents();
    });
}

// ── Audio Panel ──
function initAudioPanel() {
    const toggle = document.getElementById('audioPanelToggle');
    const body = document.getElementById('audioPanelBody');
    if (!toggle || !body) return;

    toggle.addEventListener('click', () => {
        body.classList.toggle('open');
        toggle.closest('.audio-panel').classList.toggle('expanded');
    });
}

// ── Clock ──
function updateClock() {
    document.getElementById('clock').textContent = formatClockTime();
}

// ── Init ──
async function init() {
    initMap();
    initFilters();
    initTimeFilter();
    initCityFilter();
    initAudioPanel();
    updateClock();

    document.getElementById('incidentMarquee').innerHTML = `
        <div style="color:var(--text-secondary); padding: 10px; font-size: 0.8rem; font-weight: 500;">Loading Incidents...</div>
    `;

    await fetchIncidents();
    setInterval(updateClock, 1000);
    setInterval(fetchIncidents, POLL_INTERVAL_MS);

    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalOverlay').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    console.log('%c🚨 Hamilton County Dispatch — Live', 'color: #ff6b35; font-size: 14px; font-weight: bold;');
    console.log('%cHamCoDispatch.com — Hamilton County, IN', 'color: #888; font-size: 11px;');
}

document.addEventListener('DOMContentLoaded', init);
