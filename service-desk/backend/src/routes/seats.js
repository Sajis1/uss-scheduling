const express = require('express');
const { getRows } = require('../smartsheetClient');
const { buildSeatsFromRows, summarizeSeats } = require('../seatsConfig');

const router = express.Router();

// GET /api/seats -> every active location's days/hours/pool/category, for
// the manager dashboard's dropdowns, calendar grouping, and legend. Reads
// the same Seats Configuration sheet the generator itself uses, so the
// frontend never drifts from what Generate actually schedules against.
router.get('/', async (req, res) => {
  try {
    const rows = await getRows(process.env.SEATS_CONFIG_SHEET_ID);
    const { seats, warnings } = buildSeatsFromRows(rows);
    res.json({ seats: summarizeSeats(seats), warnings });
  } catch (err) {
    console.error('GET /api/seats failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
