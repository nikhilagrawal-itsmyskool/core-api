// AI-assisted inventory capture for the asset register.
//
// The pain this solves: nobody does the physical inventory because *typing* the
// register is miserable. So we flip data ENTRY into data REVIEW — a staff member
// photographs one zone of a room, Claude vision drafts "what + roughly how many"
// against the school's own asset_type catalog, and the operator only corrects the
// counts and taps Save. The confirmed lines are written as quantity BUCKETS under
// the room node (not individualised items) via the normal asset create path.
//
// Two operations:
//   analyze(images)         -> draft lines [{typeId, typeCode, label, count, confidence}]
//   commit(roomId, lines)   -> create one quantity-bucket asset per line under the room
//
// Deliberately NOT in scope for v1: storing the photos as evidence, condition
// grading from the image (the model must not assert condition), per-item QR
// tagging, and cross-photo de-duplication (the operator shoots non-overlapping
// zones and is the arbiter of "already counted" — see the PWA loop).

import Anthropic from '@anthropic-ai/sdk';
import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { assetService } from './asset-service';
import { Asset } from './asset-interfaces';

// Vision model — overridable per-stage without a code change. Sonnet-class is the
// sweet spot for recognition + rough counting at low latency/cost; bump to an
// Opus id for hard rooms if quality demands it.
const VISION_MODEL = process.env.ASSET_VISION_MODEL || 'claude-sonnet-5';
const MAX_IMAGES = 6; // one room-zone sweep; more than this is a workflow smell
const MAX_TOKENS = 1024;

let anthropic: Anthropic | null = null;
function llm(): Anthropic {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface InventoryImage {
  data: string; // base64 (no data: prefix) — the handler strips any prefix
  mediaType: string; // image/jpeg | image/png | image/webp | image/gif
}

export interface DraftLine {
  typeId: string;
  typeCode: string;
  label: string;
  count: number;
  confidence: Confidence;
}

export interface AnalyzeResult {
  draft: DraftLine[];
  // Things the model saw but that don't map to any catalog type — surfaced so the
  // operator can add a type or pick 'other', never silently dropped.
  unmatched: { label: string; count: number }[];
  notes: string;
  model: string;
}

export interface CommitLine {
  typeId: string;
  count: number;
  assetCondition?: string | null;
}

const SUPPORTED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

class AssetInventoryService {
  // The item-kind types the school actually has. Containers (room/floor/…) are not
  // inventory targets, so the model is only ever offered 'item' types.
  private async itemCatalog(schoolId: string): Promise<{ uuid: string; code: string; label: string }[]> {
    return DB.query(
      singleLineString`
        select uuid, code, label from asset_type
        where school_id = $1 and status = 'active' and kind = 'item'
        order by label
      `,
      [schoolId]
    );
  }

  // ---- analyze: photos -> draft counts ----
  public async analyze(images: InventoryImage[], schoolId: string): Promise<AnalyzeResult> {
    if (!images || images.length === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'At least one image is required');
    }
    if (images.length > MAX_IMAGES) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `At most ${MAX_IMAGES} images per analyze`);
    }
    for (const img of images) {
      if (!img.data) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Each image needs base64 data');
      if (!SUPPORTED_MEDIA.has(img.mediaType)) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, `Unsupported image type: ${img.mediaType}`);
      }
    }

    const catalog = await this.itemCatalog(schoolId);
    if (catalog.length === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'No asset types configured for this school');
    }
    const byCode = new Map(catalog.map((c) => [c.code, c]));

    const catalogList = catalog.map((c) => `- ${c.code}: ${c.label}`).join('\n');
    const system = singleLineString`
      You are an asset-inventory assistant for an Indian K-12 school. You are shown one or
      more photos of ONE part (a single wall/zone) of a single room. Identify the FIXED
      furniture, fixtures and equipment that are clearly visible, and report a count per
      asset type. Count only items visible in THESE photos — do not guess at the rest of the
      room. Ignore people, bags, books, papers, decorations, posters, and anything that is a
      consumable rather than a durable asset. When the exact count is unclear (many identical
      items, partial occlusion), give your best estimate and mark that line's confidence
      lower. Prefer UNDER-counting to double-counting. Use ONLY the asset type codes from the
      catalog below; put anything real that has no matching code into "unmatched".
    `;
    const content: any[] = images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data },
    }));
    content.push({ type: 'text', text: `Asset type catalog (code: label):\n${catalogList}\n\nReport what you see using the report_inventory tool. Count only what is visible in these photos.` });

    const tools: any[] = [
      {
        name: 'report_inventory',
        description: 'Report the asset types and counts visible in the photos.',
        input_schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  code: { type: 'string', description: 'An asset type code from the catalog' },
                  count: { type: 'integer', minimum: 1 },
                  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                },
                required: ['code', 'count', 'confidence'],
              },
            },
            unmatched: {
              type: 'array',
              description: 'Real assets seen that have no matching catalog code',
              items: {
                type: 'object',
                properties: { label: { type: 'string' }, count: { type: 'integer', minimum: 1 } },
                required: ['label', 'count'],
              },
            },
            notes: { type: 'string', description: 'Short caveats (occlusion, uncertainty).' },
          },
          required: ['items'],
        },
      },
    ];

    const msg = await llm().messages.create({
      model: VISION_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      tools,
      tool_choice: { type: 'tool', name: 'report_inventory' },
      messages: [{ role: 'user', content }],
    });

    const call = (msg.content as any[]).find((c) => c.type === 'tool_use' && c.name === 'report_inventory');
    const input = (call?.input as any) || {};
    const rawItems: any[] = Array.isArray(input.items) ? input.items : [];
    const rawUnmatched: any[] = Array.isArray(input.unmatched) ? input.unmatched : [];

    // Map model codes to the school's real types; fold a hallucinated/unknown code into
    // unmatched rather than inventing a type. Merge duplicate codes (keep the lower
    // confidence, sum the counts) so one type never appears twice in the draft.
    const draftByCode = new Map<string, DraftLine>();
    const unmatched: { label: string; count: number }[] = rawUnmatched
      .filter((u) => u && u.label && Number(u.count) > 0)
      .map((u) => ({ label: String(u.label).slice(0, 64), count: Math.round(Number(u.count)) }));

    for (const it of rawItems) {
      const code = String(it?.code || '').trim();
      const count = Math.round(Number(it?.count));
      if (!code || !(count > 0)) continue;
      const type = byCode.get(code);
      if (!type) {
        unmatched.push({ label: code, count });
        continue;
      }
      const conf: Confidence = ['high', 'medium', 'low'].includes(it?.confidence) ? it.confidence : 'low';
      const existing = draftByCode.get(code);
      if (existing) {
        existing.count += count;
        existing.confidence = this.lowerOf(existing.confidence, conf);
      } else {
        draftByCode.set(code, { typeId: type.uuid, typeCode: code, label: type.label, count, confidence: conf });
      }
    }

    return {
      draft: [...draftByCode.values()],
      unmatched,
      notes: String(input.notes || '').slice(0, 500),
      model: VISION_MODEL,
    };
  }

  private lowerOf(a: Confidence, b: Confidence): Confidence {
    const rank: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
    return rank[a] <= rank[b] ? a : b;
  }

  // ---- commit: confirmed draft -> quantity-bucket assets under the room ----
  public async commit(
    roomId: string,
    lines: CommitLine[],
    schoolId: string,
    userId: string
  ): Promise<{ created: Asset[]; count: number }> {
    if (!roomId) throw new BusinessErrorResult(ErrorCode.BusinessError, 'roomId is required');
    if (!lines || lines.length === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'At least one line is required');
    }

    const room = await assetService.getById(roomId, schoolId);
    if (!room) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Room not found');
    if ((room as any).kind !== 'container') {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Inventory must be committed under a container (e.g. a room)');
    }

    const catalog = await this.itemCatalog(schoolId);
    const byId = new Map(catalog.map((c) => [c.uuid, c]));

    const created: Asset[] = [];
    for (const line of lines) {
      const type = byId.get(line.typeId);
      if (!type) throw new BusinessErrorResult(ErrorCode.BusinessError, `Unknown or non-item asset type: ${line.typeId}`);
      const count = Math.round(Number(line.count));
      if (!(count > 0)) throw new BusinessErrorResult(ErrorCode.BusinessError, `Count must be at least 1 for ${type.label}`);
      // One quantity bucket per confirmed type. The normal create path leaves buckets
      // (quantity > 1) untagged; they individualise into coded items later if ever needed.
      const asset = await assetService.create(
        {
          typeId: line.typeId,
          name: type.label,
          parentId: roomId,
          quantity: count,
          assetCondition: (line.assetCondition as any) || undefined,
        } as any,
        schoolId,
        userId
      );
      created.push(asset);
    }
    return { created, count: created.length };
  }
}

export const assetInventoryService = new AssetInventoryService();
