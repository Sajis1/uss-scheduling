// Pure scheduling logic: no Express, no Smartsheet calls. Operates only on
// plain JS arrays/objects so it can be exercised without any network access.
// Callers (routes/workSchedule.js) are responsible for fetching Smartsheet
// rows in, and turning generatedRows back into Smartsheet field objects out.
//
// USS LITS variant. Forked from the PMO scheduler rather than sharing a
// config-driven engine with it - LITS is structurally simpler (no Back
// Office cascade, no Floater tier, no per-day headcount cap, split shifts
// allowed) and the two departments' rules are still settling, so copying and
// adapting is less risky than a premature shared abstraction. See
// ASSUMPTIONS TO CONFIRM below for anything not yet nailed down with USS LITS.
//
// ASSUMPTIONS TO CONFIRM (flagged in the LITS coverage-policy doc too):
//   - Each of NW / OMB / CSB needs exactly ONE person at a time (no stated
//     simultaneous headcount >1, unlike PMO's S700 2-seat).
//   - No per-day cap on how many different people rotate through one desk -
//     unlike PMO, since split shifts are explicitly allowed here, multiple
//     people covering one desk in a day is expected, not a fragmentation bug.
//   - No stated weekly-hour FLOOR (PMO has a 13-hour guarantee) - this build
//     does not top anyone up toward 19 hours, it only covers the three desks.
//     Easy to add later (see topUpBelowFloor in the PMO scheduler for the
//     shape) once confirmed.

const OFFICE_START = 480; // 8:00 AM, in minutes since midnight
const OFFICE_END = 1020; // 5:00 PM
const LUNCH_START = 720; // 12:00 PM
const LUNCH_END = 780; // 1:00 PM
const MIN_SHIFT_MINUTES = 240; // 4 hours - hard minimum, no shift (or split piece) is ever assigned shorter than this
const WEEKLY_CAP_MINUTES = 1140; // 19 hours/week - default cap, used when a student has no valid Max Hours override
const CLASS_BUFFER_MINUTES = 30; // buffer before/after class, so a shift never starts the instant class ends or ends the instant class starts
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// The three desks. NW is proprietary - it draws from its own students only,
// with no fallback pool at all (an NW gap that NW students can't cover stays
// a reported gap, never filled by an OMB/CSB student). OMB and CSB are a
// two-way floater pair - each has its own home pool, filled first across the
// whole week, and each falls back to the OTHER desk's pool for whatever gap
// its own home students can't close. OMB is filled before CSB per the
// "OMB - 1st priority, CSB - 2nd priority" fill order.
const LOCATIONS = { NW: 'NW', OMB: 'OMB', CSB: 'CSB' };

// A shift spanning the full 8am-5pm office day includes a mandatory unpaid
// 1-hour lunch break. The displayed block stays one continuous row (the
// student isn't actually pulled off the schedule for it) - only the worked
// -minutes count used for the 19-hour cap and Weekly Hours drops by 60, and
// the row gets a note so it's visible without splitting the calendar entry
// in two. Scoped narrowly to the exact full-day case on purpose - this
// doesn't try to guess a break policy for partial shifts.
function isFullOfficeDay(interval) {
  return interval.start === OFFICE_START && interval.end === OFFICE_END;
}

function workedMinutesFor(interval) {
  const raw = interval.end - interval.start;
  return isFullOfficeDay(interval) ? raw - (LUNCH_END - LUNCH_START) : raw;
}

// A full 8-5 block only actually costs (raw - 60min lunch) against the
// weekly cap. Capping by raw minutes alone truncates a candidate's last hour
// even when their true lunch-adjusted cost fits the remaining budget exactly
// - which silently turned a fully-available candidate into a truncated one,
// tripping orphan-avoidance and disqualifying them even though they could
// really work the whole day. Extend to the full day first if the discounted
// cost fits; only fall back to a raw-minute cap otherwise.
function budgetCappedEnd(overlap, remainingBudget) {
  if (isFullOfficeDay(overlap) && workedMinutesFor(overlap) <= remainingBudget) {
    return overlap.end;
  }
  return Math.min(overlap.end, overlap.start + remainingBudget);
}

// Student Master's Max Hours column overrides the default 19-hour weekly cap
// per student. Blank/0/non-numeric falls back to the default. Floored (never
// rounded up) to the nearest 15 minutes - a manager typing a non-quarter-hour
// value never grants more budget than they actually entered, and this keeps
// budgetCappedEnd's cap-truncated shift ends landing on :00/:15/:30/:45, same
// as every other boundary in this file.
function resolveMaxWeeklyMinutes(maxHours) {
  const hours = Number(maxHours);
  if (!Number.isFinite(hours) || hours <= 0) return WEEKLY_CAP_MINUTES;
  return Math.floor((hours * 60) / 15) * 15;
}

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

// Computes one student's free intervals on one weekday, within office hours,
// after removing class blocks and any already-occupied (manual) time.
function computeAvailability({ day, classRows, manualOccupied, unavailableAllDay }) {
  if (unavailableAllDay) return [];
  let intervals = [{ start: OFFICE_START, end: OFFICE_END }];
  const classBlocks = classRows
    .filter((row) => row['Day'] === day)
    .map((row) => ({
      start: parseTimeToMinutes(row['Start Time']),
      end: parseTimeToMinutes(row['End Time']),
    }))
    .filter((iv) => iv.start != null && iv.end != null && iv.end > iv.start)
    // Round each raw class time outward to the nearest 15-minute mark - a
    // student-submitted time that lands on an odd minute only ever WIDENS
    // the blocked window (start rounds earlier, end rounds later), never
    // narrows it. Also what keeps every downstream boundary (buffer, gap,
    // assigned shift start/end) landing on :00/:15/:30/:45.
    .map((iv) => ({
      start: Math.floor(iv.start / 15) * 15,
      end: Math.ceil(iv.end / 15) * 15,
    }))
    // Pad each class block by a buffer on both sides so a shift never starts
    // the instant class ends (or has to end the instant it begins) - clamped
    // to office hours since a buffer past 8-5 has nothing to protect.
    .map((iv) => ({
      start: Math.max(OFFICE_START, iv.start - CLASS_BUFFER_MINUTES),
      end: Math.min(OFFICE_END, iv.end + CLASS_BUFFER_MINUTES),
    }));
  intervals = subtractIntervals(intervals, classBlocks);
  if (manualOccupied && manualOccupied.length) {
    intervals = subtractIntervals(intervals, manualOccupied);
  }
  return intervals;
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

function buildManualOccupancy(manualRows) {
  const byStudent = new Map();
  const bySeat = new Map();
  for (const row of manualRows) {
    const name = row['Student Name'];
    const day = row['Day'];
    const location = row['Location'];
    const start = parseTimeToMinutes(row['Start Time']);
    const end = parseTimeToMinutes(row['End Time']);
    if (start == null || end == null) continue;
    const interval = { start, end };

    if (!byStudent.has(name)) byStudent.set(name, new Map());
    const studentDays = byStudent.get(name);
    if (!studentDays.has(day)) studentDays.set(day, []);
    studentDays.get(day).push(interval);

    if (!bySeat.has(location)) bySeat.set(location, new Map());
    const seatDays = bySeat.get(location);
    if (!seatDays.has(day)) seatDays.set(day, []);
    seatDays.get(day).push(interval);
  }
  return { byStudent, bySeat };
}

// Full, gap-free coverage of the current gap beats everything else - a
// candidate who can close the ENTIRE gap alone always wins, even over
// someone who's worked fewer days so far. Short of that, fewer-days-worked
// is the tie-break (spreads the roster across the week), and overlap length
// breaks any remaining tie. Unlike PMO, there's no separate "preferred
// shift length" tier here - the 4-hour hard minimum already equals what PMO
// calls its preferred chunk size, so every qualifying candidate is already
// offering a substantial piece; a second tier above the minimum would be
// redundant.
function candidateScore(overlapMinutes, daysWorkedSoFar, closesGapFully) {
  const closureBonus = closesGapFully ? 100000000 : 0;
  return closureBonus - daysWorkedSoFar * 100000 + overlapMinutes;
}

// Students whose home desk is this location - the "stay home" tier tried
// before flexing anyone in from the other desk.
function homePool(pool, location) {
  return pool.filter((s) => s.primaryLocation === location);
}

// Greedily fills a seat instance's remaining gap from a pool of students,
// picking the best-scoring candidate each round. Hard constraints enforced
// here, all via ctx: a student's assignment is truncated so their running
// weekly total never exceeds their weekly cap (ctx.weeklyMinutes), and no
// assignment is ever shorter than the 4-hour minimum. Unlike PMO, there is
// NO one-shift-per-day exclusion here - USS LITS explicitly allows split
// shifts, so a student can appear more than once in a day (including at a
// different desk), as long as their available time (tracked via
// ctx.consume, shared across every desk for that student/day) never
// actually overlaps. Mutates seatInstance.gap and the availability/
// weeklyMinutes/daysWorked tracked in ctx as it assigns. `forcedReason`, if
// given, overrides the auto mix-note. When `avoidOrphans` is true (the
// default), a candidate is skipped ONLY if their own weekly cap (not real
// availability) is what would truncate the assignment short and leave a
// sub-4-hour, un-assignable sliver of the gap behind - a gap caused by the
// candidate's genuine availability is never grounds to skip them.
function fillSeatFromPool(seatInstance, pool, ctx, forcedReason, avoidOrphans = true) {
  const { day, getAvailability, consume, weeklyMinutes, daysWorkedSet, generatedRows, maxWeeklyMinutesByStudent } = ctx;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const gapWindow of [...seatInstance.gap]) {
      let best = null;
      let bestScore = -Infinity;
      for (const student of pool) {
        const weeklyCap = maxWeeklyMinutesByStudent.get(student.name) ?? WEEKLY_CAP_MINUTES;
        const remainingBudget = weeklyCap - (weeklyMinutes.get(student.name) || 0);
        if (remainingBudget <= 0) continue; // this student's own weekly cap reached
        for (const iv of getAvailability(student)) {
          const overlap = intersect(iv, gapWindow);
          if (!overlap) continue;
          const cappedEnd = budgetCappedEnd(overlap, remainingBudget);
          if (cappedEnd <= overlap.start) continue;
          const interval = { start: overlap.start, end: cappedEnd };
          const overlapMinutes = interval.end - interval.start;
          if (overlapMinutes < MIN_SHIFT_MINUTES) continue; // 4-hour hard minimum, no exception
          if (avoidOrphans) {
            const wasCapTruncated = cappedEnd < overlap.end;
            const leftoverAfter = gapWindow.end - interval.end;
            const capInducedOrphan = wasCapTruncated && leftoverAfter > 0 && leftoverAfter < MIN_SHIFT_MINUTES;
            if (capInducedOrphan) continue;
          }
          const closesGapFully = interval.start === gapWindow.start && interval.end === gapWindow.end;
          const daysWorkedSoFar = (daysWorkedSet.get(student.name) || new Set()).size;
          const score = candidateScore(overlapMinutes, daysWorkedSoFar, closesGapFully);
          if (score > bestScore) {
            bestScore = score;
            best = { student, interval };
          }
        }
      }
      if (best) {
        const reason =
          forcedReason ||
          (best.student.primaryLocation && best.student.primaryLocation !== seatInstance.location
            ? `floater: normally ${best.student.primaryLocation}`
            : '');
        const lunchNote = isFullOfficeDay(best.interval) ? 'includes unpaid lunch 12-1 PM (8 hrs counted)' : '';
        const fullReason = [reason, lunchNote].filter(Boolean).join('; ');
        generatedRows.push({
          studentName: best.student.name,
          day,
          location: seatInstance.location,
          start: best.interval.start,
          end: best.interval.end,
          reason: fullReason,
        });
        const workedMinutes = workedMinutesFor(best.interval);
        consume(best.student, best.interval);
        if (!daysWorkedSet.has(best.student.name)) daysWorkedSet.set(best.student.name, new Set());
        daysWorkedSet.get(best.student.name).add(day);
        weeklyMinutes.set(best.student.name, (weeklyMinutes.get(best.student.name) || 0) + workedMinutes);
        seatInstance.gap = subtractInterval(seatInstance.gap, best.interval);
        progressed = true;
        break; // gap array changed shape, restart the scan
      }
    }
  }
}

// students: [{ name, role: 'OMB'|'NW'|'CSB', primaryLocation, maxHours }]
//   role and primaryLocation are the same value for USS LITS (there's no
//   separate "which pool" vs "which desk" distinction like PMO's Front
//   Desk/Back Office/Floater split) - Student Master's Primary Location
//   column should just repeat the Role value per student. maxHours is this
//   student's own weekly cap override (Student Master's Max Hours column);
//   blank/0/non-numeric falls back to the 19-hour default. Caller is
//   expected to have already filtered to Active students.
// classRows / timeOffRows: raw Smartsheet rows (via getRows) for the whole sheet.
// manualRows: Work Schedule rows for the target semester where Source === 'Manual'.
function generateWeeklySchedule({ students, classRows, timeOffRows, manualRows, asOfDate }) {
  const unavailableStudents = computeUnavailableStudents(timeOffRows, asOfDate);
  const { byStudent: manualByStudent, bySeat: manualBySeat } = buildManualOccupancy(manualRows);

  const nw = students.filter((s) => s.role === 'NW');
  const ombAndCsb = students.filter((s) => s.role === 'OMB' || s.role === 'CSB');

  const generatedRows = [];
  const gaps = [];
  const warnings = [];

  const knownRoles = new Set(['OMB', 'NW', 'CSB']);
  const unrecognizedRoleNames = students.filter((s) => !knownRoles.has(s.role)).map((s) => s.name);
  if (unrecognizedRoleNames.length > 0) {
    warnings.push(
      `These active students have no recognized Role (must be "OMB", "NW", or "CSB") and were skipped: ${unrecognizedRoleNames.join(', ')}.`
    );
  }
  if (nw.length === 0) warnings.push('No students have Role = NW.');
  if (ombAndCsb.length === 0) warnings.push('No students have Role = OMB or CSB.');

  // Both persist across the whole week (not reset per day) - this is what
  // makes each student's weekly cap actually weekly, and the day-spread
  // preference actually week-aware. daysWorkedSet is a Set of days per
  // student (not a raw counter) so a split-shift day with two rows still
  // only counts as ONE day worked toward the day-spread tie-break.
  const weeklyMinutes = new Map();
  const daysWorkedSet = new Map();

  const maxWeeklyMinutesByStudent = new Map(
    students.map((s) => [s.name, resolveMaxWeeklyMinutes(s.maxHours)])
  );

  // Manual rows are pre-existing commitments the generator didn't create,
  // but their hours still count against the same weekly cap and their day
  // still counts toward the same day-spread tie-break.
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

  // One persistent context per day, built once and reused across every pass
  // below - this is what lets CSB (pass 3) see the weeklyMinutes/daysWorked
  // state NW+OMB (passes 1-2) already left behind for that same day, while
  // NW and OMB get first claim on each day's capacity across the WHOLE week
  // before CSB's overflow tier ever gets a turn.
  const perDay = new Map();
  for (const day of WEEKDAYS) {
    const availability = new Map(); // studentName -> remaining {start,end}[] for this day, shared across all three desks

    const getAvailability = (student) => {
      if (!availability.has(student.name)) {
        const manualOccupied = (manualByStudent.get(student.name) || new Map()).get(day) || [];
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

    const seatBase = () => [{ start: OFFICE_START, end: OFFICE_END }];
    const nwManual = (manualBySeat.get('NW') || new Map()).get(day) || [];
    const ombManual = (manualBySeat.get('OMB') || new Map()).get(day) || [];
    const csbManual = (manualBySeat.get('CSB') || new Map()).get(day) || [];

    perDay.set(day, {
      ctx: {
        day,
        getAvailability,
        consume,
        weeklyMinutes,
        daysWorkedSet,
        generatedRows,
        maxWeeklyMinutesByStudent,
      },
      nwInstance: { location: 'NW', gap: subtractIntervals(seatBase(), nwManual) },
      ombInstance: { location: 'OMB', gap: subtractIntervals(seatBase(), ombManual) },
      csbInstance: { location: 'CSB', gap: subtractIntervals(seatBase(), csbManual) },
    });
  }

  // Pass 1: NW, filled ONLY from NW-role students, across the whole week.
  // No fallback pool at all - NW is proprietary and can never be covered by
  // an OMB/CSB student. A gap NW's own students can't close stays a
  // reported gap.
  for (const day of WEEKDAYS) {
    const { ctx, nwInstance } = perDay.get(day);
    fillSeatFromPool(nwInstance, nw, ctx);
  }

  // Pass 2: OMB, home students first (their own claim across the whole
  // week, ahead of CSB below), then the rest of the combined OMB/CSB
  // floater pool for whatever gap remains.
  for (const day of WEEKDAYS) {
    const { ctx, ombInstance } = perDay.get(day);
    fillSeatFromPool(ombInstance, homePool(ombAndCsb, 'OMB'), ctx);
  }
  for (const day of WEEKDAYS) {
    const { ctx, ombInstance } = perDay.get(day);
    fillSeatFromPool(ombInstance, ombAndCsb, ctx);
  }

  // Pass 3: CSB - the 2nd-priority desk. Home students first, then
  // whatever's left of the combined pool (i.e. OMB people flexing into
  // CSB), using only the capacity OMB didn't already claim above.
  for (const day of WEEKDAYS) {
    const { ctx, csbInstance } = perDay.get(day);
    fillSeatFromPool(csbInstance, homePool(ombAndCsb, 'CSB'), ctx);
  }
  for (const day of WEEKDAYS) {
    const { ctx, csbInstance } = perDay.get(day);
    fillSeatFromPool(csbInstance, ombAndCsb, ctx);
  }

  // Anything still uncovered is reported, not silently dropped.
  for (const day of WEEKDAYS) {
    const { nwInstance, ombInstance, csbInstance } = perDay.get(day);
    for (const seatInstance of [nwInstance, ombInstance, csbInstance]) {
      for (const gap of seatInstance.gap) {
        gaps.push({ day, location: seatInstance.location, start: gap.start, end: gap.end });
      }
    }
  }

  const finalRows = mergeAdjacentRows(generatedRows);
  return { generatedRows: finalRows, gaps, warnings };
}

// Collapses back-to-back rows for the same student/day/location/reason into
// a single row, so the calendar doesn't show an artificial shift split when
// it's really one continuous block that just got built up across two
// restart passes. A genuine split shift (a gap between the two pieces, or a
// different desk in between) is untouched - only truly adjacent rows merge.
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

module.exports = {
  OFFICE_START,
  OFFICE_END,
  MIN_SHIFT_MINUTES,
  WEEKDAYS,
  LOCATIONS,
  parseTimeToMinutes,
  formatMinutesToTime,
  computeAvailability,
  generateWeeklySchedule,
};
