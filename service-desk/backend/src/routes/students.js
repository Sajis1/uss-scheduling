const express = require('express');
const { getRows } = require('../smartsheetClient');

const router = express.Router();

// GET /api/students -> active students, for the "pick your name" dropdown.
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
//
// `floater` is only meaningful for Role = 'On Campus' - true means this
// student can also back up the two Remote seats (see COVERAGE-POLICY.md's
// "Roles and the floater flag"). Column names confirmed against the real
// Student Master sheet 2026-10-14 - Role (Picklist) and Floater (Checkbox)
// both exist exactly as expected, just not filled in for anyone yet.
router.get('/roster', async (req, res) => {
  try {
    const rows = await getRows(process.env.STUDENT_MASTER_SHEET_ID);
    const roster = rows
      .map((row) => ({
        name: row['Student Name'],
        studentId: row['Employee ID'],
        active: row['Active'] === true,
        role: row['Role'],
        floater: row['Floater'] === true,
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

module.exports = router;
