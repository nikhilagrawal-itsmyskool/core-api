/**
 * Revert a concession reconcile that ran against un-backfilled (null fee_head_id) charges and
 * wrongly cancelled concessions. Re-activates concessions cancelled by updatedby_userid='reconcile'
 * for the given year. SAFE ONLY when that run added nothing (allocation='reconciled' count = 0);
 * aborts otherwise so it can't create duplicates.
 *
 *   node modules/fees/scripts/revert-reconcile.js --ay <id> --label <yyyy-yy>            # dry-run
 *   node modules/fees/scripts/revert-reconcile.js --ay <id> --label <yyyy-yy> --apply --yes
 */
const fs=require('fs'),path=require('path'),yaml=require('js-yaml');const{Pool}=require('pg');
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i>-1?process.argv[i+1]:d;};const has=k=>process.argv.includes(k);
const STAGE=arg('--stage','prod'),AY=arg('--ay',''),LABEL=arg('--label',''),APPLY=has('--apply')&&has('--yes');
const SCHOOL='2qy0xfycrq88';
const cfg=yaml.load(fs.readFileSync(path.join(__dirname,`../../../configs/${STAGE}/${STAGE}.yml`),'utf8'));
const pool=new Pool({host:cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST,database:cfg.POSTGRES_DATABASE,user:cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER,password:cfg.POSTGRES_PASSWORD,port:parseInt(cfg.POSTGRES_PORT||'5432'),ssl:cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false}});
const inr=x=>'₹'+Math.round(Number(x||0)).toLocaleString('en-IN');
(async()=>{
  if(!AY){console.log('--ay required');await pool.end();return;}
  const reposted=(await pool.query(`select count(*) n, coalesce(sum(credit),0) s from student_ledger_entry where school_id=$1 and academic_year_id=$2 and kind='concession' and allocation='reconciled' and status='active'`,[SCHOOL,AY])).rows[0];
  const cancelled=(await pool.query(`select count(*) n, coalesce(sum(credit),0) s, count(distinct student_id) st from student_ledger_entry where school_id=$1 and academic_year_id=$2 and kind='concession' and status='cancelled' and updatedby_userid='reconcile'`,[SCHOOL,AY])).rows[0];
  console.log(`year ${LABEL} (${AY})`);
  console.log(`  reconcile-reposted concessions still active: ${reposted.n} (${inr(reposted.s)})`);
  console.log(`  reconcile-cancelled concessions to restore : ${cancelled.n} (${inr(cancelled.s)}, ${cancelled.st} students)`);
  if(Number(reposted.n)>0){console.log('\nABORT: this reconcile also reposted concessions — restoring would duplicate. Handle manually.');await pool.end();return;}
  if(APPLY){
    const r=await pool.query(`update student_ledger_entry set status='active', updatedby_userid='revert', updated_at=now() where school_id=$1 and academic_year_id=$2 and kind='concession' and status='cancelled' and updatedby_userid='reconcile'`,[SCHOOL,AY]);
    console.log(`\nRESTORED ${r.rowCount} concession credits to active.`);
  } else console.log('\n(dry-run — pass --apply --yes to restore)');
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
