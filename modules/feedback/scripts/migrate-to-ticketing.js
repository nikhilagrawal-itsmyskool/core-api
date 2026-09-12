/**
 * One-shot migration: flat feedback (single-comment + thin audit) -> ticketing model
 * (append-only feedback_event timeline + feedback_watcher + slimmer header).
 *
 *   node modules/feedback/scripts/migrate-to-ticketing.js --stage prod
 *   node modules/feedback/scripts/migrate-to-ticketing.js -s local
 *
 * Safe to re-run: it skips rows that already have a timeline, only swaps the status
 * constraint / drops legacy columns when they're still present, and no-ops once done.
 *
 * Steps:
 *   1. Apply the additive schema (feedback-setup.sql) — new tables + columns.
 *   2. For each legacy feedback row with no events yet, synthesize a timeline
 *      (record + optional comment + optional complete/reopen), seed watchers, and set
 *      last_activity_at / closed_by / closed_at.
 *   3. Remap status values (assigned/responded/reopened -> open) and swap the CHECK.
 *   4. Drop the legacy columns (teacher_comment, responded_by, responded_at, review_note)
 *      and the superseded feedback_audit table.
 */

const path = require("path");
const { loadConfig, createPool, runSqlFile } = require("../../../scripts/run-sql");
const { generateShortUuid } = require("../../../shared/util/generate-uuid.js");

function parseArgs(args) {
  const out = { stage: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--stage" || args[i] === "-s") { out.stage = args[i + 1]; i++; }
  }
  return out;
}

async function columnExists(pool, table, column) {
  const r = await pool.query(
    `select 1 from information_schema.columns where table_name = $1 and column_name = $2`,
    [table, column],
  );
  return r.rows.length > 0;
}

async function tableExists(pool, table) {
  const r = await pool.query(
    `select 1 from information_schema.tables where table_name = $1`,
    [table],
  );
  return r.rows.length > 0;
}

// Map a legacy status to the new lifecycle for a synthesized to_status.
function newStatusFor(legacy) {
  return legacy === "completed" ? "completed" : "open";
}

async function insertEvent(pool, ev) {
  await pool.query(
    `insert into feedback_event
       (uuid, school_id, feedback_id, event_type, actor_id, body, from_status, to_status, from_assignee, to_assignee, mentions, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      generateShortUuid(12), ev.schoolId, ev.feedbackId, ev.eventType, ev.actorId || null,
      ev.body || null, ev.fromStatus || null, ev.toStatus || null,
      ev.fromAssignee || null, ev.toAssignee || null, ev.mentions || null, ev.createdAt || new Date(),
    ],
  );
}

async function addWatcher(pool, schoolId, feedbackId, employeeId, addedAt) {
  if (!employeeId) return;
  await pool.query(
    `insert into feedback_watcher (uuid, school_id, feedback_id, employee_id, muted, last_seen_at, added_at)
     values ($1,$2,$3,$4,false,null,$5)
     on conflict (feedback_id, employee_id) do nothing`,
    [generateShortUuid(12), schoolId, feedbackId, employeeId, addedAt || new Date()],
  );
}

async function migrateRow(pool, f) {
  // Skip if this ticket already has a timeline (idempotent re-run).
  const existing = await pool.query(`select 1 from feedback_event where feedback_id = $1 limit 1`, [f.uuid]);
  if (existing.rows.length > 0) return false;

  const schoolId = f.school_id;
  const id = f.uuid;
  const createdAt = f.created_at || new Date();
  let lastActivity = createdAt;

  // 1. record
  await insertEvent(pool, {
    schoolId, feedbackId: id, eventType: "record", actorId: f.recorded_by,
    fromStatus: null, toStatus: "open", toAssignee: f.assigned_to, createdAt,
  });

  // 2. teacher comment (if any) — a status-neutral comment authored by the responder.
  if (f.teacher_comment && String(f.teacher_comment).trim()) {
    const at = f.responded_at || createdAt;
    await insertEvent(pool, {
      schoolId, feedbackId: id, eventType: "comment",
      actorId: f.responded_by || f.assigned_to, body: String(f.teacher_comment).trim(), createdAt: at,
    });
    if (at > lastActivity) lastActivity = at;
  }

  // 3. director decision (if terminal/reopened)
  if (f.status === "completed" || f.status === "reopened") {
    const at = f.reviewed_at || lastActivity;
    const type = f.status === "completed" ? "complete" : "reopen";
    await insertEvent(pool, {
      schoolId, feedbackId: id, eventType: type, actorId: f.reviewed_by,
      body: f.review_note ? String(f.review_note).trim() : null,
      fromStatus: "open", toStatus: newStatusFor(f.status), createdAt: at,
    });
    if (at > lastActivity) lastActivity = at;
  }

  // Header denormalizations.
  const closedBy = f.status === "completed" ? f.reviewed_by || null : null;
  const closedAt = f.status === "completed" ? f.reviewed_at || null : null;
  await pool.query(
    `update feedback set last_activity_at = $1, closed_by = $2, closed_at = $3 where uuid = $4`,
    [lastActivity, closedBy, closedAt, id],
  );

  // Watchers: recorder + assignee + responder + reviewer.
  await addWatcher(pool, schoolId, id, f.recorded_by, createdAt);
  await addWatcher(pool, schoolId, id, f.assigned_to, createdAt);
  await addWatcher(pool, schoolId, id, f.responded_by, createdAt);
  await addWatcher(pool, schoolId, id, f.reviewed_by, createdAt);
  return true;
}

async function swapStatusConstraint(pool) {
  // Drop any existing CHECK on feedback that references status, then add the new one.
  const cons = await pool.query(
    `select conname from pg_constraint
       where conrelid = 'feedback'::regclass and contype = 'c'
         and pg_get_constraintdef(oid) ilike '%status%'`,
  );
  for (const c of cons.rows) {
    await pool.query(`alter table feedback drop constraint if exists ${c.conname}`);
  }
  await pool.query(`update feedback set status = 'open' where status in ('assigned','responded','reopened')`);
  await pool.query(
    `alter table feedback add constraint feedback_status_check check (status in ('open','completed','cancelled'))`,
  );
}

async function main() {
  const { stage } = parseArgs(process.argv.slice(2));
  if (!stage) { console.error("Usage: --stage <local|dev|qa|prod>"); process.exit(1); }

  const config = loadConfig(stage);
  console.log(`\n=== Feedback -> ticketing migration (stage: ${stage}) ===`);
  console.log(`Connecting to ${config.POSTGRES_ENDPOINT || config.POSTGRES_HOST}/${config.POSTGRES_DATABASE}...`);
  const pool = createPool(config);

  try {
    await pool.query("select 1");

    // 1. Additive schema (new tables + columns). Fresh installs are fully set up by this.
    await runSqlFile(pool, path.join(__dirname, "../feedback-setup.sql"));

    const hasLegacy = await columnExists(pool, "feedback", "teacher_comment");
    if (!hasLegacy) {
      console.log("\nNo legacy columns present — schema already on the ticketing model. Done.");
      return;
    }

    // 2. Backfill timelines + watchers.
    const rows = (await pool.query(`select * from feedback`)).rows;
    console.log(`\nBackfilling ${rows.length} feedback row(s) into the timeline...`);
    let migrated = 0;
    for (const f of rows) {
      if (await migrateRow(pool, f)) migrated++;
    }
    console.log(`  synthesized timelines for ${migrated} ticket(s) (${rows.length - migrated} already had one).`);

    // 3. Remap statuses + swap the CHECK constraint.
    console.log("\nSwapping status constraint (assigned/responded/reopened -> open)...");
    await swapStatusConstraint(pool);

    // 4. Drop legacy columns + the superseded audit table.
    console.log("Dropping legacy columns + feedback_audit...");
    for (const col of ["teacher_comment", "responded_by", "responded_at", "review_note"]) {
      await pool.query(`alter table feedback drop column if exists ${col}`);
    }
    if (await tableExists(pool, "feedback_audit")) {
      await pool.query(`drop table if exists feedback_audit`);
    }

    console.log("\n✓ Migration complete.\n");
  } catch (err) {
    console.error(`\n✗ Migration failed: ${err.message}\n`);
    throw err;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(() => process.exit(1));
}

module.exports = { main };
