// Renders a printable HTML fee/transport receipt (parent + office copy).
// SchoolPad-inspired layout, cleaned up: field block + itemised head table + concession/total-due/balance.

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
const field = (label: string, val: any) => val == null || val === '' ? '' : `<div class="f"><span class="k">${esc(label)}</span><span class="v">${esc(val)}</span></div>`;

function copy(d: ReceiptData, label: string): string {
  const cancelled = d.status === 'cancelled';
  const charged = (d.lines || []).filter((l) => !l.isConcession);
  const rows = charged.map((l) => `<tr><td>${esc(l.headLabel)}${l.cycleLabel ? ` <span class="cy">(${esc(l.cycleLabel)})</span>` : ''}</td><td class="r">${money(l.amount)}</td></tr>`).join('');
  const title = (d.receiptType === 'transport' ? 'TRANSPORT RECEIPT' : 'FEE RECEIPT');
  return `
  <div class="copy${cancelled ? ' cx' : ''}">
    ${cancelled ? `<div class="banner">CANCELLED${d.cancelReason ? ` — ${esc(d.cancelReason)}` : ''}</div>` : ''}
    <div class="hd">
      <div class="sch">${esc(d.schoolName)}</div>
      <div class="ttl">${title}</div>
      <div class="cp">${esc(label)}</div>
    </div>
    <div class="meta">
      ${field('Receipt No', d.receiptNo + (d.legacyReceiptNo && d.legacyReceiptNo !== d.receiptNo ? ` (${d.legacyReceiptNo})` : ''))}
      ${field('Date', d.date)}
      ${field('Admission No', d.admissionNo)}
      ${field('Student Name', d.studentName)}
      ${field('Father Name', d.fatherName)}
      ${field('Mother Name', d.motherName)}
      ${field('Class', d.className)}
      ${field('Fee Cycle', d.feeCycle)}
      ${field('Payment Mode', d.paymentMode)}
      ${field('Received From', d.receivedFrom)}
      ${field('Description', d.description)}
    </div>
    <table class="lines"><thead><tr><th>Fee Head</th><th class="r">Amount Paid (Rs.)</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>
        ${d.concessionTotal ? `<tr><td class="r">Concession</td><td class="r">(−) ${money(d.concessionTotal)}</td></tr>` : ''}
        ${d.totalDue != null ? `<tr><td class="r">Total Due</td><td class="r">${money(d.totalDue)}</td></tr>` : ''}
        ${d.advanceApplied ? `<tr><td class="r">Advance Applied</td><td class="r">${money(d.advanceApplied)}</td></tr>` : ''}
        ${d.waiverTotal ? `<tr><td class="r">Waived (write-off)</td><td class="r">${money(d.waiverTotal)}</td></tr>` : ''}
        <tr class="grand"><td class="r"><b>Total Paid${d.advanceApplied ? ' (cash)' : ''}</b></td><td class="r"><b>${money(d.totalPaid)}</b></td></tr>
        ${d.balance ? `<tr><td class="r">Balance</td><td class="r">${money(d.balance)}</td></tr>` : ''}
      </tfoot>
    </table>
    ${d.amountInWords ? `<div class="words"><b>In words:</b> Rupees ${esc(d.amountInWords)} only</div>` : ''}
    ${d.remarks ? `<div class="rem"><b>Remarks:</b> ${esc(d.remarks)}</div>` : ''}
    <div class="ft">
      ${d.collectedBy ? `<div>Collected by: ${esc(d.collectedBy)}</div>` : ''}
      <div class="note">Cheque/draft payments are subject to realisation. Fee once paid is not refundable. E.&amp;O.E.</div>
      <div class="note">This is a computer-generated receipt; no signature is required.</div>
    </div>
  </div>`;
}

export function buildReceiptHtml(d: ReceiptData): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(d.receiptNo)}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#1e293b;font-size:12.5px;margin:0;padding:10px;background:#fff}
    .copy{border:1px solid #cbd5e1;border-radius:6px;padding:14px 18px;margin-bottom:12px;position:relative}
    .copy.cx{opacity:.85}
    .banner{background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;border-radius:4px;text-align:center;font-weight:700;letter-spacing:1px;padding:4px;margin-bottom:8px}
    .hd{text-align:center;border-bottom:2px solid #1e293b;padding-bottom:8px;margin-bottom:10px}
    .sch{font-size:18px;font-weight:800;color:#0f172a}
    .ttl{font-size:12.5px;letter-spacing:2px;margin-top:3px;color:#334155;font-weight:600}
    .cp{font-size:10.5px;letter-spacing:1px;color:#64748b;margin-top:1px}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:3px 24px;margin-bottom:10px}
    .f{display:flex;font-size:12.5px;padding:1px 0}
    .k{color:#64748b;min-width:96px;flex:0 0 96px}
    .v{color:#0f172a;font-weight:600}
    table.lines{width:100%;border-collapse:collapse;margin-top:4px}
    .lines th,.lines td{padding:6px 8px;text-align:left}
    .lines thead th{background:#f1f5f9;border-top:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em;color:#475569}
    .lines tbody td{border-bottom:1px solid #eef2f7}
    .r{text-align:right}.cy{color:#94a3b8;font-weight:400}
    tfoot td{border-top:1px solid #e2e8f0}
    tfoot tr.grand td{border-top:2px solid #cbd5e1;font-size:13.5px}
    .words{margin-top:8px;font-style:italic;color:#334155}
    .rem{margin-top:5px;color:#334155}
    .ft{margin-top:10px;border-top:1px dashed #cbd5e1;padding-top:6px;color:#64748b;font-size:10.5px}
    .note{margin-top:2px}
    @media print{body{padding:0}.copy{page-break-inside:avoid;border-color:#94a3b8}}
  </style></head>
  <body>${copy(d, 'PARENT COPY')}${copy(d, 'OFFICE COPY')}</body></html>`;
}
