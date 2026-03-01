# Executive Summary

## Repository
- https://github.com/nikhilagrawal-itsmyskool/core-api

## Stack
- **Runtime**: Node.js 22.x, TypeScript 5.8 (target ES2020, CommonJS)
- **Framework**: Serverless Framework 3.40 with serverless-offline 13.3
- **Database**: PostgreSQL via `pg` 8.16 (direct SQL, no ORM)
- **Auth**: JWT via `jsonwebtoken` 9.x
- **Build**: Webpack 5.x with ts-loader
- **Test**: Jest 30.x with ts-jest (integration tests against live servers)

## Architecture
- Multi-tenant serverless microservices on AWS Lambda (160MB, 10s timeout)
- Each module = independent Lambda service with own `serverless.yml`
- Modules: auth, medical, student, employee, class, academic-year, sample
- Multi-tenancy via `X-School-Code` header

## Local Development
- `serverless-offline` runs each module on dedicated ports (3001-3014)
- Native Node.js HTTP proxy as local API gateway on port 3000 (no nginx/express)
- Integration tests run against gateway port; can also target individual modules
- Prod-like local setup via `--stage prod` on ports 6000-6014

## AWS Services
- Lambda, API Gateway, S3, SNS, SQS, CloudWatch Logs, Route53

## Local Hosting Infrastructure
Self-hosted production deployment on Windows server using:
- **Caddy** — Reverse proxy on port 80, forwards to gateway (port 6000)
- **Cloudflare Tunnel** — Exposes local Caddy to the internet without opening ports
  - Tunnel: `school-api` (ID: `326a548a-af8f-4515-86f3-6737d9962a7f`)
  - Routes: `dbpasn.itsmyskool.com`, `api.itsmyskool.com` → `localhost:80`
- **Tailscale** — Mesh VPN for secure remote access to the server

## Key Conventions
- API JSON: camelCase | DB columns: snake_case (auto-converted)
- Handler/Service pattern: `*-handler.ts` (Lambda entry) + `*-service.ts` (logic)
- No foreign keys — app-level validation only
- 3 production deps: `pg`, `jsonwebtoken`, `@aws-sdk/client-s3`

## Plugins
- serverless-webpack, serverless-offline, serverless-domain-manager
- Custom: serverless-merge-config (merges global + module configs)

## Region
- ap-south-1 (Mumbai)
