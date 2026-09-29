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
// approval/denial happens later (manager dashboard in Phase 2/3), not here.
router.post('/', async (req, res) => {
  try {
    const { studentName, startDate, endDate, reason, email } = req.body;
    if (!studentName || !startDate || !endDate) {
      return res
        .status(400)
        .json({ error: 'studentName, startDate, and endDate are required.' });
    }
    const submittedDate = new Date().toISOString().slice(0, 10);
    const row = await addRow(process.env.TIME_OFF_SHEET_ID, {
      'Student Name': studentName,
      'Start Date': startDate,
      'End Date': endDate,
      Reason: reason || '',
      Status: 'Pending',
      'Submitted Date': submittedDate,
      // Feeds the "Time-off status update" Smartsheet Automation, which
      // alerts whoever's in this column when Status changes.
      Email: email || '',
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
// authoritative, so a second write path was no longer wanted. Note: Status
// is a multi-select column on the real sheet, not a plain dropdown - if this
// endpoint is ever reintroduced, `updateRow` would need to send an array
// value, not a bare string.

module.exports = router;
