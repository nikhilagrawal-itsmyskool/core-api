// Backend copy of the authorization policy. This is a byte-for-byte port of the
// admin-portal frontend model — keep the two in sync:
//   admin-portal/src/permissions/policy.js   -> ROLE_PERMISSIONS (below)
//   admin-portal/src/permissions/actions.js  -> ACTIONS (below)
//   admin-portal/src/permissions/can.js      -> can() (below)
// A parity test (shared/lib/__tests__/authz-policy.parity.test.ts) fails if they drift.
//
// Model: role -> allowed actions (allow-list; default DENY). Actions are coarse,
// namespaced `module.area.verb` strings.
//   '*'            grants everything (god)
//   'module.*'     grants every action in a module
//   'module.verb'  grants one action
// A user's roles come from the verified JWT `roles` claim; the union of those roles'
// actions is what they may do. Roles are additive (a user can hold several).

// Canonical action catalog (mirror of actions.js ACTIONS). Handlers/manifests should
// reference these constants rather than raw strings so a typo is a compile error.
export const ACTIONS = {
  // Medical inventory (strict module.resource.action). admin + medical-incharge hold the
  // medical.* wildcard (everything); teachers get the two read leaves (see stock + issues).
  MEDICAL_INVENTORY_VIEW: 'medical.inventory.view',
  MEDICAL_INVENTORY_MANAGE: 'medical.inventory.manage',
  MEDICAL_PURCHASE_VIEW: 'medical.purchase.view',
  MEDICAL_PURCHASE_MANAGE: 'medical.purchase.manage',
  MEDICAL_ISSUE_VIEW: 'medical.issue.view',
  MEDICAL_ISSUE_MANAGE: 'medical.issue.manage',
  // Lab inventory (strict module.resource.action). admin + lab-incharge hold the lab.*
  // wildcard (everything); teachers get the two read leaves (inventory.view + issue.view).
  LAB_SETUP_VIEW: 'lab.setup.view',
  LAB_SETUP_MANAGE: 'lab.setup.manage',
  LAB_INVENTORY_VIEW: 'lab.inventory.view',
  LAB_INVENTORY_MANAGE: 'lab.inventory.manage',
  LAB_PURCHASE_VIEW: 'lab.purchase.view',
  LAB_PURCHASE_MANAGE: 'lab.purchase.manage',
  LAB_ISSUE_VIEW: 'lab.issue.view',
  LAB_ISSUE_MANAGE: 'lab.issue.manage',
  LAB_BREAKAGE_VIEW: 'lab.breakage.view',
  LAB_BREAKAGE_MANAGE: 'lab.breakage.manage',
  // Disciplinary fines (strict module.resource.action; NOT fees). admin holds the fine.*
  // wildcard; no teacher access. incident = the complaint/incident lifecycle (incident +
  // evidence + notes); collection = recording fine collection.
  FINE_INCIDENT_VIEW: 'fine.incident.view',
  FINE_INCIDENT_MANAGE: 'fine.incident.manage',
  FINE_COLLECTION_VIEW: 'fine.collection.view',
  FINE_COLLECTION_MANAGE: 'fine.collection.manage',
  // Fees — module.resource.action, NO fee.* wildcard (every role lists exactly what it holds).
  FEE_REPORT_VIEW: 'fee.report.view',           // all fee reads: dues, reports, receipts, ledger, lists
  FEE_COLLECT: 'fee.collect.collect',           // take payments / refunds / cancel receipts
  FEE_STRUCTURE_MANAGE: 'fee.structure.manage', // fee structure, heads, cycles, setup, charge-run
  FEE_CONCESSION_MANAGE: 'fee.concession.manage', // create/edit/delete concession SCHEMES (god-only default)
  FEE_CONCESSION_ASSIGN: 'fee.concession.assign', // add/remove students to a concession, mid-year change
  FEE_WAIVER_MANAGE: 'fee.waiver.manage',       // waivers incl. Collect "waive remaining" write-off (god-only)
  FEE_LATEFEE_MANAGE: 'fee.latefee.manage',     // late-fee rules & apply (god-only)
  FEE_TRANSPORT_MANAGE: 'fee.transport.manage', // transport slabs (god-only)
  FEE_STUDENT_MANAGE: 'fee.student.manage',     // withdraw student, exam-only flag
  FEE_MANAGER_VIEW: 'fee.manager.view',         // read-only Collection Desk (manager gets ONLY this + exempt)
  FEE_FINE_EXEMPT: 'fee.fine.exempt',           // exempt a late fine (manager + god only)
  FEE_RECEIPT_VERIFY: 'fee.receipt.verify',     // Scan & Verify (admin + god only)
  FEE_MIGRATION_IMPORT: 'fee.migration.import', // bulk historical import (god-only)
  FEE_WRITEOFF_MANAGE: 'fee.writeoff.manage',   // mark/lift a student's dues as bad debt (god-only)
  // Uniform store (strict module.resource.action). admin holds the uniform.* wildcard; no teacher.
  UNIFORM_INVENTORY_VIEW: 'uniform.inventory.view',
  UNIFORM_INVENTORY_MANAGE: 'uniform.inventory.manage',
  UNIFORM_PURCHASE_VIEW: 'uniform.purchase.view',
  UNIFORM_PURCHASE_MANAGE: 'uniform.purchase.manage',
  UNIFORM_SET_VIEW: 'uniform.set.view',
  UNIFORM_SET_MANAGE: 'uniform.set.manage',
  UNIFORM_SALE_VIEW: 'uniform.sale.view',
  UNIFORM_SALE_MANAGE: 'uniform.sale.manage',
  // Shop / sets store (strict module.resource.action). admin holds the shop.* wildcard; no teacher.
  SHOP_INVENTORY_VIEW: 'shop.inventory.view',
  SHOP_INVENTORY_MANAGE: 'shop.inventory.manage',
  SHOP_PURCHASE_VIEW: 'shop.purchase.view',
  SHOP_PURCHASE_MANAGE: 'shop.purchase.manage',
  SHOP_SET_VIEW: 'shop.set.view',
  SHOP_SET_MANAGE: 'shop.set.manage',
  SHOP_SALE_VIEW: 'shop.sale.view',
  SHOP_SALE_MANAGE: 'shop.sale.manage',
  // Sports equipment (strict module.resource.action). admin + sports-incharge hold the
  // sports.* wildcard; teachers get the two read leaves (inventory.view + issue.view).
  SPORTS_SETUP_VIEW: 'sports.setup.view',
  SPORTS_SETUP_MANAGE: 'sports.setup.manage',
  SPORTS_INVENTORY_VIEW: 'sports.inventory.view',
  SPORTS_INVENTORY_MANAGE: 'sports.inventory.manage',
  SPORTS_PURCHASE_VIEW: 'sports.purchase.view',
  SPORTS_PURCHASE_MANAGE: 'sports.purchase.manage',
  SPORTS_ISSUE_VIEW: 'sports.issue.view',
  SPORTS_ISSUE_MANAGE: 'sports.issue.manage',
  SPORTS_BREAKAGE_VIEW: 'sports.breakage.view',
  SPORTS_BREAKAGE_MANAGE: 'sports.breakage.manage',
  // Physical asset register (strict module.resource.action). admin + assets-incharge hold the
  // asset.* wildcard; no teacher access. register = the containment tree/items/moves/
  // responsibility; type = the per-school asset-type master.
  ASSET_REGISTER_VIEW: 'asset.register.view',
  ASSET_REGISTER_MANAGE: 'asset.register.manage',
  ASSET_TYPE_VIEW: 'asset.type.view',
  ASSET_TYPE_MANAGE: 'asset.type.manage',
  // Library catalog & circulation (strict module.resource.action). admin + library-incharge hold
  // the library.* wildcard; teachers get catalog.view (browse). catalog = works/copies/labels;
  // circulation = issue/return/renew; fine = overdue/lost fines; config = circulation policy + lookups.
  LIBRARY_CATALOG_VIEW: 'library.catalog.view',
  LIBRARY_CATALOG_MANAGE: 'library.catalog.manage',
  LIBRARY_CIRCULATION_VIEW: 'library.circulation.view',
  LIBRARY_CIRCULATION_MANAGE: 'library.circulation.manage',
  LIBRARY_FINE_VIEW: 'library.fine.view',
  LIBRARY_FINE_MANAGE: 'library.fine.manage',
  LIBRARY_CONFIG_VIEW: 'library.config.view',
  LIBRARY_CONFIG_MANAGE: 'library.config.manage',
  // School supplies / consumables (strict module.resource.action). admin + supplies-incharge
  // hold the supplies.* wildcard; teachers get inventory.view + issue.view.
  SUPPLIES_CATEGORY_VIEW: 'supplies.category.view',
  SUPPLIES_CATEGORY_MANAGE: 'supplies.category.manage',
  SUPPLIES_INVENTORY_VIEW: 'supplies.inventory.view',
  SUPPLIES_INVENTORY_MANAGE: 'supplies.inventory.manage',
  SUPPLIES_PURCHASE_VIEW: 'supplies.purchase.view',
  SUPPLIES_PURCHASE_MANAGE: 'supplies.purchase.manage',
  SUPPLIES_ISSUE_VIEW: 'supplies.issue.view',
  SUPPLIES_ISSUE_MANAGE: 'supplies.issue.manage',
  SUPPLIES_WASTAGE_VIEW: 'supplies.wastage.view',
  SUPPLIES_WASTAGE_MANAGE: 'supplies.wastage.manage',
  TIMETABLE_VIEW: 'timetable.grid.view',
  TIMETABLE_PRINT: 'timetable.grid.print',
  TIMETABLE_MANAGE: 'timetable.grid.manage',
  EMPLOYEE_VIEW: 'employee.record.view',
  EMPLOYEE_MANAGE: 'employee.record.manage',
  EMPLOYEE_RESTORE: 'employee.record.restore',
  // Force an employee to sign out and back in (bumps employee_login.session_version). God-only by
  // default — NOT under any wildcard admin holds and listed on no role, so only god ('*') has it;
  // god can grant it to admin from the Permissions grid.
  EMPLOYEE_SESSION_RESET: 'employee.session.reset',
  // Staff document handbook — authoring (create/edit/remind/archive/acks + the god-console
  // reads). god-only by default (no role grant); god grants via the grid. The /me read-&-sign
  // endpoints are self-service (PUBLIC in the manifest). documents.sign (frontend menu
  // visibility for "My Documents") stays a raw grant on admin/teacher — it gates no endpoint.
  DOCUMENTS_HANDBOOK_MANAGE: 'documents.handbook.manage',
  PURCHASE_LOG_EDIT: 'purchaseLog.edit',
  PURCHASE_LOG_RESTORE: 'purchaseLog.restore',
  STUDENT_VIEW: 'student.record.view',
  STUDENT_MANAGE: 'student.record.manage',
  STUDENT_VIEW_CONTACTS: 'student.contacts.view',
  // Attendance (module.resource.action). session.mark = take roll-call (roster/sessions/save +
  // read config); session.finalize = finalize sessions & edit records after finalize;
  // record.view = read a student's own attendance history (the 360 card — teachers + admin);
  // config.manage = the per-school Attendance Config screen (half-day policy), GOD-ONLY by
  // default (god grants admin via the Permissions grid if wanted).
  ATTENDANCE_MARK: 'attendance.session.mark',
  ATTENDANCE_FINALIZE: 'attendance.session.finalize',
  ATTENDANCE_RECORD_VIEW: 'attendance.record.view',
  ATTENDANCE_CONFIG_MANAGE: 'attendance.config.manage',
  COMMUNICATION_SEND: 'communication.message.send',
  COMMUNICATION_TEMPLATE_MANAGE: 'communication.template.manage',
  COMMUNICATION_TEMPLATE_DELETE: 'communication.template.delete',
  // config = the per-school message-routing policy (which channels each message type uses).
  // GOD-ONLY by default (not granted to any role below).
  COMMUNICATION_CONFIG_VIEW: 'communication.config.view',
  COMMUNICATION_CONFIG_MANAGE: 'communication.config.manage',
  // Recruitment/hiring (strict module.resource.action). admin + hiring-incharge; no teacher.
  // candidate = the pipeline (candidate + stages + files + lookups).
  HIRING_CANDIDATE_VIEW: 'hiring.candidate.view',
  HIRING_CANDIDATE_MANAGE: 'hiring.candidate.manage',
  TRANSPORT_VIEW: 'transport.setup.view',
  TRANSPORT_MANAGE: 'transport.setup.manage',
  TRANSPORT_ATTENDANCE_MARK: 'transport.attendance.mark',
  TRANSPORT_ATTENDANCE_FINALIZE: 'transport.attendance.finalize',
  TRANSFER_VIEW: 'transfer.certificate.view',
  TRANSFER_MANAGE: 'transfer.certificate.manage',
  SYLLABUS_VIEW: 'syllabus.plan.view',
  SYLLABUS_MANAGE: 'syllabus.plan.manage',
  SYLLABUS_PROGRESS_MARK: 'syllabus.progress.mark',
  // Morning-assembly planning — strict module.resource.action. plan = the planning content
  // (plans, nodes, specials, themes, references, lookups, resolve/live, pulse, documents);
  // week = the weekly roster workflow (admin surface); week.conduct = the teacher /me duty
  // surface (run my assigned week — scoped in-handler by house/evaluator data, NOT role);
  // grading = rubric + evaluators + grades + conduct checklist; house = house-mode + rotation;
  // config.manage = house/grading setConfig (god-first). Student-app me/today, me/on and the
  // duties leaderboard are PUBLIC (student token).
  ASSEMBLY_PLAN_VIEW: 'assembly.plan.view',
  ASSEMBLY_PLAN_MANAGE: 'assembly.plan.manage',
  ASSEMBLY_WEEK_VIEW: 'assembly.week.view',
  ASSEMBLY_WEEK_MANAGE: 'assembly.week.manage',
  ASSEMBLY_WEEK_CONDUCT: 'assembly.week.conduct',
  ASSEMBLY_GRADING_VIEW: 'assembly.grading.view',
  ASSEMBLY_GRADING_MANAGE: 'assembly.grading.manage',
  ASSEMBLY_HOUSE_VIEW: 'assembly.house.view',
  ASSEMBLY_HOUSE_MANAGE: 'assembly.house.manage',
  ASSEMBLY_CONFIG_MANAGE: 'assembly.config.manage',
  // Daily homework photos (strict module.resource.action). day.post = a class teacher posts
  // their class's photos (the /me surface, scoped by canPostForClass); day.manage = admin
  // oversight edits + the class↔teacher mapping override; day.view = admin oversight reads.
  // The student/parent app's /me/today self-authorizes (PUBLIC in the manifest).
  HOMEWORK_DAY_VIEW: 'homework.day.view',
  HOMEWORK_DAY_POST: 'homework.day.post',
  HOMEWORK_DAY_MANAGE: 'homework.day.manage',
  // Outreach "Moments" — parent-facing photo+text feed (strict module.resource.action).
  // moment.post = a class teacher posts/publishes their OWN class's moments (the /me surface,
  // scoped by canPostForClass + own-authored); moment.manage = admin compose to any audience;
  // moment.view = admin reads. The parent/student app feed self-authorizes (PUBLIC in the manifest).
  OUTREACH_MOMENT_VIEW: 'outreach.moment.view',
  OUTREACH_MOMENT_POST: 'outreach.moment.post',
  OUTREACH_MOMENT_MANAGE: 'outreach.moment.manage',
  ACADEMIC_CALENDAR_VIEW: 'academic-calendar.view',
  ACADEMIC_CALENDAR_MANAGE: 'academic-calendar.manage',
  ACADEMIC_CALENDAR_CONFIG_MANAGE: 'academic-calendar.config.manage',
  // Examination — strict `module.resource.action` convention. NOTE: no role carries an `exam.*`
  // wildcard anymore (admin/exam-incharge get explicit lists below), so every leaf is independently
  // grantable and the god-only ones are NOT swallowed by a wildcard. (EXAM_VIEW/EXAM_MANAGE keep
  // their constant NAMES so the ~90 existing guard() call-sites don't change — only the values move.)
  EXAM_VIEW: 'exam.schedule.view',
  EXAM_MANAGE: 'exam.schedule.manage',
  EXAM_PROGRESS_VIEW: 'exam.progress.view',
  EXAM_REPORTCARD_MANAGE: 'exam.reportcard.manage',
  EXAM_FORMAT_MANAGE: 'exam.format.manage',
  EXAM_REMARK_MANAGE: 'exam.remark.manage',
  EXAM_MAPPING_MANAGE: 'exam.mapping.manage',
  EXAM_MARKS_OVERRIDE: 'exam.marks.override',
  EXAM_MARKS_LOCK: 'exam.marks.lock',
  EXAM_CLASS_EXCLUDE: 'exam.class.exclude',
  EXAM_DUES_OVERRIDE: 'exam.dues.override',
  // God-only: edit the role→permission overrides from the Permissions grid. No role but god
  // (via '*') holds it, so requireAction('authz.manage') is effectively god-only.
  AUTHZ_MANAGE: 'authz.manage',
  // Developmental programmes (Spoken English & Life Communication, …) — strict
  // module.resource.action. unit = the programme definition + monthly units
  // (reader + authoring); teach = mark a unit taught (every teacher); source =
  // class-module reference docs (view = list/download, manage = upload);
  // config.manage = SelcSettings (god-first, frontend-only gate, no endpoint).
  PROGRAMME_UNIT_VIEW: 'programme.unit.view',
  PROGRAMME_UNIT_MANAGE: 'programme.unit.manage',
  PROGRAMME_UNIT_TEACH: 'programme.unit.teach',
  PROGRAMME_SOURCE_VIEW: 'programme.source.view',
  PROGRAMME_SOURCE_MANAGE: 'programme.source.manage',
  PROGRAMME_CONFIG_MANAGE: 'programme.config.manage',
  ASSISTANT_USE: 'assistant.voice.use',
  // Staff leave (strict module.resource.action). Self-service + the shared "who's on leave"
  // calendar are teacher/admin; all oversight/config/biometric/deduction writes are god-only
  // for now (god opens cells per-role via the Permissions grid — no live "director" role yet).
  LEAVE_CALENDAR_VIEW: 'leave.calendar.view', // shared who's-on-leave calendar + coverage handover
  LEAVE_APPLICATION_APPLY: 'leave.application.apply', // self-service: apply/cancel own leave + /me/*
  LEAVE_APPLICATION_VIEW: 'leave.application.view', // oversight read: one application's detail, audit, attachment, balance, summary
  LEAVE_APPLICATION_APPROVE: 'leave.application.approve', // approve / reject applications
  LEAVE_CONFIG_VIEW: 'leave.config.view', // read leave policy config + leave-type master
  LEAVE_CONFIG_MANAGE: 'leave.config.manage', // edit leave policy config + leave types
  LEAVE_ATTENDANCE_VIEW: 'leave.attendance.view', // view biometric attendance, day view, device mapping
  LEAVE_ATTENDANCE_MANAGE: 'leave.attendance.manage', // mark, import (file/TimeWatch), enroll mappings
  LEAVE_DEDUCTION_VIEW: 'leave.deduction.view', // view deduction (LOP) runs + an employee's deductions
  LEAVE_DEDUCTION_MANAGE: 'leave.deduction.manage', // run / finalize deduction batches
  // Home-visit feedback / complaints. view = read category lookup (teachers, to record);
  // record = log + assign to a teacher (teachers); respond = the assigned teacher's reply
  // (teachers, own items only); review = director dashboard + complete/reopen. `review` is
  // deliberately OUTSIDE any namespace admin inherits, so it is god-only until a real
  // `education-director` role is introduced (grant it feedback.ticket.review then).
  FEEDBACK_VIEW: 'feedback.ticket.view',
  FEEDBACK_RECORD: 'feedback.ticket.record',
  FEEDBACK_RESPOND: 'feedback.ticket.respond',
  FEEDBACK_REVIEW: 'feedback.ticket.review',
  // Director's Cockpit / School Pulse landing (director + god). Read-only heartbeat.
  COCKPIT_VIEW: 'cockpit.view',
  // Clubs & Activities (per-school display name e.g. "Saturday Activities"). A day-neutral
  // engine: a club's versioned activity bank, the weekly plan board, and quick closure. Strict
  // `module.resource.action` across THREE resources (setup | activity | plan); NO `club.*`
  // wildcard anywhere, so every leaf is independently grantable and god-only leaves aren't
  // swallowed. Locked default: everything is god-first; god opens the rest up via the grid.
  //   setup.*     = clubs, config, enabled blocks & programme settings
  //   activity.*  = the versioned bank (view / author content / release / review queue)
  //   plan.*      = the weekly board (view / build draft / publish+change+close / teacher conduct)
  CLUB_SETUP_VIEW: 'club.setup.view',
  CLUB_SETUP_MANAGE: 'club.setup.manage',
  CLUB_ACTIVITY_VIEW: 'club.activity.view',
  CLUB_ACTIVITY_MANAGE: 'club.activity.manage',
  CLUB_ACTIVITY_APPROVE: 'club.activity.approve',
  CLUB_ACTIVITY_REVIEW: 'club.activity.review',
  CLUB_PLAN_VIEW: 'club.plan.view',
  CLUB_PLAN_MANAGE: 'club.plan.manage',
  CLUB_PLAN_PUBLISH: 'club.plan.publish',
  CLUB_PLAN_CONDUCT: 'club.plan.conduct',
  // Website publisher — per-school push of curated Moments photos into the school's Contentful
  // CMS (tagged assets + a School Event entry). One curation action; granted to a dedicated
  // 'website-incharge' role (god via '*'). NOT on admin by default, so it stays out of the
  // sellable core — only a school with a website_config row + this grant ever sees it.
  WEBSITE_PUBLISH: 'website.publish',
} as const;

// Role -> allowed actions. Mirror of policy.js ROLE_PERMISSIONS (order preserved).
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  god: ['*'],
  admin: [
    'medical.*',
    'lab.*',
    'fine.*',
    // Fees (explicit, no wildcard). Admin does NOT get: concession.manage (create schemes),
    // waiver.manage, latefee.manage, transport.manage, fine.exempt, migration.import — all god-only.
    'fee.report.view',
    'fee.collect.collect',
    'fee.structure.manage',
    'fee.concession.assign',
    'fee.student.manage',
    'fee.manager.view',
    'uniform.*',
    'shop.*',
    'sports.*',
    'asset.*',
    'library.*',
    'supplies.*',
    'employee.record.view',
    'employee.record.manage',
    'timetable.grid.view',
    'timetable.grid.print',
    'student.record.view',
    'student.record.manage',
    'student.contacts.view',
    'attendance.session.mark',
    'attendance.session.finalize',
    'attendance.record.view',
    // attendance.config.manage is god-only by default (not here); god grants admin via the
    // Permissions grid if a school wants it. Mirrors the god-first convention.
    'communication.message.send',
    'communication.template.manage',
    'hiring.candidate.view',
    'hiring.candidate.manage',
    'transport.setup.view',
    'transport.setup.manage',
    'transport.attendance.mark',
    'transport.attendance.finalize',
    'transfer.certificate.view',
    'transfer.certificate.manage',
    'syllabus.plan.view',
    'syllabus.plan.manage',
    'syllabus.progress.mark',
    'programme.unit.view',
    'programme.unit.teach',
    'programme.source.view',
    // programme.unit.manage + programme.source.manage are god-only (authoring stays god-first,
    // as the old godpwa.* guard did); god grants admin/incharge via the Permissions grid.
    'assembly.plan.view',
    'assembly.plan.manage',
    'assembly.week.view',
    'assembly.week.manage',
    'assembly.week.conduct',
    'assembly.grading.view',
    'assembly.grading.manage',
    'assembly.house.view',
    'assembly.house.manage',
    // assembly.config.manage is god-only (house/grading setConfig).
    'homework.day.view',
    'homework.day.post',
    'homework.day.manage',
    'outreach.moment.view',
    'outreach.moment.post',
    'outreach.moment.manage',
    'academic-calendar.view',
    'academic-calendar.manage',
    // Examination (explicit, no wildcard): admin runs exams + report cards, views progress.
    // NOT config/scheme/remark/mapping, NOT marks-override/lock/class-exclude, NOT dues-override (god-only).
    'exam.schedule.view',
    'exam.schedule.manage',
    'exam.progress.view',
    'exam.reportcard.manage',
    'fee.receipt.verify', // Scan & Verify (admin + god only; NOT fee incharges)
    'leave.calendar.view', // See the shared who's-on-leave calendar
    'leave.application.apply', // Self-service own leave; oversight/config/biometric/deduction are god-only for now
    'documents.sign', // Read & sign own documents; authoring (documents.manage) is god-only
    // Clubs & Activities: NONE by default (locked to god). god grants admin what it needs via
    // the Permissions grid. No club.* here on purpose.
  ],
  // Standard teaching staff: view-only across the modules they can reach.
  teacher: [
    'medical.inventory.view', // See medicine stock
    'medical.issue.view', // See what has been issued
    'lab.inventory.view', // See lab stock
    'lab.issue.view', // See what lab items have been issued
    'sports.inventory.view', // See sports equipment stock
    'sports.issue.view', // See what sports items have been issued
    'library.catalog.view', // Browse the library catalog
    'supplies.inventory.view', // See supply stock
    'supplies.issue.view', // See what supplies have been issued
    'timetable.grid.view',
    'student.record.view',
    'student.contacts.view',
    'attendance.record.view', // read a student's attendance history on the 360 view
    'employee.record.view',
    'syllabus.plan.view',
    'syllabus.progress.mark',
    'programme.unit.view', // Read the Spoken English & Life Communication monthly units
    'programme.unit.teach', // Mark a unit taught while conducting the programme
    'programme.source.view', // Download the class-module reference docs
    'assembly.plan.view', // Read the assembly plan for their wing
    'assembly.week.conduct', // Run their assigned assembly week (/me duties; scoped in-handler by house/evaluator)
    'academic-calendar.view',
    'leave.calendar.view', // See the shared who's-on-leave calendar
    'leave.application.apply', // Apply for own leave
    'documents.sign',
    // Feedback/complaints: any teacher may record + assign, and respond to items
    // assigned to them. Reviewing/completing (feedback.ticket.review) is god-only.
    'feedback.ticket.view',
    'feedback.ticket.record',
    'feedback.ticket.respond',
    'club.plan.conduct', // Run own club assignment (guide) + quick closure on the PWA
  ],
  // Class teacher: additive to `teacher` — may MARK attendance and POST homework.
  'class-teacher': ['attendance.session.mark', 'homework.day.post'],
  // Moments in-charge: owns the parent-facing Moments feed end to end — compose to any
  // audience (whole school / grade / class), publish/unpublish. Admin-scoped-to-module, like
  // the other *-incharge roles. NOT class-teacher related; the PWA Moments screen is for
  // god / admin / moments-incharge only.
  'moments-incharge': ['outreach.moment.view', 'outreach.moment.post', 'outreach.moment.manage'],
  // Club in-charge: READ-ONLY by default across the three club resources (see clubs, the
  // activity bank, and the plan board). Authoring/approve/review/planning are god-first;
  // god grants this role more via the Permissions grid as each school decides.
  'club-incharge': ['club.setup.view', 'club.activity.view', 'club.plan.view'],
  // Website publisher — curates Moments photos into Contentful. Per-school (only DBPASN assigns it).
  'website-incharge': ['website.publish'],
  // Each in-charge === admin, but scoped to its own module.
  'medical-incharge': ['medical.*'],
  'lab-incharge': ['lab.*'],
  // Fees in-charge: like admin for fees, but NOT the god-only money-rule actions (concession.manage,
  // waiver.manage, latefee.manage, transport.manage, fine.exempt) and NOT receipt.verify.
  'fees-incharge': ['fee.report.view', 'fee.collect.collect', 'fee.structure.manage', 'fee.concession.assign', 'fee.student.manage', 'fee.manager.view'],
  'sports-incharge': ['sports.*'],
  'assets-incharge': ['asset.*'],
  'library-incharge': ['library.*'],
  'supplies-incharge': ['supplies.*'],
  'hiring-incharge': ['hiring.*'],
  'transport-incharge': ['transport.*'],
  'syllabus-incharge': ['syllabus.*'],
  // Explicit (not programme.*) so authoring (unit.manage/source.manage) + config.manage stay
  // god-first; god grants the write leaves to incharge via the Permissions grid.
  'programme-incharge': ['programme.unit.view', 'programme.unit.teach', 'programme.source.view'],
  // Explicit (not assembly.*) so assembly.config.manage stays god-first; incharge owns
  // planning + weekly roster + grading + houses + conduct, like admin.
  'assembly-incharge': ['assembly.plan.view', 'assembly.plan.manage', 'assembly.week.view', 'assembly.week.manage', 'assembly.week.conduct', 'assembly.grading.view', 'assembly.grading.manage', 'assembly.house.view', 'assembly.house.manage'],
  // Exam incharge === admin, but scoped to the examination module.
  // Exam office: run exams + view progress, but NOT report cards, config, mapping, or the god-only
  // overrides (enter-on-behalf, lock, class-exclude, dues-override).
  'exam-incharge': ['exam.schedule.view', 'exam.schedule.manage', 'exam.progress.view'],
  // Route-scoped teacher: reach bus-attendance screens + mark, but only on routes
  // they staff (route filtering enforced in the transport handlers); finalize stays
  // admin/god/transport-incharge only.
  'transport-attendance': ['transport.attendance.mark'],
  // Collection-desk manager: a locked, read-only fee-collection view, plus the one-tap
  // late-fine exemption (the counter escape hatch — clerks can't skip/forgive fines).
  manager: ['fee.manager.view', 'fee.fine.exempt'],
  // Education director: lands on the Cockpit / School Pulse and reviews the school's
  // heartbeat. Read-oriented oversight across the pulse domains. Additive — a person can
  // also hold `god`. Mirrors admin-portal/src/permissions/policy.js.
  'education-director': [
    'cockpit.view',
    'feedback.ticket.view',
    'feedback.ticket.review',
    'assembly.plan.view',
    'assembly.plan.manage',
    'assembly.week.view',
    'assembly.week.manage',
    'assembly.grading.view',
    'assembly.grading.manage',
    'assembly.house.view',
    'assembly.house.manage',
    'syllabus.plan.view',
    'student.record.view',
    'student.contacts.view',
    'academic-calendar.view',
    'timetable.grid.view',
    'transport.setup.view',
    'leave.calendar.view',
    'leave.application.apply',
  ],
};

// ── God's live overrides (DB) layered on the file defaults above ──────────────────────
// Loaded into a per-Lambda cache, refreshed in the background (fire-and-forget, short TTL). can()
// stays SYNC and FAIL-SAFE: an empty/stale/unavailable cache falls back to the file defaults, and
// with no overrides this is byte-for-byte the old behaviour. GLOBAL (deployment-wide, not per-school).
type Override = { role: string; action: string; effect: 'grant' | 'revoke' };
let OVERRIDES: Override[] = [];
let overridesLoadedAt = 0;
let overridesLoading = false;
const OVERRIDE_TTL_MS = 60_000;

async function loadOverridesNow(): Promise<void> {
  try {
    // lazy require — merely importing this policy file must NOT create a DB pool (authorizer safety)
    const { DB } = require('./db');
    const rows = await DB.query('select role, action, effect from authz_permission_override');
    OVERRIDES = (rows || []).map((r: any) => ({ role: r.role, action: r.action, effect: r.effect }));
  } catch { /* keep current cache → file defaults on any failure */ }
  overridesLoadedAt = Date.now();
}

function maybeRefreshOverrides(): void {
  // Skip the background DB refresh under the jest unit harness (no DB server) to avoid noise and
  // open handles; real Lambdas (NODE_ENV unset/'production') refresh normally.
  if (process.env.NODE_ENV === 'test') return;
  if (overridesLoading || Date.now() - overridesLoadedAt < OVERRIDE_TTL_MS) return;
  overridesLoading = true;
  loadOverridesNow().finally(() => { overridesLoading = false; });
}

// Force a reload now — called right after god writes a toggle so the same warm container is fresh.
export async function reloadPermissionOverrides(): Promise<void> { await loadOverridesNow(); }
export function getPermissionOverrides(): Override[] { return OVERRIDES; }

// Does the FILE default (ignoring overrides) grant this action to this single role?
export function baseGrants(role: string, action: string): boolean {
  return (ROLE_PERMISSIONS[role] || []).some(
    (p) => p === '*' || p === action || (p.endsWith('.*') && action.startsWith(p.slice(0, -1)))
  );
}
const hasOverride = (role: string, action: string, effect: 'grant' | 'revoke') =>
  OVERRIDES.some((o) => o.role === role && o.action === action && o.effect === effect);

// True if any of `roles` grants `action`. File defaults + god's grant/revoke overrides.
export function can(roles: string[] | undefined, action: string): boolean {
  maybeRefreshOverrides();
  const rs = roles || [];
  if (rs.some((r) => (ROLE_PERMISSIONS[r] || []).includes('*'))) return true;         // god — never overridable
  if (rs.some((r) => hasOverride(r, action, 'grant'))) return true;                    // explicit grant wins
  return rs.some((r) => !hasOverride(r, action, 'revoke') && baseGrants(r, action));   // default, unless revoked
}

// ── Per-employee TEMPORARY grants (DB) ────────────────────────────────────────────────
// God assigns one teacher an action for N hours (the Permissions-screen "temporary access"
// panel). Same per-Lambda 60s cache + fail-safe pattern as the overrides above, but keyed to
// the PERSON (employee_id) and time-bounded: a grant counts only while expires_at is in the
// future and it hasn't been revoked. ADDITIVE ONLY — it can let a user do something the role
// model denies, never the reverse. employee_id is globally unique, so no school scoping is
// needed in the lookup (the row still records school_id for the management UI).
type UserGrant = { employeeId: string; action: string; expiresAt: number };
let USER_GRANTS: UserGrant[] = [];
let userGrantsLoadedAt = 0;
let userGrantsLoading = false;

async function loadUserGrantsNow(): Promise<void> {
  try {
    const { DB } = require('./db');
    // Load only still-active grants; expiry is re-checked per request against the clock, so a
    // grant that lapses within the 60s cache window still stops working at its exact expiry.
    const rows = await DB.query(
      'select employee_id, action, extract(epoch from expires_at) * 1000 as expires_ms ' +
        'from authz_user_grant where revoked_at is null and expires_at > now()'
    );
    USER_GRANTS = (rows || []).map((r: any) => ({
      employeeId: r.employeeId,
      action: r.action,
      expiresAt: Number(r.expiresMs),
    }));
  } catch { /* keep current cache → no extra access on any failure */ }
  userGrantsLoadedAt = Date.now();
}

function maybeRefreshUserGrants(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (userGrantsLoading || Date.now() - userGrantsLoadedAt < OVERRIDE_TTL_MS) return;
  userGrantsLoading = true;
  loadUserGrantsNow().finally(() => { userGrantsLoading = false; });
}

// Force a reload now — called right after god creates/revokes a grant so the writing container
// is immediately fresh (other module containers catch up within the 60s TTL).
export async function reloadUserGrants(): Promise<void> { await loadUserGrantsNow(); }

// True if this employee has an active (non-expired, non-revoked) temporary grant for `action`.
// The call site (requireAction) allows when can() OR this returns true.
export function hasActiveUserGrant(employeeId: string | undefined, action: string): boolean {
  if (!employeeId) return false;
  maybeRefreshUserGrants();
  const now = Date.now();
  return USER_GRANTS.some((g) => g.employeeId === employeeId && g.action === action && g.expiresAt > now);
}

// Test-only: seed the in-memory grant cache (jest has no DB, so the background loader is skipped).
export function __setUserGrantsForTest(list: UserGrant[]): void {
  USER_GRANTS = list;
  userGrantsLoadedAt = Date.now();
}
