import { normalizeMobile, buildSmsBody, buildWhatsappBody } from '../providers/msg91-provider';
import { SendParams } from '../providers/provider-interface';

function smsParams(overrides: Partial<SendParams> = {}): SendParams {
  return {
    channel: 'sms',
    toNumber: '8373919569',
    templateKey: 'attendance_absent',
    providerTemplateId: 'flow_123',
    language: 'en',
    variables: ['Riya', '5-A', '26 Jun 2026'],
    variableNames: ['studentName', 'className', 'date'],
    ...overrides,
  };
}

describe('MSG91 adapter payloads', () => {
  it('normalizeMobile prefixes the country code for a 10-digit number', () => {
    expect(normalizeMobile('8373919569')).toBe('918373919569');
    expect(normalizeMobile('+91 83739 19569')).toBe('918373919569');
    expect(normalizeMobile('08373919569')).toBe('918373919569');
    expect(normalizeMobile('918373919569')).toBe('918373919569'); // already CC'd
    expect(normalizeMobile('8373919569', '1')).toBe('18373919569'); // custom CC
  });

  it('buildSmsBody maps variables by NAME and uses flow_id + sender', () => {
    const body = buildSmsBody(smsParams(), 'SCHOOL');
    expect(body).toEqual({
      flow_id: 'flow_123',
      sender: 'SCHOOL',
      recipients: [
        { mobiles: '918373919569', studentName: 'Riya', className: '5-A', date: '26 Jun 2026' },
      ],
    });
  });

  it('buildSmsBody falls back to VARn when names are absent', () => {
    const body = buildSmsBody(smsParams({ variableNames: undefined }), 'SCHOOL');
    expect(body.recipients[0]).toMatchObject({ VAR1: 'Riya', VAR2: '5-A', VAR3: '26 Jun 2026' });
  });

  it('buildWhatsappBody maps variables positionally to body_n components', () => {
    const body = buildWhatsappBody(smsParams({ channel: 'whatsapp', providerTemplateId: 'attendance_absent_en' }), '918889500122');
    expect(body.integrated_number).toBe('918889500122');
    expect(body.content_type).toBe('template');
    expect(body.payload.template.name).toBe('attendance_absent_en');
    expect(body.payload.template.language.code).toBe('en');
    const tc = body.payload.template.to_and_components[0];
    expect(tc.to).toEqual(['918373919569']);
    expect(tc.components).toEqual({
      body_1: { type: 'text', value: 'Riya' },
      body_2: { type: 'text', value: '5-A' },
      body_3: { type: 'text', value: '26 Jun 2026' },
    });
  });
});
