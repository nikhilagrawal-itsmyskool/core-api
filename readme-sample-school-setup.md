# Sample School Setup

Use this for **local development and testing**. Connects directly to the database, generates SQL files, and executes them automatically. Creates a full set of sample data so you can test the app immediately.

> **Prerequisite:** Database and all tables must already exist. See `readme-db-setup.md`.

---

## Create Sample School

```bash
node scripts/sample-school-setup.js
```

Prompts for:
- Stage (`local` / `dev` / `qa` / `prod`)
- School name and school code
- Employee name (the initial admin)
- Default employee password
- Default student password

Saved configurations are stored in `scripts/school-prompts.json`. On subsequent runs you can select a saved school to **delete and recreate** it — useful when you want a clean slate during development.

**What gets created:**
- 1 school + 1 admin employee + login
- 1 academic year (2025-26)
- 30 classes (Nursery-A/B through XII-A/B)
- 60 students (2 per class) + student logins + class assignments
- 6 roles (god, admin, class-teacher, transport-incharge, medical-incharge, teacher)
- 5 additional employees + logins + role assignments

Generates four files in `modules/db/` and **immediately executes** them:
- `{school-code}-setup.sql`
- `{school-code}-setup-rollback.sql`
- `{school-code}-setup-additional-data.sql`
- `{school-code}-setup-additional-data-rollback.sql`

---

## Recreate / Reset Sample School

Run the script again, select the saved school from the menu, and confirm. It will roll back all existing data and recreate it from scratch.

---

## Rollback Manually

```bash
node scripts/run-sql.js --stage local --file modules/db/{school-code}-setup-additional-data-rollback.sql
node scripts/run-sql.js --stage local --file modules/db/{school-code}-setup-rollback.sql
```

Run in this order — additional data must be removed before the school row.
