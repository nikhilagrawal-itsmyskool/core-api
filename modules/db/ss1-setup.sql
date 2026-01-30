insert into school (uuid, name, code, createdby_userid, created_at, updatedby_userid, updated_at) 
values ('6zoptlhtok3n', 'Sample School 1', 'SS1', '0', now(), null, null);

insert into employee (uuid, employee_number, name, family_unique_number, school_id, createdby_userid, created_at) 
values ('zbtuiuwn5smc', 'wmhsnfysfsk3', 'Itsmyskool Admin', '8373919559', '6zoptlhtok3n', '0', now());

insert into employee_login (uuid, username, password, display_name, school_id, createdby_userid, created_at, updatedby_userid, updated_at)
values ('vri6atdefwdc', '8373919559', 'Itsmyskool@123', 'Itsmyskool Admin', '6zoptlhtok3n', '0', now(), null, null);
