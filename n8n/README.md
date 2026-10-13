# n8n integration

The weekly and monthly workflows are created in the connected n8n personal project as inactive drafts:

- `TaskTracker - Weekly Work Report` (workflow ID `VdtKyLgg1sDNTiIG`)
- `TaskTracker - Monthly Work Report` (workflow ID `O7LkDURhp9fHr7xi`)

Their workflow SDK source is kept in `workflows/`. Both use Asia/Kolkata workflow timezone, retry the report API call and Outlook delivery, publish the previous completed period, then email the generated report URL. The live drafts use the saved Outlook OAuth2 credential but remain inactive until the report API credential is bound and a safe self-recipient test succeeds.
