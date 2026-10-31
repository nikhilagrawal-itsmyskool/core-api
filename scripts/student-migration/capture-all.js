// Comprehensive careful capture for the 49: one page load per student gives the Student Info
// tab (dob/gender/category/nationality/admission/mother-tongue/withdrawal) from innerText AND
// the Parents pane (father/mother name+mobile+occupation) from the page HTML. Cross-checks
// parent name/mobile against the quick-search data; flags any mismatch. Writes out/final-49.json.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = 'https://dbpasn.schoolpad.in';
const USER_DATA = path.join(__dirname, '..', 'exam-migration', '.browser');
const OUT = path.join(__dirname, 'out');
for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) { try { fs.rmSync(path.join(USER_DATA, f), { force: true }); } catch {} }

const norm = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const mob = (s) => { const m = String(s || '').match(/\b([6-9]\d{9})\b/); return m ? m[1] : null; };

// value on the line after a label, from an innerText line array
function infoVal(lines, labels) {
  for (const lab of labels) {
    for (let j = 0; j < lines.length; j++) {
      if (lines[j].toLowerCase() === lab.toLowerCase()) {
        for (let k = j + 1; k < Math.min(j + 3, lines.length); k++) { const v = lines[k].trim(); if (v && v !== '---') return v; if (v === '---') return null; }
      }
    }
  }
  return null;
}

// parse a parent block (Father's Details / Mother's Details) from full HTML
function parentBlock(html, heading) {
  const i = html.indexOf(heading);
  if (i < 0) return {};
  const seg = html.slice(i, i + 8000);
  const lines = seg.replace(/<\/(td|tr|th|div|p|li|h\d|span|b)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // lines[0] = heading; name is the next non-label line
  let name = null;
  for (let k = 1; k < lines.length; k++) { if (!/^(username|mobile|occupation|designation|organisation|address|country|state|city|pincode|nationality|email|qualification|education|-->)$/i.test(lines[k]) && lines[k] !== '---') { name = lines[k]; break; } if (/username|mobile/i.test(lines[k])) break; }
  const val = (label) => { const idx = lines.findIndex((l) => l.toLowerCase() === label.toLowerCase()); if (idx < 0) return null; for (let k = idx + 1; k < Math.min(idx + 3, lines.length); k++) if (lines[k] && lines[k] !== '---') return lines[k]; return null; };
  return { name: cleanName(name), mobile: mob(val('Mobile No.')), occupation: (val('Occupation') === '---' ? null : val('Occupation')) };
}

(async () => {
  const matched = JSON.parse(fs.readFileSync(path.join(OUT, 'qs-matched-49.json'), 'utf8'));
  const ctx = await chromium.launchPersistentContext(USER_DATA, { headless: false, channel: 'chrome', viewport: null, acceptDownloads: true, ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled'] });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(BASE + '/studentReport/display', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 40; i++) { if (await page.evaluate(() => !!document.querySelector('#ui-student-lookup')).catch(() => false)) break; await page.waitForTimeout(2000); }

  const out = [];
  for (let i = 0; i < matched.length; i++) {
    const m = matched[i];
    await page.goto(`${BASE}/studentInfo/display/${m.studentId}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(500);
    const innerText = await page.evaluate(() => document.body.innerText);
    const html = await page.content();
    const lines = innerText.split('\n').map((l) => l.trim());
    const info = {
      gender: infoVal(lines, ['Gender']),
      nationality: infoVal(lines, ['Nationality']),
      dob: infoVal(lines, ['Date Of Birth', 'Date of Birth']),
      category: infoVal(lines, ['Category']),
      motherTongue: infoVal(lines, ['Mother Tongue']),
      admDate: infoVal(lines, ['Date Of Admission', 'Date of Admission']),
      placeOfBirth: infoVal(lines, ['Place Of Birth']),
      domicile: infoVal(lines, ['Domicile']),
      withdrawalDate: infoVal(lines, ['Withdrawal Date']),
      withdrawalRemarks: infoVal(lines, ['Withdrawal Remarks']),
    };
    const father = parentBlock(html, "Father's Details");
    const mother = parentBlock(html, "Mother's Details");
    // cross-check vs quick-search
    const flags = [];
    if (father.name && cleanName(m.father) && norm(father.name) !== norm(m.father)) flags.push(`father name qs="${cleanName(m.father)}" profile="${father.name}"`);
    if (mother.name && cleanName(m.mother) && norm(mother.name) !== norm(m.mother)) flags.push(`mother name qs="${cleanName(m.mother)}" profile="${mother.name}"`);
    out.push({ adm: m.adm, uuid: m.uuid, studentId: m.studentId, className: m.className, withdrawn: m.withdrawn,
      info,
      father: { name: father.name || cleanName(m.father), mobile: father.mobile || mob(m.fMob), occupation: father.occupation },
      mother: { name: mother.name || cleanName(m.mother), mobile: mother.mobile || mob(m.mMob), occupation: mother.occupation },
      qs: { dob: m.dob }, flags });
    if (i % 10 === 0 || i === matched.length - 1 || flags.length) console.log(`  ${i + 1}/${matched.length} ${m.adm} F="${out[i].father.name}" M="${out[i].mother.name}" cat=${info.category} dob=${info.dob} adm=${info.admDate}${flags.length ? ' ⚠ ' + flags.join('; ') : ''}`);
  }
  fs.writeFileSync(path.join(OUT, 'final-49.json'), JSON.stringify(out, null, 1));
  console.log('\nwrote out/final-49.json (' + out.length + '); flagged:', out.filter((x) => x.flags.length).length);
  await ctx.close();
})().catch((e) => { console.error(String(e).slice(0, 500)); process.exit(1); });
