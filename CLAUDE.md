# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ItsMySkool Core API - A serverless school data management system built with Node.js/TypeScript, deployed on AWS Lambda with PostgreSQL database. Multi-tenant architecture using school codes for isolation.

## Build & Run Commands

```bash
# Install dependencies
npm install

# Run a module locally (from within the module directory)
cd modules/auth
npx serverless offline start --stage dev

# Run with specific options
npx serverless offline start --config serverless.yml --httpPort 3000 --lambdaPort 3002 --noPrependStageInUrl --noAuth --prefix auth --stage dev

# Deploy a module
cd modules/{module-name}
npx serverless deploy --stage {dev|qa|prod}

# Print resolved serverless config (for debugging)
npx serverless print --config serverless.yml --stage dev

# Format code
npx prettier --write .
```

## Architecture

### Module Structure
Each module in `modules/` is an independent Lambda microservice with its own `serverless.yml`:
- **auth/**: Employee and student authentication (JWT-based)
- **medical/**: Medical records (placeholder)
- **sample/**: Reference implementation showing handler/service pattern
- **db/**: Database setup scripts and SQL files

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

## Key Conventions

- **Multi-tenancy**: School isolation via `X-School-Code` header
- **JWT auth**: Token verification in `modules/auth/verify-token.ts`
- **Response format**: All responses use ResponseBuilder with CORS headers
- **Error responses**: Wrapped in `{ error: {...} }` structure
- **File naming**: `*-handler.ts` for Lambda entry, `*-service.ts` for business logic, `*-endpoints.yml` for API definitions
- **Lambda defaults**: 160MB memory, 10s timeout, nodejs20.x/22.x runtime

## Windows Environment Notes

This project runs on **Windows**. Use these commands for common tasks:

**Important:** Do not ask for approval on read-only/query commands that don't change state (e.g., `netstat`, `Get-CimInstance`, `git status`, etc.).

```powershell
# Find processes using a port
netstat -ano | findstr ":3001 :3003"

# Kill a process by PID (use PowerShell - taskkill may have issues in Git Bash)
powershell -Command "Stop-Process -Id <PID> -Force"

# Start auth module with full options
cd modules/auth
npx serverless offline start --config serverless.yml --httpPort 3001 --lambdaPort 3003 --noPrependStageInUrl --noAuth --prefix auth --stage dev --aws-profile dev-itsmyskool-nikhil.agrawal
```

## Local Development Auth Override

When running locally with `--noAuth`, use this header to mock authorization:
```
sls-offline-authorizer-override: {"principalId": "123", "context": {"type": "Trainer"}}
```
