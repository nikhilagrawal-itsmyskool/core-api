-- Payments module — Razorpay online fee payments.
--
-- This module is a CONSUMER of fees: a successful payment is reconciled by calling
-- the fees public collect API (POST /fees/receipts), which owns all ledger/receipt
-- logic. We never write student_ledger_entry / fee_receipt here.
--
-- payment_intent is the single source of truth for an in-flight/settled payment:
-- it snapshots the allocations (which charge ledger entries, how much each) at order
-- time, so reconciliation is deterministic regardless of what the client sends back.
--
-- Apply: node scripts/run-sql.js --stage <stage> --file modules/payments/payments-setup.sql

create table if not exists payment_intent (
  uuid varchar(12) primary key,
  school_id varchar(12) not null,
  school_code varchar(16) not null,          -- captured at order time; the webhook path has no app header
  student_id varchar(12) not null,
  academic_year_id varchar(12) not null,
  family_number varchar(32),                 -- the family login (audience/telemetry)
  amount numeric(12,2) not null,             -- total charged (sum of allocations)
  allocations jsonb not null,                -- [{ ledgerId, amount }] snapshot at order time
  provider varchar(16) not null,             -- 'razorpay'
  order_id varchar(64),                      -- provider order id
  payment_id varchar(64),                    -- provider payment id (set on success)
  signature varchar(256),                    -- provider signature (verified before reconcile)
  status varchar(16) not null check (status in ('created','paid','reconciled','failed','cancelled')),
  receipt_id varchar(12),                    -- fee_receipt uuid once reconciled
  error text,                                -- last failure reason, if any
  createdby_userid varchar(12),
  created_at timestamp not null,
  updated_at timestamp
);

create index if not exists idx_payment_intent_student
  on payment_intent (school_id, student_id, academic_year_id);
create index if not exists idx_payment_intent_order on payment_intent (order_id);

-- Idempotency guard: at most ONE intent per provider payment_id, so verify + webhook
-- (which both reconcile) can never create two receipts for the same payment.
create unique index if not exists uq_payment_intent_payment
  on payment_intent (provider, payment_id) where payment_id is not null;
