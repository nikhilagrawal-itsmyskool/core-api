insert into school (uuid, name, code, createdby_userid, created_at, updatedby_userid, updated_at) 
values ('mggd21p5dwf6', 'Sample School 1', 'SS1', '0', now(), null, null);

insert into employee (uuid, employee_number, name, family_unique_number, school_id, createdby_userid, created_at) 
values ('iww8zvhjv2bi', 'kwplqycpfzj0', 'Itsmyskool Admin', '8373919559', 'mggd21p5dwf6', '0', now());
