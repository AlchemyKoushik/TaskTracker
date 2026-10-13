# Antigravity prompt: TaskTracker UI

Build a beautiful, lightweight Windows desktop UI for **TaskTracker & Automatic Reporting System**. This repository already contains the Python service, domain rules, local SQLite store, sync queue, and the API contract in `docs/ANTIGRAVITY_HANDOFF.md`. Read that contract and the repository README before building.

## Your responsibility

Design and implement the entire visual and interaction layer: the Windows desktop shell, system tray experience, task picker, current-work view, history/reports screens, settings, and the public weekly/monthly report dashboard. You own UI/UX decisions and visual polish. The API/service code owns workday calculations, idle detection, persistence, time totals, and sync. Integrate with the existing API; do not duplicate its business rules in the renderer.

## Product feel

Make this feel like a calm, focused personal utility that stays out of the way. It should open quickly, work well in a compact window, and make the current task and the next action obvious. Create a distinctive but restrained visual system, strong typography, refined spacing, subtle motion, and thoughtful empty/loading/error/offline states. Avoid project-management clutter, generic admin panels, fake analytics, and decorative complexity. The report dashboard can be more expressive and analytical while remaining readable and suitable to share with management.

## Required behaviors

- Search/select reusable tasks grouped by category; create a category/task only when needed.
- Clearly show the current task and whether its service state is active, idle, or paused.
- Separate **Wrap Up Task** from **Wrap Up Day**; the day action ends the task and closes the workday.
- Pause/resume the current task.
- Show today's work, previous workdays, and weekly/monthly report views.
- Display active, idle, and paused durations separately. Never count idle/paused seconds as active time.
- Explain the 5:00 AM local cutoff in Settings. Midnight does not end a workday.
- Display offline/pending-sync state and provide an explicit "Sync now" action. Task tracking must continue when offline.
- Provide confirmation for destructive-feeling actions such as wrapping the entire day, but keep normal start/wrap-task actions quick.
- System tray: open window, show current task/state, and access safe quick actions. Do not collect private user activity content.
- Start with Windows and launch the local service as a child process; wait for `/health` before loading the renderer and shut it down cleanly when the desktop process exits. Keep the API bound to loopback. In Electron, serve the packaged renderer from a registered secure `app://tasktracker` origin (the backend allowlists that origin) rather than `file://` or a remote web page.
- Implement a shareable, read-only `/report/:shareToken` page that fetches `GET /api/v1/public/reports/:shareToken` from the VPS API. The public report token is the only access mechanism for that published report; do not embed central DB credentials or the report API bearer token in browser code.

## API integration rules

- Local desktop API base URL is `http://127.0.0.1:8765`; all endpoints and payloads are in `docs/ANTIGRAVITY_HANDOFF.md` and `/openapi.json`.
- On launch and window focus, refresh current state from the service. The service continues tracking while the renderer is closed.
- Use service response values and integer-second totals as source of truth. Browser animations may interpolate display only; never write calculated durations back.
- Respect API error codes and show concise recovery actions. In particular, handle `409` duplicate task/category and state conflicts without silently creating duplicates.
- Use the same report data contract for weekly and monthly views; period is the only variable.
- Keep API calls behind a small typed client module. Add timeout, cancellation, loading, and error handling.

## Constraints

- Do not edit the Python backend's domain logic or change API fields/routes to fit a screen. If a required field is missing, document the gap and ask Codex to extend the contract.
- Do not put SQL/database credentials, sync bearer tokens, or report API credentials in the renderer or desktop bundle.
- Do not implement key logging, screenshots, coordinates, window-title/URL capture, clipboard capture, or content monitoring.
- Avoid adding unrelated features such as project boards, comments, file uploads, team chat, or timesheet approvals.
- Keep application UI and report dashboard UI separate in information architecture, while reusing typography, color, and components.

## Deliverables

1. A working Windows desktop application shell that launches and supervises the local Python service.
2. The complete responsive UI wired to the documented API.
3. A polished read-only report dashboard route suitable for VPS static hosting.
4. Clear setup/build instructions and the exact frontend origin needed for local CORS.
5. A list of any contract gaps, without silently changing backend behavior.

