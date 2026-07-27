-- Homework module rollback: drop all homework tables.
-- Note: homework images in file_storage (entity_type='homework') are NOT removed here.
drop table if exists homework_audit;
drop table if exists homework_class_teacher;
drop table if exists homework_item;
drop table if exists homework_day;
