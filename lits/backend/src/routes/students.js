const express = require('express');
const { getRows } = require('../smartsheetClient');

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

// New USS-LITS workers reach Student Master via a Smartsheet Automation on
// the shared IT Student Worker Tracker ("Copy new USS-LITS students to
// Student Master": IT Unit changes to USS-LITS -> copy row), not through
// this backend. A POST /api/students/sync route used to duplicate that same
// job (Employee-ID-only insert, no Copy Row) - removed 2026-09-29 once it
// was confirmed the Tracker automation was still active the whole time, so
// the two were redundant and risked double-inserting a new hire.

module.exports = router;
