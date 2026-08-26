-- Examination module rollback: drop all Phase 1 tables. Destructive.
drop table if exists exam_audit;
drop table if exists exam_invigilator;
drop table if exists exam_paper;
drop table if exists examination;
