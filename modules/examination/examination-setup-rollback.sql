-- Examination module rollback: drop all tables. Destructive.
-- Note: school_branding is a shared/central table (examination is only its first
-- consumer) — dropped here for a clean module rollback, but be aware other modules
-- may adopt it later.
drop table if exists exam_attendance_audit;
drop table if exists exam_attendance;
drop table if exists school_branding;
drop table if exists exam_print_log;
drop table if exists exam_dues_override;
drop table if exists exam_admit_card;
drop table if exists exam_audit;
drop table if exists exam_invigilator;
drop table if exists exam_paper;
drop table if exists examination;
