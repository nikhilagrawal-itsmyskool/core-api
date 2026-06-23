-- Library Module Schema
-- All SQL in lowercase, no foreign keys, enum fields use CHECK constraints.
-- No default values in DDL - defaults handled in application code.
-- Safe to re-run: all statements use IF NOT EXISTS guards.
--
-- Three-level bibliographic model (FRBR-style):
--   library_work  -> the intellectual work (author, DDC/subject, color). 1 row.
--   library_title -> a specific edition+language (manifestation). N per work.
--   library_copy  -> one physical book = one accession number. N per title.
-- Translations / new editions are new library_title rows under the same work,
-- which is what enables cross-language/edition rollups
-- (e.g. "Wings of Fire = 5 English + 5 Hindi").

-- Table 1: library_work (the intellectual work; shared across editions/languages)
create table if not exists library_work (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    uniform_title varchar(512) not null,
    author_input varchar(512),
    author_display varchar(512),
    first_author_surname varchar(128),
    cutter varchar(8),
    ddc_number varchar(16),
    subject_type varchar(128),
    topic varchar(128),
    keywords varchar(512),
    age_from integer,
    age_to integer,
    class_from varchar(32),
    class_to varchar(32),
    color_code varchar(32),
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_library_work_school on library_work(school_id);
create index if not exists idx_library_work_school_status on library_work(school_id, status);
create index if not exists idx_library_work_title on library_work(school_id, lower(uniform_title));
create index if not exists idx_library_work_surname on library_work(school_id, lower(first_author_surname));

-- Table 2: library_title (an edition+language under a work)
create table if not exists library_title (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    work_id varchar(12) not null,
    title_as_printed varchar(512) not null,
    language varchar(16) check (language in ('hindi', 'english', 'bilingual')),
    edition varchar(64),
    year_of_publication integer,
    publisher varchar(256),
    isbn varchar(20),
    local_call_no varchar(64),
    pages integer,
    cover_file_id varchar(12),
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_library_title_school on library_title(school_id);
create index if not exists idx_library_title_school_status on library_title(school_id, status);
create index if not exists idx_library_title_work on library_title(school_id, work_id);
create index if not exists idx_library_title_isbn on library_title(school_id, isbn);
create index if not exists idx_library_title_search on library_title(school_id, lower(title_as_printed));
create index if not exists idx_library_title_callno on library_title(school_id, lower(local_call_no));

-- Table 3: library_copy (a physical book = one accession number)
create table if not exists library_copy (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    title_id varchar(12) not null,
    accession_no varchar(64) not null,
    acquisition_date date,
    acquisition_year integer,
    source varchar(128),
    bill_no varchar(64),
    bill_date date,
    bill_file_id varchar(12),
    acquisition_batch_id varchar(12),
    price numeric(10, 2),
    is_specimen boolean,
    almirah varchar(64),
    shelf varchar(64),
    qr_value varchar(64),
    book_condition varchar(32) check (book_condition in ('new', 'good', 'fair', 'damaged', 'poor')),
    remarks varchar(512),
    status varchar(16) check (status in ('available', 'issued', 'lost', 'withdrawn', 'damaged', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_library_copy_school on library_copy(school_id);
create index if not exists idx_library_copy_school_status on library_copy(school_id, status);
create index if not exists idx_library_copy_title on library_copy(school_id, title_id);
create index if not exists idx_library_copy_batch on library_copy(school_id, acquisition_batch_id);
create unique index if not exists idx_library_copy_accession_unique on library_copy(school_id, lower(accession_no)) where status <> 'deleted';

-- Table 4: library_ddc (global Dewey Decimal summaries; read-only reference)
-- Not per-school. Seeded once in application code (library-ddc-service) from
-- the publicly usable DDC Summaries.
create table if not exists library_ddc (
    code varchar(16) primary key,
    level varchar(16) check (level in ('class', 'division', 'section')),
    label varchar(256) not null,
    parent_code varchar(16)
);

create index if not exists idx_library_ddc_level on library_ddc(level);
create index if not exists idx_library_ddc_parent on library_ddc(parent_code);

-- Table 5: library_lookup (generic per-school managed lookups)
create table if not exists library_lookup (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    lookup_type varchar(32) not null check (lookup_type in ('color', 'age_band', 'almirah', 'shelf', 'edition', 'publisher', 'source')),
    code varchar(64) not null,
    label varchar(128) not null,
    extra jsonb,
    status varchar(16) check (status in ('active', 'deleted')),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_library_lookup_school_type on library_lookup(school_id, lookup_type, status);
create unique index if not exists idx_library_lookup_code_unique on library_lookup(school_id, lookup_type, lower(code)) where status = 'active';

-- Table 6: library_circulation (issue/return transactions)
create table if not exists library_circulation (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    copy_id varchar(12) not null,
    borrower_type varchar(16) check (borrower_type in ('student', 'employee')),
    borrower_id varchar(12) not null,
    borrower_name varchar(256),
    issue_date date not null,
    due_date date not null,
    return_date date,
    renew_count integer,
    status varchar(16) check (status in ('issued', 'returned', 'lost')),
    issuedby_userid varchar(12),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_library_circ_school on library_circulation(school_id);
create index if not exists idx_library_circ_copy on library_circulation(school_id, copy_id);
create index if not exists idx_library_circ_borrower on library_circulation(school_id, borrower_type, borrower_id);
create index if not exists idx_library_circ_status on library_circulation(school_id, status);

-- Table 7: library_fine (overdue / lost-book charges)
create table if not exists library_fine (
    uuid varchar(12) primary key,
    school_id varchar(12) not null,
    circulation_id varchar(12),
    copy_id varchar(12) not null,
    borrower_type varchar(16) check (borrower_type in ('student', 'employee')),
    borrower_id varchar(12) not null,
    fine_type varchar(16) check (fine_type in ('overdue', 'lost')),
    days_overdue integer,
    amount numeric(10, 2) not null,
    amount_collected numeric(10, 2),
    status varchar(16) check (status in ('pending', 'paid', 'waived')),
    receipt_number varchar(32),
    paid_date date,
    notes varchar(512),
    createdby_userid varchar(12),
    created_at timestamp(0),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);

create index if not exists idx_library_fine_school on library_fine(school_id);
create index if not exists idx_library_fine_status on library_fine(school_id, status);
create index if not exists idx_library_fine_borrower on library_fine(school_id, borrower_type, borrower_id);
create unique index if not exists idx_library_fine_receipt on library_fine(receipt_number) where receipt_number is not null;

-- Table 8: library_policy (per-school loan/fine configuration; one row per school)
create table if not exists library_policy (
    school_id varchar(12) primary key,
    loan_period_days integer,
    max_copies_per_borrower integer,
    grace_days integer,
    overdue_rate_per_day numeric(10, 2),
    max_fine_cap numeric(10, 2),
    renew_limit integer,
    lost_charge_mode varchar(16) check (lost_charge_mode in ('price', 'fixed', 'multiplier')),
    lost_charge_value numeric(10, 2),
    updatedby_userid varchar(12),
    updated_at timestamp(0)
);
