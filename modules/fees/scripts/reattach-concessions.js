/**
 * Re-attach concession credits to the correct charge WITHOUT changing any amount.
 *
 * The migration sometimes linked a concession credit to the wrong charge within a cycle (e.g. the
 * ₹2000 caution waiver landed on the ₹200 Registration charge instead of the ₹2000 Caution Fee).
 * The credit AMOUNT is correct (it encodes real percentages / late-fee waivers); only its target is
 * wrong. This moves each mis-attached credit to the charge matching (its concession's intended head,
 * its own cycle), preserving credit/amount. Uses the definition's HEAD only (reliable), never its
 * VALUE (unreliable in prior years). Idempotent — a no-op once every credit is on the right head.
 *
 *   node modules/fees/scripts/reattach-concessions.js --ay <id> --label <yyyy-yy>            # DRY-RUN
 *   node modules/fees/scripts/reattach-concessions.js --ay <id> --label <yyyy-yy> --apply --yes
 */
const fs=require('fs'),path=require('path'),yaml=require('js-yaml');const{Pool}=require('pg');
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>-1?process.argv[i+1]:d;};const has=k=>process.argv.includes(k);
const STAGE=arg('--stage','prod'),AY=arg('--ay',''),LABEL=arg('--label',''),APPLY=has('--apply')&&has('--yes');
const SCHOOL='2qy0xfycrq88';
const cfg=yaml.load(fs.readFileSync(path.join(__dirname,`../../../configs/${STAGE}/${STAGE}.yml`),'utf8'));
const pool=new Pool({host:cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST,database:cfg.POSTGRES_DATABASE,user:cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER,password:cfg.POSTGRES_PASSWORD,port:parseInt(cfg.POSTGRES_PORT||'5432'),ssl:cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false}});
const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase(),n=v=>v==null?0:Number(v),inr=x=>'₹'+Math.round(Number(x||0)).toLocaleString('en-IN');
const P=[SCHOOL,AY];
(async()=>{
  if(!AY){console.log('--ay required');await pool.end();return;}
  const nameHead={};(await pool.query(`select name,fee_head_id from fee_concession where school_id=$1 and academic_year_id=$2 and status='active'`,P)).rows.forEach(r=>nameHead[norm(r.name)]=r.fee_head_id);
  const charges=(await pool.query(`select uuid,student_id,fee_head_id,cycle_id,cycle_label from student_ledger_entry where school_id=$1 and academic_year_id=$2 and kind='charge' and status='active'`,P)).rows;
  const chargeById={};charges.forEach(c=>chargeById[c.uuid]=c);
  const chByKey={};charges.forEach(c=>{chByKey[`${c.student_id}|${c.fee_head_id}|${norm(c.cycle_label)}`]=c;});
  const creds=(await pool.query(`select uuid,student_id,settles_entry_id,credit,head_label,cycle_label from student_ledger_entry where school_id=$1 and academic_year_id=$2 and kind='concession' and status='active' and settles_entry_id is not null`,P)).rows;

  const moves=[]; let ok=0,already=0,noDef=0,noTarget=0;
  for(const cr of creds){
    const cur=chargeById[cr.settles_entry_id]; if(!cur) continue;
    const head=nameHead[norm(cr.head_label)];
    if(!head){ noDef++; continue; }
    if(cur.fee_head_id===head){ already++; continue; }   // correctly attached — leave (amount untouched)
    const target=chByKey[`${cr.student_id}|${head}|${norm(cr.cycle_label)}`];
    if(!target){ noTarget++; continue; }
    moves.push({credit:cr.uuid, to:target.uuid, feeHead:target.fee_head_id, cycleId:target.cycle_id});
    ok++;
  }
  const movedAmt=creds.filter(c=>moves.find(m=>m.credit===c.uuid)).reduce((s,c)=>s+n(c.credit),0);
  console.log(`================ RE-ATTACH CONCESSIONS ${APPLY?'APPLY':'DRY-RUN'} — ${LABEL} ================`);
  console.log(`concession credits: ${creds.length}`);
  console.log(`  already on correct head (left as-is): ${already}`);
  console.log(`  TO MOVE to correct charge (amount preserved): ${ok}  (${inr(movedAmt)})`);
  console.log(`  skipped — concession name has no def head: ${noDef}`);
  console.log(`  skipped — no matching target charge: ${noTarget}`);
  if(APPLY){
    const client=await pool.connect(); let done=0;
    try{ await client.query('begin');
      for(const m of moves){ await client.query(`update student_ledger_entry set settles_entry_id=$1, fee_head_id=$2, cycle_id=$3, updatedby_userid='reattach', updated_at=now() where uuid=$4`,[m.to,m.feeHead,m.cycleId,m.credit]); done++; }
      await client.query('commit');
    }catch(e){ await client.query('rollback'); console.error('FAILED, rolled back:',e.message); client.release(); await pool.end(); return; }
    client.release();
    console.log(`\nAPPLIED: re-attached ${done} concession credits (amounts unchanged).`);
  } else console.log('\n(dry-run — pass --apply --yes to write)');
  await pool.end();
})().catch(e=>{console.error(e);process.exit(1);});
