const fetch = require('node-fetch');

const TEN_CODES = {
    '10-0': 'Fatality',
    '10-1': 'Signal Weak',
    '10-3': 'Stop Transmitting',
    '10-4': 'Acknowledged',
    '10-7': 'Out of Service',
    '10-8': 'In Service',
    '10-10': 'Fight in Progress',
    '10-11': 'Animal Problem',
    '10-14': 'Prowler/Burglar',
    '10-15': 'Civil Disturbance',
    '10-16': 'Domestic Problem',
    '10-18': 'Urgent',
    '10-20': 'Location Request',
    '10-21': 'Phone Call',
    '10-22': 'Disregard',
    '10-23': 'Arrived on Scene',
    '10-24': 'Assignment Complete',
    '10-26': 'Detaining Subject',
    '10-27': 'Drivers License Check',
    '10-28': 'Vehicle Registration',
    '10-29': 'Check Wants/Warrants',
    '10-31': 'Crime in Progress',
    '10-32': 'Person with Gun',
    '10-33': 'Emergency',
    '10-34': 'Riot',
    '10-35': 'Major Crime Alert',
    '10-37': 'Suspicious Person/Vehicle',
    '10-38': 'Stopping Suspicious Vehicle',
    '10-39': 'Urgent — Lights & Siren',
    '10-40': 'Silent Response',
    '10-46': 'Disabled Vehicle',
    '10-48': 'Traffic Control',
    '10-50': 'Traffic Accident',
    '10-50F': 'Fatal Traffic Accident',
    '10-50PI': 'Injury Accident',
    '10-50PD': 'Property Damage Accident',
    '10-51': 'Wrecker Needed',
    '10-52': 'Ambulance Needed',
    '10-53': 'Road Blocked',
    '10-54': 'Livestock on Road',
    '10-55': 'Intoxicated Driver',
    '10-56': 'Intoxicated Person',
    '10-57': 'Hit & Run',
    '10-70': 'Fire Alarm',
    '10-71': 'Fire — Nature Unknown',
    '10-72': 'Fire — Progress Report',
    '10-73': 'Smoke Report',
    '10-76': 'En Route',
    '10-77': 'ETA',
    '10-78': 'Request Assistance',
    '10-79': 'Notify Coroner',
    '10-80': 'Pursuit in Progress',
    '10-89': 'Bomb Threat',
    '10-90': 'Burglar Alarm',
    '10-95': 'Subject in Custody',
    '10-96': 'Mental Subject',
};

const CITY_CENTERS = {
    'Noblesville': { lat: 40.0456, lng: -86.0086 },
    'Carmel': { lat: 39.9784, lng: -86.1180 },
    'Fishers': { lat: 39.9568, lng: -86.0134 },
    'Westfield': { lat: 40.0428, lng: -86.1275 },
    'Cicero': { lat: 40.1238, lng: -86.0172 },
    'Sheridan': { lat: 40.1340, lng: -86.2200 },
    'Arcadia': { lat: 40.1756, lng: -86.0214 },
    'Atlanta': { lat: 40.2140, lng: -86.0230 },
    'County': { lat: 40.0580, lng: -86.0500 },
};

const ARCGIS_BASE = 'https://gis1.hamiltoncounty.in.gov/arcgis/rest/services/HamCo911/FeatureServer';

function getCityForAgency(agency) {
    if (!agency) return 'County';
    const ag = agency.toLowerCase();
    if (ag.includes('noblesville')) return 'Noblesville';
    if (ag.includes('carmel')) return 'Carmel';
    if (ag.includes('fishers')) return 'Fishers';
    if (ag.includes('westfield')) return 'Westfield';
    if (ag.includes('cicero')) return 'Cicero';
    if (ag.includes('sheridan')) return 'Sheridan';
    if (ag.includes('arcadia')) return 'Arcadia';
    return 'County';
}

const HAMCO_GEO = {
    // ── NOBLESVILLE ──
    'CONNER ST': { lat: 40.0483, lng: -86.0120 },
    'LOGAN ST': { lat: 40.0470, lng: -86.0100 },
    'CHERRY ST': { lat: 40.0465, lng: -86.0095 },
    'CLINTON ST': { lat: 40.0460, lng: -86.0110 },
    'MAPLE AVE': { lat: 40.0478, lng: -86.0135 },
    'PLEASANT ST': { lat: 40.0445, lng: -86.0020 },
    'SHERIDAN RD': { lat: 40.0587, lng: -86.0055 },
    'CUMBERLAND RD': { lat: 40.0612, lng: -85.9830 },
    'GREENFIELD AVE': { lat: 40.0390, lng: -85.9955 },
    'STONY CREEK RD': { lat: 40.0700, lng: -85.9940 },
    'HAZEL DELL RD': { lat: 40.0650, lng: -86.0150 },
    'HAGUE RD': { lat: 40.0510, lng: -85.9920 },
    'RIVER RD': { lat: 40.0523, lng: -86.0240 },
    'FIELD DR': { lat: 40.0510, lng: -86.0120 },
    'CAMPUS PKWY': { lat: 40.0480, lng: -85.9910 },
    'PROMISE RD': { lat: 40.0420, lng: -85.9700 },
    'NOBLE CROSSING': { lat: 40.0380, lng: -86.0250 },
    'PROMENADE PKWY': { lat: 40.0330, lng: -86.0080 },
    'HANNIBAL ST': { lat: 40.0460, lng: -86.0170 },
    'MUNDY DR': { lat: 40.0590, lng: -86.0080 },
    'DARTOWN RD': { lat: 40.0650, lng: -86.0280 },
    'HARBOUR TREES': { lat: 40.0570, lng: -86.0070 },
    'VILLAGE PKWY': { lat: 40.0380, lng: -86.0050 },
    'RAIDER RD': { lat: 40.0520, lng: -86.0145 },

    // ── CARMEL ──
    'RANGE LINE RD': { lat: 39.9780, lng: -86.1300 },
    'MERIDIAN ST': { lat: 39.9785, lng: -86.1375 },
    'KEYSTONE AVE': { lat: 39.9790, lng: -86.1100 },
    'KEYSTONE PKWY': { lat: 39.9790, lng: -86.1100 },
    'SPRING MILL RD': { lat: 39.9770, lng: -86.1520 },
    'OLD MERIDIAN': { lat: 39.9750, lng: -86.1380 },
    'GUILFORD RD': { lat: 39.9900, lng: -86.1350 },
    'WESTFIELD BLVD': { lat: 39.9720, lng: -86.1420 },
    'CITY CENTER DR': { lat: 39.9790, lng: -86.1260 },
    'MAIN ST': { lat: 40.0470, lng: -86.0105 },
    'GRADLE DR': { lat: 39.9760, lng: -86.1150 },
    'SMOKEY ROW RD': { lat: 39.9600, lng: -86.1300 },
    'CARMEL DR': { lat: 39.9710, lng: -86.1200 },
    'HAZEL DELL PKWY': { lat: 39.9850, lng: -86.1550 },
    'TOWNE RD': { lat: 39.9910, lng: -86.1700 },
    'GRAY RD': { lat: 40.0000, lng: -86.1400 },
    '96TH ST': { lat: 39.9330, lng: -86.1200 },
    '106TH ST': { lat: 39.9475, lng: -86.1200 },
    '116TH ST': { lat: 39.9620, lng: -86.1200 },
    '126TH ST': { lat: 39.9770, lng: -86.1200 },
    '131ST ST': { lat: 39.9840, lng: -86.1200 },
    'CLAY TERRACE': { lat: 39.9720, lng: -86.1300 },
    'CAREY RD': { lat: 39.9550, lng: -86.1490 },
    'DITCH RD': { lat: 39.9700, lng: -86.1600 },
    '1ST AVE': { lat: 39.9780, lng: -86.1360 },
    '2ND AVE': { lat: 39.9780, lng: -86.1340 },
    '3RD AVE': { lat: 39.9780, lng: -86.1320 },
    'COLLEGE AVE': { lat: 39.9780, lng: -86.1270 },
    'PENNSYLVANIA ST': { lat: 39.9785, lng: -86.1450 },

    // ── FISHERS ──
    'ALLISONVILLE RD': { lat: 39.9568, lng: -86.0310 },
    'LANTERN RD': { lat: 39.9580, lng: -85.9850 },
    'BROOKS SCHOOL RD': { lat: 39.9600, lng: -85.9700 },
    'OLIO RD': { lat: 39.9580, lng: -85.9500 },
    'BRITTON PARK RD': { lat: 39.9550, lng: -85.9800 },
    '116TH ST': { lat: 39.9620, lng: -86.0134 },
    'MUNICIPAL DR': { lat: 39.9600, lng: -86.0150 },
    'TECHNOLOGY WAY': { lat: 39.9500, lng: -86.0100 },
    'FISHERS STATION': { lat: 39.9580, lng: -86.0130 },
    'SOUTHEASTERN PKWY': { lat: 39.9450, lng: -85.9700 },
    'GEIST RD': { lat: 39.9350, lng: -85.9650 },
    'FALL CREEK RD': { lat: 39.9400, lng: -86.0100 },
    'SUNBLEST BLVD': { lat: 39.9520, lng: -86.0200 },
    'ELLER RD': { lat: 39.9650, lng: -86.0400 },
    'MOLLENKOPF RD': { lat: 39.9700, lng: -85.9900 },
    'FLORIDA RD': { lat: 39.9630, lng: -85.9600 },
    'HAMILTON CROSSING': { lat: 39.9600, lng: -86.0050 },

    // ── WESTFIELD ──
    'GREYHOUND PASS': { lat: 40.0428, lng: -86.1275 },
    'UNION ST': { lat: 40.0430, lng: -86.1270 },
    'OAK RIDGE RD': { lat: 40.0500, lng: -86.1300 },
    'CAREY RD_W': { lat: 40.0350, lng: -86.1400 },
    'GRAND PARK BLVD': { lat: 40.0550, lng: -86.1500 },
    'CENTENNIAL RD': { lat: 40.0420, lng: -86.1100 },
    'JERSEY ST': { lat: 40.0430, lng: -86.1285 },
    'SHAMROCK BLVD': { lat: 40.0480, lng: -86.1350 },

    // ── CROSS-COUNTY ROADS ──
    'STATE RD 32': { lat: 40.0465, lng: -86.0500 },
    'STATE RD 37': { lat: 40.0400, lng: -86.0180 },
    'STATE RD 38': { lat: 40.0520, lng: -86.0240 },
    'SR 32': { lat: 40.0465, lng: -86.0500 },
    'SR 37': { lat: 40.0400, lng: -86.0180 },
    'SR 38': { lat: 40.0520, lng: -86.0240 },
    '146TH ST': { lat: 40.0488, lng: -86.0400 },
    'E 146TH ST': { lat: 40.0488, lng: -85.9750 },
    'W 146TH ST': { lat: 40.0488, lng: -86.1200 },
    '151ST ST': { lat: 39.9910, lng: -86.0400 },
    '161ST ST': { lat: 40.0580, lng: -86.0050 },
    '166TH ST': { lat: 40.0610, lng: -86.0050 },
    '176TH ST': { lat: 40.0720, lng: -86.0050 },
    '186TH ST': { lat: 40.0790, lng: -86.0050 },
    '191ST ST': { lat: 40.0830, lng: -86.0100 },
    '196TH ST': { lat: 40.0870, lng: -86.0100 },
    '206TH ST': { lat: 40.0950, lng: -86.0100 },
    '236TH ST': { lat: 40.1200, lng: -86.0100 },
    'STRAWTOWN AVE': { lat: 40.0680, lng: -85.9900 },
    'MOONTOWN RD': { lat: 40.0720, lng: -85.9780 },
    'CYNTHEANNE RD': { lat: 40.0350, lng: -85.9680 },
    'CARRIGAN RD': { lat: 40.0540, lng: -85.9780 },
    'VICTORY CHAPEL RD': { lat: 40.0430, lng: -85.9780 },
    'CICERO RD': { lat: 40.0700, lng: -86.0100 },
    '10TH ST': { lat: 40.0455, lng: -86.0145 },
    '9TH ST': { lat: 40.0455, lng: -86.0110 },
    '8TH ST': { lat: 40.0455, lng: -86.0092 },
    'WESTFIELD RD': { lat: 40.0555, lng: -86.0180 },
    '465 ': { lat: 39.9300, lng: -86.0500 },
    'I 69': { lat: 39.9500, lng: -85.9800 },
    'I-69': { lat: 39.9500, lng: -85.9800 },
};

function classifyCallType(callType, agency) {
    const ct = callType.toUpperCase();

    // Fire
    if (ct.startsWith('F ') || ct.startsWith('F-')) return 'fire';
    if (ct.includes('FIRE') || ct.includes('STRUCTURE') || ct.includes('BRUSH') ||
        ct.includes('SMOKE') || ct.includes('GAS LEAK') || ct.includes('CO ALARM') ||
        ct.includes('CARBON MONOXIDE') || ct.includes('HAZMAT') ||
        ct.includes('10-70') || ct.includes('10-71') || ct.includes('10-73')) return 'fire';

    // EMS
    if (ct.startsWith('M ') || ct.startsWith('M-')) return 'ems';
    if (ct.includes('MEDICAL') || ct.includes('STROKE') || ct.includes('CARDIAC') ||
        ct.includes('CHEST PAIN') || ct.includes('SEIZURE') || ct.includes('OVERDOSE') ||
        ct.includes('BREATHING') || ct.includes('FALL') || ct.includes('TRAUMA') ||
        ct.includes('PEDIATRIC') || ct.includes('ALLERGIC') || ct.includes('UNRESPONSIVE') ||
        ct.includes('ABDOMINAL') || ct.includes('DIABETIC') || ct.includes('HEMORRHAGE') ||
        ct.includes('UNCONSCIOUS') || ct.includes('PREGNANCY') ||
        ct.includes('SICK') || ct.includes('CVA') || ct.includes('CHOKING') ||
        ct.includes('DEATH') || ct.includes('DOA') || ct.includes('INJURY') ||
        ct.includes('PAIN') || ct.includes('DIFF BREATH') ||
        ct.includes('10-52') || ct.includes('10-0') || ct.includes('10-79')) return 'ems';

    // Agency fallback
    if (agency) {
        const ag = agency.toUpperCase();
        if (ag.includes('FIRE') || ag.includes('EMS')) {
            if (ct.includes('ALARM')) return 'fire';
            return 'ems';
        }
    }

    return 'police';
}

function translateCallType(callType) {
    let result = callType
        .replace(/^[PMF]\s+/, '')
        .replace(/^[PMF]-/, '')
        .trim();

    // Check for 10-codes in the text
    for (const [code, meaning] of Object.entries(TEN_CODES)) {
        if (result.includes(code)) {
            result = result.replace(code, meaning);
        }
    }

    return result;
}

const GLOBAL_GEO_CACHE = new Map();

/**
 * Normalizes CAD addresses for better geocoding accuracy.
 */
function normalizeAddress(address) {
    if (!address) return '';
    let clean = address.trim().toUpperCase()
        .replace(/\s+/g, ' ')
        .replace(/\d+\s+BLK\s+/, '') // Remove "BLK" prefix
        .replace(/\//g, '&')        // Use & for intersections
        .replace(/\bSR\b/g, 'STATE RD')
        .replace(/\bST RD\b/g, 'STATE RD')
        .replace(/\bHWY\b/g, 'HIGHWAY')
        .replace(/\bINTERSTATE\b/g, 'I')
        .replace(/\bUS\s*(\d+)\b/g, 'US HIGHWAY $1')
        .trim();
    return clean;
}

/**
 * Attempts to geocode an address using Hamilton County ArcGIS FeatureServer.
 */
async function geocodeArcGIS(address, agency) {
    if (!address || address === '<UNKNOWN>' || address === '') return null;

    const queryAddr = normalizeAddress(address);
    if (GLOBAL_GEO_CACHE.has(queryAddr)) {
        return GLOBAL_GEO_CACHE.get(queryAddr);
    }

    try {
        const isIntersection = address.includes(' / ') || address.includes(' & ');
        const layer = isIntersection ? 1 : 0; // Layer 1 = Intersections, Layer 0 = Address Points
        const field = isIntersection ? 'LOC' : 'Add_Full';

        // Build query URL
        const params = new URLSearchParams({
            where: `${field} LIKE '%${queryAddr}%'`,
            outFields: '*',
            returnGeometry: 'true',
            outSR: '4326',
            f: 'json'
        });

        const response = await fetch(`${ARCGIS_BASE}/${layer}/query?${params.toString()}`);
        if (!response.ok) throw new Error('ArcGIS query failed');

        const data = await response.json();
        let result = null;

        if (data.features && data.features.length > 0) {
            const feat = data.features[0];
            result = {
                lat: feat.geometry.y,
                lng: feat.geometry.x,
                accuracy: 'high',
                source: 'ArcGIS'
            };
        }

        if (result) {
            GLOBAL_GEO_CACHE.set(queryAddr, result);
        }
        return result;

        // Secondary attempt for addresses: split into number and street
        if (!isIntersection) {
            const numMatch = address.match(/^(\d+)/);
            const streetMatch = address.match(/^\d+\s+BLK\s+(.+)$/) || address.match(/^\d+\s+(.+)$/);

            if (numMatch && streetMatch) {
                const num = numMatch[1];
                const street = streetMatch[1].split(' ')[0]; // Just the first word of street

                const fallbackParams = new URLSearchParams({
                    where: `Add_Number = ${num} AND St_Name LIKE '${street}%'`,
                    outFields: '*',
                    returnGeometry: 'true',
                    outSR: '4326',
                    f: 'json'
                });

                const fallbackResp = await fetch(`${ARCGIS_BASE}/0/query?${fallbackParams.toString()}`);
                const fallbackData = await fallbackResp.json();

                if (fallbackData.features && fallbackData.features.length > 0) {
                    return {
                        lat: fallbackData.features[0].geometry.y,
                        lng: fallbackData.features[0].geometry.x,
                        accuracy: 'high',
                        source: 'ArcGIS Fallback'
                    };
                }
            }
        }

        return null;
    } catch (err) {
        console.error('Geocoding error:', err.message);
        return null;
    }
}

/**
 * Synchronous fallback geocoding using local lookup.
 * Adds random jitter to prevent stacked markers.
 */
function parseAddress(address, agency) {
    if (!address || address === '<UNKNOWN>' || address === '') return null;

    let clean = address.trim().toUpperCase();
    const blkMatch = clean.match(/^\d+\s+BLK\s+(.+)$/);
    const blockNumber = clean.match(/^(\d+)\s+BLK/);
    const isIntersection = clean.includes(' / ');

    let streetName = clean;
    if (blkMatch) streetName = blkMatch[1].trim();
    else if (isIntersection) streetName = clean.split(' / ')[0].trim();

    // Try Hamilton County-wide geo lookup
    for (const [street, coords] of Object.entries(HAMCO_GEO)) {
        if (streetName.includes(street) || street.includes(streetName)) {
            let offsetLat = 0, offsetLng = 0;
            if (blockNumber) {
                const num = parseInt(blockNumber[1]);
                offsetLat = ((num % 100) / 100) * 0.001 - 0.0005;
                offsetLng = ((num % 73) / 73) * 0.001 - 0.0005;
            } else {
                offsetLat = (Math.random() - 0.5) * 0.002;
                offsetLng = (Math.random() - 0.5) * 0.002;
            }
            return { lat: coords.lat + offsetLat, lng: coords.lng + offsetLng, accuracy: 'low', source: 'Manual' };
        }
    }

    // Fallback to agency city center with spread
    const city = getCityForAgency(agency);
    const center = CITY_CENTERS[city] || CITY_CENTERS['County'];
    return {
        lat: center.lat + (Math.random() - 0.5) * 0.02,
        lng: center.lng + (Math.random() - 0.5) * 0.02,
        accuracy: 'none',
        source: 'CityCenter'
    };
}

function parseNetDate(dateStr) {
    if (!dateStr) return null;
    const match = dateStr.match(/\/Date\((\d+)\)\//);
    if (match) return new Date(parseInt(match[1]));
    return new Date(dateStr);
}

module.exports = {
    TEN_CODES,
    CITY_CENTERS,
    HAMCO_GEO,
    getCityForAgency,
    classifyCallType,
    translateCallType,
    parseAddress,
    geocodeArcGIS,
    normalizeAddress,
    parseNetDate
};

