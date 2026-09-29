# USS LITS Coverage Policy

This is the scheduling policy the LITS auto-scheduler implements, and the
policy the manager dashboard's manual overrides should follow too. Captured
here so it isn't lost in chat/meeting history. Anything marked **(assumed)**
is not explicitly stated in the team's draft doc or meeting notes â€” it's a
placeholder until confirmed; see "Open questions" at the bottom.

## Office hours & general rules

- **Monday-Friday, 8:00 AM - 5:00 PM.**
- **Minimum shift: 4 hours, no exceptions.** If the only coverage available
  for a gap would be under 4 hours, the gap is left uncovered and reported
  rather than assigning a shorter shift.
- **Maximum 19 hours per student per week by default** â€” hard cap, enforced
  across the whole week, not per day. Overridable per student via the **Max
  Hours** column on Student Master (same mechanism as PMO's tool). Blank/0/
  non-numeric falls back to 19.
- **Students may never be scheduled during their class times**, whether or
  not they've actually submitted a class schedule (no rows = treated as free
  all day). **Every class block gets a 30-minute buffer on both sides**
  (bigger than PMO's 15-minute buffer), clamped to office hours.
- **Split shifts are explicitly allowed** â€” unlike PMO, a student can work
  more than one block in the same day, including at two different desks, as
  long as the blocks don't overlap. There is intentionally **no per-day cap**
  on how many different people rotate through one desk, since fragmenting a
  day across a couple of people is an accepted, expected outcome here (it
  would be treated as a bug in PMO's tool, which disallows split shifts).
- **Mandatory unpaid 1-hour lunch (12:00-1:00 PM) on any full 8 AM-5 PM day**
  â€” the calendar shows one continuous block, but only 8 of the 9 hours count
  toward the 19-hour weekly cap and the Weekly Hours summary.
- **No weekly-hour floor.** PMO guarantees every student at least 13 hours/
  week when availability allows; LITS's draft doc never stated an equivalent,
  so v1 only covers the three desks and does not try to top anyone up toward
  19 hours **(assumed â€” see "Open questions")**.

## The three desks

There are three physical desks (`OMB`, `CSB`, `NW` â€” these are the Work
Schedule `Location` values), but only **two** role pools, per the real
Student Master's Role formula (keyed off Supervisor: Amanda Jones â†’
`OMB/CSB`, Ivan Saldivia â†’ `NW`):

| Desk | Who can staff it | Fallback pool |
|------|---|----------------|
| **NW** | `NW`-role students only. | **None.** A gap NW's own students can't close is reported, never filled by an `OMB/CSB` student. |
| **OMB** | `OMB/CSB`-role students. | The same combined pool â€” no per-student preference for OMB over CSB. |
| **CSB** | `OMB/CSB`-role students. | Same pool, filled from whatever OMB's pass didn't already claim. |

**There is no "home desk" within the `OMB/CSB` pool** â€” an earlier draft of
this doc assumed OMB and CSB each had their own home students who preferred
staying put, mirroring PMO's home-seat-first pattern. That's now superseded:
Student Master has no Primary Location column at all, so every `OMB/CSB`
student is fully interchangeable between the two desks. **NW never
participates in this flex** in either direction.

**Fill priority:** NW and OMB are tied at 1st priority; CSB is 2nd
(overflow). In practice:
1. NW is filled entirely from its own pool â€” it doesn't compete with
   `OMB/CSB` for capacity, since no student is ever in both pools.
2. OMB is filled next, from the whole `OMB/CSB` pool across the entire week.
3. CSB is filled last, from the same pool, using only whatever capacity
   OMB's pass didn't already claim.

A student's `Role` is exactly `OMB/CSB` or `NW` â€” there is no "On Campus"
role value, and no longer a three-way `OMB`/`NW`/`CSB` split either (the
original draft doc's "must be exactly On Campus" line was leftover/wrong
text, and the three-way Role split was itself an early assumption later
corrected once the real Smartsheet was built with a Supervisor-driven
formula instead).

**Headcount:** each desk is assumed to need exactly **one** person at a time
**(assumed)** â€” nothing states a simultaneous headcount above 1 for any
desk, unlike PMO's 2-seat front desk.

## Time off

An approved request covering the date the schedule is generated for excludes
that student from the generated pattern entirely for that run.

**Approval is entirely a Smartsheet workflow now** (confirmed live,
2026-09-29 â€” corrects the "dual approval paths" question this doc used to
flag). The "Time Off Approval" automation on Time Off Requests:
1. Triggers on any new row (Status starts blank/Pending).
2. Branches by **Supervisor** (looked up from Student Master by Student
   Name): `Amanda Jones` â†’ one branch, `Ivan Saldivia` â†’ the other.
3. Sends a structured **"Request an approval"** action to a shared **IT PMO
   Mailbox**, with the request's `Calendar Title` (the sheet's primary
   column, doubling as the student's display name), dates, and reason in
   the message. The response is recorded into a column named after that
   branch's supervisor (`Amanda Jones` / `Ivan Saldivia` â€” two separate
   columns, not one shared "Supervisor Approval" column as earlier assumed).
4. On Approve/Decline, emails the student (via the `Email` column) and sets
   **`Status`** â€” which is a **multi-select** column in the real sheet, not
   a plain single-value dropdown.

The manager dashboard shows Time Off Requests **read-only** â€” it used to
have its own Approve/Deny buttons that set `Status` directly via
`PATCH /api/time-off/:rowId/status`; removed 2026-09-29 once this workflow
was confirmed built and authoritative, so there's one approval path, not two.

## How the generator actually decides (`backend/src/scheduler.js`)

Pure module, no Express or Smartsheet calls, operating in minutes-since-
midnight so it can be tested without network access.

- **Availability** is computed per student/day: start from the full 8-5 day,
  subtract class blocks (each padded 30 minutes on both sides, clamped to
  office hours), subtract any already-occupied manual time. A raw class time
  landing on an odd minute is rounded *outward* to the nearest 15 minutes
  (start earlier, end later) so a class block only ever widens, keeping every
  downstream boundary on a :00/:15/:30/:45 mark.
- **Three passes, in desk-priority order, each running across the whole
  week before the next starts:**
  1. NW, from NW-role students only.
  2. OMB, from the combined `OMB/CSB` pool (whole week).
  3. CSB, from the same combined pool, using only whatever capacity OMB's
     pass didn't already use.
  Running each tier across the whole week first is what makes "CSB is
  overflow" a genuinely week-wide rule rather than a per-day one.
- **Scoring, per pick:** a candidate who can close the *entire* current gap
  outright always wins, even over someone who's worked fewer days so far.
  Short of full closure, whoever's worked fewer days this week so far wins
  the tie-break (spreads the roster across the week); raw overlap length
  breaks any remaining tie. There's no separate "preferred shift length"
  tier above the 4-hour minimum (unlike PMO) â€” the hard minimum already
  equals what PMO calls its preferred chunk size, so a second tier would be
  redundant.
- **Orphan avoidance:** a candidate is skipped for a pick only when their own
  weekly cap â€” not their real availability â€” is what would truncate the
  assignment short and leave a sub-4-hour, un-assignable sliver of the
  current gap behind. A gap caused by the candidate's own availability
  window (e.g. a class right before/after) is never grounds to skip them.
- **Weekly cap enforcement is lunch-aware:** a full 8-5 day only actually
  costs 480 minutes against the cap (thanks to the unpaid-lunch deduction),
  even though it spans 540 raw calendar minutes â€” so a candidate with
  exactly 480 minutes of budget left can still be given the whole day,
  rather than being truncated an hour early by a naive raw-minute cap.
- **Anything still uncovered after all three passes is reported** in the
  generator's `gaps[]` output, never silently dropped.
- Adjacent generated rows for the same student/day/desk are merged back into
  one continuous block afterward, so a shift built up across two passes
  doesn't show as an artificial split in the calendar.
- **A student with a `Role` that isn't exactly `OMB/CSB` or `NW`** (including
  blank â€” which happens if Supervisor is blank or unrecognized, since Role is
  formula-derived from it) is silently excluded from scheduling and surfaced
  by name in the response's `warnings[]`, instead of erroring or vanishing
  without explanation.

**How manual overrides survive regeneration:** same mechanism as PMO's tool.
`POST /api/work-schedule/generate` only ever deletes+recreates rows where
`Source` is `Generated`, for the target semester (unless a manager explicitly
opts into `overrideManual`, which wipes and rebuilds everything for that
semester from scratch). `Source: 'Manual'` rows are never touched by a normal
Generate run, and the generator treats their time as already occupied so it
won't double-book over them. Editing any row via the dashboard unconditionally
sets `Source: 'Manual'`, regardless of what it was before.

## Open questions

Flagged in code comments too (`scheduler.js`, top of file) â€” confirm these
with the LITS team before treating them as final:

1. **Simultaneous headcount per desk.** Assumed 1 for NW/OMB/CSB. If any desk
   genuinely needs more than one person at a time, the scheduler needs a
   seat-capacity concept added (PMO's S700 2nd-seat pass is the closest
   analog).
2. **No weekly-hour floor.** LITS's doc doesn't state PMO's "guarantee 13
   hrs/week when availability allows" equivalent. If LITS wants one, PMO's
   `topUpBelowFloor` pass is the template to adapt.
3. **"Submit class schedule" vs. "submit an unavailable block."** The draft
   doc lists these as two separate feature bullets; v1 treats them as the
   same mechanism (one blocked-time entry with an optional note), matching
   PMO. Flag if LITS actually wants two visually distinct student-portal
   sections.
4. **Excel export layout.** PMO splits its export into two side-by-side boxes
   (Front Desk vs. Floater/Back Office). LITS has no analogous two-way split
   among NW/OMB/CSB, so v1 builds one box covering everyone. Confirm if a
   different split (e.g. by building: NW+OMB vs. CSB) is wanted instead.
5. ~~Two approval paths for time off.~~ **RESOLVED 2026-09-29** â€” the
   dashboard's Approve/Deny buttons are removed; the Smartsheet "Time Off
   Approval" workflow (IT PMO Mailbox routing) is the sole approval path.
   See "Time off" above for the full mechanism.
6. **`Active` column's Smartsheet type.** It's formula-driven
   (`=IF(...,1,0)`) off the Tracker's "Actively Employed" column. The backend
   does a strict `row['Active'] === true` check, which only works if this is
   a genuine Checkbox-type column in Smartsheet (not Text/Number) â€” confirm
   the column type if the roster/scheduler ever silently returns nobody.
7. ~~`Role` didn't auto-fill on a freshly-synced row.~~ **RESOLVED
   2026-09-16** by the user directly in Smartsheet (likely re-converting
   `Role` to a genuine Column Formula) â€” confirmed working since.
8. **Two mechanisms both added new Student Master rows.** A
   `POST /api/students/sync` backend route and a Smartsheet Copy Row
   automation on the Tracker ("Copy new USS-LITS students to Student
   Master") were both live at the same time, risking duplicate rows for one
   new hire. **RESOLVED 2026-09-29** â€” the backend route is removed; the
   Smartsheet automation is the sole mechanism now.
