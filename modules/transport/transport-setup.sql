-- Transport Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints.
-- No default values in DDL - defaults handled in application code.
-- Safe to re-run: all statements use IF NOT EXISTS guards.
--
-- Model:
--   transport_stop            - school-wide master of stops (km drives future fees)
--   transport_vehicle         - registry of buses/vans (owned or contract)
--   transport_route           - a morning OR evening route; vehicle + staff + snapshot contacts
--   transport_route_stop      - ordered, de-duplicated stops on a route (sequence)
--   transport_student_assignment - student -> route+stop, one per direction per year
--   transport_attendance_session/_record/_audit - per-route roll-call (mirrors attendance module)

-- Table 1: transport_stop (school-wide master; reused across routes)
create table if not exists transport_stop (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    name varchar(128) not null,
    km numeric(6,2),
    landmark varchar(256),
    latitude numeric(10,8),
    longitude numeric(11,8),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- No duplicate stop names within a school (soft-delete aware, case-insensitive).
create unique index if not exists idx_transport_stop_name_unique
    on transport_stop(school_id, lower(name)) where status = 'active';
create index if not exists idx_transport_stop_school on transport_stop(school_id);

-- Table 2: transport_vehicle (bus/van registry)
create table if not exists transport_vehicle (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    vehicle_type varchar(16) not null check (vehicle_type in ('bus', 'van', 'other')),
    make_model varchar(128),
    registration_number varchar(32) not null,
    ownership varchar(16) not null check (ownership in ('owned', 'contract')),
    capacity integer,
    driver_name varchar(128),
    driver_phone varchar(20),
    conductor_name varchar(128),
    conductor_phone varchar(20),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- No duplicate registration number within a school (soft-delete aware).
create unique index if not exists idx_transport_vehicle_reg_unique
    on transport_vehicle(school_id, lower(registration_number)) where status = 'active';
create index if not exists idx_transport_vehicle_school on transport_vehicle(school_id);

-- Table 3: transport_route (a single direction; morning and evening are separate rows)
create table if not exists transport_route (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    name varchar(128) not null,
    direction varchar(16) not null check (direction in ('morning', 'evening')),
    vehicle_id varchar(12),
    accompanying_teacher_id varchar(12),
    helper_id varchar(12),
    route_incharge_id varchar(12),
    -- Driver/conductor snapshot: prefilled from the vehicle, editable per route.
    driver_name varchar(128),
    driver_phone varchar(20),
    conductor_name varchar(128),
    conductor_phone varchar(20),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- Route name unique per direction within a school (soft-delete aware).
create unique index if not exists idx_transport_route_name_unique
    on transport_route(school_id, lower(name), direction) where status = 'active';
create index if not exists idx_transport_route_school_direction on transport_route(school_id, direction);

-- Table 4: transport_route_stop (ordered junction; no duplicate stop on a route)
create table if not exists transport_route_stop (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    route_id varchar(12) not null,
    stop_id varchar(12) not null,
    sequence integer not null,
    scheduled_time varchar(8),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- A stop can appear at most once on a route (soft-delete aware).
create unique index if not exists idx_transport_route_stop_unique
    on transport_route_stop(route_id, stop_id) where status = 'active';
create index if not exists idx_transport_route_stop_seq on transport_route_stop(school_id, route_id, sequence);

-- Table 5: transport_student_assignment (student -> route+stop, per direction per year)
create table if not exists transport_student_assignment (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    student_id varchar(12) not null,
    route_id varchar(12) not null,
    stop_id varchar(12) not null,
    direction varchar(16) not null check (direction in ('morning', 'evening')),
    student_name varchar(128),
    status varchar(16) not null check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- At most one morning + one evening assignment per student per academic year.
create unique index if not exists idx_transport_assignment_unique
    on transport_student_assignment(school_id, academic_year_id, student_id, direction) where status = 'active';
create index if not exists idx_transport_assignment_route on transport_student_assignment(school_id, route_id);
create index if not exists idx_transport_assignment_student on transport_student_assignment(school_id, student_id);

-- Table 6: transport_attendance_session (per-route roll-call header; route carries direction)
create table if not exists transport_attendance_session (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    academic_year_id varchar(12) not null,
    route_id varchar(12) not null,
    attendance_date date not null,
    status varchar(16) not null check (status in ('open', 'finalized')),
    finalized_at timestamp(0),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

-- One roll-call per route per day.
create unique index if not exists idx_transport_att_session_unique
    on transport_attendance_session(school_id, route_id, attendance_date);
create index if not exists idx_transport_att_session_lookup
    on transport_attendance_session(school_id, route_id, attendance_date);

-- Table 7: transport_attendance_record (one per assigned student per session)
create table if not exists transport_attendance_record (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    session_id varchar(12) not null,
    student_id varchar(12) not null,
    status varchar(16) not null check (status in ('boarded', 'absent', 'excused')),
    remark text,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create unique index if not exists idx_transport_att_record_unique on transport_attendance_record(session_id, student_id);
create index if not exists idx_transport_att_record_session on transport_attendance_record(session_id);
create index if not exists idx_transport_att_record_student on transport_attendance_record(school_id, student_id);

-- Table 8: transport_attendance_audit (append-only change log)
create table if not exists transport_attendance_audit (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    session_id varchar(12) not null,
    record_id varchar(12),
    student_id varchar(12) not null,
    old_status varchar(16),
    new_status varchar(16),
    source varchar(32) check (source in ('mark', 'edit', 'finalize')),
    changedby_userid varchar(12),
    changed_at timestamp(0)
);

create index if not exists idx_transport_att_audit_session on transport_attendance_audit(session_id);
create index if not exists idx_transport_att_audit_record on transport_attendance_audit(record_id);
