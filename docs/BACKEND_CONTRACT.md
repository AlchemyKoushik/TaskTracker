# Backend and sync contract

This document describes the service boundary between the Windows client, the VPS API, SQL storage, and n8n. The current HTTP request/response contract is also available in [`../contracts/openapi.json`](../contracts/openapi.json).

## Runtime modes

The same FastAPI application has two explicit modes:

| Mode | Database | Bind/access | Purpose |
|---|---|---|---|
| `local` | SQLite under `%LOCALAPPDATA%/TaskTracker/` | `127.0.0.1:8765` | Windows UI API, activity monitor, durable outbox, retrying sync client |
| `server` | SQLAlchemy URL in `DATABASE_URL` | VPS, behind HTTPS reverse proxy | Idempotent sync receiver, report API, published report links |

The local service never receives the SQL connection string. The central database URL and report/sync bearer tokens belong only in server environment variables. The Windows service receives the server API URL and sync token in its protected local configuration. The public report page receives only an unguessable share token.

All application tables use the `tt_` prefix. Startup calls SQLAlchemy `create_all`, which creates missing tables and has no table-drop or column-delete code path. Use a dedicated database if possible and inspect for existing `tt_*` names before first server startup. Schema evolution should move to reviewed, additive Alembic migrations after the SQL engine is confirmed.

## Record model

```text
Category Category 1 -> * Task 1 -> * TimeEntry * -> 1 Workday
                            TimeEntry 1 -> * ActivitySegment
```

- IDs are UUID strings generated locally. Central rows retain the same ID, so an upload retry updates the same row.
- A `Workday` starts with the first task. Its label is `local date` for starts at/after 05:00 and the previous date for starts before 05:00. It stays open through midnight and closes manually or at 05:00 on the following date.
- Each start creates a distinct `TimeEntry`; entries never span the automatic 05:00 cutoff.
- `ActivitySegment.kind` is `active`, `idle`, or `paused`. Each interval has UTC `started_at` and nullable UTC `ended_at`. The current open segment is not included in report totals until closed.
- `TimeEntry` stores materialized active/idle/paused integer-second totals for quick current/history views. The report engine derives totals from closed segments and clips none across calendar dates because the Workday label owns overnight periods.
- No schema captures input contents, coordinates, screen state, website state, or clipboard contents.

## Local API

Local UI routes and payload examples are in [`ANTIGRAVITY_HANDOFF.md`](ANTIGRAVITY_HANDOFF.md). The only inbound browser origin intended for the packaged renderer is `app://tasktracker`; Vite origins are allowlisted for development. Keep the service loopback-only.

Every important local mutation is committed with its outbox row before returning success. Sync occurs in the background, every configured interval, and by `POST /api/v1/sync/now`. A failed request leaves rows pending and records a sanitized error; it does not block task tracking.

## Sync request

`POST /api/v1/sync/push` on the server accepts an authenticated batch:

```json
{
  "records": [
    {
      "type": "category",
      "id": "<uuid>",
      "data": {
        "id": "<same uuid>",
        "name": "CRM",
        "color": null,
        "created_at": "2026-09-22T03:30:00+00:00",
        "updated_at": "2026-09-22T03:30:00+00:00",
        "archived": false
      }
    }
  ]
}
```

Allowed types: `category`, `task`, `workday`, `time_entry`, `activity_segment`. A batch is limited to 500 records. The receiver sorts parent types before dependent types, checks the envelope ID matches `data.id`, and merges the batch in one transaction. Repeating the same IDs is safe. The server never deletes a row during sync. A successful response is `{ "accepted": <count>, "idempotent": true }`.

The local outbox increments a revision whenever the same entity changes. After a successful upload, it only marks the exact revision sent; if the record changed while the request was in flight, the newer revision remains pending.

## VPS report API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/server/reports/publish` | `REPORT_API_TOKEN` bearer | Generate/update period snapshot and return share URL |
| GET | `/api/v1/server/reports/previous_week` | `REPORT_API_TOKEN` bearer | Previous Monday-Sunday data |
| GET | `/api/v1/server/reports/previous_month` | `REPORT_API_TOKEN` bearer | Previous calendar-month Workdays |
| GET | `/api/v1/public/reports/{token}` | Share token | Read-only report data for the dashboard |

Publish request:

```json
{ "period": "previous_week" }
```

The only accepted period values are `previous_week` and `previous_month`. Publishing is idempotent for each period key. The same tokenized URL is returned for repeat publishes of the same period. The URL is formed with `PUBLIC_DASHBOARD_URL`; the dashboard's `/report/:shareToken` route fetches the JSON from `/api/v1/public/reports/:shareToken`.

The central database stores only a hash of each report share token. Token derivation uses `PUBLIC_REPORT_SIGNING_KEY`; keep it stable to preserve issued links. The public token is a bearer link intended for report recipients. Do not expose either API bearer token to browser code.

`is_final` is false while the server knows a Workday or activity segment is open in the report range. Reports count only closed activity segments, so an unobserved shutdown interval cannot be counted as active time. When late offline records arrive, sync refreshes saved report snapshots; previously emailed links then show the newer data.

## Error semantics

- `400`: invalid date range or report period.
- `401`: missing/invalid server bearer token.
- `404`: unknown task/session/workday or invalid share token.
- `409`: invalid current task state or duplicate category/task.
- `422`: malformed request body or sync ID mismatch.
- `503`: database/sync/report service unavailable; clients may retry safely for sync and report publish.

Errors do not include database URLs, tokens, SQL statements, or stack traces.

