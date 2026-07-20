-- Student Module Schema Rollback (Phase 1)
-- Drops only what student-setup.sql added. The core `student` / `student_class`
-- tables (owned by modules/db) are left intact; only the columns this module
-- added to them are removed.

-- Phase 2 additions (drop first; reverse of setup order).
drop table if exists student_sibling;
drop table if exists student_address;
drop table if exists student_lookup;

alter table file_storage drop column if exists variant;

alter table student_guardian drop column if exists relationship;
alter table student_guardian drop column if exists designation;
alter table student_guardian drop column if exists organisation;
alter table student_guardian drop column if exists education;

alter table student_class drop column if exists join_date;

alter table student drop column if exists student_email;
alter table student drop column if exists student_mobile;
alter table student drop column if exists student_whatsapp;
alter table student drop column if exists category_code;
alter table student drop column if exists nationality_code;
alter table student drop column if exists mother_tongue_code;
alter table student drop column if exists blood_group_code;
alter table student drop column if exists aadhaar_number;
alter table student drop column if exists previous_school;
alter table student drop column if exists admission_date;
alter table student drop column if exists withdrawal_date;
alter table student drop column if exists withdrawal_remarks;

drop table if exists student_guardian;
drop table if exists house_teacher;
drop table if exists house;

drop index if exists idx_student_class_roll_unique;
alter table student_class drop column if exists roll_number;
alter table student_class drop column if exists status;

alter table student drop column if exists house_id;

-- Note: the global UNIQUE on student.admission_number that setup dropped is NOT
-- recreated here (it was a multi-tenancy bug); per-school uniqueness remains via
-- idx_student_admission_number_school_id.
