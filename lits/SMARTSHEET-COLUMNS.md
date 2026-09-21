# USS LITS Smartsheet Column Spec

**As-built** documentation of the real Smartsheet sheets (not a proposal —
these already exist; this doc was updated 2026-09-15 to match them after the
role model changed from an earlier three-way `OMB`/`NW`/`CSB` draft to the
two-value `OMB/CSB`/`NW` model below). **Column names must match exactly**
(case-sensitive) — the backend looks up columns by title, not by position.

Sheet IDs live in `backend/.env` (gitignored, not in this repo) under these
keys — ask whoever set up the sheets for the actual numbers if you need them
again:

```
STUDENT_MASTER_SHEET_ID=
CLASS_SCHEDULE_SHEET_ID=      # sheet is actually named "USS LITS Unavailable Schedule"
TIME_OFF_SHEET_ID=
WORK_SCHEDULE_SHEET_ID=
SUPERVISORS_SHEET_ID=
IT_TRACKER_SHEET_ID=          # the shared "IT Student Worker Tracker" sheet - see the roster sync note below
```

## Role model — read this first

Student Master's **Role** is not typed by hand — it's a formula keyed off
**Supervisor**, and only ever produces one of two values:

```
Role = IF(Supervisor = "Amanda Jones", "OMB/CSB",
        IF(Supervisor = "Ivan Saldivia", "NW", ""))
```

- **`NW`** — proprietary desk. Can only ever be scheduled at NW.
- **`OMB/CSB`** — can be scheduled at *either* OMB or CSB, with no per-student
  preference between them (no "home desk" concept at all anymore).

There is **no Primary Location column** — an earlier draft assumed Role and
Primary Location would both hold one of three literal values (`OMB`/`NW`/
`CSB`) with a per-student home desk. That's superseded. The backend
(`scheduler.js`, `routes/students.js`, `routes/workSchedule.js`) and the
manager dashboard (`manager.js`) have been updated to match this — they read
only `Role` and expect exactly `'OMB/CSB'` or `'NW'`.

**Work Schedule's `Location` column still has three values** (`OMB`, `CSB`,
`NW`) — that part didn't change. The distinction is: Role says *which pool*
a student is drawn from, Location says *which desk* a given shift is at. An
`NW`-role student's shifts are always at Location `NW`; an `OMB/CSB`-role
student's shifts can land at Location `OMB` or `CSB`, interchangeably.

## 1. Student Master (sheet: "USS LITS - Student Master")

**Not** fed by a Smartsheet Copy Row automation — that approach was tried
and explicitly rejected, since Copy Row brings the *source* sheet's columns
along with it, and Student Master must stay a clean, fixed schema (only the
columns listed below, ever). Instead, the backend runs its own sync
(`POST /api/students/sync`, see below) against the shared **"IT Student
Worker Tracker"** sheet (also used by PMO, spans OPS/TLS/PMO/USS): for every
Tracker row with `IT Unit` exactly `USS-LITS` whose Employee ID isn't
already on this sheet, it inserts a bare new row containing **only**
`Employee ID` — nothing else copied, and no existing row ever touched. Every
other column below is a Smartsheet **column formula** keyed on that
`Employee ID`, so it self-populates the instant the bare row lands.

### The sync: `POST /api/students/sync` (`backend/src/routes/students.js`)

1. Reads the Tracker (`IT_TRACKER_SHEET_ID` env var) and Student Master.
2. Filters Tracker rows to `row['IT Unit'] === 'USS-LITS'` (exact match).
3. Collects Tracker Employee IDs, and Student Master's existing Employee
   IDs, each deduped via a `Set`.
4. Inserts one new Student Master row per Tracker Employee ID that isn't
   already present, via `addRows(STUDENT_MASTER_SHEET_ID, [{ 'Employee ID':
   id }, ...])` — a single field, nothing else.
5. Returns `{ added, employeeIds }`.

Triggered manually from the manager dashboard's "Sync Roster" button
(`manager.js` → `handleSyncRoster`) — run it whenever a new worker is added
to the Tracker under `USS-LITS`, before Generate.

| Column name | Type | Notes |
|---|---|---|
| Employee ID | Text/Number | **The lookup key.** Everything else on this row is INDEX/MATCH'd against the Tracker using this value. Backend reads it as `row['Employee ID']` (`routes/students.js`, `routes/workSchedule.js`) — do not rename without updating both. |
| First Name | Text/Number, **formula** | `=IF([Employee ID]@row="","",INDEX({Tracker First Name},MATCH([Employee ID]@row,{Tracker Employee ID},0)))` |
| Last Name | Text/Number, **formula** | Same pattern, against the Tracker's Last Name column. |
| Student Name | Text/Number, **formula** | `=IF([Employee ID]@row="","",[First Name]@row+" "+[Last Name]@row)`. Primary column in the app's sense (what the backend matches against everywhere else), even though it's not Smartsheet's *primary column* here. |
| IT Unit | Text/Number, **formula** | Pulled from the Tracker for reference/audit; not read by the backend. |
| Supervisor | Text/Number, **formula** | `=IF([Employee ID]@row="","",INDEX({Tracker RTM},MATCH([Employee ID]@row,{Tracker Employee ID},0)))` — pulled from the Tracker's "Reports To Manager Name (RTM)" column, same lookup pattern as First/Last Name. **Not manually typed** (an earlier version of this doc incorrectly said it was). |
| **Role** | Text/Number, **formula** | `'OMB/CSB'` or `'NW'`, derived from Supervisor above. Confirmed via the backend sync test (2026-09-16) that Supervisor's own formula reliably auto-fills on a brand-new row, but **Role did not** for that same row even after Supervisor resolved — worth checking whether Role is genuinely registered as a Column Formula (right-click the header → "Convert to Column Formula" should be greyed out/already-applied, not offered) rather than just typed into the original rows individually. A blank/unrecognized Supervisor leaves Role blank either way, and that student is silently excluded from scheduling and listed by name in the generator's warnings. |
| Active | Checkbox, **formula** | `=IF([Employee ID]@row="","",IF(INDEX({Tracker Actively Employed},MATCH(...))="Yes",1,0))`. **Must be a real Checkbox-type column**, not Text/Number — the backend does a strict `row['Active'] === true` check, and Smartsheet only normalizes a formula's 1/0 output to boolean true/false at the API level for genuine checkbox columns. If the roster ever comes back empty, check this column's type first. |
| Max Hours | Text/Number | Manually set. Blank/0/non-numeric defaults to **19** hours/week. |
| Extension | Text/Number | Shown in the "Ext." row of the manager dashboard's Excel export. |
| Phone | Text/Number | Shown in the per-student contact list at the bottom of the Excel export. |

Not present on this sheet (and not needed): `Position`, `Primary Location`.

## 2. Unavailable Schedule (sheet: "USS LITS Unavailable Schedule")

A plain blank grid (not copied from PMO's Class Schedule sheet, built fresh
instead — same shape, no formulas). One row per class block per student.

| Column name | Type | Notes |
|---|---|---|
| Student Name | Text/Number, primary column | Must match Student Master's (formula-generated) Student Name exactly. |
| Day | Dropdown | Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday |
| Start Time | Text/Number | e.g. "9:00 AM". Stored as text. |
| End Time | Text/Number | e.g. "10:15 AM". |
| Semester | Text/Number | e.g. "Fall 2026". Populated from the frontend's `SEMESTER_TERMS` dropdown, not free text. |
| Expected Grad | Text/Number | Optional, e.g. "Spring 2027" or "Temp". First non-blank value per student is used and auto-abbreviated in the Excel export. |

## 3. Time Off Requests (sheet: "USS LITS - Time Off Requests")

Adapted from PMO's Time Off sheet, with two columns added to route approvals
by supervisor.

| Column name | Type | Notes |
|---|---|---|
| Student Name | Text/Number | Must match Student Master exactly. |
| Start Date | Date | |
| End Date | Date | |
| Reason | Text/Number | Optional. |
| Status | Dropdown | Pending, Approved, Denied. Defaults to Pending. Set by the manager dashboard's Approve/Deny buttons (`PATCH /api/time-off/:rowId/status`). |
| Submitted Date | Date | Set automatically by the backend on submit. |
| Email | Contact List | Server-set on submit from the student's Student Master email. |
| **Supervisor** | Text/Number, **formula** | `=IF([Student Name]@row="","",INDEX({Student Master Supervisor},MATCH([Student Name]@row,{Student Master Student Name},0)))` — looked up from Student Master, not typed. |
| **Supervisor Approval** | (planned rename target for the old PMO approval column) | Feeds a Smartsheet Automation that branches on Supervisor: `Amanda Jones` → routes to the OMB/CSB approval path, `Ivan Saldivia` → routes to the NW approval path. Each branch emails the student and sets Status on Approve/Decline. **Actual approver recipient addresses are not filled in yet.** |

**Open question worth resolving before relying on this:** the manager
dashboard already has its own Approve/Deny buttons that PATCH `Status`
directly (`manager.js` → `setTimeOffStatus`). Once the Supervisor Approval
automation is live and also writes `Status`, there will be **two independent
paths that can set the same field** — worth deciding whether the dashboard
buttons stay as a manual override/fallback, or whether approval is meant to
happen exclusively through the new Smartsheet automation going forward.

## 4. Work Schedule (sheet: "USS LITS - Work Schedule")

Unchanged shape from the original spec — a recurring weekly pattern per
semester, not dated instances.

| Column name | Type | Notes |
|---|---|---|
| Student Name | Text/Number, primary column | Must match Student Master exactly. |
| Day | Dropdown | Monday-Friday only. |
| Location | Dropdown | `OMB`, `CSB`, `NW`. An `NW`-role student's rows must be `NW`; an `OMB/CSB`-role student's rows can be `OMB` or `CSB`. |
| Start Time | Text/Number | e.g. "8:00 AM" |
| End Time | Text/Number | e.g. "12:00 PM" |
| Semester | Text/Number | e.g. "Fall 2026" |
| Source | Dropdown | Generated / Manual — always server-set. |
| Notes | Text/Number | Optional — override reason or the unpaid-lunch tag. |
| Last Updated | Date | Server-stamped. |

## 5. Supervisors (sheet: "USS LITS - Supervisors")

| Column name | Type | Notes |
|---|---|---|
| Name | Text/Number, primary column | Currently: Amanda Jones, Ivan Saldivia. |
| Phone | Text/Number | |

Maintained **manually** — Smartsheet has no simple `UNIQUE()` formula to
auto-derive this list from Student Master's Supervisor column, so add/remove
a row here by hand when a supervisor joins or leaves.

## Differences from the original three-desk draft

| | Original draft | As-built |
|---|---|---|
| Role values | `OMB`, `NW`, `CSB` (three-way) | `OMB/CSB`, `NW` (two-way) |
| Primary Location | Mirrors Role, its own column | **Removed entirely** |
| Home-desk preference within OMB/CSB | Yes (home pool tried first) | **None** — fully interchangeable |
| Student ID column | `Student ID` | `Employee ID` (also the Tracker join key) |
| Time Off Requests | Student Name/Start/End/Reason/Status/Submitted/Email | + `Supervisor`, `Supervisor Approval` |
| Roster source | Manual entry | Backend-synced Employee ID (`POST /api/students/sync`, NOT a Copy Row automation) + Student Master column formulas |
