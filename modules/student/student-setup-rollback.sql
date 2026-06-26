-- Student Module Schema Rollback (Phase 1)
-- Drops only what student-setup.sql added. The core `student` / `student_class`
-- tables (owned by modules/db) are left intact; only the columns this module
-- added to them are removed.

drop table if exists student_guardian;
drop table if exists house;

drop index if exists idx_student_class_roll_unique;
alter table student_class drop column if exists roll_number;
alter table student_class drop column if exists status;

alter table student drop column if exists house_id;

-- Note: the global UNIQUE on student.admission_number that setup dropped is NOT
-- recreated here (it was a multi-tenancy bug); per-school uniqueness remains via
-- idx_student_admission_number_school_id.
