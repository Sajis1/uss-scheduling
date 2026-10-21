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
(`Remote Weekday` → M-Th Remote, `Remote Weekend` → Friday Remote, `On
Campus` → the 5 on-site seats), but **`Floater: true` now means they can
also back up ANY other seat**, not just "On-Campus floaters backing up
Remote." `Floater: false` means strictly locked to their own Role's
seat(s), same as always. This is still a **flag on top of Role**, not a
4th Role value — the `Floater` checkbox on Student Master, read for every
student regardless of Role (not just `On Campus` ones anymore).

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
| 1st | M-Th Remote | 6:00–10:00 PM | 1 person 6–8pm, 2 needed 8–10pm (3 fine) | `Remote Weekday` (+ On-Campus floaters as backup) |
| 2nd | Friday Remote | 3:30–7:30 PM | 2 minimum, 3 fine | `Remote Weekend` (+ On-Campus floaters as backup) |
| 3rd | Saturday | 10:00 AM–7:30 PM | 2 minimum, 3 fine | `On Campus` |
| 4th | Sunday | 7:30 AM–7:30 PM | 2 people (double coverage) | `On Campus` |
| 5th | Acad 700 ("A700") | 7:30 AM–5:00 PM | double coverage | `On Campus` |
| 6th | Monday morning overfill | — | bonus capacity only, capped at 2 extra — not required coverage, never counted as a gap if empty | `On Campus` |
| 7th | S817 | 7:30 AM–5:00 PM | no headcount cap | `On Campus` |

Saturday was revised mid-draft: the original "10PM" close and the
"filled first" position were both struck through and replaced — it's
confirmed **In Person (On Campus)**, closing at **7:30 PM**, filled 3rd.

**The `On Campus` → seat mapping above (Saturday/Sunday/Acad700/overfill/
S817 all drawing from one pool, differentiated only by their own internal
fill order) is this doc's best read of the notes, not something confirmed
sentence-by-sentence** — see "Open questions" below.

**Mandatory vs. opportunistic coverage, confirmed:** the two Remote seats
are the "always covered, report a gap if not" seats. The five On-Campus
seats are the opportunistic bucket — acceptable to under-cover. Same shape
as PMO's required-seats-vs-S701-overflow split and LITS's NW/OMB-tied vs.
CSB-overflow split.

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
- **Fill order, whole week per tier before the next tier starts** (same
  "week-wide, not per-day" principle as both siblings): M-Th Remote → 
  Friday Remote → Saturday → Sunday → Acad 700 → Monday overfill → S817.
  Within the On-Campus seats this is really one pool being drawn down
  across 5 different time-slots in sequence.
- **Floater backup — universal, changed 2026-10-14**: for EVERY seat, if
  it still has an uncovered gap after its own Role pool is exhausted, pull
  from the full Floater pool next (any Role, not just On-Campus-into-
  Remote), before giving up and reporting a gap. Non-floaters are never
  considered outside their own Role's seat(s).
- **Hit the 19.75 cap via several shorter shifts, not greedy full days** —
  directly reuse LITS's `resolveTargetShiftMinutes` approach
  (`backend/src/scheduler.js` in `lits/`): precompute a per-student target
  shift length that divides 19.75h evenly (or as evenly as a 15-minute-
  aligned length allows) instead of grabbing full 8-5 days and stalling
  short of the cap the way LITS's *first* scheduler version did before
  that fix.
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

## Open questions

Flag these before or during the build, don't silently guess:

1. **Exact Role-to-seat mapping for the 5 On-Campus seats.** This doc
   assumes Saturday/Sunday/Acad700/Monday-overfill/S817 are all one
   `On Campus` pool differentiated by fill order — never confirmed
   sentence-by-sentence. If wrong, the whole On-Campus fill sequence needs
   rework.
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
