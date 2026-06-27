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
| `admin` | Administrator. Manages employees and day-to-day records.           |
| _other_ | Any other role / standard user. Read/view access only (no management controls). |

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

## Everything else

All other modules (inventory items, issues, breakages, fines, uniform, shop, assets,
dashboards) currently have **no role gating** — any authenticated user can use them.
