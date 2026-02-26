import system
import datetime
import json
import base64
import urllib
import re

# === Configuration ===
SUPABASE_URL = "https://atcwvurzrdfhceqmqgnv.supabase.co"
SUPABASE_KEY = "sb_publishable_Wi1WkXEmcyJl99lAypqUYw_D5uvE9Ve"
HAMCO_API_URL = "https://secure2.hamiltoncounty.in.gov/DailyIncidents/Daily_Log/Incidents_Read"
ARCGIS_BASE = "https://gis1.hamiltoncounty.in.gov/arcgis/rest/services/HamCo911/FeatureServer"

# Local cache for this single execution to prevent double-probing the same address
GEO_CACHE = {}

# === 10-Code Reference ===
TEN_CODES = {
    '10-0': 'Fatality', '10-1': 'Signal Weak', '10-3': 'Stop Transmitting', '10-4': 'Acknowledged',
    '10-7': 'Out of Service', '10-8': 'In Service', '10-10': 'Fight in Progress', '10-11': 'Animal Problem',
    '10-14': 'Prowler/Burglar', '10-15': 'Civil Disturbance', '10-16': 'Domestic Problem', '10-18': 'Urgent',
    '10-20': 'Location Request', '10-21': 'Phone Call', '10-22': 'Disregard', '10-23': 'Arrived on Scene',
    '10-24': 'Assignment Complete', '10-26': 'Detaining Subject', '10-27': 'Drivers License Check',
    '10-28': 'Vehicle Registration', '10-29': 'Check Wants/Warrants', '10-31': 'Crime in Progress',
    '10-32': 'Person with Gun', '10-33': 'Emergency', '10-34': 'Riot', '10-35': 'Major Crime Alert',
    '10-37': 'Suspicious Person/Vehicle', '10-38': 'Stopping Suspicious Vehicle', '10-39': 'Urgent Lights & Siren',
    '10-40': 'Silent Response', '10-46': 'Disabled Vehicle', '10-48': 'Traffic Control', '10-50': 'Traffic Accident',
    '10-50F': 'Fatal Traffic Accident', '10-50PI': 'Injury Accident', '10-50PD': 'Property Damage Accident',
    '10-51': 'Wrecker Needed', '10-52': 'Ambulance Needed', '10-53': 'Road Blocked', '10-54': 'Livestock on Road',
    '10-55': 'Intoxicated Driver', '10-56': 'Intoxicated Person', '10-57': 'Hit & Run', '10-70': 'Fire Alarm',
    '10-71': 'Fire Nature Unknown', '10-72': 'Fire Progress Report', '10-73': 'Smoke Report', '10-76': 'En Route',
    '10-77': 'ETA', '10-78': 'Request Assistance', '10-79': 'Notify Coroner', '10-80': 'Pursuit in Progress',
    '10-89': 'Bomb Threat', '10-90': 'Burglar Alarm', '10-95': 'Subject in Custody', '10-96': 'Mental Subject'
}

# === Utils ===
def normalize_address(address):
    if not address: return ""
    clean = address.strip().upper()
    clean = re.sub(r'\d+\s+BLK\s+', '', clean)
    clean = clean.replace('/', '&')
    clean = re.sub(r'\bSR\b', 'STATE RD', clean)
    clean = re.sub(r'\bST RD\b', 'STATE RD', clean)
    clean = re.sub(r'\bHWY\b', 'HIGHWAY', clean)
    clean = re.sub(r'\bUS\s*(\d+)\b', r'US HIGHWAY \1', clean)
    return clean.strip()

def get_arcgis_coords(address):
    if not address or address in ["<UNKNOWN>", ""]: return None
    
    # Check local cache first
    norm = normalize_address(address)
    if norm in GEO_CACHE: return GEO_CACHE[norm]
    
    try:
        is_intersection = " / " in address or " & " in address
        layer = 1 if is_intersection else 0
        field = "LOC" if is_intersection else "Add_Full"
        
        # Build Query
        where_clause = "%s LIKE '%%%s%%'" % (field, norm)
        params = urllib.urlencode({
            "where": where_clause, "outFields": "*", "returnGeometry": "true", "outSR": "4326", "f": "json"
        })
        
        url = "%s/%d/query?%s" % (ARCGIS_BASE, layer, params)
        # Add a tight timeout (2s) to prevent script hanging
        res_raw = system.net.httpGet(url, 2000, 2000)
        data = system.util.jsonDecode(res_raw)
        
        if data.get("features"):
            geom = data["features"][0].get("geometry", {})
            coords = {"lat": geom.get("y"), "lng": geom.get("x")}
            GEO_CACHE[norm] = coords
            return coords
            
        # Fallback for addresses: split number and street
        if not is_intersection:
            num_match = re.search(r'^(\d+)', address)
            street_match = re.search(r'^\d+\s+BLK\s+(.+)$', address) or re.search(r'^\d+\s+(.+)$', address)
            
            if num_match and street_match:
                num = num_match.group(1)
                street = street_match.group(1).split(" ")[0]
                
                where_clause = "Add_Number = %s AND St_Name LIKE '%s%%'" % (num, street)
                params = urllib.urlencode({
                    "where": where_clause, "outFields": "*", "returnGeometry": "true", "outSR": "4326", "f": "json"
                })
                url = "%s/0/query?%s" % (ARCGIS_BASE, params)
                res_raw = system.net.httpGet(url, 2000, 2000)
                data = system.util.jsonDecode(res_raw)
                
                if data.get("features"):
                    geom = data["features"][0].get("geometry", {})
                    coords = {"lat": geom.get("y"), "lng": geom.get("x")}
                    GEO_CACHE[norm] = coords
                    return coords
                    
        return None
    except:
        return None

def get_city_for_agency(agency):
    if not agency: return 'County'
    ag = agency.lower()
    if 'noblesville' in ag: return 'Noblesville'
    if 'carmel' in ag: return 'Carmel'
    if 'fishers' in ag: return 'Fishers'
    if 'westfield' in ag: return 'Westfield'
    if 'cicero' in ag: return 'Cicero'
    if 'sheridan' in ag: return 'Sheridan'
    if 'arcadia' in ag: return 'Arcadia'
    return 'County'

def classify_call_type(call_type, agency):
    ct = call_type.upper()
    if ct.startswith('F ') or ct.startswith('F-'): return 'fire'
    if any(x in ct for x in ['FIRE', 'STRUCTURE', 'BRUSH', 'SMOKE', 'GAS LEAK', 'CO ALARM', 'HAZMAT', '10-70']): return 'fire'
    if ct.startswith('M ') or ct.startswith('M-'): return 'ems'
    if any(x in ct for x in ['MEDICAL', 'STROKE', 'CARDIAC', 'OVERDOSE', 'BREATHING', 'TRAUMA', '10-52', '10-0']): return 'ems'
    if agency:
        ag = agency.upper()
        if 'FIRE' in ag or 'EMS' in ag:
            return 'fire' if 'ALARM' in ct else 'ems'
    return 'police'

def translate_call_type(call_type):
    result = call_type.lstrip('PMF -').strip()
    for code, meaning in TEN_CODES.items():
        if code in result:
            result = result.replace(code, meaning)
    return result

def parse_net_date(date_str):
    try:
        timestamp = int(date_str[6:-2])
        return system.date.fromMillis(timestamp)
    except:
        return system.date.now()

# === Main Script ===
try:
    # 1. Fetch from Hamilton County
    postData = "sort=DateTime-desc&group=&filter=&page=1&pageSize=500"
    headers = { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" }
    
    response = system.net.httpPost(HAMCO_API_URL, "application/x-www-form-urlencoded", postData, headerValues=headers, throwOnError=False)
    data = system.util.jsonDecode(response)
    raw_incidents = data.get("Data", [])
    
    transformed = []
    geo_count = 0
    max_geo = 20 # Only geocode top 20 fresh incidents per run to keep it snappy
    
    # 2. Transform the data
    for raw in raw_incidents:
        try:
            timestamp = parse_net_date(raw.get("DateTime", ""))
            iso_time = system.date.format(timestamp, "yyyy-MM-dd'T'HH:mm:ss.SSSZ")
            
            call_type = raw.get("Call_Type", "")
            agency = raw.get("Agency", "")
            address = raw.get("Address", "Address Pending")
            
            # Geocoding with local cache check
            lat, lng = None, None
            if geo_count < max_geo:
                coords = get_arcgis_coords(address)
                if coords:
                    lat, lng = coords["lat"], coords["lng"]
                    geo_count += 1
            
            incident_id = str(raw.get("Incident_Number") or ("HC-" + str(raw.get("ID", ""))))
            incident = {
                "id": incident_id,
                "type": str(classify_call_type(call_type, agency)),
                "description": str(translate_call_type(call_type)),
                "raw_call_type": str(call_type),
                "address": str(address),
                "agency": str(agency),
                "city": str(get_city_for_agency(agency)),
                "timestamp": str(iso_time),
                "incident_number": str(raw.get("Incident_Number", "")),
                "is_noblesville": bool(agency in ["Noblesville Fire", "Noblesville Police"]),
                "lat": lat, "lng": lng
            }
            transformed.append(incident)
        except Exception: pass

    if transformed:
        unique_incidents = {}
        for inc in transformed:
            unique_incidents[inc["id"]] = inc
        final_payload = unique_incidents.values()

        # 3. Upsert into Supabase
        supabase_endpoint = SUPABASE_URL + "/rest/v1/incidents?on_conflict=id"
        supabase_headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": "Bearer " + SUPABASE_KEY,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
        }
        
        system.net.httpPost(supabase_endpoint, "application/json", json.dumps(final_payload), 10000, 10000, "", "", supabase_headers, False, False)
        
        # 4. Auto-Purge old data (> 30 days)
        try:
            purge_time = system.date.addDays(system.date.now(), -30)
            iso_purge_time = system.date.format(purge_time, "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
            delete_endpoint = SUPABASE_URL + "/rest/v1/incidents?timestamp=lte." + urllib.quote(iso_purge_time)
            system.net.httpDelete(delete_endpoint, headerValues=supabase_headers, throwOnError=False)
        except Exception: pass

except Exception: pass

