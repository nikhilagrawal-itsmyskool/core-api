-- Website module rollback. Contentful entries/assets already pushed are NOT removed.
drop table if exists website_audit;
drop table if exists website_publication_asset;
drop table if exists website_publication;
drop table if exists website_config;
