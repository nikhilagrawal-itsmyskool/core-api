// Renders a printable HTML fee receipt (parent + office copy). Itemized per head/cycle.

interface ReceiptData {
  schoolName: string;
  receiptNo: string;
  legacyReceiptNo?: string | null;
  date: string;
  studentName?: string | null;
  admissionNo?: string | null;
  className?: string | null;
  fatherName?: string | null;
  paymentMode?: string | null;
  receivedFrom?: string | null;
  collectedBy?: string | null;
  remarks?: string | null;
  lines: { headLabel: string; cycleLabel?: string | null; amount: number }[];
  totalPaid: number;
  balance?: number | null;
  amountInWords?: string | null;
}

const money = (v: number) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

function copy(d: ReceiptData, label: string): string {
  const rows = d.lines.map((l) => `<tr><td>${esc(l.headLabel)}${l.cycleLabel ? ` <span class="cy">(${esc(l.cycleLabel)})</span>` : ''}</td><td class="r">${money(l.amount)}</td></tr>`).join('');
  return `
  <div class="copy">
    <div class="hd"><div class="sch">${esc(d.schoolName)}</div><div class="ttl">FEE RECEIPT <span class="cp">${label}</span></div></div>
    <div class="meta">
      <div><b>No:</b> ${esc(d.receiptNo)}${d.legacyReceiptNo ? ` <span class="cy">(${esc(d.legacyReceiptNo)})</span>` : ''}</div>
      <div><b>Date:</b> ${esc(d.date)}</div>
      <div><b>Student:</b> ${esc(d.studentName)} ${d.admissionNo ? `(${esc(d.admissionNo)})` : ''}</div>
      <div><b>Class:</b> ${esc(d.className)}</div>
      ${d.fatherName ? `<div><b>Father:</b> ${esc(d.fatherName)}</div>` : ''}
      <div><b>Mode:</b> ${esc(d.paymentMode)}${d.receivedFrom ? ` &nbsp; <b>From:</b> ${esc(d.receivedFrom)}` : ''}</div>
    </div>
    <table class="lines"><thead><tr><th>Particulars</th><th class="r">Amount (Rs.)</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="r"><b>Total Paid</b></td><td class="r"><b>${money(d.totalPaid)}</b></td></tr>
      ${d.balance ? `<tr><td class="r">Balance</td><td class="r">${money(d.balance)}</td></tr>` : ''}</tfoot>
    </table>
    ${d.amountInWords ? `<div class="words"><b>In words:</b> ${esc(d.amountInWords)}</div>` : ''}
    <div class="ft">
      <div>${d.collectedBy ? `Collected by: ${esc(d.collectedBy)}` : ''} ${d.remarks ? `&nbsp;|&nbsp; ${esc(d.remarks)}` : ''}</div>
      <div class="verify">Verify: ${esc(d.receiptNo)}</div>
      <div class="note">Computer-generated receipt. Fee once paid is not refundable. E.&amp;O.E.</div>
    </div>
  </div>`;
}

export function buildReceiptHtml(d: ReceiptData): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(d.receiptNo)}</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;color:#222;font-size:13px;margin:0;padding:10px}
    .copy{border:1px solid #999;padding:12px 16px;margin-bottom:12px}
    .hd{text-align:center;border-bottom:1px solid #ccc;padding-bottom:6px;margin-bottom:8px}
    .sch{font-size:17px;font-weight:700}.ttl{font-size:13px;letter-spacing:1px;margin-top:2px}
    .cp{color:#666;font-weight:400}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;margin-bottom:8px}
    table.lines{width:100%;border-collapse:collapse;margin-top:4px}
    .lines th,.lines td{border-bottom:1px solid #eee;padding:5px 6px;text-align:left}
    .lines th{background:#f4f6fb;border-bottom:1px solid #ccc}
    .r{text-align:right}.cy{color:#777;font-weight:400}
    tfoot td{border-top:1px solid #ccc;border-bottom:none}
    .words{margin-top:6px;font-style:italic}
    .ft{margin-top:8px;border-top:1px dashed #ccc;padding-top:6px;color:#555;font-size:11px}
    .verify{font-family:monospace;margin-top:2px}.note{margin-top:4px}
    @media print{.copy{page-break-inside:avoid}}
  </style></head>
  <body>${copy(d, 'PARENT COPY')}${copy(d, 'OFFICE COPY')}</body></html>`;
}
