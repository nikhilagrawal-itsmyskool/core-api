# Actual School Setup

Use this when onboarding a **real school** to any environment. Can be run multiple times — each run adds one new school to the existing database.

> **Prerequisite:** Database and all tables must already exist. See `readme-db-setup.md`.

---

## Add a New School

```bash
node scripts/actual-school-setup.js
```

Prompts for:
- School name
- School code (used as `X-School-Code` header in all API calls)
- Employee name (the initial admin)
- Employee family unique number (becomes the login username)
- Employee password

**This script only generates files — it does not connect to the database or execute anything.**

Generates two files in `modules/db/`:
- `{school-code}-setup.sql` — INSERT statements for school, employee, employee_login
- `{school-code}-setup-rollback.sql` — DELETE statements to undo

Then manually run the generated SQL against the target database:

```bash
node scripts/run-sql.js --stage <dev|prod> --file modules/db/{school-code}-setup.sql
```

---

## Rollback a School

```bash
node scripts/run-sql.js --stage <dev|prod> --file modules/db/{school-code}-setup-rollback.sql
```

> Removes only the school, employee, and login rows. Tables are not dropped.
