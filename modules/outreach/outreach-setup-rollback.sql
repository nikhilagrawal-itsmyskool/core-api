-- Outreach module rollback — drop all Moments tables. Image rows in the shared
-- file_storage table (entity_type = 'outreach') are NOT dropped here; sweep them
-- separately if required.
drop table if exists moment_audit;
drop table if exists moment_reaction;
drop table if exists moment_audience;
drop table if exists moment_photo;
drop table if exists moment;
