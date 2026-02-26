require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { getCityForAgency, classifyCallType, translateCallType, parseAddress, parseNetDate } = require('./utils');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("Please provide SUPABASE_URL and SUPABASE_ANON_KEY in .env");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function scrapeIncidents() {
    console.log(`[${new Date().toLocaleTimeString()}] Fetching incidents...`);
    try {
        const response = await fetch('https://secure2.hamiltoncounty.in.gov/DailyIncidents/Daily_Log/Incidents_Read', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: 'sort=&group=&filter=&page=1&pageSize=500'
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

        const data = await response.json();
        const rawIncidents = data.Data || [];

        const transformed = rawIncidents
            .map(raw => {
                const dateTime = parseNetDate(raw.DateTime);
                if (!dateTime || isNaN(dateTime.getTime())) return null;

                const category = classifyCallType(raw.Call_Type, raw.Agency);
                const coords = parseAddress(raw.Address, raw.Agency);
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
                    incident_number: raw.Incident_Number,
                    is_noblesville: ['Noblesville Fire', 'Noblesville Police'].includes(raw.Agency),
                };
            })
            .filter(i => i !== null);

        if (transformed.length === 0) {
            console.log("No incidents to insert.");
            return;
        }

        // Upsert into supabase
        const { error } = await supabase
            .from('incidents')
            .upsert(transformed, { onConflict: 'id' });

        if (error) {
            console.error("Supabase upsert error:", error);
        } else {
            console.log(`[${new Date().toLocaleTimeString()}] Processed ${transformed.length} incidents to DB.`);
        }
    } catch (err) {
        console.error(`[${new Date().toLocaleTimeString()}] Error:`, err.message);
    }
}

console.log("Starting Scraper process...");
scrapeIncidents();
setInterval(scrapeIncidents, 60 * 1000);
