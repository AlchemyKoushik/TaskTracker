# n8n report automation contract

The reporting engine and publishing API live in this service. n8n is responsible for schedule and email delivery. No credentials or recipient list are stored in this repository.

## Schedules

- Weekly: Monday at 05:15 in `Asia/Kolkata`; publish `previous_week` (previous Monday through Sunday).
- Monthly: day 1 at 05:00 in `Asia/Kolkata`; publish `previous_month` (previous calendar month).
- These schedules are separate workflows that use the same report engine. If you want another weekday/time, adjust the n8n schedule; the report window remains the previous complete calendar week/month.

## Publish call

Configure an n8n HTTP Request node:

- `POST https://<your-vps-api>/api/v1/server/reports/publish`
- Header credential: `Authorization: Bearer <REPORT_API_TOKEN>` (store in an n8n credential; never put token in node text/expressions).
- JSON body: `{ "period": "previous_week" }` or `{ "period": "previous_month" }`.
- Retry transient errors. Do not send email unless the publish call returns success and `url` is present.

The connected n8n instance currently has no TaskTracker credentials. Before activating the saved drafts, create an HTTP Request Generic Auth credential of type `httpTemplatedCustomAuth` with the header template `Authorization: Bearer {{api_key}}`, then enter the VPS `REPORT_API_TOKEN` as `api_key`. Create/select an SMTP credential for the Email node; set the sender and recipient fields in each workflow. Credential creation stays in the n8n UI; credentials are never stored in this repository.

Success includes `period`, `range`, `url`, and the full report JSON. The report period selects Workdays by their Workday date label, so overnight work up to the 5:00 AM cutoff remains with the day that began before midnight. Only closed activity segments are included. `is_final: false` means the service knows about an open Workday or segment in that range; the email should label the link provisional. If the laptop syncs late, the server refreshes published report snapshots on sync, so the same public link shows the newer data. The public share URL is idempotent for a period and can be sent as a normal link. The read-only UI route is `/report/:shareToken`; it fetches JSON from `/api/v1/public/reports/:shareToken`. The API bearer token is not used on that public route.

## Email delivery

After publishing, send the recipient list a short email with period dates and the `url`. Set recipients through n8n configuration, not source code. Configure a catch-all n8n Error Trigger workflow in the UI and assign it to both scheduled workflows. Keep the workflows inactive until the API URL, credential, email credential, recipient list, and report route are configured and a safe end-to-end run has been approved.

## Record flow

`GET /api/v1/server/reports/previous_week` and `/previous_month` are authenticated read-only report endpoints for inspection. Use the publish endpoint for scheduled delivery because it also persists the public report snapshot. Report calculations select by the Workday date and bucket daily totals by that label, keeping overnight intervals together through the 5:00 AM cutoff.
