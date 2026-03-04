/**
 * Generate Excel (.xlsx) templates for data-sync imports.
 *
 * Each template has:
 *   - "Data" sheet with headers, sample rows, and dropdown validation
 *   - "Lookups" sheet with valid values for dropdown fields
 *
 * Usage:
 *   node modules/data-sync/scripts/generate-templates.js
 */

const ExcelJS = require('exceljs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname);

// Style for required header columns
const requiredHeaderFill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF0F0' },
};
const requiredHeaderFont = { bold: true, color: { argb: 'FFCC0000' } };
const normalHeaderFont = { bold: true };

// Lookup range size — generous so schools can extend without regenerating
const LOOKUP_ROWS = 100;

const TEMPLATES = [
  {
    filename: 'sample-employees.xlsx',
    headers: [
      { key: 'name', label: 'name', required: true },
      { key: 'phone_number', label: 'phone_number', required: true, numFmt: '@' },
      { key: 'role', label: 'role', required: true },
      { key: 'gender', label: 'gender' },
      { key: 'dob', label: 'dob' },
      { key: 'email', label: 'email' },
      { key: 'whatsapp', label: 'whatsapp', numFmt: '@' },
      { key: 'status', label: 'status' },
    ],
    lookups: {
      role: ['teacher', 'class-teacher', 'principal', 'lab-assistant'],
      gender: ['M', 'F'],
      status: ['active', 'inactive', 'deleted'],
    },
    sampleRows: [
      { name: 'Jane Doe', phone_number: '9876543210', role: 'teacher', gender: 'F', dob: '1985-06-15', email: 'jane@example.com', whatsapp: '9876543210', status: 'active' },
      { name: 'John Smith', phone_number: '9876543211', role: 'class-teacher', gender: 'M', dob: '1980-03-22', email: 'john@example.com', whatsapp: '9876543211', status: 'active' },
      { name: 'Priya Sharma', phone_number: '9876543212', role: 'principal', gender: 'F', dob: '1975-11-08', email: 'priya@example.com', whatsapp: '9876543212', status: 'active' },
      { name: 'Amit Patel', phone_number: '9876543213', role: 'lab-assistant', gender: 'M', dob: '1990-01-30', email: '', whatsapp: '9876543213', status: 'active' },
    ],
  },
  {
    filename: 'sample-students.xlsx',
    headers: [
      { key: 'admission_number', label: 'admission_number', required: true, numFmt: '@' },
      { key: 'name', label: 'name', required: true },
      { key: 'class', label: 'class', required: true },
      { key: 'academic_session', label: 'academic_session', required: true },
      { key: 'gender', label: 'gender' },
      { key: 'dob', label: 'dob' },
      { key: 'father_mobile', label: 'father_mobile', numFmt: '@' },
      { key: 'mother_mobile', label: 'mother_mobile', numFmt: '@' },
      { key: 'old_admission_number', label: 'old_admission_number', numFmt: '@' },
      { key: 'status', label: 'status' },
    ],
    lookups: {
      class: [
        'I', 'I-A', 'I-B', 'II', 'II-A', 'II-B',
        'III', 'III-A', 'III-B', 'IV', 'IV-A', 'IV-B',
        'V', 'V-A', 'V-B', 'VI', 'VI-A', 'VI-B',
        'VII', 'VII-A', 'VII-B', 'VIII', 'VIII-A', 'VIII-B',
        'IX', 'IX-A', 'IX-B', 'X', 'X-A', 'X-B',
        'XI', 'XI-A', 'XI-B', 'XII', 'XII-A', 'XII-B',
      ],
      academic_session: ['2025-26', '2026-27'],
      gender: ['M', 'F'],
      status: ['active', 'inactive', 'deleted'],
    },
    sampleRows: [
      { admission_number: 'S001', name: 'Rahul Kumar', class: 'IX-A', academic_session: '2025-26', gender: 'M', dob: '2010-05-15', father_mobile: '9876543210', mother_mobile: '9876543211', old_admission_number: '', status: 'active' },
      { admission_number: 'S002', name: 'Anita Singh', class: 'IX-B', academic_session: '2025-26', gender: 'F', dob: '2010-08-22', father_mobile: '9876543212', mother_mobile: '9876543213', old_admission_number: '', status: 'active' },
      { admission_number: 'S003', name: 'Vikram Patel', class: 'X-A', academic_session: '2025-26', gender: 'M', dob: '2009-12-03', father_mobile: '9876543214', mother_mobile: '9876543215', old_admission_number: '', status: 'active' },
      { admission_number: 'S004', name: 'Neha Gupta', class: 'X-B', academic_session: '2025-26', gender: 'F', dob: '2009-07-19', father_mobile: '9876543216', mother_mobile: '9876543217', old_admission_number: '', status: 'active' },
    ],
  },
  {
    filename: 'sample-medical-items.xlsx',
    headers: [
      { key: 'name', label: 'name', required: true },
      { key: 'unit', label: 'unit', required: true },
      { key: 'reorder_level', label: 'reorder_level' },
      { key: 'current_stock', label: 'current_stock' },
      { key: 'comments', label: 'comments' },
      { key: 'status', label: 'status' },
    ],
    lookups: {
      unit: ['tablet', 'capsule', 'ml', 'tube', 'sachet', 'strip', 'bottle', 'piece', 'roll', 'pair', 'box'],
      status: ['active', 'deleted'],
    },
    sampleRows: [
      { name: 'Paracetamol', unit: 'tablet', reorder_level: '50', current_stock: '200', comments: 'General fever and pain relief', status: 'active' },
      { name: 'Crocin Syrup', unit: 'ml', reorder_level: '20', current_stock: '100', comments: 'Pediatric fever syrup', status: 'active' },
      { name: 'Band-Aid', unit: 'piece', reorder_level: '30', current_stock: '150', comments: 'Adhesive bandages', status: 'active' },
      { name: 'Dettol', unit: 'bottle', reorder_level: '5', current_stock: '10', comments: 'Antiseptic liquid', status: 'active' },
      { name: 'Cotton Roll', unit: 'roll', reorder_level: '10', current_stock: '25', comments: 'Surgical cotton', status: 'active' },
      { name: 'ORS Sachets', unit: 'sachet', reorder_level: '20', current_stock: '80', comments: 'Oral rehydration salts', status: 'active' },
    ],
  },
  {
    filename: 'sample-labs.xlsx',
    headers: [
      { key: 'name', label: 'name', required: true },
      { key: 'type', label: 'type', required: true },
      { key: 'location', label: 'location' },
      { key: 'in_charge_phone', label: 'in_charge_phone', numFmt: '@' },
      { key: 'status', label: 'status' },
    ],
    lookups: {
      type: ['physics', 'chemistry', 'biology', 'computer', 'language', 'mathematics', 'other'],
      status: ['active', 'inactive', 'deleted'],
    },
    sampleRows: [
      { name: 'Physics Lab', type: 'physics', location: 'Block A Room 101', in_charge_phone: '', status: 'active' },
      { name: 'Chemistry Lab', type: 'chemistry', location: 'Block A Room 102', in_charge_phone: '', status: 'active' },
      { name: 'Biology Lab', type: 'biology', location: 'Block B Room 201', in_charge_phone: '', status: 'active' },
      { name: 'Computer Lab', type: 'computer', location: 'Block C Room 301', in_charge_phone: '', status: 'active' },
    ],
  },
  {
    filename: 'sample-lab-items.xlsx',
    headers: [
      { key: 'lab_name', label: 'lab_name', required: true },
      { key: 'name', label: 'name', required: true },
      { key: 'category', label: 'category' },
      { key: 'item_type', label: 'item_type', required: true },
      { key: 'unit', label: 'unit', required: true },
      { key: 'current_stock', label: 'current_stock' },
      { key: 'reorder_level', label: 'reorder_level' },
      { key: 'location', label: 'location' },
      { key: 'item_condition', label: 'item_condition' },
      { key: 'cost_per_unit', label: 'cost_per_unit' },
      { key: 'comments', label: 'comments' },
      { key: 'status', label: 'status' },
    ],
    lookups: {
      lab_name: ['Physics Lab', 'Chemistry Lab', 'Biology Lab', 'Computer Lab'],
      item_type: ['equipment', 'consumable'],
      unit: ['piece', 'set', 'bottle', 'packet', 'ml', 'gm', 'kg', 'box', 'roll', 'pair', 'strip', 'litre', 'dozen', 'ream'],
      item_condition: ['new', 'good', 'fair', 'needs_repair', 'condemned'],
      status: ['active', 'deleted'],
    },
    sampleRows: [
      { lab_name: 'Physics Lab', name: 'Voltmeter', category: 'Electrical', item_type: 'equipment', unit: 'piece', current_stock: '10', reorder_level: '2', location: 'Cabinet A', item_condition: 'good', cost_per_unit: '500', comments: '', status: 'active' },
      { lab_name: 'Physics Lab', name: 'Ammeter', category: 'Electrical', item_type: 'equipment', unit: 'piece', current_stock: '10', reorder_level: '2', location: 'Cabinet A', item_condition: 'good', cost_per_unit: '450', comments: '', status: 'active' },
      { lab_name: 'Physics Lab', name: 'Connecting Wires', category: 'Electrical', item_type: 'consumable', unit: 'set', current_stock: '25', reorder_level: '5', location: 'Drawer B', item_condition: 'good', cost_per_unit: '50', comments: '', status: 'active' },
      { lab_name: 'Chemistry Lab', name: 'Beaker 250ml', category: 'Glassware', item_type: 'equipment', unit: 'piece', current_stock: '30', reorder_level: '5', location: 'Shelf A', item_condition: 'good', cost_per_unit: '120', comments: '', status: 'active' },
      { lab_name: 'Chemistry Lab', name: 'Test Tubes', category: 'Glassware', item_type: 'consumable', unit: 'piece', current_stock: '100', reorder_level: '20', location: 'Rack B', item_condition: 'good', cost_per_unit: '15', comments: '', status: 'active' },
      { lab_name: 'Chemistry Lab', name: 'Litmus Paper', category: 'Reagent', item_type: 'consumable', unit: 'strip', current_stock: '200', reorder_level: '50', location: 'Cabinet C', item_condition: 'new', cost_per_unit: '5', comments: '', status: 'active' },
      { lab_name: 'Biology Lab', name: 'Microscope', category: 'Optical', item_type: 'equipment', unit: 'piece', current_stock: '15', reorder_level: '3', location: 'Cabinet A', item_condition: 'good', cost_per_unit: '8000', comments: '', status: 'active' },
      { lab_name: 'Biology Lab', name: 'Glass Slides', category: 'Optical', item_type: 'consumable', unit: 'box', current_stock: '20', reorder_level: '5', location: 'Shelf B', item_condition: 'good', cost_per_unit: '200', comments: '', status: 'active' },
      { lab_name: 'Computer Lab', name: 'Keyboard', category: 'Peripheral', item_type: 'equipment', unit: 'piece', current_stock: '40', reorder_level: '5', location: 'Desk', item_condition: 'good', cost_per_unit: '300', comments: '', status: 'active' },
      { lab_name: 'Computer Lab', name: 'Mouse', category: 'Peripheral', item_type: 'equipment', unit: 'piece', current_stock: '40', reorder_level: '5', location: 'Desk', item_condition: 'good', cost_per_unit: '200', comments: '', status: 'active' },
    ],
  },
];

/**
 * Get the Excel column letter for a 1-based index (1=A, 2=B, ... 26=Z, 27=AA).
 */
function colLetter(index) {
  let letter = '';
  let n = index;
  while (n > 0) {
    n--;
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26);
  }
  return letter;
}

async function generateTemplate(template) {
  const workbook = new ExcelJS.Workbook();
  const dataSheet = workbook.addWorksheet('Data');
  const lookupsSheet = workbook.addWorksheet('Lookups');

  // --- Lookups sheet ---
  const lookupKeys = Object.keys(template.lookups);
  const lookupColMap = {}; // field -> { col letter, count }

  lookupKeys.forEach((field, idx) => {
    const col = idx + 1;
    const letter = colLetter(col);
    const values = template.lookups[field];

    // Header
    lookupsSheet.getCell(1, col).value = field;
    lookupsSheet.getCell(1, col).font = { bold: true };

    // Values
    values.forEach((val, rowIdx) => {
      lookupsSheet.getCell(rowIdx + 2, col).value = val;
    });

    lookupColMap[field] = { letter, count: values.length };
  });

  // --- Data sheet ---

  // Header row
  const headerRow = dataSheet.getRow(1);
  template.headers.forEach((h, idx) => {
    const col = idx + 1;
    const cell = headerRow.getCell(col);
    cell.value = h.label;
    cell.font = h.required ? requiredHeaderFont : normalHeaderFont;
    if (h.required) {
      cell.fill = requiredHeaderFill;
    }

    // Set column format (text for phone/admission numbers)
    if (h.numFmt) {
      dataSheet.getColumn(col).numFmt = h.numFmt;
    }

    // Auto-width
    dataSheet.getColumn(col).width = Math.max(h.label.length + 4, 14);
  });

  // Freeze header row
  dataSheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Sample data rows
  template.sampleRows.forEach((rowData, rowIdx) => {
    const row = dataSheet.getRow(rowIdx + 2);
    template.headers.forEach((h, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = rowData[h.key] || '';
    });
  });

  // Data validation (dropdowns) — apply to rows 2 through 1000
  template.headers.forEach((h, colIdx) => {
    if (lookupColMap[h.key]) {
      const { letter } = lookupColMap[h.key];
      const dataCol = colLetter(colIdx + 1);

      for (let r = 2; r <= 1000; r++) {
        dataSheet.getCell(`${dataCol}${r}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`Lookups!$${letter}$2:$${letter}$${LOOKUP_ROWS}`],
          showErrorMessage: true,
          errorTitle: 'Invalid value',
          error: `Please select a valid ${h.key} from the dropdown`,
        };
      }
    }
  });

  const outputPath = path.join(OUTPUT_DIR, template.filename);
  await workbook.xlsx.writeFile(outputPath);
  console.log(`  Created: ${template.filename}`);
}

async function main() {
  console.log('\nGenerating Excel templates...\n');

  for (const template of TEMPLATES) {
    await generateTemplate(template);
  }

  console.log('\nDone! Templates created in:', OUTPUT_DIR);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
