import {
  parsePreference, defaultLadder, resolveLadder, resolveVariables,
  studentNumbers, employeeNumbers,
} from '../communication-util';
import { Channel } from '../communication-constants';
import { AudienceTarget } from '../communication-interfaces';

const ALL: Set<Channel> = new Set(['whatsapp', 'sms']);

function studentTarget(numbers: Record<string, string | null | undefined>, preference?: string | null): AudienceTarget {
  return { recipientType: 'student', recipientId: 's1', name: 'Riya', preference, numbers, context: {} };
}

describe('communication ladder', () => {
  it('parsePreference keeps valid tokens and drops invalid ones', () => {
    expect(parsePreference('father:whatsapp,mother:sms', 'student'))
      .toEqual([{ role: 'father', channel: 'whatsapp' }, { role: 'mother', channel: 'sms' }]);
    // invalid role for student type + invalid channel are dropped
    expect(parsePreference('self:whatsapp,father:email,guardian:sms', 'student'))
      .toEqual([{ role: 'guardian', channel: 'sms' }]);
    // employee only allows self
    expect(parsePreference('father:sms,self:whatsapp', 'employee'))
      .toEqual([{ role: 'self', channel: 'whatsapp' }]);
    expect(parsePreference('', 'student')).toEqual([]);
  });

  it('defaultLadder is WhatsApp-first then SMS', () => {
    expect(defaultLadder('student')).toEqual([
      { role: 'father', channel: 'whatsapp' },
      { role: 'mother', channel: 'whatsapp' },
      { role: 'guardian', channel: 'whatsapp' },
      { role: 'father', channel: 'sms' },
      { role: 'mother', channel: 'sms' },
      { role: 'guardian', channel: 'sms' },
    ]);
    expect(defaultLadder('employee')).toEqual([
      { role: 'self', channel: 'whatsapp' },
      { role: 'self', channel: 'sms' },
    ]);
  });

  it('default ladder picks father WhatsApp when available', () => {
    const t = studentTarget({ 'father:whatsapp': '+9111', 'father:sms': '+9122' });
    expect(resolveLadder(t, ALL)).toEqual({ role: 'father', channel: 'whatsapp', toNumber: '+9111' });
  });

  it('walks past an empty preferred number to the next resolvable token', () => {
    // father whatsapp empty -> next whatsapp token is mother
    const t = studentTarget({ 'father:whatsapp': '', 'mother:whatsapp': '+9133', 'father:sms': '+9144' });
    expect(resolveLadder(t, ALL)).toEqual({ role: 'mother', channel: 'whatsapp', toNumber: '+9133' });
  });

  it('falls back across channels when the preferred channel has no template', () => {
    // only SMS template exists; father has both, so SMS is used
    const t = studentTarget({ 'father:whatsapp': '+9111', 'father:sms': '+9122' });
    const smsOnly: Set<Channel> = new Set(['sms']);
    expect(resolveLadder(t, smsOnly)).toEqual({ role: 'father', channel: 'sms', toNumber: '+9122' });
  });

  it('honours an explicit preference order', () => {
    const t = studentTarget(
      { 'father:whatsapp': '+9111', 'mother:sms': '+9155' },
      'mother:sms,father:whatsapp',
    );
    expect(resolveLadder(t, ALL)).toEqual({ role: 'mother', channel: 'sms', toNumber: '+9155' });
  });

  it('forceChannel bypasses preference', () => {
    const t = studentTarget(
      { 'father:whatsapp': '+9111', 'father:sms': '+9122' },
      'father:whatsapp',
    );
    expect(resolveLadder(t, ALL, 'sms')).toEqual({ role: 'father', channel: 'sms', toNumber: '+9122' });
  });

  it('returns null when the ladder is exhausted (no reachable number)', () => {
    const t = studentTarget({ 'father:whatsapp': '', 'mother:whatsapp': null });
    expect(resolveLadder(t, ALL)).toBeNull();
  });

  it('resolves employee self numbers', () => {
    const t: AudienceTarget = {
      recipientType: 'employee', recipientId: 'e1', name: 'Mr Rao', preference: null,
      numbers: employeeNumbers({ whatsapp: '+9199', mobile: '+9188' }), context: {},
    };
    expect(resolveLadder(t, ALL)).toEqual({ role: 'self', channel: 'whatsapp', toNumber: '+9199' });
  });

  it('builds student numbers from a camelCase row', () => {
    expect(studentNumbers({ fatherWhatsapp: 'a', fatherMobile: 'b', motherWhatsapp: 'c', motherMobile: 'd', guardianWhatsapp: 'e', guardianMobile: 'f' }))
      .toEqual({ 'father:whatsapp': 'a', 'father:sms': 'b', 'mother:whatsapp': 'c', 'mother:sms': 'd', 'guardian:whatsapp': 'e', 'guardian:sms': 'f' });
  });

  it('resolveVariables fills ordered values and reports missing', () => {
    expect(resolveVariables(['studentName', 'className', 'date'], { studentName: 'Riya', className: '5-A', date: '26 Jun' }))
      .toEqual({ values: ['Riya', '5-A', '26 Jun'], missing: [] });
    expect(resolveVariables(['studentName', 'className'], { studentName: 'Riya' }))
      .toEqual({ values: ['Riya', ''], missing: ['className'] });
    expect(resolveVariables(undefined, {})).toEqual({ values: [], missing: [] });
  });
});
