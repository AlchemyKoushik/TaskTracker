import { workflow, node, trigger, placeholder, expr, sticky } from '@n8n/workflow-sdk';

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
  type: 'n8n-nodes-base.emailSend',
  version: 2.1,
  config: {
    name: 'Email Weekly Report Link',
    position: [860, 300],
    parameters: {
      resource: 'email',
      operation: 'send',
      fromEmail: placeholder('Set the approved sender email address'),
      toEmail: placeholder('Set report recipients in the n8n workflow'),
      subject: expr('TaskTracker Weekly Work Report{{ $json.is_final ? "" : " (Provisional)" }} - {{ $json.range.start_date }} to {{ $json.range.end_date }}'),
      emailFormat: 'html',
      html: expr('<p>{{ $json.is_final ? "Your TaskTracker weekly work report is ready." : "This report is provisional and will update when offline records sync. Open this same link later for the latest data." }}</p><p>Period: {{ $json.range.start_date }} through {{ $json.range.end_date }}</p><p><a href="{{ $json.url }}">View Weekly Work Report</a></p>'),
      options: { appendAttribution: false }
    }
  },
  output: [{ accepted: true }]
});

const weeklySetupNote = sticky('## Setup before activation\n1. Set the HTTPS publish endpoint for your VPS.\n2. Select an n8n HTTP auth credential of type httpTemplatedCustomAuth with Authorization: Bearer {{api_key}}.\n3. Select an SMTP credential and set sender/recipients.\n4. The workflow timezone is Asia/Kolkata.\n5. Confirm the VPS public report route, then validate and run a safe delivery.', [weeklyPublish, weeklyEmail], { color: 5 });

export default workflow('574bb45c-0ccd-45d8-a648-a8dd80e5c0a1', 'TaskTracker - Weekly Work Report')
  .add(weeklySchedule)
  .to(weeklyPublish)
  .to(weeklyEmail)
  .add(weeklySetupNote);
