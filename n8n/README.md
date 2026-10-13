# n8n integration

The weekly and monthly workflows are created in the connected n8n personal project as inactive drafts:

- `TaskTracker - Weekly Work Report` (workflow ID `VdtKyLgg1sDNTiIG`)
- `TaskTracker - Monthly Work Report` (workflow ID `O7LkDURhp9fHr7xi`)

Their workflow SDK source is kept in `workflows/`. Both use Asia/Kolkata workflow timezone, retry the report API call, publish the previous completed period, then email the generated report URL. The drafts are intentionally inactive until the VPS API URL, `httpTemplatedCustomAuth` credential, SMTP credential, sender, recipients, and public dashboard route are configured. No emails or report links have been sent.
