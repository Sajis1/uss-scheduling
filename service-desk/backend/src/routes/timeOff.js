const express = require('express');
const { getRows, addRow, updateRow } = require('../smartsheetClient');

const router = express.Router();

// GET /api/time-off?student=Name -> that student's time-off requests.
// GET /api/time-off -> every request (manager dashboard).
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

// POST /api/time-off -> submit a new request. Status always starts Pending.
// Confirmed 2026-10-14 against the real sheet: Email and Supervisor are both
// formula columns there (same as LITS's), so they're deliberately NOT
// written here - a direct write to a formula cell fails outright. Calendar
// Title, however, is a plain column (not a formula) - this is exactly the
// bug LITS had (its own Calendar Title went unwritten for weeks, leaving
// every approval email showing a blank requester name), so it's written
// here from day one instead of waiting to rediscover it.
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
      'Calendar Title': studentName,
      'Student Name': studentName,
      'Start Date': startDate,
      'End Date': endDate,
      Reason: reason || '',
      Status: 'Pending',
      'Submitted Date': submittedDate,
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('POST /api/time-off failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/time-off/:rowId/status -> manager approves or denies a
// request. The feature doc itself is NOT settled on this ("Pending
// Time-Off approvals - approve or deny in one click" annotated "I think we
// will do this manually - we are discussing it") - see COVERAGE-POLICY.md's
// "Time off" section. Built per the drafted spec for now; remove this
// route (and the dashboard's approve/deny buttons) if that discussion
// lands on a pure-Smartsheet-automation approach instead, same place LITS
// ended up.
router.patch('/:rowId/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (status !== 'Approved' && status !== 'Denied') {
      return res.status(400).json({ error: 'status must be "Approved" or "Denied".' });
    }
    const row = await updateRow(process.env.TIME_OFF_SHEET_ID, Number(req.params.rowId), {
      Status: status,
    });
    res.json(row);
  } catch (err) {
    console.error('PATCH /api/time-off/:rowId/status failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
