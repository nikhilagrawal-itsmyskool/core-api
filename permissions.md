# UI Permissions

This document records the **role-based UI permissions** enforced in the admin portal.

## How roles work

- Roles come from the JWT issued at login (`roles[]`), resolved server-side from
  `employee_role → role.code` (e.g. `god`, `admin`).
- They are read in components via `useAuth()`:
  ```js
  const { user } = useAuth();
  const isGod = user?.roles?.includes('god');
  const isAdmin = user?.roles?.includes('god') || user?.roles?.includes('admin');
  ```
- **Convention:** `admin` capabilities are a subset that `god` also has. `god` is the
  superuser — wherever `admin` can act, `god` can too, plus god-only actions.

> ⚠️ **These checks are UI-only for now.** They hide/show controls but the backend
> endpoints do **not** yet enforce them (except `auth`'s own reset-password endpoint).
> A user calling the API directly can still perform these actions. Backend authorization
> is planned but not implemented.

## Role summary

| Role    | Description                                                        |
|---------|--------------------------------------------------------------------|
| `god`   | Superuser. Everything `admin` can do, plus restore/edit of deleted records. |
| `admin` | Administrator. Manages employees and day-to-day records across all modules. |
| `teacher` | Standard teaching staff. **View-only** on the modules they can reach (Sports, Assets, Library, Supplies), the published timetable, students and employees. No add/edit/delete. |
| `<x>-incharge` | Per-module manager (`medical-`, `lab-`, `sports-`, `assets-`, `library-`, `supplies-incharge`). Within its own module behaves **exactly like `admin`**; sees nothing else. |
| _other_ | Any other role / standard user. Read/view access only (no management controls). |

> **Roles stack.** A user can hold several roles at once (e.g. `teacher` + `lab-incharge`);
> their permissions are the **union** of all their roles. So that user gets the teacher's
> view-only modules **plus** full Lab management.

## Left-menu visibility

The left navigation only shows the modules a user is allowed to touch. Each menu item is
gated by a `<module>.view` permission (with a few per-child exceptions); within a module,
add/edit/delete controls are gated by `<module>.manage`. `<module>.*` (held by `admin`,
`god` and the module's in-charge) grants both.

| Menu | god | admin | teacher | matching in-charge |
|------|:---:|:-----:|:-------:|--------------------|
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| Medical | ✅ | ✅ | — | medical-incharge |
| Laboratory | ✅ | ✅ | — | lab-incharge |
| Fines | ✅ | ✅ | — | — |
| Uniform | ✅ | ✅ | — | — |
| Shop | ✅ | ✅ | — | — |
| Sports | ✅ | ✅ | view-only | sports-incharge |
| Assets | ✅ | ✅ | view-only | assets-incharge |
| Library | ✅ | ✅ | view-only | library-incharge |
| Supplies | ✅ | ✅ | view-only | supplies-incharge |
| Timetable | ✅ (full) | ✅ (no mutate) | Published only | — |
| Attendance | ✅ | ✅ | ✅ | — |
| Communication | ✅ | ✅ | ✅ | — |
| Students | ✅ | ✅ | view-only (All Students) | — |
| Employees | ✅ | ✅ | view-only (+ self) | — |

> The `*-incharge` roles other than `medical-incharge` are defined in the frontend policy
> only — their DB role records must be created and assigned before the gating takes effect.
> See the generated matrix in `admin-portal/permissions.md` for the full action grid.

## Employees module (`/employees`)

| Action                                  | god | admin | other |
|-----------------------------------------|:---:|:-----:|:-----:|
| View employee list & search             | ✅  | ✅    | ✅    |
| Add employee                            | ✅  | ✅    | —     |
| Edit employee                           | ✅  | ✅    | —     |
| Delete employee (soft-delete + drop login) | ✅ | ✅  | —     |
| View login credentials (username/password) | ✅ | ✅  | —     |
| Reset password                          | ✅  | ✅    | —     |
| Toggle "Show deleted"                    | ✅  | ✅    | —     |
| **Restore deleted employee**            | ✅  | —     | —     |

Notes:
- Adding an employee auto-creates a login (default password `Itsmyskool@123`,
  `mustChangePassword=true`).
- Restoring re-creates the login that was removed on delete. **god only.**

## Purchase logs (Lab / Medical / Sports `/…/purchases`)

| Action                          | god | admin | other |
|---------------------------------|:---:|:-----:|:-----:|
| View purchase log               | ✅  | ✅    | ✅    |
| Edit purchase batch             | ✅  | —     | —     |
| Delete purchase batch           | ✅  | ✅    | ✅    |
| **Restore deleted purchase**    | ✅  | —     | —     |

> Here delete is available to any authenticated user, while **edit and restore are
> god-only** — the established pattern in `LabPurchaseList`, `PurchaseList` (medical),
> and `SportPurchaseList`.

## Attendance module (`/attendance`)

| Action                                   | god | admin | other (staff) |
|------------------------------------------|:---:|:-----:|:-------------:|
| View roster / sessions / history         | ✅  | ✅    | ✅            |
| Take/mark attendance (while `open`)      | ✅  | ✅    | ✅            |
| **Finalize**                             | ✅  | ✅    | —             |
| **Edit after finalize** (record edit)    | ✅  | ✅    | —             |
| Delete / restore a session               | ✅  | —     | —             |

> Marking is the everyday teacher action (any authenticated staff). Finalizing and
> editing a finalized record are admin/god only.

## Communication module (`/communication`)

| Action                                       | god | admin | other |
|----------------------------------------------|:---:|:-----:|:-----:|
| View jobs / delivery status / templates      | ✅  | ✅    | ✅    |
| Ad-hoc send / schedule / preview / cancel    | ✅  | ✅    | —     |
| Template create / edit / activate            | ✅  | ✅    | —     |
| **Template delete / restore**                | ✅  | —     | —     |

> **System-triggered** transactional sends (e.g. attendance absence alerts) are
> authorized by the triggering action (attendance finalize = admin/god), not by a
> communication user role — they go through the internal server-to-server send path.
> Infra endpoints (`messages/process-next`, provider `webhooks/{provider}`) are not
> on the user/UI path: `process-next` is driven by the worker/EventBridge, and
> webhooks are authenticated by a provider shared-secret/signature.

## Employees module — view (`/employees`)

Beyond the `employee.manage` controls above, anyone with `employee.view` (incl. `teacher`)
can open a **read-only detail** of any employee by clicking a row (and so view their own
profile). Add/edit/delete, credentials and reset-password stay `admin`/`god` only.

## Everything else

Modules now gated by the per-module `view`/`manage` scheme above: Medical, Laboratory,
Fines, Uniform, Shop, Sports, Assets, Library, Supplies. Attendance and Communication keep
their existing action-level gating (open to all staff; finalize/send gated). Purchase-log
edit/restore remain **god-only** across all inventory modules regardless of `<module>.manage`.
