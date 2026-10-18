# Permissions & Config rollout — tracking catalog

Goal: every module exposes an **Overview → Permissions → Config** menu, with Permissions
(god-only RBAC grid) and Config (settings, gated by `<module>.config.manage`) enforced on the
backend. A top-right header **toggle** (default OFF, desktop/tablet only, never PWA) reveals the
Permissions/Config menu items; it only appears for users who have at least one such screen
(god, or anyone holding a `*.config.manage` grant). See plan:
`~/.claude/plans/luminous-riding-wolf.md`.

Legend: ✅ done · 🟡 partial · ⬜ not started

## Permissions grid (backend `CATALOGS` + frontend `Permissions.jsx` + menu link)

| Module | `CATALOGS` | `Permissions.jsx` | Menu link |
|---|---|---|---|
| examination | ✅ | `examination/Permissions.jsx` | `/exam/permissions` |
| attendance | ✅ | `attendance/AttendancePermissions.jsx` | `/attendance/permissions` |
| club | ✅ | `club/Permissions.jsx` | `/club/permissions` |
| fees | ✅ | `fees/Permissions.jsx` | `/fees/permissions` |

## Config / Settings screen (backend `getConfig→*.view` / `updateConfig→*.config.manage` + frontend)

| Module | Screen | Backend guard |
|---|---|---|
| attendance | `AttendanceConfig.jsx` ("Config") | ✅ `attendance.config.manage` |
| club | `ClubSettings.jsx` ("Settings") | ✅ `club.setup.manage` |
| timetable | "Grid Config" | 🟡 gated `timetable.print` |
| fees | `LateFeeSettings.jsx` | ✅ `fees.latefee.manage` |
| examination | per-exam `ConfigScreen` (not module-wide) | 🟡 dues=god-only |
| assembly | `AssemblySettings.jsx` | ⬜ **frontend only — must add `assembly.config.manage`** |
| programmes | `SelcSettings.jsx` | ⬜ **frontend only — must add `programmes.config.manage`** |

## Part A — global toggle + menu convention (one-time, admin-portal) ✅ DONE (build-verified, not deployed)

- [x] `src/context/AdminRevealContext.jsx` — localStorage `ims.adminReveal`, default false
- [x] `MainLayout.jsx` — wrap Sidebar+Header in `AdminRevealProvider`
- [x] `Sidebar.jsx` — marked admin children `admin:true` (exam/attendance/club/fees Permissions + attendance Config); `hasAdminScreens(can)` export; filter hides `admin:true` unless `reveal`
- [x] `Header.jsx` — top-right toggle (AdminPanelSettings icon), shown only when `!isMobile && hasAdminScreens(can)`

## Part B — per-module backend enforcement + grid (UNGUARDED first)

Recipe per module M (see plan): add `ACTIONS.M_*` + role grants in **both**
`core-api/shared/lib/authz-policy.ts` and `admin-portal/src/permissions/{actions,policy}.js`
(parity test); `modules/M/M-actions.ts` + `guard()` every export; add M to
`authz-coverage.test.ts`; `CATALOGS['M']` slice; frontend `Permissions.jsx` (+ `Config.jsx` where
needed); routes in `App.jsx`; menu children (Permissions first, Config second, `admin:true`).

### ~~Known pre-existing gap: `communication` coverage test red~~ — FIXED 2026-10-18. The in-app
`notification-handler.*` endpoints are now decided: the 5 `/me` self-service ones
(list/markRead/markAllRead/registerDevice/unregisterDevice — own inbox, employee or student token)
are PUBLIC; the cross-module `notification-handler.create` POST is gated `communication.message.send`
(service tokens bypass). Also renamed `communication.send` → `communication.message.send` (3-part).
Only `employee` coverage remains red (document-handler.* — fix when employee is backfilled). PROD 2026-10-18 (core-api d1639c8 local, admin-portal 718b524 pushed; communication+auth deployed, /health ok).

Unguarded modules (any logged-in employee has full access today) — do first:

- [x] leave — 10 actions `leave.{calendar.view, application.(apply|view|approve), config.(view|manage), attendance.(view|manage), deduction.(view|manage)}`; teacher/admin hold calendar.view+application.apply, rest god-first. Backend guarded (all 37 endpoints) + `CATALOGS['leave']` + coverage test + frontend Permissions.jsx + Config menu + guard end-to-end test. tsc ✓, authz tests ✓, both builds ✓, 9/9 leave integration ✓. committed 4bd211b/9aaa991, PROD 2026-10-16.
- [x] medical — 6 actions `medical.{inventory,purchase,issue}.{view,manage}`; admin+medical-incharge keep `medical.*`, **teacher gets inventory.view + issue.view**, god via `*`. All 27 endpoints guarded + `CATALOGS['medical']` + coverage + guard test; frontend Permissions menu + teacher-safe ItemList/IssueList (write controls hidden). committed + PROD 2026-10-16 (core-api eef78a8 auth+leave+medical deployed; admin-portal 59413b1 pushed→Amplify). (medical-issue.test.ts 9 failures are PRE-EXISTING — fail identically with guards stashed.)
- [x] lab — 10 actions `lab.{setup,inventory,purchase,issue,breakage}.{view,manage}`; admin+lab-incharge keep `lab.*`, **teacher gets inventory.view + issue.view** (lookups ride inventory.view), god via `*`. All 43 endpoints guarded + `CATALOGS['lab']` + coverage + guard test; frontend Permissions menu + teacher-safe LabItemList/LabIssueList. tsc ✓, authz+parity ✓, builds ✓, 82/82 lab integration ✓. committed + PROD 2026-10-16.
- [x] sports — 10 actions `sports.{setup,inventory,purchase,issue,breakage}.{view,manage}`; admin+sports-incharge keep `sports.*`, teacher narrowed from broad sports.view to inventory.view+issue.view, god via `*`. 40 endpoints guarded + CATALOGS + coverage + guard test; frontend Permissions menu (Overview→Permissions→rest) + existing page canManage repointed to granular. tsc/authz/parity ✓, 73/73 sports ✓. committed + PROD 2026-10-16.
- [~] asset — BUILT + locally committed (core-api 6d9924d, admin-portal d0b05a8), tsc/guard/parity/coverage ✓, frontend build ✓. 4 actions `asset.register.{view,manage}` + `asset.type.{view,manage}`; admin+assets-incharge wildcard; no teacher. **NOT pushed/deployed — awaiting owner's permission-catalog review** (see PERMISSIONS-PROPOSED-CATALOGS.md). All new modules now gated on owner review before deploy.
- [x] library — 8 actions (catalog/circulation/fine/config); teacher catalog.view. BUILT, tests+build ✓. PROD 2026-10-17 (library/supplies/uniform/shop + auth catalogs deployed; core-api push still blocked by prod.yml secret).
- [x] supplies — 10 actions (category/inventory/purchase/issue/wastage); teacher inventory.view+issue.view. BUILT ✓.
- [x] uniform — 8 actions (inventory/purchase/set/sale); no teacher. BUILT ✓.
- [x] shop — 8 actions (inventory/purchase/set/sale); no teacher. BUILT ✓.
- [x] fine — 4 actions `fine.{incident,collection}.{view,manage}`; admin wildcard, no teacher. BUILT; tsc/guard/parity/coverage ✓. deploy pending (push blocked by prod.yml secret).
- [x] hiring — 2 actions `hiring.candidate.{view,manage}`; admin+hiring-incharge, no teacher. PROD 2026-10-17 (core-api a66ca4d local, admin-portal 8785cf3 pushed; hiring+auth deployed).
- [x] assembly — 10 actions `assembly.{plan.view, plan.manage, week.view, week.manage, week.conduct, grading.view, grading.manage, house.view, house.manage, config.manage}`; was fully unguarded (98 endpoints). teacher = plan.view + **week.conduct** (the /me duty surface — grades + checklist, scoped in-handler by house-on-duty / assembly_evaluator data, NOT role); admin+assembly-incharge+education-director author (all view+manage); **config.manage (house/grading setConfig) god-first**. incharge narrowed from `assembly.*` to explicit leaves. PUBLIC = me/today, me/on, duties leaderboard (student token). guard() on all 98 via codemod; CATALOGS + coverage + guard test. tsc/parity/guard ✓. PROD 2026-10-18 (core-api d9eed4a local, admin-portal cfdec6d pushed; assembly+auth deployed, both /health ok).
- [x] homework — 3 actions `homework.day.{view,post,manage}`; class-teacher posts (/me), admin oversees+mapping, student app me/today PUBLIC. tsc/guard/parity/coverage ✓. PROD 2026-10-17 (core-api 697d152 local, admin-portal 747b799 pushed; homework+auth deployed, both /health ok). Also bumped admin-portal vite workbox precache cap 4→6 MiB (main bundle crossed 4.2 MB and tripped the PWA build limit).
- [x] academic-calendar — 3 actions `academic-calendar.{view,manage,config.manage}`; teacher view, admin view+manage, **config.manage (weekly-off settings) god-first** (weekly-off affects attendance school-wide; HolidaysTab weekly-off editor now gated on config.manage, holidays/import/columns stay on manage). view/manage pre-existed; only config.manage is new. 19 endpoints guarded + CATALOGS + coverage + guard test. tsc/parity/guard ✓. PROD 2026-10-17 (core-api d5b9e52 local, admin-portal b88aa5a pushed; academic-calendar+auth deployed, both /health ok).
- [x] programmes — 6 actions `programme.{unit.view, unit.manage, unit.teach, source.view, source.manage, config.manage}`; teacher+admin+incharge get view+teach+source.view. **Authoring (unit.manage + source.manage) and config.manage stay GOD-ONLY** (owner chose option B — preserves the old godpwa.* behavior; god grants admin/incharge via the grid). Replaced the old inline `programme.view` + magic `godpwa.programme.manage` with guard()+manifest on all 14 endpoints; incharge narrowed from `programme.*` to explicit read leaves. CATALOGS + coverage + guard test. tsc/parity/guard ✓. PROD 2026-10-18 (core-api c906048 local, admin-portal ed134a2 pushed; programmes+auth deployed, both /health ok).
- [ ] class / academic-year (tiny read-only lookups — SKIPPED per owner 2026-10-18)

Then backfill grids/menus for already-guarded modules missing a Permissions screen:
transfer, employee, communication, assistant, student, timetable, syllabus. — ALL DONE (below).

### Backfill batch — 6 modules renamed to 3-part + grids (2026-10-18)
- [x] employee — `employee.record.{view,manage,restore}` + `employee.session.reset` + **`documents.handbook.manage`** (staff handbook authoring, **god-only** — preserved today's MANAGER_ROLES=['god']; NOT widened to admin). document-handler authoring now guard()ed (list/get/create/update/remind/archive/acks/ackArtifact/docPdf → documents.handbook.manage); `my*` read-&-sign = PUBLIC self-service; `requireManager` relaxed to a school-resolver (guard is the gate → grid grants now real). **Closes the last authz-coverage red.** documents.sign stays a frontend-only menu-visibility grant.
- [x] student — `student.record.{view,manage}` (+ existing `student.contacts.view`).
- [x] timetable — `timetable.grid.{view,print,manage}`.
- [x] syllabus — `syllabus.plan.{view,manage}` (+ existing `syllabus.progress.mark`); guarded inline (raw strings renamed); CATALOGS grid added.
- [x] transfer — `transfer.certificate.{view,manage}`.
- [x] assistant — `assistant.voice.use`.
All: ACTIONS values + grants mirrored both repos (parity ✓), CATALOGS slices + frontend Permissions.jsx + routes + menu (Permissions-first). coverage 100/100 ✓, tsc/parity ✓. PROD 2026-10-18 (core-api 6b0ec1f local, admin-portal 84783a7 pushed; batch A employee/student/timetable/syllabus + batch B transfer/assistant/auth deployed, all /health ok — note employee/student live under PLURAL base paths /employees /students).

### Backfill — done (backend was already guarded; added grid + menu + strict-3-part rename)
- [x] feedback — **renamed 2-part → 3-part `feedback.ticket.{view,record,respond,review}`** (resource = ticket); teacher view+record+respond, director (god-first) review. Constants kept (FEEDBACK_* values moved). Added to coverage test + CATALOGS + frontend Permissions.jsx/menu (Permissions-first) + guard test. PROD 2026-10-17 (core-api b8ff9f9 local, admin-portal 5fd0ff3 pushed; feedback+transport+auth deployed, all /health ok).
- [x] transport — **renamed 2-part → 3-part `transport.setup.{view,manage}`** (setup = vehicles/stops/routes/assignments; mirrors lab.setup/sports.setup) + kept `transport.attendance.{mark,finalize}`. admin+transport-incharge(wildcard)+education-director(setup.view)+transport-attendance(attendance.mark). CATALOGS + frontend Permissions.jsx/menu + guard test. `fee.transport.manage` deliberately untouched. PROD 2026-10-17 (same deploy as feedback).
