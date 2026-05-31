# Database Setup

One-time setup per environment (local, dev, prod). Do this before running any school setup scripts.

---

## Step 1 — Create PostgreSQL Instance and Database

Create a PostgreSQL instance manually (local install, Docker, or AWS RDS), then create the database:

```sql
create database itsmyskool_local;   -- or itsmyskool_dev / itsmyskool_prod
```

Update the credentials in `configs/{stage}/{stage}.yml`.

---

## Step 2 — Create Core Tables

```bash
node scripts/run-sql.js --stage <local|dev|prod> --file modules/db/db-create-1.sql
node scripts/run-sql.js --stage <local|dev|prod> --file modules/db/db-create-2.sql
```

| File | Contains |
|------|----------|
| `db-create-1.sql` | school, employee, student, class, academic_year, role, and related tables |
| `db-create-2.sql` | file_storage (used for bill/receipt uploads) |

All statements use `IF NOT EXISTS` — safe to re-run.

---

## Step 3 — Create Module Tables

Each module manages its own tables via a `db-setup.js` script.

```bash
node modules/medical/scripts/db-setup.js --stage <local|dev|prod> --action setup
node modules/lab/scripts/db-setup.js     --stage <local|dev|prod> --action setup
```

---

## Rollback (if needed)

```bash
# Module tables first
node modules/medical/scripts/db-setup.js --stage <local|dev|prod> --action rollback
node modules/lab/scripts/db-setup.js     --stage <local|dev|prod> --action rollback

# Core tables last
node scripts/run-sql.js --stage <local|dev|prod> --file modules/db/db-drop-2.sql
node scripts/run-sql.js --stage <local|dev|prod> --file modules/db/db-drop-1.sql
```

---

## Next Steps

Once the database is set up, add a school:
- **Real school** → see `readme-actual-school-setup.md`
- **Sample/dev school** → see `readme-sample-school-setup.md`
