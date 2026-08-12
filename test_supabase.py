import requests

url = "https://gucnrzlfzyiyvpuugqgj.supabase.co/rest/v1/rpc/admission_discharge_preview"
key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1Y25yemxmenlpeXZwdXVncWdqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTg3MTQ2NywiZXhwIjoyMTAxNDQ3NDY3fQ.xu7a-rW0U6JWlbju-e05iz_xxfKSUTz_bARKyIy_sJ0"

headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json"
}

# Let us test calling admission_discharge_preview with a dummy uuid or listing admissions
admissions_url = "https://gucnrzlfzyiyvpuugqgj.supabase.co/rest/v1/admissions?select=id,admitted_at,discharged_at&limit=5"
resp = requests.get(admissions_url, headers=headers)
print("Admissions status:", resp.status_code)
print("Admissions:", resp.text)
