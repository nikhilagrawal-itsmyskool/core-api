'use strict';

// One-time migration: copy file_storage blobs from Postgres (data column) into S3.
// Idempotent — only processes rows where storage_key IS NULL. The DB `data` is left
// intact so you can verify before dropping it.
//
// Prereqs: run modules/db/db-create-4.sql first (adds storage_key column).
//
// Usage (PowerShell), from core-api/:
//   $env:AWS_PROFILE='prod-itsmyskool-nikhil.agrawal'; $env:AWS_REGION='ap-south-1'
//   $env:FILE_STORAGE_BUCKET='prod-itsmyskool-file-storage'
//   $env:POSTGRES_ENDPOINT='...rds.amazonaws.com'; $env:POSTGRES_DATABASE='itsmyskool_prod'
//   $env:POSTGRES_USERNAME='postgres'; $env:POSTGRES_PASSWORD='...'; $env:POSTGRES_SSL='true'
//   node scripts/migrate-file-storage-to-s3.js --dry-run
//   node scripts/migrate-file-storage-to-s3.js            # for real
//   node scripts/migrate-file-storage-to-s3.js --batch 500

const path = require('path');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const DRY = process.argv.includes('--dry-run');
const bi = process.argv.indexOf('--batch');
const BATCH = bi > -1 ? parseInt(process.argv[bi + 1], 10) : 200;

const BUCKET = process.env.FILE_STORAGE_BUCKET;
if (!BUCKET) {
  console.error('FILE_STORAGE_BUCKET is not set.');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.POSTGRES_HOST || process.env.POSTGRES_ENDPOINT,
  database: process.env.POSTGRES_DATABASE,
  user: process.env.POSTGRES_USER || process.env.POSTGRES_USERNAME,
  password: process.env.POSTGRES_PASSWORD,
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  ssl: process.env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
});

const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });

// MUST match buildStorageKey() in shared/lib/file-storage.ts
function buildStorageKey(f) {
  const ext = path.extname(f.file_name || '');
  return `${f.school_id}/${f.entity_type}/${f.entity_id}/${f.uuid}${ext}`;
}

async function main() {
  let migrated = 0;
  let failed = 0;

  for (;;) {
    const { rows } = await pool.query(
      `select uuid, file_name, mime_type, data, entity_type, entity_id, school_id
         from file_storage
        where storage_key is null and data is not null
        order by uuid
        limit $1`,
      [BATCH],
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      const key = buildStorageKey(row);
      try {
        if (!DRY) {
          const body = Buffer.from(row.data, 'base64');
          await s3.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            Body: body,
            ContentType: row.mime_type,
          }));
          await pool.query('update file_storage set storage_key = $1 where uuid = $2', [key, row.uuid]);
        }
        migrated++;
        if (migrated % 50 === 0) console.log(`  ...${migrated} migrated`);
      } catch (e) {
        failed++;
        console.error(`FAILED ${row.uuid} -> ${key}: ${e.message}`);
      }
    }

    if (DRY) {
      console.log(`[dry-run] first batch would migrate ${rows.length} object(s); sample key: ${buildStorageKey(rows[0])}`);
      break; // dry-run doesn't set storage_key, so it would loop forever otherwise
    }
  }

  console.log(`Done. migrated=${migrated} failed=${failed}${DRY ? ' (dry-run)' : ''}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
