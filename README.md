# TaskTracker & Automatic Reporting System

Backend foundation for a local-first Windows work tracker. The visual UI is intentionally delegated to Antigravity; its complete integration brief is [`ANTIGRAVITY_PROMPT.md`](ANTIGRAVITY_PROMPT.md), UI API walkthrough is [`docs/ANTIGRAVITY_HANDOFF.md`](docs/ANTIGRAVITY_HANDOFF.md), backend/sync/report contract is [`docs/BACKEND_CONTRACT.md`](docs/BACKEND_CONTRACT.md), and machine-readable API contract is [`contracts/openapi.json`](contracts/openapi.json).

## Architecture

- Windows UI/shell: Antigravity implementation; it starts the local Python service and talks to `127.0.0.1:8765`.
- Local service: FastAPI + SQLite under `%LOCALAPPDATA%/TaskTracker/`; observes only the age of the last Windows input event.
- VPS API: same service in `APP_MODE=server`, with `DATABASE_URL` and bearer tokens kept in the server environment.
- Sync: UUID-stable category/task/workday/time-entry/segment records are queued locally and retried idempotently through `/api/v1/sync/push`.
- Reports: shared previous-week/month JSON aggregation; n8n can fetch/publish data and send the resulting share link. The frontend report page is hosted on the VPS.
- SQL tables use a `tt_` prefix to reduce collision risk in the existing hosted database. Startup only creates missing application tables; it has no drop/alter/delete path.

## Run the local API & Desktop App

Requires Python 3.11+ and Node.js 20+.

1. Install Python dependencies:
   ```powershell
   py -3 -m venv .venv
   .venv\Scripts\python.exe -m pip install -r requirements.txt
   ```
2. Install UI dependencies:
   ```powershell
   cd ui
   npm install
   ```
3. Start the Desktop App in development mode (this will spawn the Python backend automatically):
   ```powershell
   npm run dev
   ```

## Package the Windows Desktop App

To build a standalone installer or unpacked app for Windows:

```powershell
cd ui
npm run dist
```
This uses Electron Builder. The output executable will be inside the `ui/release/` directory. The packaged app bundles the local Python backend, creates its SQLite database at `%LOCALAPPDATA%\TaskTracker\tasktracker.sqlite3`, and gracefully shuts down its child processes on exit.

## VPS Report Dashboard

The production Docker image builds the React frontend and serves it from the FastAPI process. Put the container behind HTTPS at `PUBLIC_DASHBOARD_URL` (for this deployment: `https://tracker.alchemy-research.com`) and route `/api/v1` to the same container. Browser routes such as `/report/:shareToken` are handled by the built-in SPA fallback. The browser only calls the unauthenticated public-report endpoint; private report and sync tokens stay server-side/n8n-side.


## VPS API setup

1. Create a `.env` on the VPS from `.env.example`; set `APP_MODE=server`, the database URL, unique `SYNC_API_TOKEN` and `REPORT_API_TOKEN`, `PUBLIC_REPORT_SIGNING_KEY`, and `PUBLIC_DASHBOARD_URL`.
2. Use a dedicated database where possible. The app creates only its own `tt_*` tables and never drops tables or alters/deletes existing data. Review the table list and SQL engine support before first deployment.
3. Put the service behind the VPS's TLS reverse proxy. Keep port 8765 private; expose only HTTPS through the proxy. Do not publish the database port.
4. Run `docker compose up --build -d` from the project directory. Check `/health` and `/docs` through the private/admin route.
5. Enter `SYNC_API_URL` and the same `SYNC_API_TOKEN` in the local app's server-side configuration. Keep report authorization on n8n only; the desktop/browser must never receive it.

PostgreSQL and MySQL URLs are supported when their configured Python driver is installed; SQLite is for development only. The initial implementation uses SQLAlchemy `create_all` for additive creation of missing prefixed tables, not schema migrations. Before long-term production use, add reviewed Alembic migrations after the hosted DB engine is confirmed.

## Current implementation boundary

The backend and UI handoff are implemented. No hosted credentials, n8n recipients, email credential, report hostname, or SQL engine have been provided, so remote deployment and live email delivery need those settings. n8n workflow setup instructions and payloads are in [`docs/REPORT_AUTOMATION.md`](docs/REPORT_AUTOMATION.md).
