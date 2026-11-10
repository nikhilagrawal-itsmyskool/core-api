-- Classify the management/system accounts as Management: keep their current number but add the M
-- prefix (DBPASN/00n -> DBPASN/M/00n) and set employee_type='management'. device_number untouched.
-- After the earlier teaching conversion the only bare DBPASN/<digits> rows ARE the 4 management
-- accounts (001,002,003,100) — confirm with list-bare.js before running. Idempotent: re-run matches
-- 0 rows (DBPASN/M/... no longer matches ^DBPASN/[0-9]+$).
update employee
set employee_number = 'DBPASN/M/' || split_part(employee_number, '/', 2),
    employee_type = 'management',
    updated_at = now()
where school_id = (select uuid from school where lower(code) = 'dbpasn')
  and employee_number ~ '^DBPASN/[0-9]+$';
