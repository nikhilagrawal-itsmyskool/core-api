-- One-time, IDEMPOTENT backfill for the Phase-5 signature-owner refactor.
-- Pre-refactor, a signed roster lived only on exam_attendance.signed_* rows. The refactor
-- made exam_roster_signature the authoritative "submitted" record (read by the roster screens
-- and the completion board). This creates one owner row per signing event from the existing
-- signed exam_attendance rows so already-signed rosters keep showing as submitted after deploy.
-- Safe to re-run: inserts only where an owner row for that (exam_id, scope_key) doesn't exist.
-- Admit cards are unaffected either way (they read the denormalised exam_attendance columns).

insert into exam_roster_signature
  (uuid, school_id, exam_id, scope_key, room_id, exam_date,
   signed_by_employee_id, signed_at, signature_file_id,
   corrected_by_employee_id, corrected_at, createdby_userid, created_at)
select
  substr(md5(random()::text || clock_timestamp()::text), 1, 12),
  src.school_id, src.exam_id, src.scope_key, src.room_id, src.exam_date,
  src.signed_by_employee_id, src.signed_at, src.signature_file_id,
  src.corrected_by_employee_id, src.corrected_at, 'backfill', now()
from (
  select distinct on (exam_id, scope_key)
    school_id, exam_id,
    case when room_id is not null
         then 'r:' || room_id || ':' || to_char(exam_date, 'YYYY-MM-DD')
         else 'p:' || exam_paper_id || ':' || section_class_id end as scope_key,
    room_id, exam_date,
    signed_by_employee_id, signed_at, signature_file_id,
    corrected_by_employee_id, corrected_at
  from exam_attendance
  where signed_at is not null
  order by exam_id, scope_key, signed_at desc
) src
where not exists (
  select 1 from exam_roster_signature s
  where s.exam_id = src.exam_id and s.scope_key = src.scope_key
);
