import { CtfTag } from "./website-interfaces";

// Minimal Contentful Management API (CMA) client over raw fetch — no SDK dependency. Handles
// the binary Upload API, asset create/process/publish WITH per-asset metadata tags, and entry
// create/publish. All mutating calls carry X-Contentful-Version (optimistic locking).
const CMA_HOST = "https://api.contentful.com";
const UPLOAD_HOST = "https://upload.contentful.com";

const tagLinks = (ids: string[] = []) =>
  ids.filter(Boolean).map((id) => ({ sys: { type: "Link", linkType: "Tag", id } }));

export class ContentfulClient {
  constructor(
    private readonly spaceId: string,
    private readonly environment: string,
    private readonly token: string,
    private readonly locale = "en-US",
  ) {}

  private base(): string {
    return `${CMA_HOST}/spaces/${this.spaceId}/environments/${this.environment}`;
  }

  // CMA JSON call with 429 retry. `version` sets X-Contentful-Version; `contentType` sets
  // X-Contentful-Content-Type (entry create).
  private async cma(
    method: string,
    path: string,
    opts: { body?: any; version?: number; contentType?: string } = {},
  ): Promise<any> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/vnd.contentful.management.v1+json",
    };
    if (opts.version !== undefined) headers["X-Contentful-Version"] = String(opts.version);
    if (opts.contentType) headers["X-Contentful-Content-Type"] = opts.contentType;
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`${CMA_HOST}${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      if (res.status === 429) {
        const wait = Number(res.headers.get("x-contentful-ratelimit-reset") || "1");
        await new Promise((r) => setTimeout(r, Math.max(1, wait) * 1000));
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`Contentful ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    }
    throw new Error(`Contentful ${method} ${path} -> rate-limited after retries`);
  }

  private envPath(suffix: string): string {
    return `/spaces/${this.spaceId}/environments/${this.environment}${suffix}`;
  }

  async listTags(): Promise<CtfTag[]> {
    const r = await this.cma("GET", this.envPath("/tags?limit=500"));
    return (r.items || []).map((t: any) => ({ id: t.sys.id, name: t.name }));
  }

  async listContentTypes(): Promise<{ id: string; name: string }[]> {
    const r = await this.cma("GET", this.envPath("/content_types?limit=200"));
    return (r.items || []).map((t: any) => ({ id: t.sys.id, name: t.name }));
  }

  // Upload raw bytes to the space-level Upload API; returns the upload id.
  private async uploadBytes(buffer: Buffer): Promise<string> {
    const res = await fetch(`${UPLOAD_HOST}/spaces/${this.spaceId}/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/octet-stream" },
      body: buffer,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Contentful upload -> ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text).sys.id;
  }

  // Full asset lifecycle: upload -> create (with tags) -> process -> wait -> publish.
  // Returns the published asset id.
  async uploadAndPublishAsset(input: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    title: string;
    tagIds: string[];
  }): Promise<string> {
    const uploadId = await this.uploadBytes(input.buffer);
    const created = await this.cma("POST", this.envPath("/assets"), {
      body: {
        fields: {
          title: { [this.locale]: input.title },
          file: {
            [this.locale]: {
              contentType: input.mimeType,
              fileName: input.fileName,
              uploadFrom: { sys: { type: "Link", linkType: "Upload", id: uploadId } },
            },
          },
        },
        metadata: { tags: tagLinks(input.tagIds) },
      },
    });
    const assetId = created.sys.id;
    // Process the uploaded file for the locale, then poll until the processed URL appears.
    await this.cma("PUT", this.envPath(`/assets/${assetId}/files/${this.locale}/process`), {
      version: created.sys.version,
    });
    const ready = await this.waitAssetProcessed(assetId);
    await this.cma("PUT", this.envPath(`/assets/${assetId}/published`), { version: ready.version });
    return assetId;
  }

  private async waitAssetProcessed(assetId: string): Promise<{ version: number }> {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const a = await this.cma("GET", this.envPath(`/assets/${assetId}`));
      const url = a.fields?.file?.[this.locale]?.url;
      if (url) return { version: a.sys.version };
    }
    throw new Error(`Contentful asset ${assetId} did not finish processing in time`);
  }

  // Create an entry of `contentTypeId` with localized fields + entry tags; returns {id, version}.
  // rawFields: { fieldId: value } (value is wrapped under the locale here).
  async createEntry(
    contentTypeId: string,
    rawFields: Record<string, any>,
    tagIds: string[] = [],
  ): Promise<{ id: string; version: number }> {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(rawFields)) fields[k] = { [this.locale]: v };
    const created = await this.cma("POST", this.envPath("/entries"), {
      contentType: contentTypeId,
      body: { fields, metadata: { tags: tagLinks(tagIds) } },
    });
    return { id: created.sys.id, version: created.sys.version };
  }

  async publishEntry(entryId: string, version: number): Promise<void> {
    await this.cma("PUT", this.envPath(`/entries/${entryId}/published`), { version });
  }

  async unpublishEntry(entryId: string, version: number): Promise<void> {
    await this.cma("DELETE", this.envPath(`/entries/${entryId}/published`), { version });
  }

  // Current version of an entry (for publish/unpublish after a separate read).
  async entryVersion(entryId: string): Promise<number> {
    const e = await this.cma("GET", this.envPath(`/entries/${entryId}`));
    return e.sys.version;
  }

  // Asset link for an eventMemories-style field.
  static assetLink(id: string) {
    return { sys: { type: "Link", linkType: "Asset", id } };
  }
}
