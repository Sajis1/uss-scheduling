// Seats Configuration (Smartsheet) -> the `seats` shape scheduler.js
// expects. Added 2026-10-27 so a manager can add/retire a location without
// a code change - one row per time-segment (most locations are 1 row, a
// two-tier seat like M-Th Remote is 2+), grouped here by Location. Column
// names are exact as built on the real sheet, including its two known
// typos ("Start TIme"/"End TIme", "Madatory") - don't "fix" these to look
// right without checking the real sheet first, same lesson as every other
// Smartsheet integration in this project.
//
// Shared by routes/workSchedule.js (feeds the scheduler directly) and
// routes/seats.js (summarized for the frontend's dropdowns/category
// grouping/legend) so both read the live sheet the same way.
const { parseTimeToMinutes, formatMinutesToTime, ROLES } = require('./scheduler');

const KNOWN_POOLS = new Set(Object.values(ROLES));

function buildSeatsFromRows(rows) {
  const byLocation = new Map();
  const warnings = [];

  rows.forEach((row) => {
    if (row['Active'] !== true) return; // inactive rows are skipped entirely, not just flagged
    const location = row['Location'];
    const days = String(row['Days'] || '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);
    const start = parseTimeToMinutes(row['Start TIme']);
    const end = parseTimeToMinutes(row['End TIme']);
    const need = Number(row['Need']);
    const pool = row['Pool'];
    const mandatory = row['Madatory'] === true;

    const malformed =
      !location ||
      days.length === 0 ||
      start == null ||
      end == null ||
      end <= start ||
      !Number.isFinite(need) ||
      need <= 0 ||
      !KNOWN_POOLS.has(pool);
    if (malformed) {
      warnings.push(
        `Seats Configuration row for "${location || '(blank Location)'}" is malformed (check Days/Start TIme/End TIme/Need/Pool) and was skipped.`
      );
      return;
    }

    if (!byLocation.has(location)) {
      byLocation.set(location, { location, days: new Set(), pool, mandatory, segments: [] });
    }
    const seat = byLocation.get(location);
    days.forEach((d) => seat.days.add(d));
    seat.segments.push({ start, end, need });
    if (seat.pool !== pool) {
      warnings.push(`Seats Configuration: "${location}" has rows with different Pool values - using "${seat.pool}" (the first one seen).`);
    }
    if (seat.mandatory !== mandatory) {
      warnings.push(`Seats Configuration: "${location}" has rows with different Madatory values - using "${seat.mandatory}" (the first one seen).`);
    }
  });

  const seats = [...byLocation.values()].map((s) => ({
    location: s.location,
    days: [...s.days],
    pool: s.pool,
    mandatory: s.mandatory,
    segments: s.segments.sort((a, b) => a.start - b.start),
  }));
  return { seats, warnings };
}

// Frontend-facing summary: adds a display "hours" string (min start -> max
// end across all of a seat's segments) and a derived "category" (Remote
// vs. In Person) from its Pool, so manager.js doesn't need its own
// hardcoded LOCATIONS/SEAT_DAYS/SEAT_HOURS/CATEGORIES anymore.
function summarizeSeats(seats) {
  return seats.map((seat) => {
    const start = Math.min(...seat.segments.map((s) => s.start));
    const end = Math.max(...seat.segments.map((s) => s.end));
    const category = seat.pool === ROLES.ON_CAMPUS ? 'In Person' : 'Remote';
    return {
      location: seat.location,
      days: seat.days,
      pool: seat.pool,
      mandatory: seat.mandatory,
      category,
      hours: `${formatMinutesToTime(start)}-${formatMinutesToTime(end)}`,
    };
  });
}

module.exports = { buildSeatsFromRows, summarizeSeats };
