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

## NPM Scripts

### Module Commands (auth, medical, student, employee, class, academic-year)
| Command | Description |
|---------|-------------|
| `npm run start:<module>` | Start module (auto-kills ports first) |
| `npm run health:<module>` | Checks the health of module |
| `npm run test:<module>` | Run module tests (requires server running) |
| `npm run stop:<module>` | Stop module |
| `npm run test:<module>:full` | Full cycle: stop → start → test → stop |

Available modules: `auth`, `medical`, `sample`, `student`, `employee`, `class`, `academic-year`

### All Modules Commands
| Command | Description |
|---------|-------------|
| `npm run start:all` | Start all modules + gateway on port 3000 |
| `npm run health:all` | Checks the health of all modules on port 3000|
| `npm run stop:all` | Stop all modules + gateway |
| `npm run test:all` | Run all tests (requires servers running) |
| `npm run test:all:full` | Full cycle: stop → start → test → stop |

## Architecture

### Module Structure
Each module in `modules/` is an independent Lambda microservice with its own `serverless.yml`:
- **auth/**: Employee and student authentication (JWT-based)
- **medical/**: Medical inventory, purchases, and issue tracking
- **student/**: Student search by name, class, and academic year
- **employee/**: Employee search by name
- **class/**: Class search for dropdowns (uuid + name)
- **academic-year/**: Academic year list for dropdowns (uuid + name)
- **sample/**: Reference implementation showing handler/service pattern
- **db/**: Database setup scripts and SQL files

### Module Port Conventions
Each module runs on dedicated ports to allow simultaneous local development:

| Module        | HTTP Port | Lambda Port | Gateway Route     |
|---------------|-----------|-------------|-------------------|
| auth          | 3001      | 3002        | /auth/*           |
| medical       | 3003      | 3004        | /medical/*        |
| sample        | 3005      | 3006        | /sample/*         |
| student       | 3007      | 3008        | /student/*        |
| employee      | 3009      | 3010        | /employee/*       |
| class         | 3011      | 3012        | /class/*          |
| academic-year | 3013      | 3014        | /academic-year/*  |
| gateway       | 3000      | -           | (routes all)      |

### Scripts Organization
```
scripts/
├── sample-school-setup.js    # Create sample school data
├── actual-school-setup.js    # School data generation utilities
├── run-sql.js                # Run SQL files against database
├── school-prompts.json       # Saved school configurations
└── local/                # Local development tools
    ├── module-loader.js      # Auto-discovers modules from local.config.json
    ├── gateway.js            # API Gateway proxy (port 3000)
    ├── start-all.js          # Start all modules + gateway
    ├── start-module.js       # Start a single module by name
    └── kill-ports.js         # Kill processes on module ports
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

**Expected result**: 75 tests passed, 11 test suites (auth: 12, medical: 42, sample: 2, student: 5, employee: 5, class: 5, academic-year: 4)

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

# Single module lifecycle (module = auth, medical, sample, student, employee, class, academic-year)
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
