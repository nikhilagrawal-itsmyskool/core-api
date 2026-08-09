// Renders a printable A4 fee/transport receipt — "Clean statement" layout (design A).
// Two copies (parent + office) stacked on ONE A4 page with a tear line between them.

interface ReceiptData {
  schoolName: string;
  receiptNo: string;
  legacyReceiptNo?: string | null;
  date: string;
  receiptType?: string | null;            // 'fee' | 'transport' | 'adhoc' | 'refund'
  studentName?: string | null;
  admissionNo?: string | null;
  className?: string | null;
  fatherName?: string | null;
  motherName?: string | null;
  feeCycle?: string | null;               // cycle_set, e.g. "August" / "April,May"
  paymentMode?: string | null;
  receivedFrom?: string | null;
  collectedBy?: string | null;
  remarks?: string | null;
  description?: string | null;
  lines: { headLabel: string; cycleLabel?: string | null; amount: number; isConcession?: boolean }[];
  totalDue?: number | null;
  totalPaid: number;
  concessionTotal?: number | null;
  advanceApplied?: number | null;
  waiverTotal?: number | null;
  balance?: number | null;
  amountInWords?: string | null;
  status?: string | null;                 // 'active' | 'cancelled'
  cancelReason?: string | null;
}

const money = (v: number) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(s: any): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  // receipt dates are date-only (stored at 00:00 UTC) — read in UTC so the day never shifts
  return `${String(d.getUTCDate()).padStart(2, '0')}-${MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

const detail = (label: string, val: any, wide = false) =>
  val == null || val === '' ? '' : `<div class="d${wide ? ' wide' : ''}"><dt>${esc(label)}</dt><dd>${esc(val)}</dd></div>`;

function copy(d: ReceiptData, label: string): string {
  const cancelled = d.status === 'cancelled';
  const charged = (d.lines || []).filter((l) => !l.isConcession);
  const rows = charged.length
    ? charged.map((l) => `<tr><td>${esc(l.headLabel)}${l.cycleLabel ? ` <span class="cy">(${esc(l.cycleLabel)})</span>` : ''}</td><td class="r money">${money(l.amount)}</td></tr>`).join('')
    : `<tr><td colspan="2" class="empty">${esc(d.description || d.receiptType === 'transport' ? 'Transport fee' : '—')}</td></tr>`;
  const title = d.receiptType === 'transport' ? 'Transport Receipt' : d.receiptType === 'refund' ? 'Refund Receipt' : 'Fee Receipt';
  const bal = Number(d.balance || 0);
  const rno = d.receiptNo + (d.legacyReceiptNo && d.legacyReceiptNo !== d.receiptNo ? ` (${d.legacyReceiptNo})` : '');

  return `
  <section class="copy${cancelled ? ' cx' : ''}">
    ${cancelled ? `<div class="banner">CANCELLED${d.cancelReason ? ` — ${esc(d.cancelReason)}` : ''}</div>` : ''}
    <header class="top">
      <div><div class="sch">${esc(d.schoolName)}</div><div class="ey">${esc(title)}</div></div>
      <div class="rbox">
        <div class="cptag">${esc(label)}</div>
        <div class="rno">${esc(rno)}</div>
        <div class="dt">${esc(fmtDate(d.date))}</div>
      </div>
    </header>

    <dl class="det">
      ${detail('Student', d.studentName)}
      ${detail('Admission', d.admissionNo)}
      ${detail('Father', d.fatherName)}
      ${detail('Mother', d.motherName)}
      ${detail('Class', d.className)}
      ${detail('Mode', d.paymentMode)}
      ${detail('Received from', d.receivedFrom, true)}
      ${detail('Fee cycle', d.feeCycle, true)}
      ${detail('Description', d.description, true)}
    </dl>

    <table class="li">
      <thead><tr><th>Fee head</th><th class="r">Amount (₹)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="tot">
      ${d.totalDue != null ? `<div class="tr"><span>Total due</span><span class="money">${money(d.totalDue)}</span></div>` : ''}
      ${d.concessionTotal ? `<div class="tr"><span>Concession</span><span class="money">(−) ${money(d.concessionTotal)}</span></div>` : ''}
      ${d.advanceApplied ? `<div class="tr"><span>Advance applied</span><span class="money">${money(d.advanceApplied)}</span></div>` : ''}
      ${d.waiverTotal ? `<div class="tr"><span>Waived (write-off)</span><span class="money">${money(d.waiverTotal)}</span></div>` : ''}
      <div class="tr paid"><span>Total paid${d.advanceApplied ? ' (cash)' : ''}</span><span class="money">${money(d.totalPaid)}</span></div>
    </div>
    <div class="bal${bal > 0 ? '' : ' zero'}"><span>${bal > 0 ? 'Balance' : 'Fully paid'}</span><span class="money">₹ ${money(bal)}</span></div>
    ${d.amountInWords ? `<div class="words">Rupees ${esc(d.amountInWords)} only</div>` : ''}
    ${d.remarks ? `<div class="rem"><b>Remarks:</b> ${esc(d.remarks)}</div>` : ''}

    <footer class="foot">
      ${d.collectedBy ? `<div>Collected by: ${esc(d.collectedBy)}</div>` : ''}
      <div>Cheque/draft payments are subject to realisation · Fee once paid is not refundable · E.&amp;O.E.</div>
      <div>This is a computer-generated receipt; no signature is required.</div>
    </footer>
  </section>`;
}

export function buildReceiptHtml(d: ReceiptData): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(d.receiptNo)}</title>
  <style>
    @page { size: A4 portrait; margin: 11mm; }
    *{box-sizing:border-box}
    html,body{margin:0;padding:0}
    body{font-family:'Segoe UI',Roboto,Arial,Helvetica,sans-serif;color:#0f172a;font-size:12px;
      -webkit-print-color-adjust:exact;print-color-adjust:exact;background:#eef1f6}
    .sheet{width:190mm;margin:0 auto;background:#fff}
    .copy{padding:6mm 7mm;position:relative}
    .copy.cx{opacity:.9}
    .banner{border:1px solid #fca5a5;background:#fee2e2;color:#b91c1c;text-align:center;font-weight:700;
      letter-spacing:1px;padding:4px;border-radius:4px;margin-bottom:8px}

    .top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;
      border-bottom:2px solid #0f172a;padding-bottom:10px}
    .sch{font-size:16px;font-weight:800;letter-spacing:-.01em;color:#0f172a}
    .ey{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#64748b;margin-top:3px}
    .rbox{text-align:right;line-height:1.5;white-space:nowrap}
    .cptag{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8}
    .rno{font-weight:700;font-size:12.5px;font-variant-numeric:tabular-nums}
    .dt{font-size:11.5px;color:#475569;font-variant-numeric:tabular-nums}

    .det{display:grid;grid-template-columns:1fr 1fr;gap:6px 26px;margin:11px 0 4px}
    .d{display:grid;grid-template-columns:88px 1fr;align-items:baseline;gap:8px;margin:0}
    .d.wide{grid-column:1/-1}
    .d dt{margin:0;color:#94a3b8;font-size:9.5px;text-transform:uppercase;letter-spacing:.05em}
    .d dd{margin:0;font-weight:600;color:#0f172a}

    table.li{width:100%;border-collapse:collapse;margin-top:8px}
    .li th,.li td{padding:6px 6px}
    .li thead th{font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;
      text-align:left;border-bottom:1px solid #cbd5e1}
    .li thead th.r{text-align:right}
    .li tbody td{border-bottom:1px solid #eef2f7}
    .li td.r{text-align:right}
    .li td.empty{color:#94a3b8}
    .money{font-variant-numeric:tabular-nums}
    .cy{color:#94a3b8;font-weight:400}

    .tot{margin-left:auto;width:56%;min-width:220px;margin-top:8px}
    .tr{display:flex;justify-content:space-between;padding:2.5px 0;color:#475569}
    .tr.paid{border-top:1px solid #cbd5e1;margin-top:3px;padding-top:6px;color:#0f172a;font-weight:700;font-size:12.5px}
    .bal{display:flex;justify-content:space-between;align-items:center;margin:8px 0 0 auto;width:56%;min-width:220px;
      padding:7px 12px;border-radius:8px;border:1px solid #fca5a5;background:#fef2f2;color:#b91c1c;font-weight:700}
    .bal.zero{border-color:#86efac;background:#f0fdf4;color:#15803d}
    .words{margin-top:8px;font-style:italic;color:#334155}
    .rem{margin-top:5px;color:#334155}
    .foot{margin-top:12px;border-top:1px dashed #cbd5e1;padding-top:7px;color:#94a3b8;font-size:9.5px;line-height:1.55}

    /* tear line between the two copies */
    .tear{position:relative;text-align:center;height:0;border-top:1px dashed #94a3b8;margin:0 7mm}
    .tear span{position:relative;top:-8px;background:#fff;padding:0 10px;font-size:9px;letter-spacing:.12em;
      text-transform:uppercase;color:#94a3b8}

    /* screen preview: show the sheet as a page with a soft shadow */
    @media screen{ .sheet{margin:14px auto;box-shadow:0 8px 30px rgba(15,23,42,.14);min-height:277mm} body{padding:0} }

    /* print: both copies fill one A4, tear lands at the middle */
    @media print{
      body{background:#fff}
      .sheet{width:auto;margin:0;box-shadow:none}
      .copy{min-height:128mm}
      .copy, .tear{page-break-inside:avoid}
    }
  </style></head>
  <body><div class="sheet">
    ${copy(d, 'Parent Copy')}
    <div class="tear"><span>✂ &nbsp; tear here &nbsp; ✂</span></div>
    ${copy(d, 'Office Copy')}
  </div></body></html>`;
}
