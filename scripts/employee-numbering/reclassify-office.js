// Reclassify 3 DBPASN staff as Office Person (OP): change employee_number to DBPASN/OP/<n>
// (starting 101, in date-of-joining order) and employee_type='office'. DEVICE NUMBER UNCHANGED.
// Their old DBPASN/T/<n> numbers are freed (T series keeps the gaps). Dry-run; --write to apply.
const { Pool } = require('pg');
const { getCreds } = require('../student-migration/db-creds');
const WRITE = process.argv.includes('--write');
const PATTERNS = ['%ajay kumar saini%', '%shivendra%', '%ritik agnihotri%'];
const START = 101;

(async () => {
  const pool = new Pool(await getCreds('prod'));
  const client = await pool.connect();
  try {
    const s = (await client.query("select uuid from school where lower(code)='dbpasn'")).rows[0].uuid;
    const found = [];
    for (const pat of PATTERNS) {
      const rows = (await client.query(
        "select uuid,name,employee_number,device_number,employee_type,to_char(date_of_joining,'YYYY-MM-DD') doj from employee where school_id=$1 and status<>'deleted' and lower(name) like $2",
        [s, pat])).rows;
      if (rows.length !== 1) { console.error(`PATTERN "${pat}" matched ${rows.length} (need exactly 1):`, rows.map(r => r.name)); process.exit(1); }
      found.push(rows[0]);
    }
    // order by date of joining (nulls last), then name
    found.sort((a, b) => (a.doj || '9999').localeCompare(b.doj || '9999') || a.name.localeCompare(b.name));
    let n = START;
    const plan = found.map((e) => ({ name: e.name, from: e.employee_number, to: `DBPASN/OP/${n++}`, device: e.device_number, doj: e.doj, uuid: e.uuid }));
    console.table(plan.map(p => ({ name: p.name, from: p.from, to: p.to, device: p.device, doj: p.doj })));
    if (!WRITE) { console.log('\nDRY RUN — pass --write to apply.'); process.exit(0); }
    await client.query('BEGIN');
    for (const p of plan) {
      await client.query(
        "update employee set employee_number=$1, employee_type='office', updatedby_userid='reclassify', updated_at=now() where uuid=$2 and school_id=$3",
        [p.to, p.uuid, s]);
    }
    await client.query('COMMIT');
    console.log(`\n✅ Reclassified ${plan.length} as Office Person (${plan[0].to}..${plan[plan.length-1].to}); devices unchanged.`);
  } catch (e) { await client.query('ROLLBACK'); console.error(e.message); process.exit(1); } finally { client.release(); await pool.end(); }
})();
