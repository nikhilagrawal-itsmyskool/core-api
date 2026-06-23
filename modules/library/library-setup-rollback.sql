-- Library Module Schema Rollback
-- Drops all library module tables. Destructive - use with care.
-- library_ddc is a global reference table; dropping it removes seeded summaries.

drop table if exists library_fine;
drop table if exists library_circulation;
drop table if exists library_copy;
drop table if exists library_title;
drop table if exists library_work;
drop table if exists library_lookup;
drop table if exists library_policy;
drop table if exists library_ddc;
