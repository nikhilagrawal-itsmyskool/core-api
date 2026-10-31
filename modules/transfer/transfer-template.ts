// Renders a printable A4 Transfer Certificate matching the DBPASN CBSE-style form:
// masthead (logo + school header), a 23-field numbered body, verification QR, and
// the three signature columns. Pure function — all data assembled by the service.

export interface TcTemplateData {
  tc: any;         // stored student_tc row (camelCase)
  derived: any;    // live-derived identity (DerivedStudent) — may be null
  branding: any;   // TcBranding (school header + logo data URI + cbse no)
  feeConcession: string;
  qrDataUri?: string | null;
  verifyUrl?: string | null;
  watermark?: string | null; // e.g. "DRAFT — NOT ISSUED" / "CANCELLED"; null when issued
  showBookNo?: boolean;      // render the "Book No." line (default true)
}

const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
const up = (s: any) => (s == null || s === '' ? '' : String(s).toUpperCase());

// 'YYYY-MM-DD' or a JS Date (pg returns date columns as Date) -> 'DD-MM-YYYY',
// using local getters so the calendar day never shifts under IST.
function dmy(s: any): string {
  if (!s) return '';
  if (s instanceof Date) {
    return `${String(s.getDate()).padStart(2, '0')}-${String(s.getMonth() + 1).padStart(2, '0')}-${s.getFullYear()}`;
  }
  const str = String(s).slice(0, 10);
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : esc(s);
}

const FAILED: Record<string, string> = { no: 'NO', once: 'ONCE', twice: 'TWICE' };
const YESNO: Record<string, string> = { yes: 'YES', no: 'NO' };

// One numbered field row: label on the left, value sitting on an underline.
function row(num: string, label: string, value: string, extra = ''): string {
  return `<div class="r"><span class="n">${num}</span><span class="l">${label}</span><span class="v ${extra}">${value || ''}</span></div>`;
}

export function buildTransferCertificateHtml(d: TcTemplateData): string {
  const tc = d.tc || {};
  const s = d.derived || {};
  const b = d.branding || {};

  const name = esc(s.name || '');
  const dobFig = dmy(s.dob);
  const dobWords = up(s.dobInWords);
  const classFig = esc(s.classFigures || '');
  const classWords = up(s.classWords || '');
  const failed = FAILED[String(tc.failedInClass || '').toLowerCase()] ?? up(tc.failedInClass);
  const promo = YESNO[String(tc.qualifiedForPromotion || '').toLowerCase()] ?? up(tc.qualifiedForPromotion);
  const concession = esc(d.feeConcession || tc.feeConcession || 'NO');

  // Top-left corner note mirrors the samples: result · presence · category · adm no.
  const corner = [up(tc.result), tc.totalAttendanceDays, up(s.category), s.admissionNumber]
    .filter((x) => x !== null && x !== undefined && x !== '').join(' ');

  const addressLines = esc(b.address || '')
    .split(/\n|,(?=\s*[A-Z])/).map((x: string) => x.trim()).filter(Boolean).join(', ');
  const contactLine = [b.contact ? `Contact No. : ${esc(b.contact)}` : ''].filter(Boolean).join('');
  const webLine = [b.email ? `E-mail : ${esc(b.email)}` : '', b.website ? `Web: ${esc(b.website)}` : '']
    .filter(Boolean).join('  |  ');

  const body = [
    row('1.', 'Name of Pupil', name),
    row('2.', "Mother's Name", esc(s.motherName || '')),
    row('3.', "Father's / Guardian's Name", esc(s.fatherName || '')),
    `<div class="r"><span class="n">4.</span><span class="l">Date of Birth (In Christian Era) according to Admission &amp; Withdrawal Register</span></div>
     <div class="r sub"><span class="l2">(In figures)</span><span class="v w-fig">${dobFig}</span><span class="l2">(In words)</span><span class="v">${dobWords}</span></div>`,
    row('5.', 'Nationality', up(s.nationality)),
    row('6.', 'Whether the Candidate belongs to Schedule Caste or Schedule Tribe or OBC', up(s.category)),
    row('7.', 'Date of first admission in the school (with class)', dmy(s.admissionDate)),
    `<div class="r"><span class="n">8.</span><span class="l">Class in which the pupil last studied (in figures)</span><span class="v w-fig">${classFig}</span><span class="l2">(in words)</span><span class="v">${classWords}</span></div>`,
    row('9.', 'School / Board Annual Examination last taken with result', up(tc.result)),
    row('10.', 'Whether failed, if so once / twice in the same class', failed),
    row('11.', 'Subject studied', esc(tc.subjectsStudied || '')),
    row('12.', 'Whether qualified for promotion to the higher class', promo),
    row('13.', 'Month upto which the pupil has paid school dues', up(tc.duesPaidUpto)),
    row('14.', 'Any fee concession availed of ; if so, the nature of such concession', concession),
    row('15.', 'Total No. of working days in the academic session', esc(tc.totalWorkingDays ?? '')),
    row('16.', 'Total No. of presence in the academic session', esc(tc.totalAttendanceDays ?? '')),
    row('17.', 'Whether NCC Cadet / Boy Scout / Girl Guide (details may be given)', esc(tc.nccScoutGuide || '')),
    row('18.', 'Games Played or extra-curricular activities in which the pupil usually took part', esc(tc.gamesActivities || '')),
    row('19.', 'General Conduct', up(tc.generalConduct)),
    row('20.', 'Date of application for certificate', dmy(tc.applicationDate)),
    row('21.', 'Date of issue of certificate', dmy(tc.issueDate)),
    row('22.', 'Reasons for leaving the School', up(tc.reasonForLeaving)),
    row('23.', 'Any other remarks', esc(tc.remarks || '')),
  ].join('\n');

  const logo = b.logoDataUri ? `<img class="logo" src="${b.logoDataUri}" alt="">` : '';
  const qr = d.qrDataUri
    ? `<div class="qr"><img src="${d.qrDataUri}" alt="verify"><div class="qrcap">Scan to verify</div></div>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8"><title>Transfer Certificate ${esc(tc.tcNumber || tc.uuid || '')}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  *{box-sizing:border-box}
  body{font-family:'Segoe UI',Roboto,Arial,Helvetica,sans-serif;color:#111;font-size:12px;margin:0;background:#f3f4f6;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{background:#fff;max-width:200mm;margin:10px auto;padding:14mm 14mm 10mm;position:relative;min-height:287mm}
  .corner{position:absolute;top:6mm;left:12mm;font-size:10px;color:#333;letter-spacing:.3px}
  .mast{display:flex;align-items:flex-start;gap:14px;justify-content:center;text-align:center;margin-bottom:6px}
  .logo{width:72px;height:72px;object-fit:contain}
  .mast .txt{flex:0 1 auto}
  .sname{color:#c0202a;font-weight:800;font-style:italic;font-size:26px;line-height:1.1;letter-spacing:.5px}
  .motto{color:#c0202a;font-style:italic;font-size:13px;margin-top:-2px}
  .addr{font-size:11px;color:#222;margin-top:4px;line-height:1.5}
  .title{text-align:center;font-weight:800;font-size:17px;letter-spacing:1px;margin:14px 0 8px;text-decoration:underline}
  .hd{display:flex;justify-content:space-between;font-weight:600;margin:6px 2px}
  .ids{display:flex;gap:10px;align-items:flex-end;margin:4px 2px 12px;flex-wrap:wrap}
  .ids .f{display:flex;gap:6px;align-items:flex-end}
  .ids .fv{border-bottom:1px solid #333;min-width:120px;padding:0 6px;font-weight:600;text-align:center}
  .r{display:flex;align-items:flex-end;gap:6px;margin:3px 0;line-height:1.5}
  .r .n{width:22px;flex:0 0 22px}
  .r .l{flex:0 1 auto}
  .r .l2{flex:0 0 auto;padding:0 4px;color:#333}
  .r .v{flex:1 1 auto;border-bottom:1px dotted #555;min-height:16px;padding:0 8px;font-weight:600;text-align:center}
  .r .v.w-fig,.ids .fv{flex:0 0 150px}
  .r.sub{margin-left:22px}
  .foot{display:flex;justify-content:space-between;margin-top:46px;text-align:center;font-size:11px}
  .foot .c{flex:1}
  .foot .c .ln{margin-top:2px;font-weight:600}
  .qr{position:absolute;right:14mm;bottom:30mm;text-align:center}
  .qr img{width:84px;height:84px}
  .qrcap{font-size:9px;color:#444;margin-top:2px}
  .watermark{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-32deg);
    font-size:60px;font-weight:800;letter-spacing:4px;color:#c0202a;opacity:.14;white-space:nowrap;
    pointer-events:none;z-index:5;text-transform:uppercase;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @media print{body{background:#fff}.sheet{margin:0;max-width:none;min-height:auto;box-shadow:none}}
</style></head>
<body>
  <div class="sheet">
    ${d.watermark ? `<div class="watermark">${esc(d.watermark)}</div>` : ''}
    ${corner ? `<div class="corner">${esc(corner)}</div>` : ''}
    <div class="mast">
      ${logo}
      <div class="txt">
        <div class="sname">${esc(b.schoolName || '')}</div>
        ${b.motto ? `<div class="motto">${esc(b.motto)}</div>` : ''}
        <div class="addr">${addressLines}${contactLine ? `<br>${contactLine}` : ''}${webLine ? `<br>${webLine}` : ''}</div>
      </div>
    </div>
    <div class="title">TRANSFER CERTIFICATE</div>
    <div class="hd">
      <span>${d.showBookNo === false ? '' : `Book No.: ${esc(tc.bookNo || '')}`}</span>
      <span>S.R.N.: ${esc(tc.srnNumber || '')}</span>
    </div>
    <div class="ids">
      <div class="f">Adm No. <span class="fv">${esc(s.admissionNumber || '')}</span></div>
      <div class="f">TC No. <span class="fv">${esc(tc.tcNumber || '')}</span></div>
      <div class="f">CBSE Reg No. <span class="fv">${esc(b.cbseRegNo || '')}</span></div>
    </div>
    ${body}
    ${qr}
    <div class="foot">
      <div class="c">SIGNATURE OF<br>CLASS TEACHER</div>
      <div class="c">CHECKED BY<br>(With Full name &amp; Designation)</div>
      <div class="c">SIGNATURE OF PRINCIPAL<br>(with Date &amp; School Seal)</div>
    </div>
  </div>
</body></html>`;
}
