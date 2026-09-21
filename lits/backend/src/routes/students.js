const express = require('express');
const { getRows, addRows } = require('../smartsheetClient');

const router = express.Router();

// GET /api/students -> active students, for the "pick your name" dropdown.
// `Active` is formula-driven off the shared IT Student Worker Tracker's
// "Actively Employed" column (=IF(...="Yes",1,0)) - this comparison only
// works if Active is a real Checkbox-type column in Smartsheet (checkbox
// columns normalize 1/0 to true/false at the API level even when driven by
// a formula). If Active is a Text/Number column instead, this filter will
// silently match nobody - confirm the column type if the roster ever comes
// back empty.
router.get('/', async (req, res) => {
  try {
    const rows = await getRows(process.env.STUDENT_MASTER_SHEET_ID);
    const activeStudents = rows
      .filter((row) => row['Active'] === true)
      .map((row) => ({
        name: row['Student Name'],
        studentId: row['Employee ID'],
        email: row['Email'],
      }))
      .filter((student) => student.name);
    res.json(activeStudents);
  } catch (err) {
    console.error('GET /api/students failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/students/roster -> every student (active or not) with the fields
// the manager dashboard and scheduler need. Deliberately separate from GET /
// above, which intentionally hides Role from the student portal.
router.get('/roster', async (req, res) => {
  try {
    const rows = await getRows(process.env.STUDENT_MASTER_SHEET_ID);
    const roster = rows
      .map((row) => ({
        name: row['Student Name'],
        studentId: row['Employee ID'],
        email: row['Email'],
        active: row['Active'] === true,
        role: row['Role'],
        maxHours: row['Max Hours'],
        extension: row['Extension'],
        phone: row['Phone'],
      }))
      .filter((student) => student.name);
    res.json(roster);
  } catch (err) {
    console.error('GET /api/students/roster failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/students/sync -> pull newly-assigned USS-LITS workers from the
// shared IT Student Worker Tracker into Student Master. Explicitly NOT a
// Smartsheet Copy Row automation - Student Master must stay a clean fixed
// schema, so this inserts a bare row containing ONLY Employee ID for each
// tracker row that's new, nothing else copied over, and never touches an
// existing Student Master row. Student Master's other columns (Student
// Name, First/Last Name, IT Unit, Supervisor, Active, Role) are already
// Smartsheet column formulas keyed on Employee ID, so they self-populate
// the moment the bare row lands - the backend never writes them directly.
router.post('/sync', async (req, res) => {
  try {
    const [trackerRows, studentRows] = await Promise.all([
      getRows(process.env.IT_TRACKER_SHEET_ID),
      getRows(process.env.STUDENT_MASTER_SHEET_ID),
    ]);

    const existingEmployeeIds = new Set(
      studentRows.map((row) => row['Employee ID']).filter(Boolean).map(String)
    );

    // Set() dedupes in case the tracker ever has more than one row for the
    // same Employee ID.
    const trackerEmployeeIds = new Set(
      trackerRows
        .filter((row) => row['IT Unit'] === 'USS-LITS')
        .map((row) => row['Employee ID'])
        .filter(Boolean)
        .map(String)
    );

    const newEmployeeIds = [...trackerEmployeeIds].filter((id) => !existingEmployeeIds.has(id));

    if (newEmployeeIds.length === 0) {
      return res.json({ added: 0, employeeIds: [] });
    }

    await addRows(
      process.env.STUDENT_MASTER_SHEET_ID,
      newEmployeeIds.map((employeeId) => ({ 'Employee ID': employeeId }))
    );

    res.json({ added: newEmployeeIds.length, employeeIds: newEmployeeIds });
  } catch (err) {
    console.error('POST /api/students/sync failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
