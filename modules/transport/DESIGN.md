# Transport — Design

School bus/van transport: a school-wide **stop master** (each stop tagged with a km distance that will later drive fees), a **vehicle registry** (owned or contract), **routes** that run in a single direction (morning pickup / evening drop) with an ordered list of stops and assigned staff, **student assignments** (a student rides one morning route and one evening route), and per-route **attendance** (who boarded), mirroring the class-attendance module.

> Status: **Phase 1 built** (backend). Stops, vehicles, routes + ordered stops, assignments, and attendance with absence notifications are implemented with integration tests. Fees are intentionally deferred.

## Scope boundaries

- **Fees are out of scope** for now. Stops store `km`; fee slabs/collection are a later phase.
- **Drivers/conductors are not employees.** They are free-text name + phone on the vehicle (and a per-route editable snapshot). Only accompanying teacher, helper, and route-incharge reference the `employee` module.
- **Students/employees/academic years/classes** are owned by their modules; transport stores their uuids (no FKs) and denormalizes display names where useful.
- **Delivery of notifications** is owned by the `communication` module; transport only enqueues a job.

## Confirmed decisions

- **Global stop master**, deduped by name per school (case-insensitive, soft-delete aware). The same stop is reused across many routes. Entered via a **grid/bulk upsert** (`POST /stops/bulk`) rather than one-at-a-time forms.
- **Morning and evening are separate route rows** (`direction`). "A student is on two routes" → two assignment rows, one per direction, enforced unique per student per academic year.
- **Vehicle selection prefills** driver/conductor name+phone onto the route; those are editable per route (a snapshot, not a live link).
- **Ordered, de-duplicated route stops**: a `sequence` column, resequenced 1..n on add/remove/reorder; a stop can appear at most once on a route.
- **Attendance mirrors the class-attendance module**: one session per route per date, exceptions-marking UX, finalize fills the roster (from assignments) as `boarded`, append-only audit, fire-and-forget absence notification (once, on first finalize).

## Data model

Conventions: lowercase SQL, no FKs, no DDL defaults, `varchar(12)` uuids, `school_id` on every row, `status in ('active','deleted')` soft delete, audit columns, enums as `varchar + check`. Uniqueness via partial unique indexes `where status = 'active'`. See `transport-setup.sql`.

- **transport_stop** — `name`, `km numeric(6,2)`, optional `landmark`/`latitude`/`longitude`. Unique `(school_id, lower(name))`.
- **transport_vehicle** — `vehicle_type in (bus,van,other)`, free-text `make_model`, `registration_number`, `ownership in (owned,contract)`, optional `capacity`, `driver_name/phone`, `conductor_name/phone`. Unique `(school_id, lower(registration_number))`.
- **transport_route** — `name`, `direction in (morning,evening)`, `vehicle_id`, `accompanying_teacher_id`/`helper_id`/`route_incharge_id` (employees), driver/conductor snapshot. Unique `(school_id, lower(name), direction)`.
- **transport_route_stop** — `route_id`, `stop_id`, `sequence`, optional `scheduled_time`. Unique `(route_id, stop_id)`.
- **transport_student_assignment** — `academic_year_id`, `student_id`, `route_id`, `stop_id`, `direction`, denormalized `student_name`. Unique `(school_id, academic_year_id, student_id, direction)`.
- **transport_attendance_session** — `academic_year_id`, `route_id`, `attendance_date`, `status in (open,finalized)`. Unique `(school_id, route_id, attendance_date)`.
- **transport_attendance_record** — `session_id`, `student_id`, `status in (boarded,absent,excused)`, `remark`. Unique `(session_id, student_id)`.
- **transport_attendance_audit** — append-only `source in (mark,edit,finalize)` change log.

## API

Base path `/transport`. All requests require `X-School-Code`; JSON is camelCase.

- **Lookups**: `GET /lookups` (vehicle types, ownership, directions, attendance statuses)
- **Stops**: `POST /stops/bulk` (grid upsert → `{created,updated,skipped,errors}`), `POST /stops`, `GET /stops`, `GET/PUT/DELETE /stops/{id}`
- **Vehicles**: `POST /vehicles`, `GET /vehicles`, `GET/PUT/DELETE /vehicles/{id}`
- **Routes**: `POST /routes`, `GET /routes?direction=`, `GET /routes/{id}` (route + vehicle + resolved staff names + ordered stops), `PUT/DELETE /routes/{id}`, `POST /routes/{id}/stops`, `PUT /routes/{id}/stops/order`, `DELETE /routes/{id}/stops/{stopId}`, `GET /routes/{id}/students`
- **Assignments/reports**: `POST /assignments`, `GET /assignments?routeId=&studentId=&academicYearId=&direction=`, `PUT/DELETE /assignments/{id}`, `GET /reports/student/{studentId}?academicYearId=` (morning + evening)
- **Attendance**: `GET /attendance/roster?routeId=&date=`, `POST /attendance/sessions`, `GET /attendance/sessions?routeId=&academicYearId=&from=&to=`, `GET /attendance/sessions/{id}`, `POST /attendance/sessions/{id}/marks`, `POST /attendance/sessions/{id}/finalize`, `PUT /attendance/records/{id}`

## Cross-module access

- Reads `school`, `employee`, `student`, `academic_year` by uuid for validation and name resolution (`transport-common.ts`).
- On attendance finalize, POSTs to `communication`'s `/communication/messages` with `templateKey: 'transport_absent'`, `audience.students.studentIds`, and `context {routeName, direction, date}` (`transport-util.ts`). Fire-and-forget: never fails finalize.

## Notifications dependency

Absence notifications need a `transport_absent` template approved in the communication module (keyed by key/channel/language). Until it exists the ladder finds no approved template and recipients are skipped — finalize still succeeds. Registering that template is a communication-module follow-up.

## Test plan

Integration tests (`__tests__/transport.test.ts`, run against the gateway) cover: bulk-upsert created/updated/skipped and dedup; vehicle duplicate-registration rejection; route driver/conductor prefill from vehicle; ordered stop add + duplicate rejection + reorder; staff resolution; assignment stop-in-route + one-per-direction enforcement; attendance open idempotency, mark → finalize roster fill + counts, idempotent re-finalize (no re-notify); and the per-student report. Ports: 3039/3040 local, 6039/6040 prod.

## Handover checklist

- [ ] Register/approve the `transport_absent` communication template before relying on absence alerts.
- [ ] Frontend grid for `POST /stops/bulk` (add-row + paste-from-Excel) in admin-portal.
- [ ] Deploy DB (`node modules/transport/scripts/db-setup.js --stage <stage> --action setup`).
