# USS LITS Student Worker Scheduling System

Internal tool for USS LITS to manage student worker class schedules, time-off
requests, and automatic work schedule generation. Forked from the working UHD
PMO version of this tool and adapted for LITS's own rules — the two are
separate, independently deployed projects that don't share code going forward.

## Architecture

- **Smartsheet is the single source of truth.** There is no separate database.
- **`backend/`** is a small Express API. It is the *only* thing that ever talks
  to the Smartsheet API directly, because it holds the Smartsheet API token as
  a server-side secret. It exposes a small REST API of its own to the frontend.
- **`frontend/`** is plain HTML/CSS/JS with no build step and no framework —
  open the files directly, no tooling knowledge required.
- **No login / authentication system.** Students pick their own name from a
  dropdown (Student Master, filtered to `Active`); the manager dashboard has
  no login either. Same accepted tradeoff PMO's tool made.
- **Deployed and live** on Vercel — see "Deployment" below.

```
frontend (HTML/CSS/JS) --> backend (Express) --> Smartsheet API
```

## Two things this backend deliberately does NOT do

Both used to be backend-driven and were removed 2026-09-29 once it turned
out Smartsheet was already handling them natively — see COVERAGE-POLICY.md
for the full story on each:

- **New-hire roster sync.** A Smartsheet Automation on the shared IT Student
  Worker Tracker ("Copy new USS-LITS students to Student Master") copies a
  row in whenever `IT Unit` changes to `USS-LITS`. A backend
  `POST /api/students/sync` route used to do the same job a different way;
  removed once the automation was confirmed still active, to avoid two
  mechanisms both adding new students.
- **Time-off approval.** A Smartsheet Automation on Time Off Requests routes
  every new request to a shared approval mailbox (branched by Supervisor),
  records the response, and sets `Status`. The manager dashboard shows time
  off read-only; it no longer has its own Approve/Deny buttons.

## Where the real detail lives

This README is the map. The actual rules and schema live in two dedicated docs
— read those before changing scheduling behavior or the Smartsheet sheets:

- **[COVERAGE-POLICY.md](COVERAGE-POLICY.md)** — the scheduling rules
  (desks, hour caps, fill priority, how the generator actually decides), plus
  open questions not yet confirmed with the team.
- **[SMARTSHEET-COLUMNS.md](SMARTSHEET-COLUMNS.md)** — the exact, as-built
  column spec for all 5 sheets, including which columns are Smartsheet
  formulas vs. manually maintained.

## Setup

### 1. Get the Smartsheet sheet IDs and API token

You don't create the sheets from scratch — see `SMARTSHEET-COLUMNS.md` for
what already exists (Student Master, Unavailable Schedule, Time Off Requests,
Work Schedule, Supervisors). Get each sheet's ID (right-click the tab →
Properties, or "Sheet ID" via the Smartsheet app), and generate an API
token: Smartsheet account → **Apps & Integrations → API Access → Generate
new access token**.

The shared IT Student Worker Tracker isn't one of this backend's env vars —
new hires reach Student Master via a Smartsheet Automation on the Tracker
itself (Copy Row, triggered on `IT Unit` → `USS-LITS`), not through this app.

### 2. Configure the backend

```
cd backend
copy .env.example .env
```

Fill in `.env`:

```
SMARTSHEET_API_TOKEN=your_token_here
STUDENT_MASTER_SHEET_ID=your_sheet_id_here
CLASS_SCHEDULE_SHEET_ID=your_sheet_id_here
TIME_OFF_SHEET_ID=your_sheet_id_here
WORK_SCHEDULE_SHEET_ID=your_sheet_id_here
SUPERVISORS_SHEET_ID=your_sheet_id_here
PORT=3001
```

### 3. Run the backend

```
cd backend
npm install
npm start
```

Visit `http://localhost:3001/api/health` — it should return `{"ok":true}`.

### 4. Run the frontend

No build step. Open `frontend/index.html` (student portal) or
`frontend/manager.html` (manager dashboard) directly in a browser, or serve
the folder with any static file server. `frontend/js/api.js` points at
`http://localhost:3001` automatically when opened as a local `file://` page;
once deployed, it uses a relative path since frontend and API share one
Vercel domain.

## Deployment

Live on **Vercel**, project under the `student-worker-app` account.

- **How it deploys:** [`vercel.json`](vercel.json) tells Vercel to run
  `backend/server.js` as a serverless function (mounted at `/api/*`) and
  serve `frontend/` as static files. The Vercel project's **Root Directory**
  is set to `lits/`, since the parent `uss-scheduling` repo will eventually
  also hold USS Service Desk alongside this. Every push to `main` on
  [`github.com/Sajis1/uss-scheduling`](https://github.com/Sajis1/uss-scheduling)
  auto-triggers a redeploy — no separate manual deploy step.
- **Environment variables live in Vercel, not in this repo** — Project →
  Settings → Environment Variables. Same 6 keys as the local `.env` above.
  **Adding or changing a variable does not affect an already-running
  deployment** — trigger a redeploy afterward (Deployments tab → latest →
  `...` → Redeploy) for it to take effect.
- **Live URLs:**
  - Manager Dashboard: https://uss-scheduling.vercel.app/manager.html
  - Student Portal: https://uss-scheduling.vercel.app/

## Backend API (frontend-facing, not Smartsheet's own API)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Liveness check, returns `{"ok":true}`. |
| GET | `/api/students` | Active students, for the student portal's name dropdown. |
| GET | `/api/students/roster` | Every student with Role/Max Hours/etc. — manager dashboard and scheduler only. |
| GET | `/api/class-schedule?student=Name` | A student's submitted class/unavailable blocks. |
| POST/PUT/DELETE | `/api/class-schedule[/:rowId]` | Add/edit/delete a class block. |
| GET | `/api/time-off?student=Name` | Time-off requests (read-only — see below). |
| POST | `/api/time-off` | Submit a new request (Status starts Pending). |
| GET | `/api/work-schedule?student=&semester=` | Work Schedule rows, optionally filtered. |
| POST | `/api/work-schedule/generate` | Runs the scheduler for a semester/asOfDate; replaces that semester's Generated rows, leaves Manual rows untouched (unless `overrideManual: true`). |
| POST/PUT/DELETE | `/api/work-schedule[/:rowId]` | Manually add/edit/delete one shift (always `Source: Manual`). |
| GET | `/api/supervisors` | Shared supervisor contact list — manager dashboard's Excel export only. |

## What's NOT done yet

- The scheduling algorithm is a greedy heuristic, not a globally-optimal
  solver.
- USS Service Desk (`uss-scheduling/service-desk/`) doesn't exist yet — this
  repo currently holds only LITS.
- No request locking/concurrency control (two people editing the same shift
  at once is last-write-wins) — same tradeoff as the no-auth decision.
- See COVERAGE-POLICY.md's "Open questions" for scheduling-rule specifics
  still pending confirmation with the team (per-desk headcount, weekly-hour
  floor, the dual time-off approval paths, etc).
