# DBPAS Deployment - Remaining Steps

## Completed
- [x] Task 1: Database setup (data-sync tables created)
- [x] Task 2: School record created (code: DBPASN)
- [x] Task 3: sync-employees.js and sync-students.js scripts ready
- [x] Task 4: prod.yml configured

## Remaining

### Step 5: Load Employee Data
Prepare the real employee CSV and run the sync script.

```bash
node modules/data-sync/scripts/sync-employees.js --stage prod --school-code DBPASN --file path/to/employees.csv
```

CSV format:
```
name,phone_number,role,status
Jane Doe,9876543210,teacher,active
```

- Roles are auto-created if they don't exist
- Default password: `Itsmyskool@123` (must_change_password = true)
- See `modules/data-sync/scripts/sample-employees.csv` for reference

### Step 6: Load Student Data
Prepare the real student CSV and run the sync script.

```bash
node modules/data-sync/scripts/sync-students.js --stage prod --school-code DBPASN --file path/to/students.csv
```

CSV format:
```
name,class,academic_session,status
Rahul Kumar,IX-A,2025-26,active
```

- Academic years and classes are auto-created if they don't exist
- Academic session format: `YYYY-YY` (e.g., `2025-26` -> April 2025 to March 2026)
- See `modules/data-sync/scripts/sample-students.csv` for reference

### Step 7: Start Services in Prod Mode

```bash
node scripts/local/start-all.js --stage prod
```

Services will start on prod ports (6000-6014).

### Step 8: Verify

```bash
# Check all modules are healthy
node scripts/local/health-all.js --stage prod

# Run tests against prod
set GATEWAY_PORT=6000 && node node_modules/jest/bin/jest.js
```

Manual verification:
- Login with an employee phone number and default password
- Confirm student search returns imported students
- Confirm class and academic year dropdowns are populated
