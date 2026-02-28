-- Data Sync Module Migration
-- Adds status column to employee and student tables
-- Adds must_change_password column to employee_login table

alter table employee add column status varchar(16) check (status in ('active', 'inactive', 'deleted'));
update employee set status = 'active' where status is null;

alter table student add column status varchar(16) check (status in ('active', 'inactive', 'deleted'));
update student set status = 'active' where status is null;

alter table employee_login add column must_change_password boolean;
update employee_login set must_change_password = false where must_change_password is null;
