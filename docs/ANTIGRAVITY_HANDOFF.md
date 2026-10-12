# Antigravity UI integration contract

The Python service in this repository owns tracking, persistence, idle detection, workday boundaries, sync, and report data. Antigravity owns all visual design, UX, and frontend implementation. Keep the service API as the integration contract; do not move tracking calculations into the browser.

## Runtime connection

- Desktop web UI origin: `http://127.0.0.1:8765`.
- Interactive API documentation: `http://127.0.0.1:8765/docs`.
- OpenAPI JSON: `http://127.0.0.1:8765/openapi.json`.
- Checked-in OpenAPI snapshot: [`../contracts/openapi.json`](../contracts/openapi.json). Regenerate with `py -3 scripts/export_openapi.py` after API contract changes.
- JSON API prefix: `/api/v1`.
- Local API binds to loopback and requires no browser credential. It is a same-user desktop service, not a LAN service.
- Start the Python service as an Electron/Tauri child process; wait for `GET /health` before loading the UI. Stop the child process on app exit. Configure the Windows login startup behavior in the native desktop shell.
- Use the native shell to expose system tray, launch-at-login, and notifications. The Python service does not implement a visual tray.

## Required screen state

On launch, request `GET /api/v1/bootstrap`. It returns the timezone, idle/cutoff settings, task/category index, current workday, and active/idle/paused entry if present. Refresh state after any mutation and when the window regains focus. Do not assume the renderer stays alive while the service tracks time.

Current entry states are `running`, `idle`, or `paused`. `current_segment.kind` is `active`, `idle`, or `paused`; the service detects transitions. Render `active_seconds`, `idle_seconds`, and `paused_seconds` independently. The 5:00 AM cutoff is local to the configured timezone. Midnight does not close a workday.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Readiness/mode check |
| GET | `/api/v1/bootstrap` | Initial app state and indexes |
| GET | `/api/v1/current` | Refresh current task/workday state |
| GET | `/api/v1/categories` | List active categories |
| POST | `/api/v1/categories` | Create category: `{ "name": "CRM", "color": "#..." }` |
| GET | `/api/v1/tasks?q=calling&limit=30` | Search reusable tasks |
| POST | `/api/v1/tasks` | Create task: `{ "name": "Calling Workflow Design", "category_id": "<uuid>", "notes": null }` |
| POST | `/api/v1/tasks/start` | Start task: `{ "task_id": "<uuid>" }` |
| POST | `/api/v1/tasks/pause` | Pause current session |
| POST | `/api/v1/tasks/resume` | Resume paused session |
| POST | `/api/v1/tasks/wrap-up` | Close current session; workday remains open |
| POST | `/api/v1/workday/wrap-up` | Close current session and the workday |
| GET | `/api/v1/workdays?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` | Previous workday details and totals |
| GET | `/api/v1/reports/previous_week` | Previous Monday-Sunday report data |
| GET | `/api/v1/reports/previous_month` | Previous calendar month report data |
| GET | `/api/v1/reports/custom?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` | Custom range report data (use any `period` path value) |
| GET | `/api/v1/settings` | Read local settings |
| PATCH | `/api/v1/settings` | Update, e.g. `{ "idle_threshold_seconds": 120 }` |
| GET | `/api/v1/sync/status` | Pending count and last sync status |
| POST | `/api/v1/sync/now` | Request immediate sync |

## Response shape and behavior

- Collections return `{ "items": [...] }`.
- Start/pause/resume returns `{ "current_entry": { ... } }`.
- Wrap current returns `{ "closed_entry": { ... }, "current_entry": null }`.
- `409` means the requested operation conflicts with current state or a duplicate task/category exists. Duplicate responses include the existing record `id` when available; offer the existing item to the user.
- `404` means the requested active task/session/workday does not exist.
- Validation errors use FastAPI's standard `detail` shape. Domain errors use `{ "error": "code", "message": "human-readable explanation" }`.
- IDs are UUID strings. All timestamps are ISO 8601 with UTC offset. Workday `work_date` is a date string and has its own `timezone`.
- Time totals are integer seconds. Format them in the UI; do not recompute or persist totals from browser timers.
- The service continues tracking while the UI is closed. A detected laptop sleep or process restart pauses an open session, so sleep/shutdown time cannot be counted as active time. Show the paused state and let the user resume or wrap it.
- Never collect key content, coordinates, screenshots, window titles, URLs, or clipboard data. The operating system signal is only the age of the last input event.

## Report data shape

`GET /api/v1/reports/...` returns:

```json
{
  "period": "previous_week",
  "range": { "start_date": "2026-09-14", "end_date": "2026-09-20", "timezone": "Asia/Kolkata" },
  "generated_at": "2026-09-21T00:00:00+00:00",
  "is_final": true,
  "completeness": { "open_workdays": 0, "open_segments": 0 },
  "summary": {
    "active_seconds": 104460,
    "idle_seconds": 7800,
    "paused_seconds": 1200,
    "task_count": 8,
    "category_count": 3,
    "workday_count": 5,
    "time_entry_count": 13
  },
  "categories": [{
    "id": "<uuid>", "name": "CRM", "active_seconds": 30000,
    "idle_seconds": 1200, "paused_seconds": 0,
    "tasks": [{ "id": "<uuid>", "name": "Calling Workflow Design", "active_seconds": 30000, "idle_seconds": 1200, "paused_seconds": 0 }]
  }],
  "daily": [{ "date": "2026-09-14", "active_seconds": 12000, "idle_seconds": 600, "paused_seconds": 0 }],
  "timeline": [{ "entry_id": "<uuid>", "task_id": "<uuid>", "task_name": "Calling Workflow Design", "category_id": "<uuid>", "category_name": "CRM", "kind": "active", "started_at": "2026-09-14T04:00:00+00:00", "ended_at": "2026-09-14T05:00:00+00:00", "duration_seconds": 3600 }]
}
```

The report screen may present this data with the visual language Antigravity chooses. It should show idle time separately and never add it to active totals. Daily buckets use the Workday label, so after-midnight work stays with the Workday that began before midnight and is included in that Workday's weekly/monthly range. Only closed activity segments enter reports; once late offline data syncs, the server refreshes published report snapshots for the affected history, so the same share link shows the newer data. `is_final: false` indicates the server knows of an open Workday/segment in that range; show a provisional label. Public dashboard route: `/report/:shareToken`; fetch its data from `GET /api/v1/public/reports/:shareToken`.

## Suggested UI flow

1. Boot by loading `/bootstrap`; display the current task state and sync indicator.
2. Search existing work with `/tasks?q=...`; create a task only when needed.
3. Start with `/tasks/start`; refresh state from its response.
4. Reflect service-provided `running`/`idle`/`paused` state. Let the service determine idle transitions.
5. Separate task wrap-up from day wrap-up in both wording and confirmation.
6. Show sync pending count from `/sync/status`; offer “Sync now” without blocking task actions.
7. Fetch historical summaries from `/workdays` and report data from `/reports`.
