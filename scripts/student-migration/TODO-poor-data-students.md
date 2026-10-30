# TODO — 3 deferred DBPASN students (poor SchoolPad data)

**Status: NOT imported. Need data verification before importing.**
Created 2026-10-18 during the final SchoolPad→ItsMySkool student reconciliation.

These 3 came out of the 7 "name-clash" missing students. On review they are **distinct real
students** (not duplicates of anyone in ItsMySkool), but SchoolPad holds almost no usable data for
them — **placeholder father name ("To Be Filled Later"), no DOB (`30/11/0001` sentinel), and no
real admission date (`01/01/1970`)**. They were all enrolled in 2021-22 and withdrawn ~31/03/2022.

They were deliberately **left out** of the import until the real details (at minimum DOB + father's
name) can be confirmed. The 3 "missing" rows + the `0000` Dummy are the only gap remaining in the
reconciliation (1178/1182 present).

| Adm. No. | Name | Class | Father mobile (only solid datum) | Withdrawn | What's missing | Notes / disambiguation |
|---|---|---|---|---|---|---|
| `1030/S/2K21` | Navya Gupta (F) | IV-A | `9170163361` | 31/03/2022 | DOB, father/mother name, adm date | Father-mobile = same as **Divya Gupta `306/S/2K21`** (already imported) → **likely Divya's sibling**. NOT the same as active **Navya Gupta `301/S/2K21`** (father Vineet Kumar Gupta — different family). |
| `1071/S/2K21` | Prashant Yadav (M) | VIII-A | `9369705622` | 31/03/2022 | DOB, father/mother name, adm date | Unique mobile. Name-clash with `218/S/2K20` Prashant Yadav is a **different child** (father Sushil Kumar). |
| `1037/S/2K21` | Ayush Yadav (M) | IV-A | `9452773781` | 31/03/2022 | DOB, father/mother name, adm date | Unique mobile. Name-clash with `660/S/2K24` and `247/S/2K21` Ayush Yadav are **different children**. |

## What to do later
1. Get the real **DOB + father's name** (and ideally mother/address) for each — from the family, a
   paper record, or by cross-checking Divya Gupta's family for Navya.
2. Their SchoolPad detail exports are at `out/raw/detail/studentReport-{1030-S-2K21,1071-S-2K21,1037-S-2K21}.csv`
   (gitignored). Edit those CSVs to fill the corrected D.O.B / Father's Name / Date Of Admission.
3. Build + dry-run, then import as inactive 2021-22 records (same flow as the rest):
   ```bash
   node scripts/student-migration/combine-detail.js \
     --only "1030/S/2K21,1071/S/2K21,1037/S/2K21" --out _combined-poordata.csv
   # creds: export SSO creds + AWS_REGION, OR set POSTGRES_PASSWORD env (prod.yml plaintext is stale)
   node modules/data-sync/scripts/sync-students-full.js --stage prod --school-code DBPASN \
     --file scripts/student-migration/out/raw/detail/_combined-poordata.csv \
     --academic-session 2021-22 --inserts-inactive --link-old-admissions --dry-run   # then drop --dry-run
   ```
   ⚠️ `sync-students-full.js` still reads the stale plaintext password from `configs/prod/prod.yml` —
   pass `POSTGRES_PASSWORD` via env (or wire it to `db-creds.js`/SSM) before running. The folder's
   own scripts (`q.js`, `reconcile.js`, …) already use SSM via `db-creds.js`.
4. Re-run `node scripts/student-migration/reconcile.js --no-collect` — should then show only the
   `0000` Dummy as "missing" (that one is junk, ignore).
