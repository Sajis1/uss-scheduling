const express = require('express');
const { getRows, addRow } = require('../smartsheetClient');

const router = express.Router();

// GET /api/time-off?student=Name -> that student's time-off requests.
// GET /api/time-off -> every request (used by the Phase 2/3 manager views).
router.get('/', async (req, res) => {
  try {
    const rows = await getRows(process.env.TIME_OFF_SHEET_ID);
    const { student } = req.query;
    const filtered = student
      ? rows.filter((row) => row['Student Name'] === student)
      : rows;
    res.json(filtered);
  } catch (err) {
    console.error('GET /api/time-off failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/time-off -> submit a new request. Status always starts Pending;
// approval happens entirely via the "Time Off Approval" Smartsheet
// Automation (see below), not here.
router.post('/', async (req, res) => {
  try {
    const { studentName, startDate, endDate, reason } = req.body;
    if (!studentName || !startDate || !endDate) {
      return res
        .status(400)
        .json({ error: 'studentName, startDate, and endDate are required.' });
    }
    const submittedDate = new Date().toISOString().slice(0, 10);
    const row = await addRow(process.env.TIME_OFF_SHEET_ID, {
      // Calendar Title is what the approval automation displays as the
      // requester's name ({{Calendar Title}} in its email) - it's a plain
      // column, not a formula, so the backend has to set it directly or
      // every approval email shows a blank name.
      'Calendar Title': studentName,
      'Student Name': studentName,
      'Start Date': startDate,
      'End Date': endDate,
      Reason: reason || '',
      Status: 'Pending',
      'Submitted Date': submittedDate,
      // Email is NOT written here - it's a Smartsheet formula on this sheet
      // (INDEX/MATCH against Student Master's Email by Student Name), so it
      // self-populates once Student Master's own Email column has real
      // values. Smartsheet's API rejects any direct write to a formula
      // cell (this is exactly what broke submission until 2026-09-29 -
      // "Smartsheet API error (400): You cannot edit cells with Column
      // Formula").
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST /api/time-off failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Approval itself happens entirely in Smartsheet now (the "Time Off
// Approval" automation on this sheet: routes to IT PMO Mailbox by
// Supervisor, records the response, then sets Status) - there is
// deliberately no backend endpoint that writes Status. A PATCH
// /:rowId/status route used to let the manager dashboard set it directly;
// removed 2026-09-29 once that Smartsheet workflow was confirmed built and
// authoritative, so a second write path was no longer wanted. Status is a
// plain TEXT_NUMBER column (confirmed via the Smartsheet API's own column
// metadata, 2026-09-29) - an earlier version of this comment guessed
// multi-select from the automation UI's wording alone, which was wrong.

module.exports = router;
