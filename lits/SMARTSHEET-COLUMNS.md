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
```

The shared **"IT Student Worker Tracker"** sheet (also used by PMO) is not
one of this app's env vars — the backend never talks to it. New hires reach
Student Master via a Smartsheet Automation on the Tracker itself; see
Student Master below.

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

**Fed by a Smartsheet Automation on the Tracker itself** — "Copy new
USS-LITS students to Student Master": trigger is rows added/changed where
`IT Unit` changes to `USS-LITS`, condition `IT Unit` equals `USS-LITS`,
action Copy Row into this sheet. Confirmed live and active 2026-09-29.

(History: a `POST /api/students/sync` backend route was built 2026-09-16 as
a *replacement* for this automation, on the assumption Copy Row had been
rejected in favor of a clean-schema, Employee-ID-only insert. That
assumption was wrong — the automation was never actually turned off, so for
about two weeks both mechanisms were live simultaneously, each capable of
adding a new hire's row independently. Removed the backend route 2026-09-29
once this was discovered, so there's one mechanism again, not two. If
Student Master's schema ever needs to go back to "clean, fixed columns
only," the fix now is to disable this automation and reintroduce the
backend sync — not the other way around.)

Every column below except `Employee ID` is a Smartsheet **column formula**
keyed on that `Employee ID`, so it self-populates regardless of how the row
arrived.

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

Adapted from PMO's Time Off sheet, with columns added to route approvals by
supervisor. **As-built column list confirmed live 2026-09-29** — corrects
an earlier version of this doc that was missing `Calendar Title` entirely
and guessed at one shared "Supervisor Approval" column instead of the real
per-supervisor pair.

| Column name | Type | Notes |
|---|---|---|
| **Calendar Title** | Text/Number, **primary column** | Not written by the backend at all currently (`routes/timeOff.js`'s POST only sets the fields below). Used as `{{Calendar Title}}` in the approval email to display who's requesting time off — **if nothing populates this, every approval email shows a blank name.** Unconfirmed whether this is meant to be a formula mirroring Student Name, or requires a manual/automation fix. Worth checking before relying on the approval emails. |
| Student Name | Text/Number | Must match Student Master exactly. Written by the backend on submit. |
| Start Date | Date | |
| End Date | Date | |
| Reason | Text/Number | Optional. |
| **Status** | **Multi-select** dropdown | Pending / Approved / Denied. This is a multi-select column, not a plain single-value dropdown — the "Time Off Approval" automation's own "Change cell value" step explicitly checks "Replace existing values in multi-select column" when setting it. `routes/timeOff.js`'s POST writes it as a plain string (`Status: 'Pending'`) on submit, which appears to work for an initial single value; there is no longer a backend PATCH route that overwrites it later (see below). |
| Submitted Date | Date | Set automatically by the backend on submit. |
| Email | Contact List | Server-set on submit from the student's Student Master email — used by the approval automation to notify the student. |
| **Supervisor** | Text/Number, **formula** | `=IF([Student Name]@row="","",INDEX({Student Master Supervisor},MATCH([Student Name]@row,{Student Master Student Name},0)))` — looked up from Student Master, not typed. Drives which branch of the approval automation fires. |
| **Amanda Jones** | Text/Number | Not a person — a column, storing the approval-response payload from the `Amanda Jones` branch's "Request an approval" action ("Save response in" targets this column). Blank unless that branch fired. |
| **Ivan Saldivia** | Text/Number | Same idea, for the `Ivan Saldivia` branch. |

### The "Time Off Approval" automation (confirmed live, 2026-09-29)

1. **Trigger:** rows added, `Status` is any value.
2. **Branch by `Supervisor`:** `Amanda Jones` / `Ivan Saldivia`, one path each.
3. **Request an approval** → sent to a shared **"IT PMO Mailbox"**, response
   saved into that branch's own column (see table above). Message body:
   *"Hi, {{Calendar Title}} has requested time off. Start Date: {{Start
   Date}} End Date: {{End Date}} Reason: {{Reason}} Please click Open
   Request. Select Approve or Decline."*
4. **If Approved / If Declined**, each branch: **Alert someone** → sends to
   the contact in the `Email` column ("Time Off Request Approved" /
   "Declined", with dates), then **Change cell value** → sets `Status` to
   `Approved` / `Denied` (multi-select-aware, per above).

This is the **sole** approval path — the manager dashboard shows Time Off
Requests read-only (no Approve/Deny buttons; the backend's old
`PATCH /api/time-off/:rowId/status` route is removed, 2026-09-29).

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
| Time Off Requests | Student Name/Start/End/Reason/Status/Submitted/Email | + `Calendar Title`, `Supervisor`, `Amanda Jones`, `Ivan Saldivia`; `Status` is multi-select |
| Roster source | Manual entry | Copy Row automation on the shared Tracker (`IT Unit` → `USS-LITS`) + Student Master column formulas |
