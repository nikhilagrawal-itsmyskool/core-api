-- Feedback module rollback: drop all feedback tables.
drop table if exists feedback_audit;
drop table if exists feedback;
drop table if exists feedback_category;
