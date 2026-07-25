import { maskPhone, maskContactFields } from '../mask-phone';

describe('maskPhone', () => {
  it('keeps the last 2 digits and masks the rest', () => {
    expect(maskPhone('9876543210')).toBe('••••••••10');
    expect(maskPhone('9810054521')).toBe('••••••••21');
  });

  it('supports a custom mask character and visible count', () => {
    expect(maskPhone('9876543210', { ch: '*' })).toBe('********10');
    expect(maskPhone('9876543210', { visible: 4 })).toBe('••••••3210');
  });

  it('fully masks very short values (min 4 dots)', () => {
    expect(maskPhone('12')).toBe('••••');
    expect(maskPhone('1')).toBe('••••');
  });

  it('passes through null/undefined/empty unchanged', () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone(undefined)).toBeUndefined();
    expect(maskPhone('')).toBe('');
  });

  it('coerces non-strings', () => {
    expect(maskPhone(9876543210)).toBe('••••••••10');
  });
});

describe('maskContactFields', () => {
  it('masks the listed keys when reveal is false', () => {
    const row = { name: 'A', mobile: '9876543210', whatsapp: '9811112222' };
    maskContactFields(row, ['mobile', 'whatsapp'], false);
    expect(row).toEqual({ name: 'A', mobile: '••••••••10', whatsapp: '••••••••22' });
  });

  it('is a no-op when reveal is true', () => {
    const row = { mobile: '9876543210' };
    maskContactFields(row, ['mobile'], true);
    expect(row.mobile).toBe('9876543210');
  });

  it('skips null/empty values and absent keys', () => {
    const row: any = { mobile: null, whatsapp: '' };
    maskContactFields(row, ['mobile', 'whatsapp', 'notThere'], false);
    expect(row).toEqual({ mobile: null, whatsapp: '' });
  });

  it('tolerates null/undefined targets', () => {
    expect(maskContactFields(null, ['mobile'], false)).toBeNull();
    expect(maskContactFields(undefined, ['mobile'], false)).toBeUndefined();
  });
});
