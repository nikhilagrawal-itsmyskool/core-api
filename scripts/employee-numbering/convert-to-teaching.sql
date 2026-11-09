-- One-off: convert the existing DBPASN staff numbers DBPASN/<n> -> DBPASN/T/<n> and mark them
-- teaching. device_number is untouched (biometric PINs stay the same — no re-enrollment).
-- Idempotent: after conversion the numbers match ^DBPASN/T/..., not ^DBPASN/[0-9]+$, so a re-run
-- affects 0 rows.
update employee
set employee_number = 'DBPASN/T/' || split_part(employee_number, '/', 2),
    employee_type = 'teaching',
    updated_at = now()
where school_id = (select uuid from school where lower(code) = 'dbpasn')
  and employee_number ~ '^DBPASN/[0-9]+$';
