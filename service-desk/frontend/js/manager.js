// No login here either (same accepted tradeoff as the student portal).

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_LABEL = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };

// Seats are no longer hardcoded here (changed 2026-10-27) - LOCATIONS,
// SEAT_DAYS, SEAT_HOURS, and which calendar row each seat belongs to all
// come from GET /api/seats now, which reads the live "Seats Configuration"
// Smartsheet. This is what lets a manager add/retire a location without a
// code change. See loadSeats() below. The calendar table itself still has
// exactly 2 fixed rows (Remote / In Person, in manager.html) - a seat just
// slots into whichever one its Pool maps to.
let currentSeats = []; // [{location, days, pool, mandatory, category, hours}] - populated by loadSeats()

function seatsByCategory(categoryName) {
  return currentSeats.filter((s) => s.category === categoryName);
}

function seatInfo(location) {
  return currentSeats.find((s) => s.location === location);
}

async function loadSeats() {
  try {
    const data = await api.getSeats();
    currentSeats = data.seats;
    if (data.warnings && data.warnings.length) {
      console.warn('Seats Configuration warnings:', data.warnings);
    }
  } catch (err) {
    appAlert(`Could not load seat configuration: ${err.message}`);
    currentSeats = [];
  }
}

// Deterministic name -> palette color, shared by colorForSeat/colorForStudent
// so the same name always gets the same color without storing a mapping
// anywhere. Separate palettes so seat colors and person colors never look
// like the same kind of label.
function hashToIndex(name, length) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % length;
}

// Known seats keep these exact hand-picked colors (unchanged look from
// 2026-10-22); any new seat added later gets one from SEAT_PALETTE instead,
// via colorForSeat() below - no code change needed when a seat is added.
const SEAT_COLORS = {
  'M-Th Remote': '#15803d',
  'Friday Remote': '#0e7490',
  Saturday: '#b45309',
  Sunday: '#be185d',
  'Acad 700': '#1d4ed8',
  S817: '#7e22ce',
};
const SEAT_PALETTE = ['#be123c', '#4d7c0f', '#0369a1', '#a21caf', '#b45309', '#0f766e', '#15803d', '#7e22ce'];

function colorForSeat(name) {
  return SEAT_COLORS[name] || SEAT_PALETTE[hashToIndex(name, SEAT_PALETTE.length)];
}

// Pale tint of a seat's color, computed on the fly (not hand-picked) so it
// works for any seat, known or new. Used as a generated chip's own
// background (not just its border) so the seat coding reads at a glance.
// Manual-override chips keep their amber background instead (see
// renderChip) - that's still the "manual" signal.
function lightenColor(hex, amount = 0.82) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

// Per-person color coding - a fixed palette, deterministically assigned by
// name so the same student always gets the same color across the whole
// dashboard (calendar chips, weekly hours, class schedule) without needing
// a stored mapping anywhere. Distinct from SEAT_COLORS/SEAT_PALETTE on
// purpose - a chip's left border says "which seat", the dot next to the
// name says "which person".
const PERSON_PALETTE = [
  '#dc2626', '#ea580c', '#d97706', '#65a30d', '#059669',
  '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#db2777',
  '#4f46e5', '#0d9488',
];

function colorForStudent(name) {
  return PERSON_PALETTE[hashToIndex(name, PERSON_PALETTE.length)];
}

let currentWorkScheduleRows = [];
let currentRoster = []; // [{name, role, active, maxHours, floater, extension, phone}] - populated by loadRoster()
let currentClassScheduleRows = [];
let currentTimeOffRows = [];
let lastGaps = null; // set by handleGenerate(); null until a Generate has run this session

// --- Overview stat cards ---
function renderStatCards() {
  const activeCount = currentRoster.filter((s) => s.active).length;
  document.getElementById('stat-active-students').textContent = activeCount;

  const mandatoryEl = document.getElementById('stat-mandatory-gaps');
  const mandatorySubEl = document.getElementById('stat-mandatory-gaps-sub');
  if (lastGaps === null) {
    mandatoryEl.textContent = '—';
    mandatorySubEl.textContent = 'run Generate to check';
  } else {
    mandatoryEl.textContent = lastGaps.filter((g) => g.mandatory).length;
    mandatorySubEl.textContent = 'as of last Generate';
  }
  document.getElementById('stat-opportunistic-gaps').textContent =
    lastGaps === null ? '—' : lastGaps.filter((g) => !g.mandatory).length;

  const pendingCount = currentTimeOffRows.filter((r) => r['Status'] === 'Pending').length;
  document.getElementById('stat-pending-timeoff').textContent = pendingCount;
}

function to12Hour(time24) {
  if (!time24) return '';
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = ((h + 11) % 12) + 1;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

function to24Hour(time12) {
  if (!time12) return '';
  const match = time12.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return '';
  let [, h, m, period] = match;
  h = parseInt(h, 10) % 12;
  if (period.toUpperCase() === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${m}`;
}

function parseTimeMinutes(text) {
  if (!text) return null;
  const match = String(text).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let [, h, m, period] = match;
  h = parseInt(h, 10) % 12;
  if (period.toUpperCase() === 'PM') h += 12;
  return h * 60 + parseInt(m, 10);
}

function showStatus(el, message, kind) {
  el.textContent = message;
  el.hidden = false;
  el.className = `status ${kind}`;
}

// --- Roster (for the Add/Edit Shift student dropdown) ---
async function loadRoster() {
  const select = document.getElementById('shift-student');
  try {
    const roster = await api.getStudentsRoster();
    currentRoster = roster;
    select.innerHTML = '';
    roster
      .filter((s) => s.active)
      .forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.name;
        opt.textContent = `${s.name} (${s.role}${s.floater ? ', floater' : ''})`;
        select.appendChild(opt);
      });
  } catch (err) {
    select.innerHTML = `<option value="">Could not load roster: ${err.message}</option>`;
  }
  renderStatCards();
}

// --- Calendar ---
// Chips are color-coded three ways at once: the left border AND the
// background tint are the seat's color (colorForSeat/lightenColor),
// the dot next to the name is that student's color (colorForStudent).
// Manual-override chips keep their plain amber background (from
// .chip-manual) instead of the seat tint - that's still the sole "this
// was hand-edited" signal - but keep the seat-colored border either way.
function renderChip(row) {
  const isManual = row['Source'] === 'Manual';
  const seatColor = colorForSeat(row['Location'] || '');
  const seatTint = lightenColor(seatColor);
  const personColor = colorForStudent(row['Student Name'] || '');
  const chip = document.createElement('div');
  chip.className = `chip${isManual ? ' chip-manual' : ''}`;
  chip.style.borderLeftColor = seatColor;
  if (!isManual) chip.style.background = seatTint; // manual keeps its amber bg instead - see note above
  chip.innerHTML = `
    <div class="chip-name"><span class="person-dot" style="background:${personColor}"></span>${row['Student Name'] || ''}</div>
    <div class="chip-time">${row['Start Time'] || ''} - ${row['End Time'] || ''}</div>
    ${row['Notes'] ? `<div class="chip-reason">${row['Notes']}</div>` : ''}
    <div class="chip-actions">
      <button type="button" class="edit-chip-btn">Edit</button>
      <button type="button" class="duplicate-chip-btn">Duplicate</button>
      <button type="button" class="delete-chip-btn">Delete</button>
    </div>
  `;
  chip.querySelector('.edit-chip-btn').addEventListener('click', () => startEditShift(row));
  chip.querySelector('.duplicate-chip-btn').addEventListener('click', () => duplicateShift(row));
  chip.querySelector('.delete-chip-btn').addEventListener('click', () => deleteShift(row));
  return chip;
}

// One cell can hold more than one seat (e.g. Monday's "In Person" cell has
// both Acad 700 and S817) - each seat gets its own labeled sub-group of
// chips, tagged with that seat's color via a small square swatch, so it's
// still clear which seat a student's shift is at.
function renderSeatGroup(seat, day) {
  const group = document.createElement('div');
  group.className = 'seat-group';
  const seatColor = colorForSeat(seat);
  const hours = (seatInfo(seat) || {}).hours || '';
  group.innerHTML = `<div class="seat-group-label"><span class="seat-swatch" style="background:${seatColor}"></span>${seat}<span class="hint">${hours}</span></div>`;
  const rows = currentWorkScheduleRows
    .filter((r) => r['Location'] === seat && r['Day'] === day)
    .sort((a, b) => (parseTimeMinutes(a['Start Time']) || 0) - (parseTimeMinutes(b['Start Time']) || 0));
  rows.forEach((row) => group.appendChild(renderChip(row)));
  return group;
}

async function loadCalendar() {
  const semester = document.getElementById('calendar-semester-input').value.trim();
  if (!semester) return;
  try {
    currentWorkScheduleRows = await api.getWorkSchedule(semester);
  } catch (err) {
    appAlert(`Could not load the schedule: ${err.message}`);
    return;
  }

  ['Remote', 'In Person'].forEach((categoryName) => {
    const rowEl = document.querySelector(`#calendar-table tr[data-category="${categoryName}"]`);
    const categorySeats = seatsByCategory(categoryName);
    DAYS.forEach((day) => {
      const cell = rowEl.querySelector(`td[data-day="${day}"]`);
      const seatsToday = categorySeats.filter((s) => s.days.includes(day)).map((s) => s.location);
      cell.innerHTML = '';
      // N/A styling is set here, not static in the HTML - a category's
      // N/A days can change as seats are added/retired through the sheet.
      cell.classList.toggle('cell-na', seatsToday.length === 0);
      seatsToday.forEach((seat) => cell.appendChild(renderSeatGroup(seat, day)));
    });
  });

  renderWeeklyHours();
  renderStatCards();
}

// Builds the seat-color legend above the calendar from currentSeats itself,
// so it can never drift out of sync with the actual swatches used, and
// automatically picks up any seat added/retired through the sheet.
function renderSeatLegend() {
  const el = document.getElementById('seat-legend');
  if (!el) return;
  el.innerHTML = currentSeats
    .map((s) => `<span class="seat-legend-item"><span class="seat-swatch" style="background:${colorForSeat(s.location)}"></span>${s.location}</span>`)
    .join('');
}

// --- Copy for Excel ---
// Grid layout (students as columns, days as rows), same idea as LITS/PMO's
// export. One box covering everyone, same reasoning as LITS (no clean
// two-way split here either).
// Known seats keep these exact 2-letter markers (unchanged from before);
// any new seat gets one auto-derived from its name instead (initials of
// each word, e.g. "New Front Desk" -> "NFD", or first 2 letters of a
// single-word name) - no code change needed when a seat is added.
const KNOWN_LOCATION_MARKERS = { 'M-Th Remote': 'MR', 'Friday Remote': 'FR', Saturday: 'SA', Sunday: 'SU', 'Acad 700': 'A7', S817: 'S8' };

function markerForSeat(name) {
  if (KNOWN_LOCATION_MARKERS[name]) return KNOWN_LOCATION_MARKERS[name];
  const words = name.trim().split(/\s+/);
  const marker = words.length > 1 ? words.map((w) => w[0]).join('') : name.slice(0, 2);
  return marker.toUpperCase();
}

const EXPORT_FONT_STACK = "'Aptos','Segoe UI',Calibri,Arial,sans-serif";

function compactTime(text) {
  const match = String(text || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return text || '';
  const [, h, m] = match;
  return m === '00' ? h : `${h}:${m}`;
}

function htmlEscape(value) {
  const text = value == null ? '' : String(value);
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function workedMinutesForShift(startTime, endTime) {
  const start = parseTimeMinutes(startTime);
  const end = parseTimeMinutes(endTime);
  if (start == null || end == null) return 0;
  const spansLunch = start <= 720 && end >= 780; // 12-1pm
  return end - start - (spansLunch ? 60 : 0);
}

function weeklyHoursByStudent(rows) {
  const totals = new Map();
  rows.forEach((row) => {
    const workedMinutes = workedMinutesForShift(row['Start Time'], row['End Time']);
    if (!workedMinutes) return;
    totals.set(row['Student Name'], (totals.get(row['Student Name']) || 0) + workedMinutes);
  });
  return totals;
}

function buildScheduleTableHtml() {
  if (currentWorkScheduleRows.length === 0) return null;

  const semester = document.getElementById('calendar-semester-input').value.trim() || 'Schedule';
  const totals = weeklyHoursByStudent(currentWorkScheduleRows);
  const allStudents = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  if (allStudents.length === 0) return null;

  const byStudentDay = new Map();
  currentWorkScheduleRows.forEach((row) => {
    const key = `${row['Student Name']}|${row['Day']}`;
    if (!byStudentDay.has(key)) byStudentDay.set(key, []);
    byStudentDay.get(key).push(row);
  });
  const cellFor = (name, day) =>
    (byStudentDay.get(`${name}|${day}`) || [])
      .sort((a, b) => (parseTimeMinutes(a['Start Time']) || 0) - (parseTimeMinutes(b['Start Time']) || 0))
      .map((row) => {
        const marker = row['Location'] ? markerForSeat(row['Location']) : '';
        return `${compactTime(row['Start Time'])}-${compactTime(row['End Time'])}${marker ? ' ' + marker : ''}`;
      })
      .join('<br>');

  // Excel export shows first name only - full names (several 3-4 words
  // long, e.g. "Abu Alteen Abdulaziz") were wrapping to 3 lines each and
  // making every column unreadably narrow. Lookups below still key off the
  // full Student Name (that's what's actually on each row); only the
  // printed header changes. If two students ever share a first name,
  // they'll look identical here - not handled, flag it if it comes up.
  const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || name;

  const th = 'style="background:#1F3864;color:#fff;font-weight:bold;text-align:center;border:1px solid #999;padding:5px 10px;white-space:nowrap;"';
  const dayLabelTd = 'style="background:#D9E1F2;font-weight:bold;text-align:center;border:1px solid #999;padding:5px 10px;white-space:nowrap;"';
  const cellTd = 'style="text-align:center;border:1px solid #999;padding:5px 10px;white-space:nowrap;"';
  const totalTd = 'style="background:#D9E1F2;font-weight:bold;text-align:center;border:1px solid #999;padding:5px 10px;"';

  const totalCols = allStudents.length + 1;
  const titleRow = `<tr><td colspan="${totalCols}" style="background:#1F3864;color:#fff;font-weight:bold;text-align:center;font-size:14pt;padding:8px;">USS Service Desk Student Worker Schedule &mdash; ${htmlEscape(semester)}</td></tr>`;
  const headerRow = `<tr><td ${th}></td>${allStudents.map((name) => `<td ${th}>${htmlEscape(firstName(name))}</td>`).join('')}</tr>`;
  const dayRows = DAYS.map(
    (day) => `<tr><td ${dayLabelTd}>${DAY_LABEL[day]}</td>${allStudents.map((name) => `<td ${cellTd}>${cellFor(name, day)}</td>`).join('')}</tr>`
  ).join('');
  const hoursRow = `<tr><td ${totalTd}>Total Hrs</td>${allStudents
    .map((name) => `<td ${totalTd}>${(Math.round((totals.get(name) || 0) / 6) / 10).toFixed(1).replace(/\.0$/, '')}</td>`)
    .join('')}</tr>`;

  const legendText = currentSeats.map((s) => `${markerForSeat(s.location)} = ${s.location}`).join('&nbsp;&nbsp;&nbsp;');
  const legendRow = `<tr><td colspan="${totalCols}" style="border:1px solid #999;padding:5px 10px;">${legendText}</td></tr>`;
  const updatedRow = `<tr><td colspan="${totalCols}" style="border:1px solid #999;padding:5px 10px;text-align:right;font-style:italic;">Last Updated: ${new Date().toLocaleDateString()}</td></tr>`;

  return `<table style="border-collapse:collapse;font-family:${EXPORT_FONT_STACK};font-size:11pt;">
${titleRow}
${headerRow}
${dayRows}
${hoursRow}
<tr><td colspan="${totalCols}" style="border:none;padding:4px;"></td></tr>
${legendRow}
${updatedRow}
</table>`;
}

function copyScheduleForExcel() {
  const tableHtml = buildScheduleTableHtml();
  const statusEl = document.getElementById('export-copy-status');
  if (!tableHtml) {
    appAlert('No schedule loaded to copy. Load a semester on the calendar above first.');
    return;
  }

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-99999px';
  container.style.top = '0';
  container.innerHTML = tableHtml;
  document.body.appendChild(container);

  const range = document.createRange();
  range.selectNode(container);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch (err) {
    copied = false;
  }
  selection.removeAllRanges();
  document.body.removeChild(container);

  if (statusEl) {
    showStatus(
      statusEl,
      copied ? 'Copied! Paste into a blank Excel sheet with Ctrl+V.' : 'Copy failed - please try again.',
      copied ? 'success' : 'error'
    );
  }
}

// --- Weekly hours summary ---
function capHoursFor(name) {
  const raw = Number((currentRoster.find((s) => s.name === name) || {}).maxHours);
  return Number.isFinite(raw) && raw > 0 ? raw : 19.75;
}

function renderWeeklyHours() {
  const tbody = document.querySelector('#weekly-hours-table tbody');
  const emptyMsg = document.getElementById('weekly-hours-empty');
  const totals = weeklyHoursByStudent(currentWorkScheduleRows);

  const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  tbody.innerHTML = '';
  emptyMsg.hidden = entries.length > 0;
  entries.forEach(([name, minutes]) => {
    const hours = (minutes / 60).toFixed(1);
    const capHours = capHoursFor(name);
    const pct = Math.min(100, (minutes / (capHours * 60)) * 100);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="person-dot" style="background:${colorForStudent(name)}"></span>${name}</td>
      <td>
        <div class="hours-bar-track"><div class="hours-bar-fill" style="width:${pct}%"></div></div>
        <span class="hours-bar-label">${hours} / ${capHours}</span>
      </td>`;
    tbody.appendChild(tr);
  });
}

// --- Class Schedule (read-only reference) ---
async function loadClassScheduleView() {
  const tbody = document.querySelector('#class-schedule-table tbody');
  try {
    const [roster, classRows] = await Promise.all([api.getStudentsRoster(), api.getAllClassSchedule()]);
    currentClassScheduleRows = classRows;
    const active = roster.filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name));

    tbody.innerHTML = '';
    active.forEach((student) => {
      const tr = document.createElement('tr');
      const nameTd = document.createElement('td');
      nameTd.innerHTML = `<strong><span class="person-dot" style="background:${colorForStudent(student.name)}"></span>${student.name}</strong><br><span class="hint">${student.role}${student.floater ? ' (floater)' : ''}</span>`;
      tr.appendChild(nameTd);

      DAYS.forEach((day) => {
        const td = document.createElement('td');
        const rows = classRows
          .filter((r) => r['Student Name'] === student.name && r['Day'] === day)
          .sort((a, b) => (parseTimeMinutes(a['Start Time']) || 0) - (parseTimeMinutes(b['Start Time']) || 0));
        rows.forEach((row) => {
          const chip = document.createElement('div');
          chip.className = 'chip chip-class';
          chip.innerHTML = `<div class="chip-time">${row['Start Time'] || ''} - ${row['End Time'] || ''}</div>`;
          td.appendChild(chip);
        });
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8">Could not load class schedule: ${err.message}</td></tr>`;
  }
}

// --- Generate ---
async function handleGenerate() {
  const semester = document.getElementById('semester-input').value.trim();
  const asOfDate = document.getElementById('asof-input').value;
  const statusEl = document.getElementById('generate-status');
  const gapsPanel = document.getElementById('gaps-panel');
  const gapsList = document.getElementById('gaps-list');
  const showGapsBtn = document.getElementById('show-gaps-btn');
  const btn = document.getElementById('generate-btn');

  if (!semester) {
    showStatus(statusEl, 'Semester is required.', 'error');
    return;
  }

  const overrideManual = document.getElementById('override-manual-checkbox').checked;
  const fullRegenerate = document.getElementById('full-regenerate-checkbox').checked;
  if (overrideManual) {
    const proceed = await appConfirm(
      `⚠ This will delete every manual shift for ${semester} and rebuild the whole schedule from scratch - manual edits will NOT survive this run. Continue?`,
      'warning'
    );
    if (!proceed) return;
  } else if (fullRegenerate) {
    const proceed = await appConfirm(
      `⚠ This rebuilds every generated shift for ${semester} from scratch, instead of only filling in what's new or changed - everyone's schedule may shuffle, not just new students'. Continue?`,
      'warning'
    );
    if (!proceed) return;
  }

  btn.disabled = true;
  showStatus(statusEl, 'Generating...', 'status');
  gapsPanel.hidden = true;
  showGapsBtn.hidden = true;
  showGapsBtn.textContent = 'View Uncovered Gaps';

  try {
    const result = await api.generateSchedule(semester, asOfDate || undefined, overrideManual, fullRegenerate);
    lastGaps = result.gaps;
    showStatus(
      statusEl,
      `Kept ${result.kept} existing shifts, added ${result.added}, removed ${result.removed}.` +
        (result.warnings.length ? ` Warnings: ${result.warnings.join(' ')}` : ''),
      'success'
    );
    if (result.gaps.length) {
      gapsList.innerHTML = result.gaps
        .map(
          (g) =>
            `<li${g.mandatory ? '' : ' class="gap-opportunistic"'}>${g.day} - ${g.location}: ${g.start} - ${g.end}, still need ${g.stillNeeded} more${g.mandatory ? '' : ' (opportunistic)'}</li>`
        )
        .join('');
      showGapsBtn.hidden = false;
    }
    document.getElementById('calendar-semester-input').value = semester;
    await loadCalendar();
    renderStatCards();
  } catch (err) {
    showStatus(statusEl, `Generate failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

// --- Add / Edit shift form ---
const SEMESTER_TERMS = [
  { name: 'Spring', startMonth: 0 },
  { name: 'Summer I', startMonth: 5 },
  { name: 'Summer II', startMonth: 6 },
  { name: 'Fall', startMonth: 7 },
  { name: 'Winter', startMonth: 11 },
];

function currentSemesterOptions() {
  const now = new Date();
  const todayKey = now.getFullYear() * 12 + now.getMonth();
  const options = [];
  for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
    SEMESTER_TERMS.forEach((term, i) => {
      const key = year * 12 + term.startMonth;
      const next = SEMESTER_TERMS[i + 1];
      const nextKey = next ? year * 12 + next.startMonth : (year + 1) * 12 + SEMESTER_TERMS[0].startMonth;
      if (nextKey > todayKey) options.push({ key, label: `${term.name} ${year}` });
    });
  }
  return options
    .sort((a, b) => a.key - b.key)
    .slice(0, 3)
    .map((o) => o.label);
}

function fillSemesterSelect(selectEl, selectedValue) {
  const options = currentSemesterOptions();
  if (selectedValue && !options.includes(selectedValue)) options.unshift(selectedValue);
  selectEl.innerHTML = options.map((s) => `<option value="${htmlEscape(s)}">${htmlEscape(s)}</option>`).join('');
  if (selectedValue) selectEl.value = selectedValue;
}

function resetShiftForm() {
  document.getElementById('shift-rowid').value = '';
  document.getElementById('shift-form-title').textContent = 'Add Shift (Manual)';
  document.getElementById('shift-submit-btn').textContent = 'Add shift';
  document.getElementById('shift-cancel-btn').hidden = true;
  document.getElementById('shift-form').reset();
  fillSemesterSelect(document.getElementById('shift-semester'), document.getElementById('calendar-semester-input').value);
}

function startEditShift(row) {
  document.getElementById('shift-rowid').value = row.rowId;
  document.getElementById('shift-form-title').textContent = `Edit Shift - ${row['Student Name']}`;
  document.getElementById('shift-submit-btn').textContent = 'Save changes';
  document.getElementById('shift-cancel-btn').hidden = false;
  document.getElementById('shift-student').value = row['Student Name'];
  document.getElementById('shift-day').value = row['Day'];
  document.getElementById('shift-location').value = row['Location'];
  document.getElementById('shift-start').value = to24Hour(row['Start Time']);
  document.getElementById('shift-end').value = to24Hour(row['End Time']);
  fillSemesterSelect(document.getElementById('shift-semester'), row['Semester']);
  document.getElementById('shift-notes').value = row['Notes'] || '';
  document.getElementById('shift-form-panel').scrollIntoView({ behavior: 'smooth' });
}

function duplicateShift(row) {
  resetShiftForm();
  document.getElementById('shift-student').value = row['Student Name'];
  document.getElementById('shift-day').value = '';
  document.getElementById('shift-location').value = row['Location'];
  document.getElementById('shift-start').value = to24Hour(row['Start Time']);
  document.getElementById('shift-end').value = to24Hour(row['End Time']);
  fillSemesterSelect(document.getElementById('shift-semester'), row['Semester']);
  document.getElementById('shift-notes').value = row['Notes'] || '';
  showStatus(document.getElementById('shift-form-status'), 'Pick the other day this repeats on, then submit.', 'success');
  document.getElementById('shift-form-panel').scrollIntoView({ behavior: 'smooth' });
}

async function deleteShift(row) {
  if (!(await appConfirm(`Delete ${row['Student Name']}'s ${row['Day']} ${row['Location']} shift?`))) return;
  try {
    await api.deleteWorkScheduleRow(row.rowId);
    await loadCalendar();
  } catch (err) {
    appAlert(`Could not delete shift: ${err.message}`);
  }
}

async function handleShiftFormSubmit(e) {
  e.preventDefault();
  const statusEl = document.getElementById('shift-form-status');
  const rowId = document.getElementById('shift-rowid').value;
  const payload = {
    studentName: document.getElementById('shift-student').value,
    day: document.getElementById('shift-day').value,
    location: document.getElementById('shift-location').value,
    startTime: to12Hour(document.getElementById('shift-start').value),
    endTime: to12Hour(document.getElementById('shift-end').value),
    semester: document.getElementById('shift-semester').value,
    notes: document.getElementById('shift-notes').value,
  };

  const workedMinutes = currentWorkScheduleRows
    .filter((r) => r['Student Name'] === payload.studentName && r['Semester'] === payload.semester)
    .filter((r) => !rowId || String(r.rowId) !== String(rowId))
    .reduce((sum, r) => sum + workedMinutesForShift(r['Start Time'], r['End Time']), 0);
  const projectedHours = (workedMinutes + workedMinutesForShift(payload.startTime, payload.endTime)) / 60;
  const capHours = capHoursFor(payload.studentName);
  if (projectedHours > capHours) {
    const proceed = await appConfirm(
      `⚠ This will put ${payload.studentName} at ${projectedHours.toFixed(1)} hrs this week - over their ${capHours} hr cap. Add it anyway?`,
      'warning'
    );
    if (!proceed) return;
  }

  try {
    if (rowId) {
      await api.updateWorkScheduleRow(rowId, payload);
      showStatus(statusEl, 'Shift updated.', 'success');
    } else {
      await api.addWorkScheduleRow(payload);
      showStatus(statusEl, 'Shift added.', 'success');
    }
    resetShiftForm();
    document.getElementById('calendar-semester-input').value = payload.semester;
    await loadCalendar();
  } catch (err) {
    showStatus(statusEl, `Could not save shift: ${err.message}`, 'error');
  }
}

// --- Time off ---
async function loadPendingTimeOff() {
  const tbody = document.querySelector('#time-off-table tbody');
  const emptyMsg = document.getElementById('time-off-empty');
  try {
    const rows = await api.getTimeOff();
    currentTimeOffRows = rows;
    const statusOrder = { Pending: 0, Approved: 1, Denied: 2 };
    const sorted = [...rows].sort((a, b) => (statusOrder[a['Status']] ?? 3) - (statusOrder[b['Status']] ?? 3));
    tbody.innerHTML = '';
    emptyMsg.hidden = sorted.length > 0;
    sorted.forEach((row) => {
      const status = row['Status'] || '';
      const isPending = status === 'Pending';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row['Student Name'] || ''}</td>
        <td>${row['Start Date'] || ''}</td>
        <td>${row['End Date'] || ''}</td>
        <td>${row['Reason'] || ''}</td>
        <td>${row['Submitted Date'] || ''}</td>
        <td>${htmlEscape(status)}</td>
        <td>
          ${isPending ? '<button type="button" class="approve-btn">Approve</button><button type="button" class="deny-btn">Deny</button>' : ''}
        </td>
      `;
      if (isPending) {
        tr.querySelector('.approve-btn').addEventListener('click', () => setTimeOffStatus(row.rowId, 'Approved'));
        tr.querySelector('.deny-btn').addEventListener('click', () => setTimeOffStatus(row.rowId, 'Denied'));
      }
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7">Could not load time-off requests: ${err.message}</td></tr>`;
  }
  renderStatCards();
}

async function setTimeOffStatus(rowId, status) {
  try {
    await api.setTimeOffStatus(rowId, status);
    await loadPendingTimeOff();
  } catch (err) {
    appAlert(`Could not update request: ${err.message}`);
  }
}

// --- Init ---
document.getElementById('generate-btn').addEventListener('click', handleGenerate);
document.getElementById('show-gaps-btn').addEventListener('click', (e) => {
  const gapsPanel = document.getElementById('gaps-panel');
  gapsPanel.hidden = !gapsPanel.hidden;
  e.target.textContent = gapsPanel.hidden ? 'View Uncovered Gaps' : 'Collapse Uncovered Gaps';
});
document.getElementById('refresh-calendar-btn').addEventListener('click', loadCalendar);
document.getElementById('copy-excel-btn').addEventListener('click', copyScheduleForExcel);
document.getElementById('refresh-class-schedule-btn').addEventListener('click', loadClassScheduleView);
document.getElementById('shift-form').addEventListener('submit', handleShiftFormSubmit);
document.getElementById('shift-cancel-btn').addEventListener('click', resetShiftForm);

document.getElementById('asof-input').valueAsDate = new Date();
fillSemesterSelect(document.getElementById('shift-semester'), document.getElementById('calendar-semester-input').value);

// Options filled from GET /api/seats, not hardcoded - see the comment on
// the <select> itself in manager.html.
function fillShiftLocationSelect() {
  const select = document.getElementById('shift-location');
  select.innerHTML = currentSeats.map((s) => `<option value="${htmlEscape(s.location)}">${htmlEscape(s.location)}</option>`).join('');
}

// loadSeats() has to finish before renderSeatLegend/fillShiftLocationSelect
// and the calendar render below, since all three now read currentSeats.
async function init() {
  await loadSeats();
  renderSeatLegend();
  fillShiftLocationSelect();
  loadRoster();
  loadCalendar();
  loadClassScheduleView();
  loadPendingTimeOff();
}
init();
