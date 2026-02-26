import system
import datetime
import json
import base64

# === Configuration ===
SUPABASE_URL = "https://atcwvurzrdfhceqmqgnv.supabase.co"
SUPABASE_KEY = "sb_publishable_Wi1WkXEmcyJl99lAypqUYw_D5uvE9Ve"
HAMCO_API_URL = "https://secure2.hamiltoncounty.in.gov/DailyIncidents/Daily_Log/Incidents_Read"

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
        # Extracts 1234567890000 from "/Date(1234567890000)/"
        timestamp = int(date_str[6:-2])
        return system.date.fromMillis(timestamp)
    except:
        return system.date.now()

# === Main Script ===
try:
    # 1. Fetch from Hamilton County
    postData = "sort=&group=&filter=&page=1&pageSize=500"
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest"
    }
    
    response = system.net.httpPost(HAMCO_API_URL, "application/x-www-form-urlencoded", postData, headerValues=headers, throwOnError=False)
    data = system.util.jsonDecode(response)
    raw_incidents = data.get("Data", [])
    
    transformed = []
    
    # 2. Transform the data
    for raw in raw_incidents:
        try:
            timestamp = parse_net_date(raw.get("DateTime", ""))
            # Use 'Z' for Java backwards compatibility (RFC 822 Timezone like -0500 which Postgres accepts)
            iso_time = system.date.format(timestamp, "yyyy-MM-dd'T'HH:mm:ss.SSSZ")
            
            call_type = raw.get("Call_Type", "")
            agency = raw.get("Agency", "")
            
            # Construct dictionary, omitting lat/lng explicitly so Postgres safely assumes DEFAULT (NULL)
            # Casting all elements to safe pure-Python strings/booleans specifically so json.dumps doesn't choke on Java Objects
            incident_id = str(raw.get("Incident_Number") or ("HC-" + str(raw.get("ID", ""))))
            incident = {
                "id": incident_id,
                "type": str(classify_call_type(call_type, agency)),
                "description": str(translate_call_type(call_type)),
                "raw_call_type": str(call_type),
                "address": str(raw.get("Address", "Address Pending")),
                "agency": str(agency),
                "city": str(get_city_for_agency(agency)),
                "timestamp": str(iso_time),
                "incident_number": str(raw.get("Incident_Number", "")),
                "is_noblesville": bool(agency in ["Noblesville Fire", "Noblesville Police"])
            }
            transformed.append(incident)
        except Exception, parseErr:
            print("Error parsing row: " + str(parseErr))

    if not transformed:
        print("No incidents to insert.")
        
    else:
        # Deduplicate transformed list by ID to prevent Postgres 21000 ON CONFLICT ON UPDATE errors
        unique_incidents = {}
        for inc in transformed:
            unique_incidents[inc["id"]] = inc
        final_payload = unique_incidents.values()

        # 3. Upsert into Supabase REST API
        supabase_endpoint = SUPABASE_URL + "/rest/v1/incidents?on_conflict=id"
        
        supabase_headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": "Bearer " + SUPABASE_KEY,
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
        }
        
        # We use python's json.dumps because Ignition's system.util.jsonEncode can sometimes swallow Python None/Lists
        json_payload = json.dumps(final_payload)
        
        # Use positional arguments for backwards compatibility in older versions of Ignition (in case kwargs fail silently)
        # signature: system.net.httpPost(url, contentType, postData, connectTimeout, readTimeout, username, password, headerValues, bypassCertValidation, throwOnError)
        supabase_res = system.net.httpPost(
            supabase_endpoint,          # url
            "application/json",         # contentType
            json_payload,               # postData
            10000,                      # connectTimeout
            10000,                      # readTimeout
            "",                         # username
            "",                         # password
            supabase_headers,           # headerValues
            False,                      # bypassCertValidation
            False                       # throwOnError
        )
        
        # Inspect Supabase's actual output! Usually an empty string "" means it succeeded
        print("Supabase returned: " + str(supabase_res))
        
        if "message" in str(supabase_res) and "code" in str(supabase_res):
            print("WARNING: Data may have been rejected! " + str(supabase_res))
        else:
            print("Successfully processed " + str(len(final_payload)) + " incidents.")

        # 4. Auto-Purge old data (> 30 days) to stay within Supabase free tier
        try:
            import urllib
            purge_time = system.date.addDays(system.date.now(), -30)
            # Use literal 'Z' to avoid '+' in URL params getting parsed as spaces
            iso_purge_time = system.date.format(purge_time, "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
            
            # The Supabase REST API lets us DELETE based on criteria in the query string
            delete_endpoint = SUPABASE_URL + "/rest/v1/incidents?timestamp=lte." + urllib.quote(iso_purge_time)
            
            del_res = system.net.httpDelete(
                delete_endpoint,
                headerValues=supabase_headers,
                throwOnError=False
            )
            # Empty response ("") usually indicates successful deletion in Supabase
            if "message" in str(del_res) and "code" in str(del_res):
                print("WARNING: Purge may have failed! " + str(del_res))
            else:
                print("Successfully purged data older than 30 days.")
        except Exception, delErr:
            print("Error purging old data: " + str(delErr))

except Exception, e:
    print("Error running scraper: " + str(e))
