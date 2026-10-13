import { workflow, node, trigger, expr, sticky } from '@n8n/workflow-sdk';

const monthlySchedule = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.4,
  config: {
    name: 'Monthly Day 1 05:00',
    position: [260, 300],
    parameters: {
      rule: { interval: [{ field: 'months', monthsInterval: 1, triggerAtDayOfMonth: 1, triggerAtHour: 5, triggerAtMinute: 0 }] }
    }
  },
  output: [{}]
});

const monthlyPublish = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Publish Previous Month Report',
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
      jsonBody: { period: 'previous_month' }
    }
  },
  output: [{ period: 'previous_month', range: { start_date: 'YYYY-MM-DD', end_date: 'YYYY-MM-DD' }, is_final: true, completeness: { open_workdays: 0, open_segments: 0 }, url: 'https://your-vps.example/report/share-token', report: { summary: { active_seconds: 0 } } }]
});

const monthlyEmail = node({
  type: 'n8n-nodes-base.microsoftOutlook',
  version: 2,
  config: {
    name: 'Email Monthly Report Link via Outlook',
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
      subject: expr('TaskTracker Monthly Work Report{{ $json.is_final ? "" : " (Provisional)" }} - {{ $json.range.start_date }} to {{ $json.range.end_date }}'),
      bodyContentType: 'html',
      bodyContent: expr('<p>{{ $json.is_final ? "Your TaskTracker monthly work report is ready." : "This report is provisional and will update when offline records sync. Open this same link later for the latest data." }}</p><p>Period: {{ $json.range.start_date }} through {{ $json.range.end_date }}</p><p><a href="{{ $json.url }}">View Monthly Work Report</a></p>'),
      saveToSentItems: true
    }
  },
  output: [{ accepted: true }]
});

const monthlySetupNote = sticky('## Production setup\n1. Bind an n8n HTTP auth credential of type httpTemplatedCustomAuth with Authorization: Bearer {{api_key}}.\n2. Bind the approved Microsoft Outlook OAuth2 credential.\n3. Sender: koushik.bhandary@alchemy-research.com; recipient: manoj.sharma@alchemy-research.com; CC: koushik.bhandary@alchemy-research.com.\n4. The workflow timezone is Asia/Kolkata.\n5. Confirm the VPS public report route, then validate and run a safe delivery.', [monthlyPublish, monthlyEmail], { color: 5 });

export default workflow('62a5ff99-76c6-4ced-9ba4-408936198acf', 'TaskTracker - Monthly Work Report')
  .add(monthlySchedule)
  .to(monthlyPublish)
  .to(monthlyEmail)
  .add(monthlySetupNote);
