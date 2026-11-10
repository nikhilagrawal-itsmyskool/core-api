-- Rinku's login should be his mobile number (staff convention: username = family_unique_number =
-- mobile), not 'rinku'. Repoint both the employee link + the login, and set the mobile.
update employee
set family_unique_number = '8090266490', mobile = '8090266490', updated_at = now()
where school_id = (select uuid from school where lower(code) = 'dbpasn')
  and family_unique_number = 'rinku';

update employee_login
set username = '8090266490', updated_at = now()
where school_id = (select uuid from school where lower(code) = 'dbpasn')
  and username = 'rinku';
