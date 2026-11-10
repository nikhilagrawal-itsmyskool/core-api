const BASE = 'https://api-prod.itsmyskool.com';
const H = { 'Content-Type': 'application/json', 'X-School-Code': 'DBPASN' };
const decode = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString());
const code = async (path, token) => (await fetch(`${BASE}${path}`, { headers: { ...H, Authorization: `Bearer ${token}` } })).status;

const lr = await (await fetch(`${BASE}/auth/employee/login`, { method: 'POST', headers: H, body: JSON.stringify({ username: 'rinku', password: 'Itsmyskool@123' }) })).json();
if (!lr.token) { console.log('LOGIN FAILED', lr); process.exit(1); }
console.log('login OK. roles =', decode(lr.token).roles, '| mustChangePassword =', lr.mustChangePassword);

for (const [label, path] of [
  ['uniform items (uniform.inventory.view)', '/uniform/items'],
  ['uniform stats', '/uniform/stats'],
  ['uniform lookups', '/uniform/lookups'],
  ['academic-calendar me', '/academic-calendar/me/calendar'],
]) {
  console.log(`${label}: HTTP ${await code(path, lr.token)}  (200/empty = allowed, 403 = denied)`);
}
