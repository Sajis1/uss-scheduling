// Pure scheduling logic: no Express, no Smartsheet calls. Operates only on
// plain JS arrays/objects so it can be exercised without any network access.
// Callers (routes/workSchedule.js) fetch Smartsheet rows in and turn
// generatedRows back into Smartsheet field objects out.
//
// USS Service Desk variant. Forked from the LITS scheduler's shape (same
// pure-module, minutes-since-midnight design) but NOT sharing an engine -
// Service Desk is structurally too different: 7-day week, varying office
// hours by day, 7 seats instead of 3, several seats needing a DIFFERENT
// NUMBER of concurrent people depending on time of day (not just "covered
// or not"), no split shifts (unlike LITS, like PMO), and a floater concept.
// See service-desk/COVERAGE-POLICY.md for the full policy this implements,
// including the still-open questions flagged in code comments below too.
//
// ASSUMPTIONS TO CONFIRM (also flagged in COVERAGE-POLICY.md's "Open
// questions"):
//   - The 5 On-Campus seats (Saturday/Sunday/Acad 700/Monday overfill/S817)
//     are one combined role pool, differentiated only by their own fill
//     order - never confirmed sentence-by-sentence.
//   - Monday overfill's exact seat is assumed to be Acad 700's own morning
//     hours (the doc names a bonus capacity window, capped at 2 extra, but
//     not which physical seat it adds to) - IMPLEMENTED on this assumption,
//     see fillMondayOverfillBonus; confirm the real seat before trusting it.
//   - Lunch-backup (open question #3): CONFIRMED 2026-10-13 - "there is
//     always 2 or 3 ppl at a time so they cover each other when one go for
//     lunch." This is NOT a cross-seat pattern like PMO's S701-backs-up-S700
//     - it's in-seat mutual coverage, and it already falls out of the
//     demand-curve model for any seat whose baseline need is 2+ through the
//     lunch window (Saturday, Sunday, Acad 700 all qualify - verified via
//     smoke test, 2 concurrent at 12:30pm on every one of them). S817 is the
//     one seat with a baseline need of 1 ("no caps" but not guaranteed extra
//     people), so it can land solo through lunch - consistent with its
//     already-established opportunistic/fine-to-under-cover status, not a
//     gap. No additional fill logic needed.
//   - The 15-minute handoff overlap is implemented as a best-effort post-
//     process (extend the incoming person's start 15 min earlier when
//     taking over from a different outgoing worker on the same seat/day),
//     not deeply verified against a real example.

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MIN_SHIFT_MINUTES = 240; // 4 hours - hard minimum, no exception
const WEEKLY_CAP_MINUTES = Math.round(19.75 * 60); // 1185 - confirmed a hard cap 2026-10-13, not a floor
const CLASS_BUFFER_MINUTES = 30;
const LUNCH_START = 720; // 12:00 PM
const LUNCH_END = 780; // 1:00 PM
const HANDOFF_OVERLAP_MINUTES = 15;

const ROLES = { REMOTE_WEEKDAY: 'Remote Weekday', REMOTE_WEEKEND: 'Remote Weekend', ON_CAMPUS: 'On Campus' };

// Mon-Thu run to 10pm; Fri-Sun close at 7:30pm. Unlike LITS/PMO (one fixed
// office day for every weekday), Service Desk's "office hours" genuinely
// differ by day, so every availability/gap computation needs the day.
function officeHoursForDay(day) {
  const start = 450; // 7:30 AM, every day
  const end = ['Monday', 'Tuesday', 'Wednesday', 'Thursday'].includes(day) ? 1320 : 1170; // 10:00 PM vs 7:30 PM
  return { start, end };
}

// Seats, in the confirmed fill-priority order. Each seat's `segments` is a
// step-function of how many people must be concurrently present over that
// span - most seats are a flat single level, but the two Remote seats and
// Saturday are explicitly two-level in the real policy (e.g. 1 person
// 6-8pm, then 2 from 8-10pm on M-Th Remote).
const SEATS = [
  {
    location: 'M-Th Remote',
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'],
    pool: ROLES.REMOTE_WEEKDAY,
    mandatory: true,
    segments: [
      { start: 1080, end: 1200, need: 1 }, // 6:00-8:00 PM
      { start: 1200, end: 1320, need: 2 }, // 8:00-10:00 PM (3 is fine, never required)
    ],
  },
  {
    location: 'Friday Remote',
    days: ['Friday'],
    pool: ROLES.REMOTE_WEEKEND,
    mandatory: true,
    segments: [{ start: 930, end: 1170, need: 2 }], // 3:30-7:30 PM
  },
  {
    location: 'Saturday',
    days: ['Saturday'],
    pool: ROLES.ON_CAMPUS,
    mandatory: false, // opportunistic bucket - confirmed 2026-10-13
    segments: [{ start: 600, end: 1170, need: 2 }], // 10:00 AM-7:30 PM
  },
  {
    location: 'Sunday',
    days: ['Sunday'],
    pool: ROLES.ON_CAMPUS,
    mandatory: false,
    segments: [{ start: 450, end: 1170, need: 2 }], // 7:30 AM-7:30 PM
  },
  {
    location: 'Acad 700',
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    pool: ROLES.ON_CAMPUS,
    mandatory: false,
    segments: [{ start: 450, end: 1020, need: 2 }], // 7:30 AM-5:00 PM
  },
  {
    location: 'S817',
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    pool: ROLES.ON_CAMPUS,
    mandatory: false,
    // "No caps" read as: no hard ceiling on simultaneous people, not a
    // minimum above 1 - base need is 1, same opportunistic bucket as the
    // other On-Campus seats.
    segments: [{ start: 450, end: 1020, need: 1 }], // 7:30 AM-5:00 PM
  },
];

function parseTimeToMinutes(text) {
  if (!text) return null;
  const match = String(text).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  const [, hourStr, minuteStr, period] = match;
  let hour = parseInt(hourStr, 10) % 12;
  if (period.toUpperCase() === 'PM') hour += 12;
  return hour * 60 + parseInt(minuteStr, 10);
}

function formatMinutesToTime(minutes) {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = ((hour24 + 11) % 12) + 1;
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

function subtractInterval(intervals, toRemove) {
  const result = [];
  for (const iv of intervals) {
    if (toRemove.end <= iv.start || toRemove.start >= iv.end) {
      result.push(iv);
      continue;
    }
    if (toRemove.start > iv.start) result.push({ start: iv.start, end: Math.min(toRemove.start, iv.end) });
    if (toRemove.end < iv.end) result.push({ start: Math.max(toRemove.end, iv.start), end: iv.end });
  }
  return result.filter((iv) => iv.end > iv.start);
}

function subtractIntervals(intervals, toRemoveList) {
  return toRemoveList.reduce((acc, tr) => subtractInterval(acc, tr), intervals);
}

function intersect(a, b) {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

// Full workday lunch deduction, generalized from LITS's narrower "exact
// 8-17 match" check: Service Desk has several different "full day" shapes
// depending on the seat (Acad700/S817 7:30-5, Saturday 10-7:30, Sunday
// 7:30-7:30), so instead of matching one fixed office-day interval exactly,
// any assignment that fully spans the lunch window (12-1pm) gets the
// 60-minute deduction, regardless of its own start/end.
function spansLunch(interval) {
  return interval.start <= LUNCH_START && interval.end >= LUNCH_END;
}

function workedMinutesFor(interval) {
  const raw = interval.end - interval.start;
  return spansLunch(interval) ? raw - (LUNCH_END - LUNCH_START) : raw;
}

// CHANGED 2026-10-21: unlike LITS, shifts are NOT capped to an even
// "target length" per day here. 4 hours (MIN_SHIFT_MINUTES) is a strict
// floor, not a ceiling - a student with a wide-open day and budget to
// spare should get one long shift, not get artificially chopped down.
// The only real ceiling is their own remaining weekly budget (enforced via
// `pickBudget = remainingBudget` in fillSeatFromPool/fillMondayOverfillBonus
// below), not a precomputed even-division length.

function resolveMaxWeeklyMinutes(maxHours) {
  const hours = Number(maxHours);
  if (!Number.isFinite(hours) || hours <= 0) return WEEKLY_CAP_MINUTES;
  return Math.floor((hours * 60) / 15) * 15;
}

function isDateWithinRange(dateStr, startStr, endStr) {
  return dateStr >= startStr && dateStr <= endStr;
}

function computeUnavailableStudents(timeOffRows, asOfDate) {
  const unavailable = new Set();
  for (const row of timeOffRows) {
    if (row['Status'] !== 'Approved') continue;
    const start = row['Start Date'];
    const end = row['End Date'];
    if (!start || !end) continue;
    if (isDateWithinRange(asOfDate, start, end)) {
      unavailable.add(row['Student Name']);
    }
  }
  return unavailable;
}

// Computes one student's free intervals on one weekday, within that day's
// office hours, after removing class blocks and manual occupancy.
function computeAvailability({ day, classRows, manualOccupied, unavailableAllDay }) {
  const { start: officeStart, end: officeEnd } = officeHoursForDay(day);
  if (unavailableAllDay) return [];
  let intervals = [{ start: officeStart, end: officeEnd }];
  const classBlocks = classRows
    .filter((row) => row['Day'] === day)
    .map((row) => ({
      start: parseTimeToMinutes(row['Start Time']),
      end: parseTimeToMinutes(row['End Time']),
    }))
    .filter((iv) => iv.start != null && iv.end != null && iv.end > iv.start)
    .map((iv) => ({ start: Math.floor(iv.start / 15) * 15, end: Math.ceil(iv.end / 15) * 15 }))
    .map((iv) => ({
      start: Math.max(officeStart, iv.start - CLASS_BUFFER_MINUTES),
      end: Math.min(officeEnd, iv.end + CLASS_BUFFER_MINUTES),
    }));
  intervals = subtractIntervals(intervals, classBlocks);
  if (manualOccupied && manualOccupied.length) {
    intervals = subtractIntervals(intervals, manualOccupied);
  }
  return intervals;
}

// Splits a need-segment at [cutStart, cutEnd] and decrements its `need` by
// `amount` over that overlap - the multi-headcount generalization of
// LITS/PMO's plain subtractInterval (which only ever tracked "covered or
// not", i.e. implicitly need=1). A segment whose need reaches 0 is dropped;
// portions outside the cut, or with remaining need, are kept.
function decrementNeed(segments, cutStart, cutEnd, amount) {
  const result = [];
  for (const seg of segments) {
    if (cutEnd <= seg.start || cutStart >= seg.end) {
      result.push(seg);
      continue;
    }
    if (cutStart > seg.start) result.push({ start: seg.start, end: Math.min(cutStart, seg.end), need: seg.need });
    const overlapStart = Math.max(cutStart, seg.start);
    const overlapEnd = Math.min(cutEnd, seg.end);
    const remainingNeed = seg.need - amount;
    if (remainingNeed > 0) result.push({ start: overlapStart, end: overlapEnd, need: remainingNeed });
    if (cutEnd < seg.end) result.push({ start: Math.max(cutEnd, seg.start), end: seg.end, need: seg.need });
  }
  return result.filter((seg) => seg.end > seg.start && seg.need > 0);
}

// Full, gap-free coverage of the current need-segment beats everything -
// same scoring philosophy as LITS/PMO, generalized: a candidate who closes
// the ENTIRE remaining segment in one pick wins outright, even over someone
// who's worked fewer days so far. Short of that, fewer-days-worked is the
// tie-break, then raw overlap length.
function candidateScore(overlapMinutes, daysWorkedSoFar, closesSegmentFully) {
  const closureBonus = closesSegmentFully ? 100000000 : 0;
  return closureBonus - daysWorkedSoFar * 100000 + overlapMinutes;
}

function budgetCappedEnd(overlap, remainingBudget) {
  if (spansLunch(overlap) && workedMinutesFor(overlap) <= remainingBudget) {
    return overlap.end;
  }
  return Math.min(overlap.end, overlap.start + remainingBudget);
}

// Greedily fills a seat instance's remaining need-segments from a pool of
// students. Unlike LITS, there is NO split-shift allowance here - once a
// student is assigned anything on a given day (tracked via
// ctx.usedToday), they're excluded from every other seat that same day,
// enforced by the caller filtering `pool` per day, not inside this
// function (kept here only for the per-student weekly-cap/target-shift
// bookkeeping, same shape as LITS's fillSeatFromPool).
function fillSeatFromPool(seatInstance, pool, ctx, forcedReason) {
  const { day, getAvailability, consume, weeklyMinutes, daysWorkedSet, generatedRows, maxWeeklyMinutesByStudent, usedToday } = ctx;
  let progressed = true;
  while (progressed) {
    progressed = false;
    // Each remaining segment is a "this much more coverage is still
    // needed here" target - but a candidate's actual assigned interval is
    // matched against the seat's FULL day span (seatInstance.fullSpan),
    // not the target segment itself. Reason: once one person covers a
    // seat's whole span, the remaining need for a 2nd/3rd concurrent
    // person can shrink to a short sliver (e.g. M-Th Remote's 8-10pm
    // "need one more" after the 6-8pm portion is already satisfied) that's
    // individually shorter than the 4-hour minimum - even though a second
    // person could easily cover 6-10pm too (overlapping the first
    // person's shift, which is fine; multiple people present at once is
    // the whole point of a need>1 segment). Matching against the full
    // span lets that second person's real 4+ hour availability count,
    // as long as it actually overlaps the segment that still needs them.
    for (const target of [...seatInstance.segments]) {
      let best = null;
      let bestScore = -Infinity;
      for (const student of pool) {
        if (usedToday.has(student.name)) continue; // one shift per day, no split shifts
        const weeklyCap = maxWeeklyMinutesByStudent.get(student.name) ?? WEEKLY_CAP_MINUTES;
        const remainingBudget = weeklyCap - (weeklyMinutes.get(student.name) || 0);
        if (remainingBudget <= 0) continue;
        const pickBudget = remainingBudget;
        for (const iv of getAvailability(student)) {
          const spanOverlap = intersect(iv, seatInstance.fullSpan);
          if (!spanOverlap) continue;
          // Try two anchor points for where this pick's shift begins:
          // the candidate's own earliest availability (right for the
          // FIRST pick on a target), and the target's own start (right for
          // a LATER pick, once earlier time is already covered by someone
          // else - anchoring at spanOverlap.start alone would always cap
          // the shift to the earliest minutes of the day and could never
          // reach a target that starts later, even with real availability
          // and budget to spare).
          const anchorStarts = new Set([spanOverlap.start, Math.max(spanOverlap.start, target.start)]);
          for (const anchorStart of anchorStarts) {
            const windowed = { start: anchorStart, end: spanOverlap.end };
            const cappedEnd = budgetCappedEnd(windowed, pickBudget);
            if (cappedEnd <= windowed.start) continue;
            const interval = { start: windowed.start, end: cappedEnd };
            if (!intersect(interval, target)) continue; // must actually help THIS target, not just the span generally
            const overlapMinutes = interval.end - interval.start;
            if (overlapMinutes < MIN_SHIFT_MINUTES) continue; // 4-hour hard minimum, no exception
            const closesTargetFully = interval.start <= target.start && interval.end >= target.end;
            const daysWorkedSoFar = (daysWorkedSet.get(student.name) || new Set()).size;
            const score = candidateScore(overlapMinutes, daysWorkedSoFar, closesTargetFully);
            if (score > bestScore) {
              bestScore = score;
              best = { student, interval };
            }
          }
        }
      }
      if (best) {
        const reason = forcedReason || '';
        generatedRows.push({
          studentName: best.student.name,
          day,
          location: seatInstance.location,
          start: best.interval.start,
          end: best.interval.end,
          reason,
        });
        const workedMinutes = workedMinutesFor(best.interval);
        consume(best.student, best.interval);
        usedToday.add(best.student.name); // no split shifts - done for the whole day once picked
        if (!daysWorkedSet.has(best.student.name)) daysWorkedSet.set(best.student.name, new Set());
        daysWorkedSet.get(best.student.name).add(day);
        weeklyMinutes.set(best.student.name, (weeklyMinutes.get(best.student.name) || 0) + workedMinutes);
        seatInstance.segments = decrementNeed(seatInstance.segments, best.interval.start, best.interval.end, 1);
        progressed = true;
        break; // segments array changed shape, restart the scan
      }
    }
  }
}

// Monday-morning overfill: bonus capacity, capped at 2 extra people, never
// counted as required coverage or reported as a gap - purely to help
// whoever's furthest below their own weekly cap catch up on hours. Direct
// analog of PMO's S700-2nd-seat pass (`maximizeUnderutilized`): ranks
// candidates by LOWEST current weeklyMinutes first, not the usual closure/
// day-spread scoring fillSeatFromPool uses for required coverage.
//
// ASSUMPTION: the doc names a bonus window ("Monday morning overfill...cap
// at 2 extra") but never says which physical seat it adds to. Assumed here
// to be Acad 700's own morning hours (7:30am-12pm), since that's the first/
// lowest-numbered of the two standing weekday On-Campus seats - confirm
// before relying on this, see COVERAGE-POLICY.md's open questions.
const MONDAY_OVERFILL_LOCATION = 'Acad 700';
const MONDAY_OVERFILL_WINDOW = { start: 450, end: 720 }; // 7:30 AM-12:00 PM
const MONDAY_OVERFILL_CAP = 2;

function fillMondayOverfillBonus(onCampusPool, ctx) {
  const { getAvailability, consume, weeklyMinutes, daysWorkedSet, generatedRows, maxWeeklyMinutesByStudent, usedToday } = ctx;
  let picked = 0;
  while (picked < MONDAY_OVERFILL_CAP) {
    let best = null;
    let bestScore = Infinity; // lower weeklyMinutes wins - opposite direction from candidateScore
    for (const student of onCampusPool) {
      if (usedToday.has(student.name)) continue; // one shift per day, even for bonus hours
      const weeklyCap = maxWeeklyMinutesByStudent.get(student.name) ?? WEEKLY_CAP_MINUTES;
      const currentMinutes = weeklyMinutes.get(student.name) || 0;
      const remainingBudget = weeklyCap - currentMinutes;
      if (remainingBudget <= 0) continue;
      const pickBudget = remainingBudget;
      for (const iv of getAvailability(student)) {
        const overlap = intersect(iv, MONDAY_OVERFILL_WINDOW);
        if (!overlap) continue;
        const cappedEnd = budgetCappedEnd(overlap, pickBudget);
        if (cappedEnd <= overlap.start) continue;
        const interval = { start: overlap.start, end: cappedEnd };
        if (interval.end - interval.start < MIN_SHIFT_MINUTES) continue;
        if (currentMinutes < bestScore) {
          bestScore = currentMinutes;
          best = { student, interval };
        }
      }
    }
    if (!best) break;
    generatedRows.push({
      studentName: best.student.name,
      day: 'Monday',
      location: MONDAY_OVERFILL_LOCATION,
      start: best.interval.start,
      end: best.interval.end,
      reason: 'bonus: Monday morning overfill',
    });
    consume(best.student, best.interval);
    usedToday.add(best.student.name);
    if (!daysWorkedSet.has(best.student.name)) daysWorkedSet.set(best.student.name, new Set());
    daysWorkedSet.get(best.student.name).add('Monday');
    weeklyMinutes.set(best.student.name, (weeklyMinutes.get(best.student.name) || 0) + workedMinutesFor(best.interval));
    picked += 1;
  }
}

// Best-effort 15-minute handoff overlap: whenever two different students
// cover the same seat/day back-to-back (one's end === the next one's
// start), pull the incoming person's start back 15 minutes so they overlap
// the outgoing worker for a handover, clamped to the incoming person's own
// real availability (never invents time they didn't actually have free).
// This is a post-process over the day's already-finalized rows, so it never
// fights the main fill loop's own scoring/need-tracking.
function applyHandoffOverlap(dayRows, availabilityByStudent) {
  const byLocation = new Map();
  for (const row of dayRows) {
    if (!byLocation.has(row.location)) byLocation.set(row.location, []);
    byLocation.get(row.location).push(row);
  }
  for (const rows of byLocation.values()) {
    rows.sort((a, b) => a.start - b.start);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      if (cur.start !== prev.end || cur.studentName === prev.studentName) continue;
      const avail = availabilityByStudent(cur.studentName) || [];
      const canStartEarlier = avail.some((iv) => iv.start <= cur.start - HANDOFF_OVERLAP_MINUTES && iv.end >= cur.start);
      if (canStartEarlier) {
        cur.start -= HANDOFF_OVERLAP_MINUTES;
        cur.reason = [cur.reason, '15-min handoff overlap'].filter(Boolean).join('; ');
      }
    }
  }
}

function mergeAdjacentRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.day}|${row.location}|${row.studentName}|${row.reason}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const merged = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.start - b.start);
    let current = null;
    for (const row of group) {
      if (current && row.start <= current.end) {
        current.end = Math.max(current.end, row.end);
      } else {
        if (current) merged.push(current);
        current = { ...row };
      }
    }
    if (current) merged.push(current);
  }
  return merged;
}

// students: [{ name, role: 'Remote Weekday'|'Remote Weekend'|'On Campus',
//   maxHours, floater }]
//   floater is universal (changed 2026-10-14, was On-Campus-only/one-
//   directional before that): true means this student can back up ANY
//   seat, not just their own Role's, once that seat's own Role pool is
//   exhausted. false means strictly locked to their own Role's seats only,
//   regardless of Role.
//   Caller is expected to have already filtered to Active students.
function generateWeeklySchedule({ students, classRows, timeOffRows, manualRows, asOfDate }) {
  const unavailableStudents = computeUnavailableStudents(timeOffRows, asOfDate);

  const knownRoles = new Set(Object.values(ROLES));
  const generatedRows = [];
  const gaps = [];
  const warnings = [];

  const unrecognizedRoleNames = students.filter((s) => !knownRoles.has(s.role)).map((s) => s.name);
  if (unrecognizedRoleNames.length > 0) {
    warnings.push(
      `These active students have no recognized Role (must be exactly "Remote Weekday", "Remote Weekend", or "On Campus") and were skipped: ${unrecognizedRoleNames.join(', ')}.`
    );
  }

  const remoteWeekday = students.filter((s) => s.role === ROLES.REMOTE_WEEKDAY);
  const remoteWeekend = students.filter((s) => s.role === ROLES.REMOTE_WEEKEND);
  const onCampus = students.filter((s) => s.role === ROLES.ON_CAMPUS);
  // Universal floater pool (see the function-level comment above) - any
  // role, available as backup for any seat that isn't their own.
  const floaters = students.filter((s) => s.floater === true);

  const weeklyMinutes = new Map();
  const daysWorkedSet = new Map();
  const maxWeeklyMinutesByStudent = new Map(students.map((s) => [s.name, resolveMaxWeeklyMinutes(s.maxHours)]));

  // Manual rows count against the same weekly cap / day-worked tie-break,
  // same as LITS/PMO, even though the generator didn't create them.
  const manualMinutesByStudent = new Map();
  for (const row of manualRows) {
    const name = row['Student Name'];
    const start = parseTimeToMinutes(row['Start Time']);
    const end = parseTimeToMinutes(row['End Time']);
    if (!name || start == null || end == null || end <= start) continue;
    manualMinutesByStudent.set(name, (manualMinutesByStudent.get(name) || 0) + workedMinutesFor({ start, end }));
    if (!daysWorkedSet.has(name)) daysWorkedSet.set(name, new Set());
    daysWorkedSet.get(name).add(row['Day']);
  }
  for (const [name, minutes] of manualMinutesByStudent) {
    weeklyMinutes.set(name, (weeklyMinutes.get(name) || 0) + minutes);
  }

  const manualBySeatDay = new Map(); // "location|day" -> [{start,end}]
  const manualByStudentDay = new Map(); // "name|day" -> [{start,end}]
  for (const row of manualRows) {
    const start = parseTimeToMinutes(row['Start Time']);
    const end = parseTimeToMinutes(row['End Time']);
    if (start == null || end == null) continue;
    const seatKey = `${row['Location']}|${row['Day']}`;
    if (!manualBySeatDay.has(seatKey)) manualBySeatDay.set(seatKey, []);
    manualBySeatDay.get(seatKey).push({ start, end });
    const studentKey = `${row['Student Name']}|${row['Day']}`;
    if (!manualByStudentDay.has(studentKey)) manualByStudentDay.set(studentKey, []);
    manualByStudentDay.get(studentKey).push({ start, end });
  }

  // One persistent context per day. usedToday enforces "no split shifts" -
  // once a student is picked for anything that day, they're excluded from
  // every other seat the same day, for every seat processed after.
  const perDay = new Map();
  for (const day of WEEKDAYS) {
    const availability = new Map();
    const usedToday = new Set();
    for (const [key, intervals] of manualByStudentDay) {
      const [name, d] = key.split('|');
      if (d === day) usedToday.add(name);
    }

    const getAvailability = (student) => {
      if (!availability.has(student.name)) {
        const manualOccupied = manualByStudentDay.get(`${student.name}|${day}`) || [];
        availability.set(
          student.name,
          computeAvailability({
            day,
            classRows: classRows.filter((r) => r['Student Name'] === student.name),
            manualOccupied,
            unavailableAllDay: unavailableStudents.has(student.name),
          })
        );
      }
      return availability.get(student.name);
    };
    const consume = (student, block) => {
      availability.set(student.name, subtractInterval(getAvailability(student), block));
    };

    const seatInstances = SEATS.filter((seat) => seat.days.includes(day)).map((seat) => {
      const manual = manualBySeatDay.get(`${seat.location}|${day}`) || [];
      let segments = seat.segments.map((s) => ({ ...s }));
      for (const block of manual) segments = decrementNeed(segments, block.start, block.end, Infinity);
      // fullSpan is computed from the seat's ORIGINAL segments (before any
      // decrementing) - it's what candidate-matching uses to evaluate a
      // person's real overlap with the whole seat, not just whatever
      // sliver of need is still outstanding. See fillSeatFromPool.
      const fullSpan = {
        start: Math.min(...seat.segments.map((s) => s.start)),
        end: Math.max(...seat.segments.map((s) => s.end)),
      };
      return { ...seat, segments, fullSpan };
    });

    perDay.set(day, {
      ctx: { day, getAvailability, consume, weeklyMinutes, daysWorkedSet, generatedRows, maxWeeklyMinutesByStudent, usedToday },
      seatInstances,
      getAvailability,
    });
  }

  // Fill order: every seat's whole week before the next seat starts (same
  // week-wide-not-per-day principle as LITS/PMO), in the confirmed
  // fill-priority order the SEATS array is already written in.
  for (const seat of SEATS) {
    const pool = seat.pool === ROLES.REMOTE_WEEKDAY ? remoteWeekday : seat.pool === ROLES.REMOTE_WEEKEND ? remoteWeekend : onCampus;
    for (const day of seat.days) {
      const { ctx, seatInstances } = perDay.get(day);
      const instance = seatInstances.find((s) => s.location === seat.location);
      fillSeatFromPool(instance, pool, ctx);
    }
    // Floater backup: universal across every seat (changed 2026-10-14) -
    // after a seat's own Role pool is exhausted, anyone flagged Floater is
    // tried next regardless of their own Role, before a gap is reported.
    // Excludes students already in this seat's own pool (already tried
    // above); usedToday prevents double-booking either way.
    const backupPool = floaters.filter((s) => s.role !== seat.pool);
    for (const day of seat.days) {
      const { ctx, seatInstances } = perDay.get(day);
      const instance = seatInstances.find((s) => s.location === seat.location);
      fillSeatFromPool(instance, backupPool, ctx, 'floater backup');
    }
  }

  // Lunch-backup (open question #3, COVERAGE-POLICY.md): no separate pass
  // needed here, by design - see the top-of-file note. Any seat with
  // baseline need >= 2 through the lunch window already has in-seat mutual
  // coverage from the ordinary fill above.

  // Monday-morning overfill bonus pass, strictly after all required
  // coverage above - see fillMondayOverfillBonus for the assumed seat/
  // window this targets (not yet confirmed with the team).
  fillMondayOverfillBonus(onCampus, perDay.get('Monday').ctx);

  // Handoff overlap + gap reporting, per day.
  for (const day of WEEKDAYS) {
    const { seatInstances, getAvailability } = perDay.get(day);
    const dayRows = generatedRows.filter((r) => r.day === day);
    applyHandoffOverlap(dayRows, (name) => getAvailability({ name }));
    for (const instance of seatInstances) {
      for (const segment of instance.segments) {
        gaps.push({
          day,
          location: instance.location,
          start: segment.start,
          end: segment.end,
          stillNeeded: segment.need,
          mandatory: SEATS.find((s) => s.location === instance.location).mandatory,
        });
      }
    }
  }

  if (remoteWeekday.length === 0) warnings.push('No students have Role = Remote Weekday.');
  if (remoteWeekend.length === 0) warnings.push('No students have Role = Remote Weekend.');
  if (onCampus.length === 0) warnings.push('No students have Role = On Campus.');

  const finalRows = mergeAdjacentRows(generatedRows);
  return { generatedRows: finalRows, gaps, warnings };
}

module.exports = {
  WEEKDAYS,
  ROLES,
  SEATS,
  MIN_SHIFT_MINUTES,
  WEEKLY_CAP_MINUTES,
  officeHoursForDay,
  parseTimeToMinutes,
  formatMinutesToTime,
  computeAvailability,
  generateWeeklySchedule,
};
