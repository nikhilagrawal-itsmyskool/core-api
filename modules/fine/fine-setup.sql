-- Fine Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints
-- No default values in DDL - defaults handled in application code
-- Safe to re-run: all statements use IF NOT EXISTS guards

-- Table 1: fine_incident (core incident record)
create table if not exists fine_incident (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    incident_date date not null,
    category varchar(32) not null check (category in (
        'library', 'infrastructure_movable', 'infrastructure_immovable',
        'library_books', 'medical', 'labs'
    )),
    person_type varchar(16) not null check (person_type in ('student', 'employee')),
    person_id varchar(12) not null,
    description varchar(1024),
    suggested_fine_amount decimal(10,2),
    assigned_to_id varchar(12),
    decided_fine_amount decimal(10,2),
    decision varchar(16) check (decision in ('collect', 'waive')),
    status varchar(16) not null check (status in ('open', 'under_review', 'decision_made', 'closed')),
    reported_by_id varchar(12) not null,
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_fine_incident_school_id on fine_incident(school_id);
create index if not exists idx_fine_incident_status on fine_incident(school_id, status);
create index if not exists idx_fine_incident_category on fine_incident(school_id, category);
create index if not exists idx_fine_incident_person on fine_incident(school_id, person_type, person_id);
create index if not exists idx_fine_incident_assigned_to on fine_incident(school_id, assigned_to_id);
create index if not exists idx_fine_incident_date on fine_incident(school_id, incident_date);

-- Table 2: fine_incident_note (append-only conversational thread)
create table if not exists fine_incident_note (
    uuid varchar(12) primary key,
    incident_id varchar(12) not null,
    school_id varchar(12) not null,
    author_id varchar(12) not null,
    author_type varchar(16) not null check (author_type in ('student', 'employee')),
    note_text varchar(2048) not null,
    note_type varchar(16) not null check (note_type in ('comment', 'system')),
    createdby_userid varchar(12),
    created_at timestamp(0)
);

create index if not exists idx_fine_note_incident_id on fine_incident_note(incident_id);
create index if not exists idx_fine_note_school_id on fine_incident_note(school_id);

-- Table 3: fine_incident_evidence (file attachments via shared file_storage)
create table if not exists fine_incident_evidence (
    uuid varchar(12) primary key,
    incident_id varchar(12) not null,
    school_id varchar(12) not null,
    file_id varchar(12) not null,
    uploaded_by_id varchar(12) not null,
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_fine_evidence_incident_id on fine_incident_evidence(incident_id);
create index if not exists idx_fine_evidence_school_id on fine_incident_evidence(school_id, status);

-- Table 4: fine_collection (fine payment record + receipt)
create table if not exists fine_collection (
    uuid varchar(12) primary key,
    incident_id varchar(12) not null,
    school_id varchar(12) not null,
    amount_collected decimal(10,2) not null,
    collection_date date not null,
    payment_method varchar(16) check (payment_method in ('cash', 'online', 'cheque', 'dd')),
    receipt_number varchar(32) not null,
    notes varchar(512),
    collected_by_id varchar(12) not null,
    createdby_userid varchar(12),
    created_at timestamp(0),
    status varchar(16) check (status in ('active', 'deleted'))
);

create index if not exists idx_fine_collection_incident_id on fine_collection(incident_id);
create index if not exists idx_fine_collection_school_id on fine_collection(school_id);
create unique index if not exists idx_fine_collection_receipt on fine_collection(receipt_number);
