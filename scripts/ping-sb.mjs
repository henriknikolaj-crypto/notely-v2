const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
fetch(`${url}/rest/v1/plan_limits?select=plan&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` }
})
.then(r => r.json().then(j => console.log({ok:r.ok,status:r.status,json:j})))
.catch(e => console.error("node-fetch error:", e));
