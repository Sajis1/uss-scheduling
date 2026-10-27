# USS Service Desk Student Worker Scheduling System

Internal tool for USS Service Desk to manage student worker class
schedules, time-off requests, and automatic work schedule generation.
Sibling to the LITS tool in this same repo — built the same way (copy a
proven backbone, adapt), but does **not** share a scheduler engine, since
the two departments' rules are structurally too different.

## Architecture

- **Smartsheet is the single source of truth.** There is no separate database.
- **`backend/`** is a small Express API — the only thing that talks to the
  Smartsheet API directly, since it holds the API token as a server-side
  secret.
- **`frontend/`** is plain HTML/CSS/JS, no build step, no framework.
- **No login / authentication system.** Same accepted tradeoff as LITS/PMO.
- **Not deployed yet** — local-only as of 2026-10-13.

```
frontend (HTML/CSS/JS) --> backend (Express) --> Smartsheet API
```

## What makes Service Desk different from LITS/PMO

- **7-day week**, Monday-Thursday to 10pm, Friday-Sunday to 7:30pm.
- **6 seats, not 3** (`M-Th Remote`, `Friday Remote`, `Saturday`, `Sunday`,
  `Acad 700`, `S817`), several needing a **different number of concurrent
  people depending on time of day** — M-Th Remote needs 1 person 6-8pm,
  then 2 from 8-10pm. LITS/PMO never had to solve this; see
  `backend/src/scheduler.js` for the "demand curve" fill model this needed.
- **No split shifts** (opposite of LITS, same as PMO) — one continuous
  shift per student per day.
- **19.75-hour weekly cap**, confirmed a hard ceiling (not a floor) despite
  the original draft doc's ambiguous wording.
- **A floater concept**: any student flagged `Floater: true` can back up
  any seat outside their own Role once their own seat's need is met - not
  a 4th Role value, a separate flag, and universal across all 3 Roles
  (changed 2026-10-14 from an earlier On-Campus-only, one-directional
  design once live data showed Remote-role students had no path to more
  hours otherwise).

## Where the real detail lives

- **[COVERAGE-POLICY.md](COVERAGE-POLICY.md)** — the scheduling rules, how
  the generator decides, and the open questions still worth confirming
  (Monday-overfill's exact seat, the role-to-seat mapping for the 3
  remaining On-Campus seats).
- **[SMARTSHEET-COLUMNS.md](SMARTSHEET-COLUMNS.md)** — the column spec the
  code currently expects. The sheets themselves now exist, but the column
  names here are still unverified guesses pending a real screenshot check.

## Setup

### 1. The Smartsheet sheets

**The 4 core sheets exist and the backend is live-verified against them**
(connected 2026-10-14). That check caught and fixed 2 real bugs —
`Expected Grad` vs. an assumed `Course/Notes`, `Employee ID` vs. an assumed
`Student ID` — both documented in `SMARTSHEET-COLUMNS.md`. A 5th sheet,
"USS Service Desk - Supervisors," also exists but isn't wired in yet — see
that doc for why (held off on purpose, pending the time-off approval
question).

**Role and Floater are blank for every real student right now** — not a
code bug, just not filled in yet. Generate Schedule will exclude everyone
and warn about it until that's done.

### 2. Configure the backend

```
cd backend
copy .env.example .env
```

`backend/.env` already has the real sheet IDs and token filled in:

```
SMARTSHEET_API_TOKEN=(already set)
STUDENT_MASTER_SHEET_ID=2060931602534276
CLASS_SCHEDULE_SHEET_ID=237938890985348
TIME_OFF_SHEET_ID=7068925461483396
WORK_SCHEDULE_SHEET_ID=7580181188530052
PORT=3002
```

### 3. Run the backend

```
cd backend
npm install
npm start
```

Visit `http://localhost:3002/api/health` — it should return `{"ok":true}`.

### 4. Run the frontend

No build step. Open `frontend/index.html` (student portal) or
`frontend/manager.html` (manager dashboard) directly in a browser.
`frontend/js/api.js` points at `http://localhost:3002` automatically when
opened as a local `file://` page.

## Deployment

**Not deployed yet.** Once ready, same pattern as LITS:
[`vercel.json`](vercel.json) is already in place (Root Directory would be
`service-desk/` in Vercel's project settings, since this repo holds LITS
alongside it); push to `main` on the shared `uss-scheduling` GitHub repo to
auto-deploy.

## Backend API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Liveness check. |
| GET | `/api/students` | Active students, for the student portal's name dropdown. |
| GET | `/api/students/roster` | Every student with Role/Floater/Max Hours/etc. |
| GET | `/api/class-schedule?student=Name` | A student's submitted class/unavailable blocks. |
| POST/PUT/DELETE | `/api/class-schedule[/:rowId]` | Add/edit/delete a block. |
| GET | `/api/time-off?student=Name` | Time-off requests. |
| POST | `/api/time-off` | Submit a new request (Status starts Pending). |
| PATCH | `/api/time-off/:rowId/status` | Manager approves/denies a request — **still under discussion**, may be removed in favor of a pure Smartsheet automation, same as LITS. |
| GET | `/api/work-schedule?student=&semester=` | Work Schedule rows, optionally filtered. |
| POST | `/api/work-schedule/generate` | Runs the scheduler for a semester/asOfDate. |
| POST/PUT/DELETE | `/api/work-schedule[/:rowId]` | Manually add/edit/delete one shift (always `Source: Manual`). |

## What's NOT done yet

- **Monday-overfill bonus pass** — confirmed to exist (bonus capacity,
  capped at 2 extra), but which physical seat it adds to was never named.
  Stubbed, not guessed at.
- **The role-to-seat mapping for the 3 remaining On-Campus seats** (Acad
  700/Monday-overfill/S817 all being one pool, differentiated by fill
  order) is this doc's best read of the notes, not confirmed
  sentence-by-sentence. (Saturday/Sunday were corrected out of this pool
  and into `Remote Weekend` on 2026-10-27.)
- No deployment, no real Smartsheet sheets, no git commit yet as of
  2026-10-13.
