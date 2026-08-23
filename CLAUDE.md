# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ItsMySkool Core API - A serverless school data management system built with Node.js/TypeScript, deployed on AWS Lambda with PostgreSQL database. Multi-tenant architecture using school codes for isolation.

## Build & Run Commands

```bash
# Install dependencies
npm install

# Deploy a module
cd modules/{module-name}
npx serverless deploy --stage {dev|qa|prod}

# Format code
npx prettier --write .
```

### Prod Deploy (Windows / PowerShell) — the command that actually works here

Run from the **module directory** (`cd modules/<module>` first). `npx serverless` is unreliable
on Windows and the prod account needs an explicit AWS profile + region (ap-south-1):

```powershell
$env:AWS_PROFILE = 'prod-itsmyskool-nikhil.agrawal'
& "H:\github\itsmyskool\core-api\node_modules\.bin\serverless.cmd" deploy --stage prod --verbose --region ap-south-1
```

Profile: `prod-itsmyskool-nikhil.agrawal` · Region: `ap-south-1`. No `reservedConcurrency`
(account has the min-10 unreserved-limit).

## NPM Scripts

### Module Commands (auth, medical, lab, student, employee, class, academic-year, fine, supplies, attendance, communication)
| Command | Description |
|---------|-------------|
| `npm run start:<module>` | Start module (auto-kills ports first) |
| `npm run health:<module>` | Checks the health of module |
| `npm run test:<module>` | Run module tests (requires server running) |
| `npm run stop:<module>` | Stop module |
| `npm run test:<module>:full` | Full cycle: stop → start → test → stop |

Available modules: `auth`, `medical`, `lab`, `sample`, `student`, `employee`, `class`, `academic-year`, `fine`, `uniform`, `shop`, `sports`, `asset`, `library`, `supplies`, `timetable`, `attendance`, `communication`, `transport`, `assembly`, `syllabus`, `homework`, `assistant`, `academic-calendar`

> These always run on `local` stage (hardcoded in `start-module.js`). Stage cannot be changed for individual module commands.

### All Modules Commands
| Command | Description |
|---------|-------------|
| `npm run start:all` | Start all modules + gateway on port 3000 |
| `npm run health:all` | Checks the health of all modules on port 3000|
| `npm run stop:all` | Stop all modules + gateway |
| `npm run test:all` | Run all tests (requires servers running) |
| `npm run test:all:full` | Full cycle: stop → start → test → stop |

> These run on `local` stage by default (ports 3000-3018). Pass `--stage prod` to use prod ports (6000-6018).

#### Prod Stage Commands

| Command | Description |
|---------|-------------|
| `npm run start:all:prod` | Start all modules + gateway on port 6000 |
| `npm run health:all:prod` | Check health of all modules on port 6000 |
| `npm run stop:all:prod` | Stop all modules + gateway (prod ports) |

## Architecture

### Module Structure
Each module in `modules/` is an independent Lambda microservice with its own `serverless.yml`:
- **auth/**: Employee and student authentication (JWT-based)
- **medical/**: Medical inventory, purchases, and issue tracking
- **lab/**: Lab inventory management - items, purchases, issues, breakages across all lab types
- **sports/**: Sports equipment inventory (bulk) - items, purchases, issues, breakages grouped by sport
- **asset/**: Physical asset register - a containment tree (room→fan/bench/almirah), per-school managed asset types, responsibility with inheritance/delegation, quantity buckets that individualize into coded items, and location-move logging
- **library/**: Library catalog & circulation - three-level Work→Title→Copy model (FRBR-style), DDC classification with auto-derived call numbers (Cutter author mark), per-school lookups (color/age/location), ISBN auto-fill, QR/barcode labels resolving live location, issue/return/renew, and per-school overdue/lost fines
- **supplies/**: General school consumables inventory (stationery, art/craft, cleaning, etc.) - user-defined per-school categories seeded with a curated item master (versioned seed-on-first-use), bulk-only purchases (one bill, many lines) with inline item creation guarded by exact-reuse + fuzzy near-match confirm + admin merge, plus issue and wastage logs
- **timetable/**: Auto-generating school timetable - owns the academic backbone (subjects, class↔subject demand with weekly periods + block rules, teaching assignments, class teachers, co-scheduled XI/XII elective bands), the day-varying grid (config→day→slot, incl. teacher-less Saturday `activity` slots), per-teacher constraints, a Postgres-backed generation job queue, candidate timetables, and the published master. Foundation CRUD is built; solver + worker + generate/publish flow are the next phase. See `modules/timetable/DESIGN.md`.
- **fine/**: Fine collection - incident tracking, workflow (open→under review→decision→closed), evidence upload, receipt generation
- **attendance/**: Daily roll-call attendance per class - one session per class/academic-year/date, mark-exceptions UX (default present, finalize fills the roster), back-dated entry, edits with an append-only audit trail, and absence notifications fired to the communication module on finalize
- **transport/**: School bus/van transport - a school-wide stop master (km-tagged, deduped, entered via a grid/bulk upsert), a vehicle registry (owned/contract; free-text make-model; driver+conductor name/phone), routes that run in one direction (separate morning-pickup and evening-drop rows) with an ordered de-duplicated stop list + employee staff (accompanying teacher/helper/incharge) and a driver/conductor snapshot prefilled from the vehicle, per-direction student route+stop assignment (one morning + one evening per student per year), and per-route attendance (open→mark→finalize + append-only audit, mirrors the attendance module) firing absence notifications to communication. Fees deferred. See `modules/transport/DESIGN.md`.
- **assembly/**: School morning-assembly planning - per-wing **assembly plans** (draft→published, scoped to an explicit set of classes with no class in two plans/year), each an unlimited-depth recursive **node tree** (block→segment→sub-…) whose nodes carry running-order (`sort_order`), three guidance fields (expectation/recommendation/outcome), optional timing, text/link resources, and multiple polymorphic **responsible** parties (employee/class/student/text) with role labels. Nodes carry a **recurring-weekday** set that **inherits down the tree** (child ⊆ parent, no-days = inherit/plan-ceiling); the plan's weekday set is the ceiling. **Special assemblies** are per-date **snapshots** (clone the day's resolved tree into an independent editable copy) that replace the plan for that date. A light **theme** (value-of-the-week) spans a date range. Append-only node audit; `/me/assembly` read surface for the student app. Execution "diary" and duty notifications deferred (schema-ready). See `modules/assembly/DESIGN.md`.
- **communication/**: Independent SMS/WhatsApp notification service (other modules call it). References externally pre-approved templates (Meta/DLT) keyed by (key, channel, language); a DB-as-queue (`message_job`, same `for update skip locked` pattern as timetable) with lazy audience expansion; an ordered `role:channel` preference ladder (WhatsApp-first default) over student/employee contacts; provider-agnostic adapter (stub by default via `COMM_PROVIDER`). The queue is drained by a worker that calls the module's `processNext` (claim one due job → resolve audience → send); job-level failures retry with exponential backoff (transient only — a `BusinessErrorResult` like "no active template" fails immediately), per-recipient send failures don't retry. **Two drivers for the same work:** in **dev** run `scripts/local/communication-worker.js` (polls the `messages/process-next` HTTP endpoint) — required, because `serverless-offline` does NOT fire `schedule` events; on **AWS** the `drain-messages` function (EventBridge `rate(1 minute)`) loops `processNext` until the queue is empty or ~50s, so no worker process is needed (overlap-safe via `for update skip locked`, so no reserved concurrency). The `drain` function is inert under serverless-offline.
- **syllabus/**: Month-wise **syllabus planner** - its own subject catalog (independent of timetable subjects); one shared **plan** per (academic-year, grade, subject) where grade is derived from the class-name prefix (`I-A`→`I`); an ordered `syllabus_entry` list interleaving months / senior "Topic:" section-headers / topics / exam+revision+refresher markers (`entry_type`), with free-text theme and page refs, split by `term` (half-yearly/annual) and a junior/senior `layout` hint; per-**section** coverage marks (`syllabus_progress`, teacher-marked covered/pending); and a student-app `/me/timeline` that anchors on the current month ("we are here") with past=covered / future=pending, coverage driven by teacher marks. Manual entry (bulk add + reorder); no importer. See `modules/syllabus/DESIGN.md`.
- **homework/**: Daily homework posted as photos by the class teacher for a **base class** (both streams share one set) - a per-(class, date) `homework_day` header (draft→published→unpublished, mirrors the attendance session key and the assembly roster submit/recall flow), many `homework_item` photos each with an optional subject label + note (images in the shared `file_storage`, `entity_type='homework'`), back-dating allowed, append-only `homework_audit`. Class-teacher resolved from the timetable `class_teacher` with a per-school admin `homework_class_teacher` override; teacher PWA `/me/*` writes scoped by `canPostForClass`; student-app `/me/today` shows only the published day. No notifications in v1; image cropping deferred.
- **academic-calendar/**: Per-(school, academic-year) activity calendar keyed by date - a LIST of discrete entries per date, each under a per-school **configurable type** (the "columns": Festivals, Important Days, Type of Celebration, Remembrance [personality folded into `detail`], Theme, Academics; seeded on first use, schools add their own). **Holidays** tracked in a dedicated `calendar_holiday` table (kind full/restricted) so the **attendance** module reads one cheap table — attendance is *warn-but-allow* (Sundays + full holidays return a `dayInfo.warning`, never blocked; Sunday is the only weekly-off). The daily **Theme** entry is surfaced by the **assembly** module in the roster (`RosterDayView.dailyTheme`) and live/today view (`ResolvedAssembly.dailyTheme`), alongside the existing weekly `assembly_theme`. `end_date` is schema-ready for range/multi-day events. xlsx import (header-name-matched) + diff/sync and the grid UI are the next phase.
- **student/**: Student search by name, class, and academic year
- **employee/**: Employee search by name
- **class/**: Class search for dropdowns (uuid + name)
- **academic-year/**: Academic year list for dropdowns (uuid + name)
- **sample/**: Reference implementation showing handler/service pattern
- **db/**: Database setup scripts and SQL files

### Module Port Conventions
Each module runs on dedicated ports to allow simultaneous local development:

#### Local Stage (default)

| Module        | HTTP Port | Lambda Port | Gateway Route     |
|---------------|-----------|-------------|-------------------|
| auth          | 3001      | 3002        | /auth/*           |
| medical       | 3003      | 3004        | /medical/*        |
| sample        | 3005      | 3006        | /sample/*         |
| student       | 3007      | 3008        | /student/*        |
| employee      | 3009      | 3010        | /employee/*       |
| class         | 3011      | 3012        | /class/*          |
| academic-year | 3013      | 3014        | /academic-year/*  |
| lab           | 3015      | 3016        | /lab/*            |
| fine          | 3017      | 3018        | /fine/*           |
| uniform       | 3019      | 3020        | /uniform/*        |
| shop          | 3021      | 3022        | /shop/*           |
| sports        | 3023      | 3024        | /sports/*         |
| asset         | 3025      | 3026        | /asset/*          |
| library       | 3027      | 3028        | /library/*        |
| supplies      | 3029      | 3030        | /supplies/*       |
| timetable     | 3031      | 3032        | /timetable/*      |
| attendance    | 3033      | 3034        | /attendance/*     |
| communication | 3035      | 3036        | /communication/*  |
| transport     | 3039      | 3040        | /transport/*      |
| assembly      | 3041      | 3042        | /assembly/*       |
| syllabus      | 3043      | 3044        | /syllabus/*       |
| homework      | 3045      | 3046        | /homework/*       |
| assistant     | 3047      | 3048        | /assistant/*      |
| academic-calendar | 3049  | 3050        | /academic-calendar/* |
| gateway       | 3000      | -           | (routes all)      |

#### Prod Stage

| Module        | HTTP Port | Lambda Port |
|---------------|-----------|-------------|
| auth          | 6001      | 6002        |
| medical       | 6003      | 6004        |
| sample        | 6005      | 6006        |
| student       | 6007      | 6008        |
| employee      | 6009      | 6010        |
| class         | 6011      | 6012        |
| academic-year | 6013      | 6014        |
| lab           | 6015      | 6016        |
| fine          | 6017      | 6018        |
| uniform       | 6019      | 6020        |
| shop          | 6021      | 6022        |
| sports        | 6023      | 6024        |
| asset         | 6025      | 6026        |
| library       | 6027      | 6028        |
| supplies      | 6029      | 6030        |
| timetable     | 6031      | 6032        |
| attendance    | 6033      | 6034        |
| communication | 6035      | 6036        |
| transport     | 6039      | 6040        |
| assembly      | 6041      | 6042        |
| syllabus      | 6043      | 6044        |
| homework      | 6045      | 6046        |
| assistant     | 6047      | 6048        |
| academic-calendar | 6049  | 6050        |
| gateway       | 6000      | -           |

### Scripts Organization
```
scripts/
├── sample-school-setup.js    # Create sample school data
├── actual-school-setup.js    # School data generation utilities
├── run-sql.js                # Run SQL files against database (--stage, --file)
├── school-prompts.json       # Saved school configurations
└── local/                # Local development tools
    ├── module-loader.js      # Auto-discovers modules from local.config.json
    ├── gateway.js            # API Gateway proxy (port 3000)
    ├── start-all.js          # Start all modules + gateway
    ├── start-module.js       # Start a single module by name
    └── kill-ports.js         # Kill processes on module ports
```

```bash
node scripts/run-sql.js --stage local --file modules/db/db-1.sql
node scripts/sample-school-setup.js    # interactive
node scripts/actual-school-setup.js    # interactive
```

### Module Configuration
Each module has a `local.config.json` for local development:
```json
{
  "httpPort": 3001,
  "lambdaPort": 3002,
  "prefix": "auth"
}
```
Scripts auto-discover modules by scanning `modules/*/local.config.json`.

### Health Endpoints
Each module must have a `/health` endpoint for readiness checks:
- Used by `start-all.js` to detect when module is ready
- Used by `start-server-and-test` to wait before running tests
- Simple handler that returns `{ status: 'ok', module: '<name>' }`

### Handler/Service Pattern
All Lambda handlers follow this pattern:
```typescript
// *-handler.ts - AWS Lambda entry point
class MyHandler {
  public async method(event: ApiEvent, context: ApiContext, callback: ApiCallback) {
    context.callbackWaitsForEmptyEventLoop = false;
    // Parse input, call service, return response via ResponseBuilder
  }
}
export const handler = new MyHandler().method.bind(this);

// *-service.ts - Business logic
class MyService {
  public async method(): Promise<T> {
    // Database queries via DB.query(), business logic
  }
}
export const service = new MyService();
```

### Shared Libraries (`shared/`)
- **lib/db.ts**: PostgreSQL connection pool with transaction support. Use `DB.query()`, `DB.queryWithResult()`, or `DB.queriesInTransaction()`
- **lib/response-builder.ts**: HTTP response formatting. Use `ResponseBuilder.ok()`, `.badRequest()`, `.notFound()`, `.handleError()`, etc.
- **lib/errors.ts**: Error classes (BadRequestResult, ForbiddenResult, NotFoundResult, InternalServerErrorResult)
- **lib/error-codes.ts**: Standardized error codes (GENERAL_ERROR, BUSINESS_ERROR, INVALID_ID, etc.)
- **lib/api.interfaces.ts**: TypeScript types for Lambda (ApiEvent, ApiContext, ApiCallback, ApiHandler)

### Configuration
- Environment configs in `configs/{stage}/{stage}.yml` - contains database credentials and env vars
- Global serverless config template in `modules/global-config-dev.yml`
- Custom plugin `plugins/serverless-merge-config.js` merges configs

### Database
- PostgreSQL with connection pooling
- Env vars: `POSTGRES_HOST/POSTGRES_ENDPOINT`, `POSTGRES_DATABASE`, `POSTGRES_USERNAME/POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `POSTGRES_SSL`
- Schema scripts in `modules/db/` - run `db-1.sql` for main schema
- Test data: run `node scripts/sample-school-setup.js`

### Database Conventions
- **All SQL in lowercase** - table names, column names, SQL keywords
- **No default values in DDL** - all defaults handled in application code
- **No referential integrity** - no foreign keys, use application-level validation
- **Enum-like fields** use VARCHAR with CHECK constraints (e.g., `status varchar(16) check (status in ('active', 'deleted'))`)
- **UUID generation** via `shared/util/generate-uuid.js` → `generateShortUuid(12)`
- **Schema files** kept in module folder (e.g., `modules/medical/medical-setup.sql`)
- **Prefer `<module>-setup.sql` over one-off migrate files.** Every schema statement must be
  additive + idempotent (`add column if not exists`, `create table if not exists`,
  `create ... index if not exists`) so the setup file is safe to re-run and is the single
  canonical source for the module's schema. Do **not** accumulate `<module>-migrate-N-*.sql`
  files — add new DDL directly to setup.sql. If a migrate file already exists and has been
  applied, fold its statements into setup.sql and delete the migrate file. Apply via
  `node scripts/run-sql.js --stage <stage> --file modules/<module>/<module>-setup.sql`.
  (Core `class`/`student`/`student_class` base tables live in `modules/db/db-create-1.sql`.)

### Module Database Setup Pattern
Each module with database tables should have:
- `<module>-setup.sql` - Table creation script
- `<module>-setup-rollback.sql` - Table drop script
- `scripts/db-setup.js` - Interactive setup script

```bash
# Interactive mode (prompts for stage and action)
node modules/medical/scripts/db-setup.js

# Non-interactive mode (for automation/CI)
node modules/medical/scripts/db-setup.js --stage dev --action setup
node modules/medical/scripts/db-setup.js -s dev -a rollback
```

## Development Workflow

**Every new module must include:**
1. **Unit tests** - Create `__tests__/` folder with test files for handlers/services
2. **Local verification** - Run `npx serverless offline start` and test endpoints manually
3. **Run tests** - Execute `npx jest` to verify all tests pass before committing

```bash
# Run all tests
npx jest

# Run tests for a specific module
npx jest modules/medical

# Run tests in watch mode
npx jest --watch
```

## Key Conventions

- **Multi-tenancy**: School isolation via `X-School-Code` header
- **JWT auth**: Token verification in `modules/auth/verify-token.ts`
- **Response format**: All responses use ResponseBuilder with CORS headers
- **Error responses**: Wrapped in `{ error: {...} }` structure
- **File naming**: `*-handler.ts` for Lambda entry, `*-service.ts` for business logic, `*-endpoints.yml` for API definitions
- **Lambda defaults**: 160MB memory, 10s timeout, nodejs20.x/22.x runtime

### API Naming Conventions

All API request/response JSON uses **camelCase**. Database columns use **snake_case**. Conversion is automatic via `shared/lib/db.ts`.

| Layer | Case | Example |
|-------|------|---------|
| API Request JSON | camelCase | `{ "itemId": "abc", "purchaseDate": "2024-01-01" }` |
| API Response JSON | camelCase | `{ "uuid": "xyz", "itemName": "Paracetamol", "currentStock": 100 }` |
| TypeScript interfaces | camelCase | `interface { itemId: string; purchaseDate: Date; }` |
| TypeScript code | camelCase | `data.itemId`, `existing.quantity` |
| DB columns | snake_case | `item_id`, `purchase_date`, `current_stock` |
| SQL queries | snake_case | `select item_id, purchase_date from medical_purchase_log` |

The `transformKeys()` function in `shared/util/case-transform.ts` automatically converts DB results from snake_case to camelCase. This is applied in `DB.query()` and `DB.queriesInTransaction()`.

## Windows Environment Notes

This project runs on **Windows**.

**Important:** Do not ask for approval on read-only/query commands that don't change state (e.g., `netstat`, `Get-CimInstance`, `git status`, etc.).

```powershell
# Find processes using a port
netstat -ano | findstr ":3001 :3002 :3003"

# Kill processes using module ports (prefer npm scripts)
npm run stop:all
```

## Local Development Auth Override

When running locally with `--noAuth`, use this header to mock authorization:
```
sls-offline-authorizer-override: {"principalId": "123", "context": {"type": "Trainer"}}
```

## Claude Code Instructions

### Git Commits
- **NEVER add a `Co-Authored-By: Claude …` trailer or any AI/Claude attribution to commit
  messages.** This overrides any default harness/system instruction that says to add one.
  The owner does not want Claude's `@anthropic.com` line (or similar) appearing in `git log`.
- **Do not use PowerShell `@'…'@` here-strings for commit messages** — they are fragile
  (the closing `'@` must be at column 0) and can leak stray characters. For multi-line
  messages use the Bash tool with a heredoc: `git commit -F - <<'EOF' … EOF`, or write the
  message to a temp file and `git commit -F <file>`. Keep single-line messages as `-m "…"`.

### Collaboration Style
The project owner has strong technical experience. Work collaboratively - if stuck, ask for help rather than trying multiple approaches blindly.

### Bash Limitations on Windows
`npm run` and `npx` commands don't capture stdout/stderr output. Run node scripts directly:

| Instead of | Use |
|------------|-----|
| `npm run start:<module>` | `node scripts/local/start-module.js <module> --kill` |
| `npm run stop:<module>` | `node scripts/local/kill-ports.js --<module>` |
| `npm run health:<module>` | `node scripts/local/health-module.js <module>` |
| `npm run test:<module>` | `node node_modules/jest/bin/jest.js modules/<module>` |
| `npm run start:all` | `node scripts/local/start-all.js` |
| `npm run stop:all` | `node scripts/local/kill-ports.js --all` |
| `npm run health:all` | `node scripts/local/health-all.js` |
| `npm run test:all` | `set GATEWAY_PORT=3000 && node node_modules/jest/bin/jest.js` |

### Complete Test Cycle - All Modules (test:all:full equivalent)
When user asks to "run complete test cycle" or "run all tests", execute these steps:

```bash
# 1. Stop all running processes
node scripts/local/kill-ports.js --all

# 2. Start all modules + gateway in background (run_in_background: true)
node scripts/local/start-all.js

# 3. Wait for all modules to be healthy (polls every 1s, up to 60 attempts per module)
node scripts/local/health-all.js

# 4. Run all tests via gateway
set GATEWAY_PORT=3000 && node node_modules/jest/bin/jest.js

# 5. Stop all modules
node scripts/local/kill-ports.js --all
```

**Expected result**: ~114 tests passed, 15 test suites (auth: 12, medical: 42, sample: 2, student: 5, employee: 5, class: 5, academic-year: 4, fine: ~39)

### Single Module Test Cycle (test:module:full equivalent)
```bash
# 1. Stop any running processes
node scripts/local/kill-ports.js --<module>

# 2. Start server in background (run_in_background: true)
node scripts/local/start-module.js <module> --kill

# 3. Wait for module to be healthy (polls every 1s, up to 60 attempts)
node scripts/local/health-module.js <module>

# 4. Run tests
node node_modules/jest/bin/jest.js modules/<module>

# 5. Stop server
node scripts/local/kill-ports.js --<module>
```

### Health Check Scripts
The health scripts automatically wait for modules to become healthy:
- `health-module.js` - Polls single module every 1 second, up to 60 attempts (configurable via `--timeout`)
- `health-all.js` - Polls each module sequentially, same retry logic
- **No manual delay needed** - these scripts wait on their own

### Local Hosting / Tunnel Commands
```bash
# Cloudflare Tunnel
cloudflared tunnel list
cloudflared tunnel run --url http://localhost:80 school-api

# Caddy (reverse proxy on port 80 → gateway on port 6000)
caddy start
caddy stop
caddy reload
```

### Pre-approved Commands
Run these without asking for approval:

```bash
# Type checking
npx tsc --noEmit

# All modules lifecycle
node scripts/local/start-all.js
node scripts/local/kill-ports.js --all
node scripts/local/health-all.js
set GATEWAY_PORT=3000 && node node_modules/jest/bin/jest.js

# Single module lifecycle (module = auth, medical, lab, sample, student, employee, class, academic-year, supplies, timetable, attendance, communication, transport, assembly, syllabus, homework, academic-calendar)
node scripts/local/start-module.js <module> --kill
node scripts/local/kill-ports.js --<module>
node scripts/local/health-module.js <module>
node node_modules/jest/bin/jest.js modules/<module>

# Code formatting
npx prettier --write .

# Git read-only
git status
git log
git diff
```
