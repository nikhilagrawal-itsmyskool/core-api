-- Fix: the convert-to-teaching pass over-matched. The management/system accounts already had
-- numbers DBPASN/001..100 (below the teaching 101..144 band) and got wrongly flipped to
-- DBPASN/T/00x + employee_type='teaching'. Revert anything numbered < 101 back to DBPASN/<n>
-- with no type. The 44 real teaching staff (101..144) keep DBPASN/T/<n> + teaching.
update employee
set employee_number = 'DBPASN/' || split_part(employee_number, '/', 3),
    employee_type = null,
    updated_at = now()
where school_id = (select uuid from school where lower(code) = 'dbpasn')
  and employee_number ~ '^DBPASN/T/[0-9]+$'
  and (split_part(employee_number, '/', 3))::int < 101;
