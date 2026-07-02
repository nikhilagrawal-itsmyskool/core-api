-- Hiring Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints
-- No default values in DDL - defaults handled in application code
-- Safe to re-run: all statements use IF NOT EXISTS guards

-- Table 1: hiring_candidate (core candidate record + final review)
create table if not exists hiring_candidate (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    name varchar(128) not null,
    father_husband_name varchar(128),
    position_type varchar(16) not null check (position_type in (
        'tgt', 'pgt', 'prt', 'ntt'
    )),
    subject varchar(64),
    mobile varchar(20),
    email varchar(128),
    photo_file_id varchar(12),
    resume_file_id varchar(12),
    status varchar(16) not null check (status in (
        'applied', 'screening', 'interview', 'demo', 'final_round',
        'selected', 'rejected', 'on_hold', 'withdrawn'
    )),
    final_comments varchar(2048),
    salary_requested decimal(12,2),
    salary_offered decimal(12,2),
    final_decision varchar(16) check (final_decision in (
        'selected', 'rejected', 'on_hold'
    )),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_hiring_candidate_school_id on hiring_candidate(school_id);
create index if not exists idx_hiring_candidate_status on hiring_candidate(school_id, status);
create index if not exists idx_hiring_candidate_position on hiring_candidate(school_id, position_type);
create index if not exists idx_hiring_candidate_subject on hiring_candidate(school_id, subject);

-- Table 2: hiring_stage (0..N interview pipeline stages per candidate)
create table if not exists hiring_stage (
    uuid varchar(12) primary key,
    candidate_id varchar(12) not null,
    school_id varchar(12) not null,
    stage_type varchar(24) not null check (stage_type in (
        'resume_screening', 'interview_1', 'class_demo', 'final_round'
    )),
    scheduled_date date,
    outcome varchar(16) not null check (outcome in (
        'pending', 'rejected', 'moved_to_next', 'on_hold', 'selected'
    )),
    comments varchar(2048),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_hiring_stage_candidate_id on hiring_stage(candidate_id);
create index if not exists idx_hiring_stage_school_id on hiring_stage(school_id);
