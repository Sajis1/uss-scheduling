# USS Service Desk Smartsheet Column Spec

**The 4 sheets now exist and are confirmed/corrected against their real
columns** (token received and connection verified live 2026-10-14). Two
real bugs this caught, both fixed the same session: `Course/Notes` didn't
exist (real column is `Expected Grad`, same as LITS - class-schedule
submission would have failed outright), and `Student ID` didn't exist (real
column is `Employee ID`, same LITS lesson repeated, though this one was a
harmless no-op either way). Each section below is now marked confirmed or
corrected rather than guessed. The live roster has 10 real students, but
**`Role` and `Floater` are blank for every one of them** - the generator
will exclude and warn about all 10 until someone fills those in.

Sheet IDs, in `backend/.env`:

```
STUDENT_MASTER_SHEET_ID=2060931602534276   # "USS Service Desk - Student Master"
CLASS_SCHEDULE_SHEET_ID=237938890985348    # "USS SD Unavailable Schedule"
TIME_OFF_SHEET_ID=7068925461483396         # "USS SD- Time Off Requests"
WORK_SCHEDULE_SHEET_ID=7580181188530052    # "USS SD- Work Schedule"
```

**A 5th sheet also exists: "USS Service Desk - Supervisors" (ID
4971235265171332)**, which this doc previously concluded Service Desk
wouldn't need. Not wired into `.env` or the backend yet — user's explicit
call (2026-10-14): hold off until the time-off approval discussion
resolves (see "Time Off Requests" section below and COVERAGE-POLICY.md's
"Time off" section), rather than guess whether it mirrors LITS's
per-supervisor approval routing or is just a flat contact list like PMO's.
`SMARTSHEET_API_TOKEN` is also still blank — needed before any of this is
reachable.

## Role model — read this first

`Role` must be exactly one of three values: `Remote Weekday`,
`Remote Weekend`, `On Campus` — a hard rule, no exceptions, no 4th value.

A separate `Floater` checkbox column is **universal as of 2026-10-14**
(changed from an earlier On-Campus-only, one-directional design): `true`
means this student can back up ANY other seat once their own Role's seat
is exhausted, regardless of Role. `Floater: false` stays strictly locked
to their own Role's seat(s). See COVERAGE-POLICY.md's "Roles and the
floater flag" for why this changed.

## 1. Student Master (sheet: "USS Service Desk - Student Master")

**Confirmed against the real sheet 2026-10-14** (10 real students, Role/
Floater both exist but blank for everyone right now — a roster gap, not a
code bug; the generator will exclude and warn about all of them until
these are filled in). Columns the backend actually reads:

| Column name | Type | Notes |
|---|---|---|
| Student Name | Text/Number, **formula** | Confirmed formula-driven, same pattern as LITS. Must match exactly everywhere else. |
| Employee ID | Text/Number | **Corrected 2026-10-14** — real column is `Employee ID`, not `Student ID` (same LITS lesson, repeated). Only ever fetched into an unused `studentId` field, never displayed — same harmless no-op PMO/LITS both had, fixed anyway. |
| Email | Text/Number | Confirmed plain text, not a formula — safe to write to directly, unlike LITS's Time Off `Email`. |
| Active | Checkbox | Confirmed genuine Checkbox type. `row['Active'] === true` check works correctly. |
| **Role** | Picklist | Confirmed to exist with this exact name. **Blank for all 10 real students as of 2026-10-14** — needs to be filled in before Generate will schedule anyone. |
| **Floater** | Checkbox | Confirmed to exist with this exact name. Also blank for everyone currently. |
| Max Hours | Text/Number | Per-student weekly cap override. Blank/0/non-numeric defaults to **19.75** hours. |
| Extension | Text/Number | For a future Excel-export contact block, if wanted (not yet built here). |
| Phone | Text/Number | Same. |

**Not read by the backend, but present on the real sheet** (confirmed
2026-10-14): `First Name`/`Last Name`/`IT Unit` (all formulas, same
Tracker-join pattern as LITS), `Supervisor` (formula) + `Reports To Manager
Name (RTM)` (Picklist) — directly relevant to the held-off Supervisors
sheet question below, since this pairing is exactly LITS's Supervisor
setup — plus a long list of HR fields (`Start Date`, `Position Number
Student`, `Pay Rate (Hourly)`, `Major`, etc.) that nothing in this app
needs.

## 2. Class Schedule (sheet: "USS SD Unavailable Schedule")

One row per class/unavailable block per student. **Days include Saturday
and Sunday** — Service Desk runs 7 days a week, unlike LITS/PMO. **Confirmed
against the real sheet 2026-10-14** (currently empty, 0 rows - no student
has submitted a class schedule yet).

| Column name | Type | Notes |
|---|---|---|
| Student Name | Text/Number | Must match Student Master exactly. |
| Day | Picklist | Confirmed: Monday through Sunday, all 7. |
| Start Time | Text/Number | e.g. "6:00 PM". Stored as text. |
| End Time | Text/Number | e.g. "10:00 PM". |
| Semester | Text/Number | Same `SEMESTER_TERMS` dropdown pattern as LITS/PMO. |
| Expected Grad | Text/Number | **Corrected 2026-10-14** — the real sheet has `Expected Grad`, same as LITS/PMO, not the `Course/Notes` this doc originally guessed from the feature doc's wording. Optional, e.g. "Spring 2027" or "Temp". |

## 3. Time Off Requests (sheet: "USS SD- Time Off Requests")

**Confirmed against the real sheet 2026-10-14** — and it already carries
strong evidence of where this is headed (see below).

| Column name | Type | Notes |
|---|---|---|
| Calendar Title | Text/Number, **not a formula** | **Fixed 2026-10-14** — this is exactly LITS's old bug (a plain column the backend has to set itself, or every approval email shows a blank requester name). Now written on submit from day one instead of waiting to rediscover it. |
| Student Name | Text/Number | Must match Student Master exactly. |
| Supervisor | Text/Number, **formula** | INDEX/MATCH'd off Student Name against Student Master, same pattern as LITS. Confirmed via a live probe: a student not on Student Master resolves to `#NO MATCH` here. Not written by the backend. |
| Email | **Contact List, formula** | Confirmed formula-driven — do NOT write to it directly (exactly the trap that broke LITS's submission once its Email became a formula). The backend already doesn't write this field. |
| Start Date | Date | |
| End Date | Date | |
| Reason | Text/Number | Optional. |
| Status | Text/Number, picklist-style options (Pending/Approved/Denied) | Defaults to Pending. |
| Submitted Date | Date | Set automatically by the backend on submit. |
| IT PMO Mailbox approval | Picklist (Approved/Submitted/Declined) | **Not read or written by the backend.** Strong signal of where this is headed: "IT PMO Mailbox" is the exact shared mailbox name from LITS's own Time Off Approval automation - combined with the `Supervisor` formula above and the held-off "USS Service Desk - Supervisors" sheet, this looks a lot like LITS's supervisor-branched automation is the intended design here too, just not wired up yet. Don't build dashboard Approve/Deny further on the assumption it survives - re-check COVERAGE-POLICY.md's "Time off" section once this is confirmed either way. |

## 4. Work Schedule (sheet: "USS SD- Work Schedule")

Recurring weekly pattern per semester, not dated instances — same shape as
LITS/PMO's Work Schedule sheet.

| Column name | Type | Notes |
|---|---|---|
**Confirmed against the real sheet 2026-10-14 — matches this doc exactly,**
no corrections needed. The only sheet of the 4 that needed none.

| Column name | Type | Notes |
|---|---|---|
| Student Name | Text/Number | Must match Student Master exactly. |
| Day | Picklist | Confirmed: Monday through Sunday, all 7. |
| Location | Picklist | Confirmed options match exactly: `M-Th Remote`, `Friday Remote`, `Saturday`, `Sunday`, `Acad 700`, `S817`. |
| Start Time | Text/Number | |
| End Time | Text/Number | |
| Semester | Text/Number | |
| Source | Picklist | Confirmed options: `Generated` / `Manual` — always server-set. |
| Notes | Text/Number | Optional — override reason or an auto-note (e.g. "floater backup", "15-min handoff overlap"). |
| Last Updated | Date | Server-stamped. |

## Differences from LITS/PMO's sheets, at a glance

| | LITS/PMO | Service Desk |
|---|---|---|
| Role values | 2-3 way split by desk | `Remote Weekday` / `Remote Weekend` / `On Campus` |
| Cross-training | LITS: none. PMO: `Floater` as a 4th Role value. | A `Floater` **checkbox**, not a Role value — universal across all 3 Roles as of 2026-10-14 |
| Days covered | Monday-Friday only | **All 7 days** |
| Split shifts | LITS allows them, PMO doesn't | **Not allowed** (same as PMO) |
| Weekly cap | 19h (LITS) / 20h (PMO) | **19.75h**, confirmed a hard cap |
| Location/seat count | 3 (LITS) | **6** (`M-Th Remote`, `Friday Remote`, `Saturday`, `Sunday`, `Acad 700`, `S817`) |
| Concurrent headcount per seat | Always exactly 1 | **Varies by time of day** for several seats (e.g. 1 then 2) |
