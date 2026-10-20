# Outreach module — "Moments" (DESIGN)

Status: **Phase 0 backend built + locally verified** (2026-10-20). Parent-facing photo+text feed.
Not yet deployed; no admin-portal / parent-app UI yet.
Ports **3063 / 3064** (prod 6063/6064), API prefix `/outreach/*`.

## What this is

A **compose-once → publish-to-many-channels** hub. Its first and always-owned surface is
**Moments**: a one-way, school-owned feed where staff post photos + text to a chosen audience,
parents get an in-app notification, and parents can react with emoji but **cannot reply**.

It exists alongside (not inside) the `communication` module — it *reuses* communication's in-app
notification inbox + family device tokens to deliver the "new Moment" ping, but owns its own
content, feed, and reactions.

### Why, when the WhatsApp group already works

The feed earns its place only on the three things a WhatsApp group structurally cannot do:
- **Permanence / archive** — WhatsApp media rots in scroll and expires; Moments is a durable record.
- **Targeting** — a group is all-or-nothing; a Moment can go to just III-A's parents.
- **Ownership + privacy** — no parent phone numbers exposed to each other, no dependency on Meta.

WhatsApp is *not* removed — it stays the richer video channel (via an assisted share button, later).
Moments is the owned, targetable, permanent layer underneath it.

## Core model — a destination-agnostic Post

Everything hangs off one **Moment** (a Post). Each delivery target is a **swappable publisher**, so
hosting/channel choices are made per medium and can be changed later without touching the model.

### Phase 0 scope (what we build first) — "Core"

- **Moment** = title/caption text + 1..N photos + an audience + author + status.
- **Audience targeting**: one or more classes / grades; "select all" = whole school.
- **Publish** → fires an in-app notification to the families in the audience.
- **Parent feed**: `/outreach/me/moments` — published Moments scoped to the viewer's child's class.
- **Reactions**: emoji reactions by families (no replies, no comments).
- **Who can post**: god/admin to any audience; **class teachers to their own class** (mirrors
  homework's `canPostForClass` = timetable `class_teacher` + a per-school override).
- **Photo storage**: shared `file_storage` (`entity_type='outreach'`) for now; **production serving
  moves to Cloudflare R2 + signed URLs before go-live** (behind the upload/serve seam, so no model
  change). Zero-egress R2 keeps cost at pennies/school/month.

Deferred to later phases (schema left room, not built in Phase 0):
- **Video** — stored on **YouTube** (one upload shared by app + website, free adaptive streaming);
  only the YouTube video id is stored. R2+signed-URL reserved for the rare truly-private clip.
- **Website publish** — push a copy to **Contentful** (owned API). Contentful is a *publish target
  only*, never the app's serving backend (its bandwidth caps make that expensive).
- **Social** — Instagram / YouTube / LinkedIn behind a single `SocialPublisher` seam (aggregator
  adapter first to skip app-review + maintenance, direct APIs per-channel later). IG business
  account is already linked to the FB page.
- **Drafts / scheduling**, **public vs private visibility + per-student media-consent** flag.

## Data model (Phase 0)

Conventions: all lowercase, no FKs (app-level validation), `varchar(n) check (...)` for enums, no
DDL defaults (defaults in code), short uuids via `generateShortUuid(12)`, idempotent additive DDL in
`outreach-setup.sql`. Shapes below are the sketch; final column names reconciled against the
homework template.

- **`moment`** — the post header
  `uuid, school_code, academic_year_id, author_employee_id, title, body,
   status varchar(16) check (status in ('published','unpublished')),
   published_at, created_at, updated_at`
  (Phase 0 publishes immediately; `draft` added with the drafts phase.)
- **`moment_photo`** — one row per image
  `uuid, moment_id, file_id (→ file_storage), caption, sort_order, created_at`
  (bytes live in shared `file_storage`, `entity_type='outreach'`, `entity_id = moment uuid`).
- **`moment_audience`** — who it targets
  `uuid, moment_id, scope varchar(8) check (scope in ('school','grade','class')), ref_id`
  (`ref_id` = class uuid or grade key; `scope='school'` = everyone, ref_id null.)
- **`moment_reaction`** — family reactions
  `uuid, moment_id, reactor_type varchar(8) check (reactor_type in ('student','employee')),
   reactor_id, emoji varchar(16), created_at`
  (one reaction per (moment, reactor); upsert toggles/changes emoji.)
- **`moment_audit`** — append-only
  `uuid, moment_id, actor_employee_id, action, detail jsonb, created_at`.

## Endpoints (Phase 0)

Admin portal + teacher PWA (guarded by `outreach.moment.*`):
- `POST   /outreach/moments` — create + publish (audience, title, body, photo file ids)
- `GET    /outreach/moments` — list (filter by audience/author/date)
- `GET    /outreach/moments/{id}` — detail (photos, audience, reaction tally)
- `PUT    /outreach/moments/{id}` — edit text / audience / photos (append audit)
- `POST   /outreach/moments/{id}/unpublish` — hide from feed
- `POST   /outreach/photos` — upload a photo → file_storage, returns file id (pre-attach)

Parent/student app (`/me`, scoped to caller's child):
- `GET    /outreach/me/moments` — published feed for the viewer's class (paginated)
- `GET    /outreach/me/moments/{id}` — single Moment
- `PUT    /outreach/me/moments/{id}/reaction` — set/clear my emoji

Machine:
- publish → `POST /communication/notifications` (service token) to ping the audience families.

## Permissions (actions)

- `outreach.moment.view` — read the admin list/detail (god/admin/teacher)
- `outreach.moment.post` — create/edit/unpublish; teacher limited by `canPostForClass`
- (parent feed + reactions use the app's family JWT, not an employee action)

## Delivery / cost shape

- Photos: `file_storage` now → **R2 (zero egress)** in prod; pennies/month, flat with viewership.
- Video (later): **YouTube** → $0 serving.
- Notifications: reuse `communication` in-app inbox (free/instant) + best-effort Expo push.
- Net target: **cents per school per month**, does not scale with how much parents watch.

## Build order

1. `outreach-setup.sql` + `scripts/db-setup.js` + `local.config.json` + `serverless.yml`.
2. Interfaces → service → handler → `outreach-endpoints.yml` for the admin/compose side.
3. Photo upload into `file_storage`.
4. Publish → communication notification fan-out.
5. `/me` feed + reactions.
6. `__tests__` mirroring the homework suite; local verify via gateway.
