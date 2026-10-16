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

### Known pre-existing gap (NOT mine): `communication` coverage test is red — the in-app
`notification-handler.*` endpoints (markRead/markAllRead/registerDevice/unregisterDevice + the
service-posted notify) are in `communication-endpoints.yml` but absent from `COMMUNICATION_ACTIONS`.
Fix when we do the communication module (they're employee/student self-service + a service-token
POST). On `main` today → `authz-coverage` fails for communication regardless of leave.

Unguarded modules (any logged-in employee has full access today) — do first:

- [x] leave — 10 actions `leave.{calendar.view, application.(apply|view|approve), config.(view|manage), attendance.(view|manage), deduction.(view|manage)}`; teacher/admin hold calendar.view+application.apply, rest god-first. Backend guarded (all 37 endpoints) + `CATALOGS['leave']` + coverage test + frontend Permissions.jsx + Config menu + guard end-to-end test. tsc ✓, authz tests ✓, both builds ✓, 9/9 leave integration ✓. committed 4bd211b/9aaa991, PROD 2026-10-16.
- [x] medical — 6 actions `medical.{inventory,purchase,issue}.{view,manage}`; admin+medical-incharge keep `medical.*`, **teacher gets inventory.view + issue.view**, god via `*`. All 27 endpoints guarded + `CATALOGS['medical']` + coverage + guard test; frontend Permissions menu + teacher-safe ItemList/IssueList (write controls hidden). committed + PROD 2026-10-16 (core-api eef78a8 auth+leave+medical deployed; admin-portal 59413b1 pushed→Amplify). (medical-issue.test.ts 9 failures are PRE-EXISTING — fail identically with guards stashed.)
- [x] lab — 10 actions `lab.{setup,inventory,purchase,issue,breakage}.{view,manage}`; admin+lab-incharge keep `lab.*`, **teacher gets inventory.view + issue.view** (lookups ride inventory.view), god via `*`. All 43 endpoints guarded + `CATALOGS['lab']` + coverage + guard test; frontend Permissions menu + teacher-safe LabItemList/LabIssueList. tsc ✓, authz+parity ✓, builds ✓, 82/82 lab integration ✓. committed + PROD 2026-10-16.
- [x] sports — 10 actions `sports.{setup,inventory,purchase,issue,breakage}.{view,manage}`; admin+sports-incharge keep `sports.*`, teacher narrowed from broad sports.view to inventory.view+issue.view, god via `*`. 40 endpoints guarded + CATALOGS + coverage + guard test; frontend Permissions menu (Overview→Permissions→rest) + existing page canManage repointed to granular. tsc/authz/parity ✓, 73/73 sports ✓. committed + PROD 2026-10-16.
- [ ] asset
- [ ] library
- [ ] supplies
- [ ] uniform
- [ ] shop
- [ ] fine
- [ ] hiring
- [ ] assembly  (also wire `assembly.config.manage` for AssemblySettings)
- [ ] homework
- [ ] academic-calendar
- [ ] programmes  (also wire `programmes.config.manage` for SelcSettings)
- [ ] class / academic-year (tiny read-only lookups — low priority)

Then backfill grids/menus for already-guarded modules missing a Permissions screen:
transfer, employee, communication, assistant, student, transport, timetable, feedback, syllabus.
