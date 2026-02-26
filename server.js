require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { getCityForAgency, classifyCallType, translateCallType, parseAddress, geocodeArcGIS, normalizeAddress, parseNetDate, TEN_CODES } = require('./utils');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, '.')));

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
let supabase = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log("Supabase configured. Server will query database.");
}

// ── Fallback Data Cache ──
let cachedIncidents = [];
let lastFetchTime = 0;
const CACHE_DURATION_MS = 60 * 1000;

const FIRE_STATIONS = [
    { id: 'NFD-71', name: 'Noblesville Station 71', agency: 'Noblesville Fire', lat: 40.0475, lng: -86.0125, address: '135 S 9th St' },
    { id: 'NFD-72', name: 'Noblesville Station 72', agency: 'Noblesville Fire', lat: 40.0580, lng: -86.0180, address: '400 S Harbour Dr' },
    { id: 'NFD-73', name: 'Noblesville Station 73', agency: 'Noblesville Fire', lat: 40.0390, lng: -85.9935, address: '2101 Greenfield Ave' },
    { id: 'NFD-74', name: 'Noblesville Station 74', agency: 'Noblesville Fire', lat: 40.0320, lng: -86.0145, address: '1551 S 10th St' },
    { id: 'FFD-91', name: 'Fishers Station 91', agency: 'Fishers Fire', lat: 39.9600, lng: -86.0150, address: '2 Municipal Dr' },
    { id: 'FFD-92', name: 'Fishers Station 92', agency: 'Fishers Fire', lat: 39.9630, lng: -85.9700, address: '11595 Brooks School Rd' },
    { id: 'FFD-93', name: 'Fishers Station 93', agency: 'Fishers Fire', lat: 39.9400, lng: -86.0310, address: '10501 Allisonville Rd' },
    { id: 'CFD-41', name: 'Carmel Station 41', agency: 'Carmel Fire', lat: 39.9785, lng: -86.1300, address: '210 Veterans Way' },
    { id: 'CFD-42', name: 'Carmel Station 42', agency: 'Carmel Fire', lat: 39.9900, lng: -86.1550, address: '4580 W 131st St' },
    { id: 'CFD-43', name: 'Carmel Station 43', agency: 'Carmel Fire', lat: 39.9600, lng: -86.1100, address: '1045 W 116th St' },
    { id: 'WFD-81', name: 'Westfield Station 81', agency: 'Westfield Fire', lat: 40.0430, lng: -86.1275, address: '17101 Ditch Rd' },
    { id: 'WFD-82', name: 'Westfield Station 82', agency: 'Westfield Fire', lat: 40.0350, lng: -86.1400, address: '322 E Main St' },
];

async function fetchIncidentsFallback() {
    try {
        const response = await fetch('https://secure2.hamiltoncounty.in.gov/DailyIncidents/Daily_Log/Incidents_Read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            body: 'sort=DateTime-desc&group=&filter=&page=1&pageSize=500'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

        const data = await response.json();
        const rawIncidents = data.Data || [];
        const transformed = await Promise.all(rawIncidents.slice(0, 100).map(async raw => {
            const dateTime = parseNetDate(raw.DateTime);
            if (!dateTime || isNaN(dateTime.getTime())) return null;
            const category = classifyCallType(raw.Call_Type, raw.Agency);

            // Try high-accuracy ArcGIS first
            let coords = await geocodeArcGIS(raw.Address, raw.Agency);
            if (!coords) {
                // Fallback to manual/fuzzy jitter
                coords = parseAddress(raw.Address, raw.Agency);
            }

            const city = getCityForAgency(raw.Agency);
            return {
                id: raw.Incident_Number || `HC-${raw.ID}`,
                type: category,
                description: translateCallType(raw.Call_Type),
                raw_call_type: raw.Call_Type,
                address: raw.Address || 'Address Pending',
                agency: raw.Agency,
                city: city,
                timestamp: dateTime.toISOString(),
                lat: coords ? coords.lat : null,
                lng: coords ? coords.lng : null,
                accuracy: coords ? (coords.accuracy || 'unknown') : 'none',
                source: coords ? (coords.source || 'none') : 'none',
                incident_number: raw.Incident_Number,
                is_noblesville: ['Noblesville Fire', 'Noblesville Police'].includes(raw.Agency),
            };
        }));
        cachedIncidents = transformed;
        lastFetchTime = Date.now();
        return transformed;
    } catch (err) {
        return cachedIncidents;
    }
}

app.get('/api/incidents', async (req, res) => {
    let result = [];

    // Check if we have Supabase connected
    if (supabase) {
        try {
            const { start, end, limit = 500 } = req.query;
            let query = supabase.from('incidents').select('*').order('timestamp', { ascending: false }).limit(limit);

            if (start) query = query.gte('timestamp', new Date(start).toISOString());
            if (end) query = query.lte('timestamp', new Date(end).toISOString());

            const { data, error } = await query;
            if (error) throw error;

            result = await Promise.all((data || []).map(async (inc) => {
                if (inc.lat === null || inc.lng === null) {
                    let coords = await geocodeArcGIS(inc.address, inc.agency);
                    if (!coords) {
                        coords = parseAddress(inc.address, inc.agency);
                    }
                    if (coords) {
                        inc.lat = coords.lat;
                        inc.lng = coords.lng;
                        inc.accuracy = coords.accuracy;
                        inc.source = coords.source;
                    }
                }
                return inc;
            }));
        } catch (e) {
            console.error("Supabase query error, falling back:", e.message);
            // Fall back to memory if DB query fails
            if (Date.now() - lastFetchTime > CACHE_DURATION_MS) await fetchIncidentsFallback();
            result = [...cachedIncidents];
        }
    } else {
        if (Date.now() - lastFetchTime > CACHE_DURATION_MS || cachedIncidents.length === 0) {
            await fetchIncidentsFallback();
        }
        result = [...cachedIncidents];

        // Manual start/end filtering for in-memory cache
        if (req.query.start || req.query.end) {
            result = result.filter(i => {
                const ts = new Date(i.timestamp).getTime();
                let valid = true;
                if (req.query.start && ts < new Date(req.query.start).getTime()) valid = false;
                if (req.query.end && ts > new Date(req.query.end).getTime()) valid = false;
                return valid;
            });
        }
    }

    // Common filtering
    if (req.query.agency === 'noblesville') result = result.filter(i => i.is_noblesville);
    if (req.query.city) result = result.filter(i => i.city.toLowerCase() === req.query.city.toLowerCase());
    if (req.query.type && ['fire', 'police', 'ems'].includes(req.query.type)) result = result.filter(i => i.type === req.query.type);

    // Limit in memory if not supabase
    if (!supabase) {
        const lim = parseInt(req.query.limit) || 200;
        result = result.slice(0, lim);
    }

    res.json({ success: true, count: result.length, lastUpdated: new Date().toISOString(), incidents: result });
});

app.get('/api/stations', (req, res) => res.json({ success: true, stations: FIRE_STATIONS }));
app.get('/api/codes', (req, res) => res.json({ success: true, codes: TEN_CODES }));
app.get('/api/health', (req, res) => res.json({ status: 'ok', usingSupabase: !!supabase, cachedIncidents: cachedIncidents.length, uptime: process.uptime() }));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

if (require.main === module) {
    app.listen(PORT, async () => {
        console.log(`\n🚨 Hamilton County Dispatch API running on http://localhost:${PORT}`);
        if (!supabase) {
            console.log(`   Supabase not configured, fetching live data into cache...\n`);
            await fetchIncidentsFallback();
            setInterval(fetchIncidentsFallback, CACHE_DURATION_MS);
        }
    });
}
module.exports = app;
