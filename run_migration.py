import requests

url = "https://gucnrzlfzyiyvpuugqgj.supabase.co/rest/v1/rpc/exec_sql"
key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1Y25yemxmenlpeXZwdXVncWdqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTg3MTQ2NywiZXhwIjoyMTAxNDQ3NDY3fQ.xu7a-rW0U6JWlbju-e05iz_xxfKSUTz_bARKyIy_sJ0"

headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json"
}

with open("/home/ubuntu/medflow-connect-32/supabase/migrations/20260812170000_observation_fee_logic.sql", "r") as f:
    sql = f.read()

# Let us check if supabase has a sql execution RPC or if we can run via psql if db url is available
# Or test rpc/exec_sql
resp = requests.post(url, headers=headers, json={"sql": sql})
print("Status code:", resp.status_code)
print("Response:", resp.text)
