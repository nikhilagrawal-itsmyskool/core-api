#!/usr/bin/env node
// Standalone quality probe for AI inventory — NO server / DB / auth needed.
//
// Point it at one or more real room photos and it prints the draft inventory
// Claude would produce, scored by confidence. Use it to decide whether the
// vision is good enough BEFORE building any UI.
//
//   node modules/asset/scripts/inventory-vision-probe.js <image1> [image2 ...]
//
// The ANTHROPIC_API_KEY is read from the environment, or (fallback) parsed out
// of configs/local/local.yml so it "just works" on this box. The asset-type
// catalog mirrors ASSET_TYPE_SEEDS in asset-constants.ts (item kinds only) — the
// real endpoint uses the school's live catalog, but seeds are representative.

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.ASSET_VISION_MODEL || 'claude-sonnet-5';

// item-kind seeds (keep in sync with asset-constants.ts ASSET_TYPE_SEEDS)
const CATALOG = [
  ['fan', 'Fan'], ['tube_light', 'Tube Light'], ['ac', 'AC'], ['projector', 'Projector'],
  ['computer', 'Computer'], ['student_desk', 'Student Desk'], ['student_table', 'Student Table'],
  ['student_chair', 'Student Chair'], ['table_chair', 'Table Chair'], ['teacher_table', 'Teacher Table'],
  ['almirah', 'Almirah'], ['cupboard', 'Cupboard'], ['rack', 'Rack'], ['notice_board', 'Notice Board'],
  ['black_board', 'Black Board'], ['white_board', 'White Board'], ['bench', 'Bench'], ['other', 'Other'],
];

const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const cfg = fs.readFileSync(path.join(__dirname, '../../../configs/local/local.yml'), 'utf8');
    const m = cfg.match(/ANTHROPIC_API_KEY:\s*['"]?([^'"\r\n]+)['"]?/);
    if (m) return m[1].trim();
  } catch (_) {}
  return null;
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node inventory-vision-probe.js <image1> [image2 ...]');
    process.exit(1);
  }
  const key = apiKey();
  if (!key) {
    console.error('No ANTHROPIC_API_KEY (env or configs/local/local.yml).');
    process.exit(1);
  }

  const content = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const mediaType = MEDIA[ext];
    if (!mediaType) { console.error(`Unsupported image type: ${f}`); process.exit(1); }
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: fs.readFileSync(f).toString('base64') } });
  }
  const catalogList = CATALOG.map(([c, l]) => `- ${c}: ${l}`).join('\n');
  content.push({ type: 'text', text: `Asset type catalog (code: label):\n${catalogList}\n\nReport what you see using the report_inventory tool. Count only what is visible in these photos.` });

  const system =
    'You are an asset-inventory assistant for an Indian K-12 school. You are shown one or more photos of ONE part ' +
    '(a single wall/zone) of a single room. Identify the FIXED furniture, fixtures and equipment clearly visible and ' +
    'report a count per asset type. Count only items visible in THESE photos. Ignore people, bags, books, papers, ' +
    'decorations, posters, and consumables. When the exact count is unclear, give your best estimate and mark that ' +
    "line's confidence lower. Prefer UNDER-counting to double-counting. Use ONLY the catalog codes; put anything real " +
    'with no matching code into "unmatched".';

  const tools = [{
    name: 'report_inventory',
    description: 'Report the asset types and counts visible in the photos.',
    input_schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object', properties: {
          code: { type: 'string' }, count: { type: 'integer', minimum: 1 }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        }, required: ['code', 'count', 'confidence'] } },
        unmatched: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, count: { type: 'integer', minimum: 1 } }, required: ['label', 'count'] } },
        notes: { type: 'string' },
      },
      required: ['items'],
    },
  }];

  const client = new Anthropic({ apiKey: key });
  console.log(`\nModel: ${MODEL} · ${files.length} image(s)\n`);
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 1024, system, tools,
    tool_choice: { type: 'tool', name: 'report_inventory' },
    messages: [{ role: 'user', content }],
  });

  const call = msg.content.find((c) => c.type === 'tool_use' && c.name === 'report_inventory');
  const input = (call && call.input) || {};
  const codes = new Set(CATALOG.map(([c]) => c));

  console.log('DRAFT INVENTORY');
  console.log('─'.repeat(40));
  for (const it of input.items || []) {
    const known = codes.has(it.code) ? '' : '  ⚠ not in catalog';
    console.log(`  ${String(it.count).padStart(3)}  ${it.code.padEnd(16)} [${it.confidence}]${known}`);
  }
  if ((input.unmatched || []).length) {
    console.log('\nUNMATCHED (needs a type or "other")');
    for (const u of input.unmatched) console.log(`  ${String(u.count).padStart(3)}  ${u.label}`);
  }
  if (input.notes) console.log(`\nNotes: ${input.notes}`);
  console.log('');
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
