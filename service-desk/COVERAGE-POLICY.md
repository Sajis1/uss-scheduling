# USS Service Desk Coverage Policy

This is the scheduling policy the Service Desk auto-scheduler is meant to
implement, drafted from the team's "OFFICE COVERAGE & SCHEDULING RULES" doc
and its handwritten meeting annotations (2026-10-13), plus direct answers to
the two questions that doc left ambiguous. Captured here, before any code
exists, so it isn't lost — same order LITS followed (policy doc first, sign
off, then build). Anything marked **(assumed)** is not explicitly stated and
is a placeholder until confirmed; see "Open questions" at the bottom.

**Service Desk is structurally different from both PMO and LITS** — 7-day
week, evening hours to 10pm, 7 distinct seat/time-slots instead of 3 clean
desks, a floater concept, and a Monday-only bonus-capacity seat. Do not
share a scheduler engine with either sibling department; copy the closer
parts (PMO's "no split shifts" rule, LITS's "spread hours across several
shifts to hit a cap" pattern) and adapt. Lunch coverage turned out NOT to
need PMO's cross-seat backup pattern — see "Planned engine behavior" below.

## Office hours & general rules

- **Monday–Thursday: 7:30 AM–10:00 PM. Friday–Sunday: 7:30 AM–7:30 PM.**
  Only the Mon–Thu block extends to 10pm.
- **Minimum shift: 4 hours.**
- **Maximum 19.75 hours per student per week — a hard cap, same shape as
  LITS's 19-hour cap.** Try to get every student as close to 19.75 as
  possible without exceeding it; the draft doc's own wording ("fine with
  over-scheduling") read ambiguously and was asked back directly — **it is
  a cap, not a floor**, confirmed 2026-10-13.
- **Students may never be scheduled during their class times**, whether or
  not they've actually submitted one (no rows = free all day). **Every
  class block gets a 30-minute buffer on both sides**, clamped to office
  hours.
- **Split shifts are explicitly NOT allowed** — opposite of LITS, same as
  PMO's original rule. One continuous shift per student per day; nobody
  clocks out and comes back later the same day.
- **Mandatory unpaid 1-hour lunch (12:00–1:00 PM) on any full 8 AM–5 PM
  day** — the row stays one continuous block, but only 8 of the 9 hours
  count toward the 19.75-hour cap.
- **15-minute handoff overlap**, confirmed broad: applies to all four of
  M-Th Remote, Friday Remote, Saturday, and Sunday whenever a new person
  takes over an already-staffed seat from someone else (not a blanket
  "every shift starts 15 min before the last ends" rule — only when one
  worker is relieving another on the same seat).
- A student whose Role isn't exactly `Remote Weekday` / `Remote Weekend` /
  `On Campus` is excluded from scheduling and surfaced by name in the
  generator's warnings, not silently dropped.

## Roles and the floater flag

**Exactly three Role values, hard rule, no exceptions:** `Remote Weekday`,
`Remote Weekend`, `On Campus`. This part never changed.

**Floater is universal — CHANGED 2026-10-14, reversing the original
one-directional design.** A student's Role still decides their home seat(s)
(`Remote Weekday` → M-Th Remote, `Remote Weekend` → Friday Remote,
Saturday, and Sunday, `On Campus` → Acad 700, Monday overfill, and S817),
but **`Floater: true` now means they can also back up ANY other seat**,
not just "On-Campus floaters backing up Remote." `Floater: false` means
strictly locked to their own Role's seat(s), same as always. This is still
a **flag on top of Role**, not a 4th Role value — the `Floater` checkbox on
Student Master, read for every student regardless of Role (not just `On
Campus` ones anymore).

**Why this changed:** live data exposed how costly the one-directional
version was. With only 2-3 students per Remote role and each Remote seat's
total weekly operating window capped low (M-Th Remote: 16h/week ceiling
even at full occupancy; Friday Remote: a hard 4h/week ceiling, period),
Remote-role students had no path to more hours no matter how well the
scheduler performed - 3 real students were landing at 4h, 4h, and 0h/week
while already being flagged `Floater: true` on the real sheet, a flag that
was being silently ignored because of the one-directional rule. Universal
floater fixed this directly: in a live-data test, the same 3 students (kept
exactly as `Remote Weekend` + `Floater: true`, no Smartsheet edit) went to
17.5h/16.75h/18.25h, with Friday Remote still fully covered from its own
primary pool exactly as before.

An earlier, broader proposal the same day (collapse Role to just 2 values,
`Remote`/`On Campus`) was considered and explicitly declined - that part of
the model is untouched. Only the floater *direction* changed.

## Seats, in fill-priority order

| Order | Seat | Hours | Coverage | Pool |
|---|---|---|---|---|
| 1st | M-Th Remote | 6:00–10:00 PM | 1 person 6–8pm, 2 needed 8–10pm (3 fine) | `Remote Weekday` (+ floaters as backup) |
| 2nd | Friday Remote | 3:30–7:30 PM | 2 minimum, 3 fine | `Remote Weekend` (+ floaters as backup) |
| 3rd | Saturday | 10:00 AM–7:30 PM | 2 minimum, 3 fine | `Remote Weekend` (+ floaters as backup) |
| 4th | Sunday | 7:30 AM–7:30 PM | 2 people (double coverage) | `Remote Weekend` (+ floaters as backup) |
| 5th | Acad 700 ("A700") | 7:30 AM–5:00 PM | double coverage | `On Campus` (+ floaters as backup) |
| 6th | Monday morning overfill | — | bonus capacity only, capped at 2 extra — not required coverage, never counted as a gap if empty | `On Campus` |
| 7th | S817 | 7:30 AM–5:00 PM | no headcount cap | `On Campus` (+ floaters as backup) |

**Saturday and Sunday are remote work, not on-campus — CORRECTED
2026-10-27.** Earlier passes of this doc had both under `On Campus`; that
was a misunderstanding of the original notes, caught and corrected by the
user directly. Both now draw from the `Remote Weekend` pool, same as
Friday Remote (one weekend-remote group of 3 seats instead of 1). Their
own hours/headcount/fill-order didn't change, only which Role pool staffs
them - and their mandatory/opportunistic status didn't change either (see
below), since that correction was specifically about location, not
criticality.

**The `On Campus` → seat mapping above (Acad 700/overfill/S817 drawing
from one pool, differentiated only by their own internal fill order) is
this doc's best read of the notes, not something confirmed
sentence-by-sentence** — see "Open questions" below.

**Mandatory vs. opportunistic coverage, confirmed:** the two Remote seats
named in the original notes — M-Th Remote and Friday Remote — are the
"always covered, report a gap if not" seats. Saturday, Sunday, Acad 700,
Monday overfill, and S817 are all still the opportunistic bucket —
acceptable to under-cover — regardless of which pool staffs them now.
Mandatory status was keyed to those two specific named seats in the
original notes, not generically to "whichever seats are Remote," so
Saturday/Sunday's pool correction above didn't change their mandatory
status. Same shape as PMO's required-seats-vs-S701-overflow split and
LITS's NW/OMB-tied vs. CSB-overflow split.

**Holidays and Emergency override** both use the same **3-check-day
mode**: three 1-hour system checks at **10–11am, 2–3pm, 7–8pm**, replacing
normal coverage for that day.

## Time off

Same Smartsheet-approval model as PMO/LITS. One annotation is worth
watching, not yet resolved: the draft feature doc's one-click
dashboard Approve/Deny line was annotated *"I think we will do this
manually – we are discussing it."* LITS ended up in exactly this spot too
and ultimately removed its dashboard buttons in favor of a Smartsheet
automation handling approval entirely — don't be surprised if Service Desk
lands there as well; don't build dashboard Approve/Deny as a given until
that discussion resolves.

## Planned engine behavior (not built yet — this is the design, not a
description of existing code)

- **Availability** computed the same way as PMO/LITS: full office day,
  minus class blocks (padded 30 min both sides), minus approved time off,
  minus manual occupancy.
- **No split-shift exclusion needed on availability** (unlike LITS) — but
  **a one-shift-per-day exclusion is needed** (like PMO): once a student is
  assigned anything on a given day, remove them from consideration for
  every other seat that same day.
- **Fill order — REWORKED 2026-10-27, now two separate whole-week passes.**
  **Pass 1 (primary fill): day-major.** For each day of the week, every
  seat operating that day fills from its own Role pool, in seat-priority
  order, before moving to the next day - not one seat's whole week before
  the next seat starts, which was the original (and still LITS/PMO's)
  approach. Changed because the old week-major order let an earlier seat
  (Acad 700, processed Mon-Fri before S817 started) consume everyone's
  weekly budget before a later seat sharing the same pool (S817) ever got
  a turn. Day-major only actually changes anything for Acad 700/S817
  (the only two seats sharing both a pool and overlapping days) - every
  other seat's days are disjoint from the others in the same pool, so this
  is a no-op for them.
  **Pass 2 (floater backup): pool-priority-major, confirmed 2026-10-27 -
  `Remote Weekday` → `Remote Weekend` → `On Campus`, in that order.** Every
  seat in the Remote Weekday tier gets its full week of backup attempts
  before any Remote Weekend seat's backup is tried, before any On Campus
  seat's. Within each tier, still day-major (same Acad 700/S817 reasoning
  as pass 1). This pass runs **only after pass 1 is fully done across the
  whole week** - critical, because running backup day-by-day alongside
  primary fill let a floater whose own seat falls later in the week (e.g.
  Friday Remote/Saturday/Sunday, all `Remote Weekend`) get pulled into
  backing up an earlier seat (Acad 700/S817/M-Th Remote, all Mon-Thu)
  before their own seat was ever attempted, genuinely exhausting their
  weekly budget on someone else's seat first. Two real bugs found and
  fixed this way, in order: (1) Friday Remote/Saturday/Sunday showing zero
  coverage some days because their own staff were drained by earlier-week
  backup duty - fixed by separating the two passes; (2) a lower-priority
  seat on an early weekday (Acad 700, Monday) claiming floater capacity
  ahead of a higher-priority seat later in the week (M-Th Remote,
  Thursday) purely because Monday comes first on the calendar - fixed by
  making pass 2 pool-priority-major instead of day-major.
- **Same-pool seats rotate daily priority, added 2026-10-27.** Even with
  day-major fill (above), Acad 700 was still winning the shared On-Campus
  pool over S817 every single day - not because it's more important, just
  because it's listed first on the Seats Configuration sheet. User's
  direct screenshot + ask: "spread people thru out the week so there is no
  [full] coverage every day in Acad 700." Fix: `rotateSamePoolPriority` -
  seats sharing a pool (only Acad 700/S817, in practice) take turns going
  first, by day index, in both fill passes. Result: Acad 700 gets priority
  Mon/Wed/Fri, S817 gets priority Tue/Thu - verified live, both seats now
  get real coverage across the week instead of one dominating and the
  other sitting at zero every day.
- **Stay-at-the-same-seat scoring preference, added 2026-10-27.** Once a
  student's worked a seat earlier in the week, `candidateScore` now gives
  them a bonus (`seatsWorkedByStudent`, tracked in `generateWeeklySchedule`)
  toward being picked for that SAME seat again over someone who hasn't -
  ranked below the closure-fully bonus but above the existing
  fewer-days-worked fairness tie-break. **Known, accepted limit:**
  confirmed directly with the user - this can't fully prevent someone from
  touching 2 different seats in the same week when the same small pool
  (5 On-Campus students) has to cover 2 seats that each need real coverage
  on different priority days; the bonus only rewards *returning* to a seat
  already worked, it can't retroactively prevent a first-ever assignment
  from landing on whichever seat has priority that day. Asked the user to
  pick which matters more when they conflict (spread vs. consistency) -
  **explicit answer: keep spreading the week**, accept that the same
  students may touch both Acad 700 and S817 across a week rather than
  revert to one seat dominating. An alternative not built (split the pool
  into two fixed groups, one per seat, up front) was offered and declined
  in favor of the simpler day-rotation approach already in place.
- **Floater backup — universal, changed 2026-10-14**: for EVERY seat, if
  it still has an uncovered gap after its own Role pool is exhausted
  (pass 1 above), pull from the full Floater pool next (any Role, not just
  On-Campus-into-Remote, in the priority order above), before giving up
  and reporting a gap. Non-floaters are never considered outside their own
  Role's seat(s).
- **Shift length: 4 hours minimum, 8 hours maximum per single shift.**
  An earlier version of this engine borrowed LITS's
  `resolveTargetShiftMinutes` approach (precompute an even per-student
  shift length, e.g. 4.75h for a 19.75h cap, and cap every pick to it) to
  avoid LITS's original problem of greedily grabbing full 8-5 days and
  stalling short of the cap. That turned out to be the wrong fix for
  Service Desk: it was quietly truncating shifts to ~4.75h even when a
  student had a wide-open day and budget to spare. Removed entirely
  2026-10-21 per direct correction: *"it doesn't have to be strict 4 hrs
  they can work long shift too if available its just they can only work
  min 4 hrs."* That briefly made the weekly budget the only ceiling
  (shifts ran up to 12h). **Then an explicit 8-hour-per-shift cap was added
  2026-10-27** (a normal full-workday policy, not a repeat of the old
  target-length bug) - `MAX_SHIFT_MINUTES` in `scheduler.js`. Current
  state: `pickBudget = Math.min(remainingBudget, MAX_SHIFT_MINUTES)`, with
  the 4-hour minimum still enforced as a separate floor. Verified live:
  shift lengths now range exactly 4.00h-8.00h.
- **Lunch-backup pattern — RESOLVED 2026-10-13**: confirmed answer was
  "there is always 2 or 3 ppl at a time so they cover each other when one
  go for lunch." That rules out the PMO-style cross-seat pairing (one named
  seat backing up another seat's lunch) — it's in-seat mutual coverage
  instead, and it already falls out of the demand-curve fill for any seat
  whose baseline need is 2+ through the lunch window. Verified: Saturday,
  Sunday, and Acad 700 (all baseline need 2) land 2 concurrent people at
  12:30pm in every test run. S817 (the one seat with baseline need 1, "no
  caps" but not guaranteed extra people) can land solo through lunch — not
  a gap, just its existing opportunistic/fine-to-under-cover status
  showing up again. No scheduler changes needed beyond what already exists.
- **Monday overfill is bonus capacity, not coverage** — same spirit as
  PMO's S700 2nd-seat pass: fill it last, purely to help someone under
  their cap catch up, capped at 2 extra people, never appears in `gaps[]`.
- **Regenerate is incremental by default, added 2026-10-27.** Confirmed
  with the user directly: *"if someone joined mid sem i dont want others
  to suffer."* Proven as a real bug first — adding 1 new hire to the
  existing 10-student roster reshuffled 3 of the other 10 students' already
  -generated shifts, with nothing about their own situation having changed.
  Fix: a semester's existing `Source: Generated` rows are now validated
  (`filterValidExistingRows`) against the CURRENT roster/class-schedule/
  time-off/seats on every Generate run. Still-valid rows are frozen -
  passed into the scheduler the same way Manual rows already are (already-
  occupied time it plans around, never re-picked), and are neither deleted
  nor re-added, since they're already correct in Smartsheet. Only rows that
  are genuinely invalid (student left, new conflicting time off/class, seat
  retired) get dropped and re-filled, and only genuinely new need (a new
  student, a freed-up gap) produces new rows. Verified live: re-running
  Generate twice with nothing changed is now a true no-op (0 added, 0
  removed, all existing rows kept); adding a simulated 11th student only
  ever produced new rows for that student, zero changes to the other 10.
  **Escape hatch:** `fullRegenerate: true` (a separate dashboard checkbox
  from "override manual edits") skips the freeze step entirely and rebuilds
  every Generated row from scratch, for when a manager wants a clean
  rebuild instead of an incremental update.

## Open questions

Flag these before or during the build, don't silently guess:

1. **Exact Role-to-seat mapping — PARTIALLY CORRECTED 2026-10-27.** Saturday
   and Sunday were moved from `On Campus` to `Remote Weekend`, fixing a
   confirmed misunderstanding. The remaining `On Campus` grouping (Acad
   700/Monday-overfill/S817 as one pool, differentiated by fill order) is
   still this doc's best read, not confirmed sentence-by-sentence — if
   that part's wrong too, only those 3 seats' fill sequence needs rework
   now, not all 5.
2. ~~Which specific seat(s) does the floater subset's Remote-backup apply
   to~~ — **SUPERSEDED 2026-10-14**: floater backup is no longer scoped to
   "On-Campus into Remote" at all - it's universal across every seat. See
   "Roles and the floater flag" above.
3. ~~Which seat backs up which seat's lunch~~ — **RESOLVED 2026-10-13**:
   no cross-seat pairing exists here; it's in-seat mutual coverage among
   the 2-3 people already scheduled concurrently. See "Planned engine
   behavior" above.
4. **"Regenerate button for select personnel only"** — left as just "?" in
   the notes, not confirmed. Low priority, skip for v1 unless asked.
5. **One-click dashboard Approve/Deny** — annotated as "under discussion,"
   may end up removed in favor of a pure-Smartsheet workflow (see "Time
   off" above). Don't build it as a given.
6. **A faint margin note near Saturday (possibly "Supervisor?")** appears
   in the scan — illegible, not acted on. Flag if it turns out to matter.
7. **Exact roster / headcount per seat** — not needed to start (per the
   doc's own framing: "exact headcount lives in Student Master, not here"),
   but will be needed before Student Master can be built for real.
