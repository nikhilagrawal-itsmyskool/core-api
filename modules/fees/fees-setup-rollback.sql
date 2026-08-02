-- fees module rollback — drops all fees tables. DESTRUCTIVE.
drop table if exists fee_receipt_counter;
drop table if exists fee_refund;
drop table if exists fee_receipt_line;
drop table if exists fee_receipt;
drop table if exists student_ledger_entry;
drop table if exists fee_waiver;
drop table if exists fee_concession_student;
drop table if exists fee_concession;
drop table if exists fee_late_fee_rule;
drop table if exists fee_transport_slab;
drop table if exists fee_structure_student;
drop table if exists fee_structure;
drop table if exists fee_head;
drop table if exists fee_cycle;
