-- fees module schema — additive + idempotent (safe to re-run).
-- Conventions: all lowercase; varchar(12) uuids (generateShortUuid); school_id on every row;
-- no foreign keys (application-level integrity); no DDL defaults (defaults in app code);
-- enum-like fields = varchar + check; audit columns on every table; amounts numeric(12,2).
-- Ledger lives inside the fees module for v1 (student_ledger_entry) but is modeled neutrally
-- (category + source_module/source_ref) so it can be extracted to a shared account module later.

-- ============================================================ CONFIG

create table if not exists fee_cycle (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  academic_year_id varchar(12) not null,
  name varchar(64) not null,
  abbreviation varchar(32),
  from_date date,
  to_date date,
  due_date date,
  sort_order integer,
  status varchar(16) not null check (status in ('active', 'deleted')),
  createdby_userid varchar(12), created_at timestamp(0),
  updatedby_userid varchar(12), updated_at timestamp(0)
);
create index if not exists idx_fee_cycle_ay on fee_cycle (school_id, academic_year_id);
create unique index if not exists uq_fee_cycle_name on fee_cycle (school_id, academic_year_id, lower(name)) where status = 'active';

create table if not exists fee_head (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  academic_year_id varchar(12) not null,
  name varchar(128) not null,
  abbreviation varchar(64),
  kind varchar(16) not null check (kind in ('recurring', 'admission', 'caution', 'transport', 'exam', 'annual', 'other')),
  refundable boolean,
  one_time boolean,
  amount_editable boolean,          -- amount editable at collection time
  sort_order integer,
  status varchar(16) not null check (status in ('active', 'deleted')),
  createdby_userid varchar(12), created_at timestamp(0),
  updatedby_userid varchar(12), updated_at timestamp(0)
);
create index if not exists idx_fee_head_ay on fee_head (school_id, academic_year_id);
create unique index if not exists uq_fee_head_name on fee_head (school_id, academic_year_id, lower(name)) where status = 'active';

-- class-wise structure: amount per (class, head, cycle)
create table if not exists fee_structure (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  academic_year_id varchar(12) not null,
  class_id varchar(12) not null,
  fee_head_id varchar(12) not null,
  cycle_id varchar(12) not null,
  amount numeric(12,2) not null,
  status varchar(16) not null check (status in ('active', 'deleted')),
  createdby_userid varchar(12), created_at timestamp(0),
  updatedby_userid varchar(12), updated_at timestamp(0)
);
create unique index if not exists uq_fee_structure on fee_structure (academic_year_id, class_id, fee_head_id, cycle_id) where status = 'active';
create index if not exists idx_fee_structure_ay on fee_structure (school_id, academic_year_id);

-- per-student override of a structure amount
create table if not exists fee_structure_student (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  academic_year_id varchar(12) not null,
  student_id varchar(12) not null,
  fee_head_id varchar(12) not null,
  cycle_id varchar(12) not null,
  amount numeric(12,2) not null,
  status varchar(16) not null check (status in ('active', 'deleted')),
  createdby_userid varchar(12), created_at timestamp(0),
  updatedby_userid varchar(12), updated_at timestamp(0)
);
create unique index if not exists uq_fee_structure_student on fee_structure_student (academic_year_id, student_id, fee_head_id, cycle_id) where status = 'active';
create index if not exists idx_fee_structure_student on fee_structure_student (school_id, student_id, academic_year_id);

-- forward-only transport pricing by km band (historical transport is not slab-based)
create table if not exists fee_transport_slab (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  academic_year_id varchar(12) not null,
  name varchar(64),
  from_km numeric(6,2),
  to_km numeric(6,2),
  amount_per_month numeric(12,2) not null,
  status varchar(16) not null check (status in ('active', 'deleted')),
  createdby_userid varchar(12), created_at timestamp(0),
  updatedby_userid varchar(12), updated_at timestamp(0)
);
create index if not exists idx_fee_transport_slab_ay on fee_transport_slab (school_id, academic_year_id);

create table if not exists fee_late_fee_rule (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  academic_year_id varchar(12) not null,
  applies_to_kind varchar(16),       -- fee_head.kind this rule targets (null = all)
  grace_days integer,
  mode varchar(8) not null check (mode in ('flat', 'perday', 'pct')),
  amount numeric(12,2) not null,
  cap numeric(12,2),
  status varchar(16) not null check (status in ('active', 'deleted')),
  createdby_userid varchar(12), created_at timestamp(0),
  updatedby_userid varchar(12), updated_at timestamp(0)
);
-- config for the auto-levy (Apply-Fine) job — off by default; see modules/fees/scripts/apply-fines.js
alter table fee_late_fee_rule add column if not exists enabled boolean;            -- master on/off (null/false = off)
alter table fee_late_fee_rule add column if not exists effective_from date;        -- fine-clock floor: days counted from max(cycle_due, effective_from)
alter table fee_late_fee_rule add column if not exists min_due_amount numeric(12,2);-- skip fine when a cycle's unpaid balance is below this ₹
alter table fee_late_fee_rule add column if not exists min_due_pct numeric(6,2);   -- skip fine when unpaid is below this % of the cycle
alter table fee_late_fee_rule add column if not exists cycle_scope text;           -- comma list of fineable cycle names (null = all except TOA/Full Term)
create index if not exists idx_fee_late_fee_rule_ay on fee_late_fee_rule (school_id, academic_year_id);

-- ============================================================ DISCOUNTS / RELIEF

create table if not exists fee_concession (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  academic_year_id varchar(12) not null,
  name varchar(128) not null,
  type varchar(20) not null check (type in ('sibling', 'sibling_elder', 'sibling_younger', 'staff', 'ews', 'other')),
  value_type varchar(8) not null check (value_type in ('amount', 'percent')),
  value numeric(12,2) not null,
  fee_head_id varchar(12),
  status varchar(16) not null check (status in ('active', 'deleted')),
  createdby_userid varchar(12), created_at timestamp(0),
  updatedby_userid varchar(12), updated_at timestamp(0)
);
create index if not exists idx_fee_concession_ay on fee_concession (school_id, academic_year_id);

create table if not exists fee_concession_student (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  concession_id varchar(12) not null,
  student_id varchar(12) not null,
  cycle_scope text,                  -- comma list of cycle ids/names the concession applies to (null = all)
  remarks varchar(512),
  attachment_file_id varchar(12),
  status varchar(16) not null check (status in ('active', 'deleted')),
  createdby_userid varchar(12), created_at timestamp(0),
  updatedby_userid varchar(12), updated_at timestamp(0)
);
-- apply the discount only to cycles due on/after this date (null = whole year); backdatable
alter table fee_concession_student add column if not exists effective_from date;
create index if not exists idx_fee_concession_student on fee_concession_student (school_id, student_id);
create index if not exists idx_fee_concession_student_c on fee_concession_student (school_id, concession_id);

create table if not exists fee_waiver (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  academic_year_id varchar(12) not null,
  student_id varchar(12) not null,
  fee_head_id varchar(12),
  cycle_id varchar(12),
  reason varchar(512),
  status varchar(16) not null check (status in ('active', 'deleted')),
  createdby_userid varchar(12), created_at timestamp(0),
  updatedby_userid varchar(12), updated_at timestamp(0)
);
create index if not exists idx_fee_waiver_student on fee_waiver (school_id, student_id, academic_year_id);

-- ============================================================ LEDGER (AR spine; v1 in fees)

create table if not exists student_ledger_entry (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  student_id varchar(12),                    -- null for unlinked/left students (see snapshot on receipt)
  academic_year_id varchar(12) not null,
  entry_date date not null,
  category varchar(12) not null check (category in ('fee', 'transport', 'library', 'fine', 'misc')),
  fee_head_id varchar(12),
  cycle_id varchar(12),
  head_label varchar(128),
  cycle_label varchar(64),
  kind varchar(10) not null check (kind in ('charge', 'concession', 'payment', 'waiver', 'adjust')),
  debit numeric(12,2),
  credit numeric(12,2),
  settles_entry_id varchar(12),              -- for payment/concession/waiver: the charge line it applies to
  source_module varchar(24),                 -- 'fees','fine','library',...
  source_ref varchar(64),                    -- e.g. receipt uuid / no, fine incident uuid
  remarks varchar(512),
  legacy_source varchar(16),                 -- 'schoolpad' for migrated rows
  allocation varchar(20),                    -- 'explicit' | 'fifo-reconstructed'
  status varchar(16) not null check (status in ('active', 'cancelled')),
  createdby_userid varchar(12), created_at timestamp(0),
  updatedby_userid varchar(12), updated_at timestamp(0)
);
create index if not exists idx_ledger_student on student_ledger_entry (school_id, student_id, academic_year_id);
create index if not exists idx_ledger_settles on student_ledger_entry (settles_entry_id);
create index if not exists idx_ledger_source on student_ledger_entry (source_module, source_ref);
create index if not exists idx_ledger_charge on student_ledger_entry (school_id, student_id, academic_year_id, fee_head_id, cycle_id);

-- ============================================================ COLLECTION

create table if not exists fee_receipt (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  academic_year_id varchar(12) not null,
  student_id varchar(12),                    -- null for adhoc/outsider
  receipt_no varchar(32) not null,           -- our own series
  legacy_receipt_no varchar(40),             -- original SchoolPad no (e.g. FR-14870-...)
  receipt_date date not null,
  type varchar(12) not null check (type in ('fee', 'transport', 'adhoc', 'refund')),
  payer_name varchar(128),                   -- identity snapshot for unlinked/left students
  payer_class_snapshot varchar(64),
  father_name varchar(128),
  mother_name varchar(128),
  admission_no_snapshot varchar(40),
  cycle_set text,                            -- comma list e.g. "Jan,Feburary,March"
  total_due numeric(12,2),
  total_paid numeric(12,2),
  balance numeric(12,2),
  concession_total numeric(12,2),
  payment_mode varchar(16) check (payment_mode in ('cash','cheque','draft','ecs','bank-deposit','card','neft','online','rte')),
  txn_ref varchar(128),
  received_from varchar(12) check (received_from in ('father','mother','guardian','other')),
  remarks varchar(1024),
  transport_remark varchar(512),             -- raw van-fee remark (2025-27) kept verbatim
  collected_by_userid varchar(12),           -- cashier: authenticated employee
  status varchar(16) not null check (status in ('active', 'cancelled')),
  cancel_reason varchar(256),
  cancelledby_userid varchar(12), cancelled_at timestamp(0),
  source varchar(12) not null check (source in ('native', 'schoolpad')),
  createdby_userid varchar(12), created_at timestamp(0),
  updatedby_userid varchar(12), updated_at timestamp(0)
);
create unique index if not exists uq_fee_receipt_no on fee_receipt (school_id, receipt_no) where status = 'active';
create unique index if not exists uq_fee_receipt_legacy on fee_receipt (school_id, legacy_receipt_no) where legacy_receipt_no is not null;
create index if not exists idx_fee_receipt_student on fee_receipt (school_id, student_id, academic_year_id);
create index if not exists idx_fee_receipt_date on fee_receipt (school_id, receipt_date);
create index if not exists idx_fee_receipt_collector on fee_receipt (school_id, collected_by_userid, receipt_date);
-- advance drawn down at collection time (cash received = total_paid; advance_applied funds the rest)
alter table fee_receipt add column if not exists advance_applied numeric(12,2);

create table if not exists fee_receipt_line (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  receipt_id varchar(12) not null,
  fee_head_id varchar(12),
  cycle_id varchar(12),
  head_label varchar(128),
  cycle_label varchar(64),
  amount numeric(12,2) not null,             -- may be < the charge's remaining (partial)
  is_concession boolean,
  settles_ledger_id varchar(12),             -- the charge line this payment settles
  createdby_userid varchar(12), created_at timestamp(0)
);
create index if not exists idx_fee_receipt_line_receipt on fee_receipt_line (receipt_id);

create table if not exists fee_refund (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  academic_year_id varchar(12) not null,
  student_id varchar(12) not null,
  fee_head_id varchar(12),                    -- typically the caution head
  amount numeric(12,2) not null,
  refund_date date,
  refund_status varchar(20) not null check (refund_status in ('not_refunded', 'refunded', 'dispersed')),
  reference_receipt_id varchar(12),
  remarks varchar(512),
  status varchar(16) not null check (status in ('active', 'deleted')),
  createdby_userid varchar(12), created_at timestamp(0),
  updatedby_userid varchar(12), updated_at timestamp(0)
);
create index if not exists idx_fee_refund_student on fee_refund (school_id, student_id, academic_year_id);

-- receipt-number counter (per school per series) for our own numbering
create table if not exists fee_receipt_counter (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  series varchar(16) not null,               -- e.g. 'FR','TR','AR','RF'
  academic_year_id varchar(12) not null,
  last_no integer not null,
  updated_at timestamp(0)
);
create unique index if not exists uq_fee_receipt_counter on fee_receipt_counter (school_id, series, academic_year_id);

-- follow-up / collection tracker: one row per (student, academic year) for the dues console
create table if not exists fee_followup (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  student_id varchar(12) not null,
  academic_year_id varchar(12) not null,
  status varchar(16),                        -- 'called' | 'promised' | 'unreachable' | 'settled' | null
  note varchar(512),
  promised_date date,
  updatedby_userid varchar(12),
  updated_at timestamp(0)
);
create unique index if not exists uq_fee_followup on fee_followup (school_id, student_id, academic_year_id);

-- follow-up timeline: MANY entries per student/year (each = a note + status + optional attachments
-- stored in file_storage entity_type='fee_followup', entity_id=entry uuid). Supersedes single-row fee_followup.
create table if not exists fee_followup_entry (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  student_id varchar(12) not null,
  academic_year_id varchar(12) not null,
  status varchar(16),                        -- 'called' | 'promised' | 'unreachable' | 'settled' | null
  note varchar(1000),
  promised_date date,
  createdby_userid varchar(12),
  created_at timestamp(0)
);
create index if not exists idx_fee_followup_entry on fee_followup_entry (school_id, student_id, academic_year_id, created_at desc);
