insert into school (uuid, name, code, createdby_userid, created_at, updatedby_userid, updated_at)
values ('2qy0xfycrq88', 'Dr. B. P. Agrawal Shiksha Niketan', 'DBPASN', '0', now(), null, null);

insert into employee (uuid, employee_number, name, family_unique_number, school_id, createdby_userid, created_at)
values ('galn0b2zx47r', 'g6wml2ai2ywm', 'Itsmyskool Admin', '8373919559', '2qy0xfycrq88', '0', now());

insert into employee_login (uuid, username, password, display_name, school_id, createdby_userid, created_at, updatedby_userid, updated_at)
values ('n32cpzknu9y1', '8373919559', 'Itsmyskool@123', 'Itsmyskool Admin', '2qy0xfycrq88', '0', now(), null, null);
