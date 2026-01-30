insert into school (uuid, name, code, createdby_userid, created_at, updatedby_userid, updated_at) 
values ('b29ex8vpzdgp', 'Test School 1', 'TS1', '0', now(), null, null);

insert into employee (uuid, employee_number, name, family_unique_number, school_id, createdby_userid, created_at) 
values ('issd7edat8ie', 'ujql7w2kq9jv', 'Itsmyskool Admin', '8373919559', 'b29ex8vpzdgp', '0', now());

insert into employee_login (uuid, username, password, display_name, school_id, createdby_userid, created_at, updatedby_userid, updated_at)
values ('yuw7a7hcvb9g', '8373919559', 'Itsmyskool@123', 'Itsmyskool Admin', 'b29ex8vpzdgp', '0', now(), null, null);
