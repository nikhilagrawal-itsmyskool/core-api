-- Assembly migration 6: house-mode GRADING + house-of-the-month (Phase D).
-- Evaluators grade a roster week's assembly on a date against a per-school
-- configurable rubric (metrics + penalties + a scaling adjustment). Day score =
-- avg of evaluators' totals; week score = avg of its days; house-of-the-month =
-- highest weekly average. Additive/idempotent; inert for 'template'-mode schools.

-- Rubric: scoring metrics (e.g. 7 metrics each out of 5).
create table if not exists assembly_rubric_metric (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    name varchar(160) not null,
    max_marks integer not null,
    sort_order integer not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_assembly_rubric_metric_school on assembly_rubric_metric(school_id) where status = 'active';

-- Rubric: penalties (deductions). value = the amount subtracted when applied.
create table if not exists assembly_rubric_penalty (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    name varchar(160) not null,
    value numeric(6, 2) not null,
    sort_order integer not null,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_assembly_rubric_penalty_school on assembly_rubric_penalty(school_id) where status = 'active';

-- Rubric config: a per-school scaling adjustment added to every grade total.
create table if not exists assembly_rubric_config (
    school_id varchar(12) primary key,
    scaling_adjustment numeric(6, 2),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- An employee assigned to grade assemblies over a date range. Presence of an
-- assignment covering a date derives the 'assembly.grade' permission.
create table if not exists assembly_evaluator (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    employee_id varchar(12) not null,
    employee_name varchar(160),
    start_date date,
    end_date date,
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create index if not exists idx_assembly_evaluator_school on assembly_evaluator(school_id) where status = 'active';

-- One grade per (roster week, date, evaluator). house_id is the week's house
-- snapshot; total is computed = sum(metric scores) - sum(applied penalties) +
-- scaling_adjustment.
create table if not exists assembly_grade (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    week_id varchar(12) not null,
    grade_date date not null,
    house_id varchar(12),
    house_name varchar(128),
    evaluator_employee_id varchar(12) not null,
    evaluator_name varchar(160),
    star_presenter varchar(160),
    diction varchar(160),
    feedback text,
    total numeric(7, 2),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
create unique index if not exists idx_assembly_grade_unique on assembly_grade(week_id, grade_date, evaluator_employee_id) where status = 'active';
create index if not exists idx_assembly_grade_week on assembly_grade(week_id) where status = 'active';
create index if not exists idx_assembly_grade_house on assembly_grade(school_id, house_id, grade_date) where status = 'active';

-- Per-metric score for a grade.
create table if not exists assembly_grade_metric (
    uuid varchar(12) primary key,
    grade_id varchar(12) not null,
    metric_id varchar(12) not null,
    score numeric(6, 2) not null
);
create unique index if not exists idx_assembly_grade_metric_unique on assembly_grade_metric(grade_id, metric_id);

-- Penalties applied to a grade (presence = applied).
create table if not exists assembly_grade_penalty (
    uuid varchar(12) primary key,
    grade_id varchar(12) not null,
    penalty_id varchar(12) not null
);
create unique index if not exists idx_assembly_grade_penalty_unique on assembly_grade_penalty(grade_id, penalty_id);
