import {
  BASE_URL, headers, uniqueKey, getStudentWithNumber, processUntilDone, createTemplate, closePool,
  getEmployeeId, seedTransportRoute,
} from './helpers';

afterAll(async () => {
  await closePool();
});

describe('Communication API — templates + send flow', () => {
  it('template CRUD: create, get, list, update', async () => {
    const key = uniqueKey('tpl_');
    const created = await createTemplate({
      key, name: 'Test', channel: 'whatsapp', language: 'en',
      providerTemplateId: 'prov-123', variables: ['recipientName'],
    });
    expect(created.uuid).toBeDefined();
    expect(created.channel).toBe('whatsapp');

    // duplicate (same key/channel/language) is rejected
    const dupRes = await fetch(`${BASE_URL}/templates`, {
      method: 'POST', headers,
      body: JSON.stringify({ key, channel: 'whatsapp', language: 'en', providerTemplateId: 'x' }),
    });
    expect(dupRes.status).not.toBe(200);

    const getRes = await fetch(`${BASE_URL}/templates/${created.uuid}`, { headers });
    expect(getRes.status).toBe(200);

    const listRes = await fetch(`${BASE_URL}/templates`, { headers });
    const { templates } = await listRes.json();
    expect(templates.some((t: any) => t.uuid === created.uuid)).toBe(true);

    const updRes = await fetch(`${BASE_URL}/templates/${created.uuid}`, {
      method: 'PUT', headers, body: JSON.stringify({ name: 'Renamed' }),
    });
    expect((await updRes.json()).name).toBe('Renamed');
  });

  it('send → worker → recipient sent, with preview matching', async () => {
    const key = uniqueKey('abs_');
    await createTemplate({ key, channel: 'whatsapp', language: 'en', providerTemplateId: 'p-wa', variables: ['recipientName'] });
    const student = await getStudentWithNumber();

    // preview resolves the recipient without sending
    const prevRes = await fetch(`${BASE_URL}/messages/preview`, {
      method: 'POST', headers,
      body: JSON.stringify({ templateKey: key, audience: { students: { studentIds: [student.uuid] } } }),
    });
    expect(prevRes.status).toBe(200);
    const preview = await prevRes.json();
    expect(preview.recipients.length).toBe(1);
    expect(preview.recipients[0].status).toBe('pending');

    // send (immediate)
    const sendRes = await fetch(`${BASE_URL}/messages`, {
      method: 'POST', headers,
      body: JSON.stringify({ templateKey: key, source: 'attendance', audience: { students: { studentIds: [student.uuid] } } }),
    });
    expect(sendRes.status).toBe(200);
    const { jobId, status } = await sendRes.json();
    expect(status).toBe('queued');

    const job = await processUntilDone(jobId);
    expect(job.status).toBe('completed');
    expect(job.recipients.length).toBe(1);
    expect(job.recipients[0].status).toBe('sent');
    expect(job.recipients[0].providerMessageId).toBeTruthy();
    expect(job.recipients[0].channel).toBe('whatsapp');
  }, 30000);

  it('skips a recipient when forced to a channel with no template', async () => {
    const key = uniqueKey('sms_');
    // only an SMS template exists for this key
    await createTemplate({ key, channel: 'sms', language: 'en', providerTemplateId: 'p-sms', variables: ['recipientName'] });
    const student = await getStudentWithNumber();

    const sendRes = await fetch(`${BASE_URL}/messages`, {
      method: 'POST', headers,
      body: JSON.stringify({ templateKey: key, forceChannel: 'whatsapp', audience: { students: { studentIds: [student.uuid] } } }),
    });
    const { jobId } = await sendRes.json();
    const job = await processUntilDone(jobId);
    expect(job.status).toBe('completed');
    expect(job.recipients[0].status).toBe('skipped');
  }, 30000);

  it('fails a job when the template key has no active template', async () => {
    const student = await getStudentWithNumber();
    const sendRes = await fetch(`${BASE_URL}/messages`, {
      method: 'POST', headers,
      body: JSON.stringify({ templateKey: uniqueKey('missing_'), audience: { students: { studentIds: [student.uuid] } } }),
    });
    const { jobId } = await sendRes.json();
    const job = await processUntilDone(jobId);
    expect(job.status).toBe('failed');
    expect(job.error).toContain('No active template');
  }, 30000);

  it('resolves a transport route audience to its assigned students and staff', async () => {
    const key = uniqueKey('route_');
    await createTemplate({ key, channel: 'whatsapp', language: 'en', providerTemplateId: 'p-route', variables: ['recipientName'] });
    const student = await getStudentWithNumber();
    const staffId = await getEmployeeId();
    const { routeId, cleanup } = await seedTransportRoute({ studentId: student.uuid, staffEmployeeId: staffId });
    try {
      const prevRes = await fetch(`${BASE_URL}/messages/preview`, {
        method: 'POST', headers,
        body: JSON.stringify({ templateKey: key, audience: { transport: { routeIds: [routeId] } } }),
      });
      expect(prevRes.status).toBe(200);
      const preview = await prevRes.json();
      // the assigned student must appear as a target
      expect(preview.recipients.some((r: any) => r.recipientType === 'student' && r.recipientId === student.uuid)).toBe(true);
      // and the route's accompanying teacher, when the school has an employee
      if (staffId) {
        expect(preview.recipients.some((r: any) => r.recipientType === 'employee' && r.recipientId === staffId)).toBe(true);
      }
    } finally {
      await cleanup();
    }
  }, 30000);

  it('skips a recipient when a required template variable is missing', async () => {
    const key = uniqueKey('var_');
    await createTemplate({ key, channel: 'whatsapp', language: 'en', providerTemplateId: 'p-var', variables: ['nonexistentVar'] });
    const student = await getStudentWithNumber();
    const sendRes = await fetch(`${BASE_URL}/messages`, {
      method: 'POST', headers,
      body: JSON.stringify({ templateKey: key, audience: { students: { studentIds: [student.uuid] } } }),
    });
    const { jobId } = await sendRes.json();
    const job = await processUntilDone(jobId);
    expect(job.status).toBe('completed');
    expect(job.recipients[0].status).toBe('skipped');
    expect(job.recipients[0].error).toContain('missing variables');
  }, 30000);
});
