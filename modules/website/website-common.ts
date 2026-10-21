import { DB, singleLineString } from "../../shared/lib/db";
import { WebsiteConfig, SourceMoment } from "./website-interfaces";
import { DEFAULT_LOCALE, CMA_TOKEN_ENV } from "./website-constants";
const { serviceAuthHeader } = require("../../shared/util/service-token.js");

// Base URL other modules are reached at (the API domain in prod; the gateway locally).
const API_BASE = process.env.COMM_BASE_URL || "http://localhost:3000";

export async function getSchoolIdByCode(schoolCode: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode],
  );
  return rows.length > 0 ? rows[0].uuid : null;
}

// Per-school Contentful connection. null = the module is not enabled for this school.
export async function getConfig(schoolId: string): Promise<WebsiteConfig | null> {
  const rows = await DB.query(
    singleLineString`select space_id, environment, default_locale from website_config
      where school_id = $1 and status = 'active' limit 1`,
    [schoolId],
  );
  if (!rows.length) return null;
  return { spaceId: rows[0].spaceId, environment: rows[0].environment, defaultLocale: rows[0].defaultLocale || DEFAULT_LOCALE };
}

// The CMA token (shared via env, resolved from SSM at deploy).
export function getCmaToken(): string | null {
  return process.env[CMA_TOKEN_ENV] || null;
}

export async function findEmployeeName(schoolId: string, employeeId: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select name from employee where uuid = $1 and school_id = $2`,
    [employeeId, schoolId],
  );
  return rows.length > 0 ? rows[0].name : null;
}

// ── Read the Moments pool via outreach's public API (service token). We never touch the
//    outreach tables — the website module is a pure consumer. ────────────────────────────

async function outreachGet(path: string, schoolCode: string): Promise<any> {
  const res = await fetch(`${API_BASE}/outreach${path}`, {
    headers: { "X-School-Code": schoolCode, Authorization: serviceAuthHeader({ name: "website" }) },
  });
  if (!res.ok) throw new Error(`outreach GET ${path} -> ${res.status}`);
  return res.json();
}

// Light list of moments to choose from (title + counts; no photos).
export async function listSourceMoments(schoolCode: string, status?: string): Promise<any[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const rows = await outreachGet(`/moments${q}`, schoolCode);
  return Array.isArray(rows) ? rows : [];
}

// A single moment with its photos (each carries fileId for byte retrieval + imageUrl for preview).
export async function getSourceMoment(schoolCode: string, momentId: string): Promise<SourceMoment | null> {
  try {
    const m = await outreachGet(`/moments/${momentId}`, schoolCode);
    if (!m || !m.uuid) return null;
    return {
      uuid: m.uuid,
      title: m.title || null,
      body: m.body || null,
      status: m.status,
      publishedAt: m.publishedAt || null,
      photos: (m.photos || []).map((p: any) => ({
        photoId: p.uuid,
        fileId: p.fileId || null,
        caption: p.caption || null,
        imageUrl: p.imageUrl || null,
      })),
    };
  } catch {
    return null;
  }
}
