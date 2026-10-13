import { workflow, node, trigger, expr, sticky } from '@n8n/workflow-sdk';

const weeklySchedule = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.4,
  config: {
    name: 'Weekly Monday 05:15',
    position: [260, 300],
    parameters: {
      rule: { interval: [{ field: 'weeks', weeksInterval: 1, triggerAtDay: [1], triggerAtHour: 5, triggerAtMinute: 15 }] }
    }
  },
  output: [{}]
});

const weeklyPublish = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Publish Previous Week Report',
    position: [560, 300],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      method: 'POST',
      url: 'https://tracker.alchemy-research.com/api/v1/server/reports/publish',
      authentication: 'genericCredentialType',
      genericAuthType: 'httpTemplatedCustomAuth',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: { period: 'previous_week' }
    }
  },
  output: [{ period: 'previous_week', range: { start_date: 'YYYY-MM-DD', end_date: 'YYYY-MM-DD' }, is_final: true, completeness: { open_workdays: 0, open_segments: 0 }, url: 'https://your-vps.example/report/share-token', report: { summary: { active_seconds: 0 } } }]
});

const weeklyEmail = node({
  type: 'n8n-nodes-base.microsoftOutlook',
  version: 2,
  config: {
    name: 'Email Weekly Report Link via Outlook',
    position: [860, 300],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
    parameters: {
      resource: 'message',
      operation: 'send',
      authentication: 'microsoftOutlookOAuth2Api',
      from: 'koushik.bhandary@alchemy-research.com',
      toRecipients: 'manoj.sharma@alchemy-research.com',
      additionalFields: { ccRecipients: 'koushik.bhandary@alchemy-research.com' },
      subject: expr('TaskTracker Weekly Work Report{{ $json.is_final ? "" : " (Provisional)" }} - {{ $json.range.start_date }} to {{ $json.range.end_date }}'),
      bodyContentType: 'html',
      bodyContent: expr(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Koushik's Weekly Work Activity Report</title>
</head>

<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:Arial,Helvetica,sans-serif; color:#1e293b;">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9; padding:32px 12px;">
    <tr>
      <td align="center">

        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="background-color:#0f172a; padding:30px 32px;">
              <p style="margin:0 0 12px; color:#93c5fd; font-size:12px; font-weight:bold; letter-spacing:2px;">
                WORKPULSE &middot; ACTIVITY REPORT
              </p>
              <h1 style="margin:0; color:#ffffff; font-size:25px; line-height:1.4;">
                Weekly Work Activity
              </h1>
              <p style="margin:8px 0 0; color:#cbd5e1; font-size:14px; line-height:1.7;">
                Employee Activity Summary &amp; Productivity Overview
              </p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding:32px;">

              <p style="margin:0 0 8px; color:#64748b; font-size:13px;">
                Prepared for Management
              </p>

              <h2 style="margin:0 0 18px; color:#0f172a; font-size:21px;">
                Koushik's Weekly Activity Report
              </h2>

              <p style="margin:0 0 22px; color:#475569; font-size:14px; line-height:1.9;">
                Please find below the weekly work activity report for <strong>Koushik</strong>,
                covering the reporting period specified below. The report provides an overview
                of recorded work sessions, task activity, and time allocation during the week.
                Please use the link below to review the detailed activity report.
              </p>

              <!-- Report Status -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
                <tr>
                  <td style="padding:8px 13px; border-radius:20px; background-color:{{ $json.is_final ? '#dcfce7' : '#fef3c7' }}; color:{{ $json.is_final ? '#166534' : '#92400e' }}; font-size:12px; font-weight:bold;">
                    {{ $json.is_final ? '&#10003; FINAL REPORT' : '&#9671; PROVISIONAL REPORT' }}
                  </td>
                </tr>
              </table>

              <!-- Employee Details -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0; border-radius:10px; margin-bottom:20px;">
                <tr>
                  <td style="padding:18px 20px; border-bottom:1px solid #e2e8f0;">
                    <p style="margin:0 0 6px; color:#64748b; font-size:11px; font-weight:bold; letter-spacing:1px;">
                      EMPLOYEE
                    </p>
                    <p style="margin:0; color:#0f172a; font-size:15px; font-weight:bold;">
                      Koushik Bhandary
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 20px;">
                    <p style="margin:0 0 6px; color:#64748b; font-size:11px; font-weight:bold; letter-spacing:1px;">
                      REPORTING PERIOD
                    </p>
                    <p style="margin:0; color:#0f172a; font-size:15px; font-weight:bold; line-height:1.6;">
                      {{ $json.range.start_date }} &mdash; {{ $json.range.end_date }}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Dynamic Notice -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:{{ $json.is_final ? '#f0fdf4' : '#fffbeb' }}; border-left:4px solid {{ $json.is_final ? '#16a34a' : '#d97706' }}; margin-bottom:26px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <p style="margin:0 0 6px; color:#0f172a; font-size:13px; font-weight:bold;">
                      {{ $json.is_final ? 'Report Status: Finalised' : 'Report Status: Awaiting Data Sync' }}
                    </p>
                    <p style="margin:0; color:#475569; font-size:13px; line-height:1.8;">
                      {{ $json.is_final
                        ? 'The report is finalised based on the records currently available for this reporting period.'
                        : 'This report is provisional. Some offline work activity may not yet be reflected. The report will be updated when pending records sync. Please revisit the same link later for the latest information.'
                      }}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 22px;">
                <tr>
                  <td align="center" bgcolor="#2563eb" style="border-radius:8px;">
                    <a href="{{ $json.url }}" target="_blank" style="display:inline-block; padding:15px 28px; color:#ffffff; font-size:14px; font-weight:bold; text-decoration:none; border-radius:8px;">
                      Review Work Activity Report &nbsp; &#8594;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0; color:#64748b; font-size:12px; line-height:1.8; text-align:center;">
                Click the button above to access the detailed weekly report, including the available work activity and time records.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:22px 32px; background-color:#f8fafc; border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 6px; color:#334155; font-size:13px; font-weight:bold;">
                WorkPulse
              </p>
              <p style="margin:0; color:#94a3b8; font-size:11px; line-height:1.8;">
                Automated Employee Work Activity Reporting<br>
                This report is generated from recorded activity data. Recorded activity and time estimates should be interpreted in context.
              </p>
              <p style="margin:12px 0 0; color:#64748b; font-size:11px; line-height:1.7;">
                If the button above does not work, use the following link:<br>
                <a href="{{ $json.url }}" style="color:#2563eb; word-break:break-all;">{{ $json.url }}</a>
              </p>
            </td>
          </tr>

        </table>

        <p style="margin:18px 0 0; color:#94a3b8; font-size:11px; text-align:center;">
          Confidential &middot; Intended for internal management review
        </p>

      </td>
    </tr>
  </table>

</body>
</html>
      `),
      saveToSentItems: true
    }
  },
  output: [{ accepted: true }]
});

const weeklySetupNote = sticky('## Production setup\n1. Bind an n8n HTTP auth credential of type httpTemplatedCustomAuth with Authorization: Bearer {{api_key}}.\n2. Bind the approved Microsoft Outlook OAuth2 credential.\n3. Sender: koushik.bhandary@alchemy-research.com; recipient: manoj.sharma@alchemy-research.com; CC: koushik.bhandary@alchemy-research.com.\n4. The workflow timezone is Asia/Kolkata.\n5. Confirm the VPS public report route, then validate and run a safe delivery.', [weeklyPublish, weeklyEmail], { color: 5 });

export default workflow('574bb45c-0ccd-45d8-a648-a8dd80e5c0a1', 'TaskTracker - Weekly Work Report')
  .add(weeklySchedule)
  .to(weeklyPublish)
  .to(weeklyEmail)
  .add(weeklySetupNote);
