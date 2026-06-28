-- ============================================================================
-- XI-A timetable cleanup — soft-deletes ALL timetable setup on the XI-A class so
-- the school can re-enter it in the composite (two-class + cohort) model manually.
--
-- Needs NO subject/teacher knowledge: it wipes everything on the class wholesale.
-- Reversible (status -> 'deleted', not a hard delete). The class row itself is kept.
--
-- run-sql.js splits on ';' and has no variables, so this is flat SQL with lookups.
-- EDIT the 3 literals below to match this school, then:
--   node scripts/run-sql.js --stage <stage> --file scripts/xi-a-cleanup.sql
-- ----------------------------------------------------------------------------
-- CONFIG (edit):  school code = 'SCH'   class name = 'XI-A'   year name = '2026-27'
-- ============================================================================

-- class_subject: every subject the class takes
update class_subject set status = 'deleted', updatedby_userid = 'cleanup', updated_at = now()
where status = 'active'
  and school_id = (select uuid from school where lower(code) = lower('SCH'))
  and academic_year_id = (select y.uuid from academic_year y join school s on s.uuid = y.school_id where lower(s.code) = lower('SCH') and y.name = '2026-27')
  and class_id = (select c.uuid from class c join school s on s.uuid = c.school_id where lower(s.code) = lower('SCH') and c.name = 'XI-A');

-- teaching_assignment: who teaches those subjects to the class
update teaching_assignment set status = 'deleted', updatedby_userid = 'cleanup', updated_at = now()
where status = 'active'
  and school_id = (select uuid from school where lower(code) = lower('SCH'))
  and academic_year_id = (select y.uuid from academic_year y join school s on s.uuid = y.school_id where lower(s.code) = lower('SCH') and y.name = '2026-27')
  and class_id = (select c.uuid from class c join school s on s.uuid = c.school_id where lower(s.code) = lower('SCH') and c.name = 'XI-A');

-- elective_offering: each option inside the class's bands (delete before the bands)
update elective_offering set status = 'deleted', updatedby_userid = 'cleanup', updated_at = now()
where status = 'active'
  and school_id = (select uuid from school where lower(code) = lower('SCH'))
  and band_id in (
    select b.uuid from elective_band b
    join school s on s.uuid = b.school_id
    join class c on c.uuid = b.class_id
    where lower(s.code) = lower('SCH') and c.name = 'XI-A'
      and b.academic_year_id = (select y.uuid from academic_year y where y.school_id = s.uuid and y.name = '2026-27'));

-- elective_band: the class's parallel option blocks
update elective_band set status = 'deleted', updatedby_userid = 'cleanup', updated_at = now()
where status = 'active'
  and school_id = (select uuid from school where lower(code) = lower('SCH'))
  and academic_year_id = (select y.uuid from academic_year y join school s on s.uuid = y.school_id where lower(s.code) = lower('SCH') and y.name = '2026-27')
  and class_id = (select c.uuid from class c join school s on s.uuid = c.school_id where lower(s.code) = lower('SCH') and c.name = 'XI-A');

-- OPTIONAL — also remove the existing class teacher (homeroom). Leave commented to
-- KEEP it (e.g. reuse as the Science homeroom). Uncomment to wipe it too.
-- update class_teacher set status = 'deleted', updatedby_userid = 'cleanup', updated_at = now()
-- where status = 'active'
--   and school_id = (select uuid from school where lower(code) = lower('SCH'))
--   and academic_year_id = (select y.uuid from academic_year y join school s on s.uuid = y.school_id where lower(s.code) = lower('SCH') and y.name = '2026-27')
--   and class_id = (select c.uuid from class c join school s on s.uuid = c.school_id where lower(s.code) = lower('SCH') and c.name = 'XI-A');
