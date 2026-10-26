import {
  parseAttlogLine,
  parseOperlogLine,
  parseDeviceCmdResult,
  parseInfo,
  deviceName,
  buildPushUserPayload,
  buildDeleteUserPayload,
} from '../biometric-parse';

// Fixtures are REAL lines captured from the K30 Pro during the probe session.
describe('biometric iclock parsers', () => {
  it('parses an ATTLOG punch line', () => {
    const rec = parseAttlogLine('1\t2026-10-23 21:19:57\t0\t1\t0\t\t\t0\t0\t');
    expect(rec).not.toBeNull();
    expect(rec!.pin).toBe('1');
    expect(rec!.time).toBe('2026-10-23 21:19:57');
    expect(rec!.statusCode).toBe('0');
    expect(rec!.verifyMode).toBe('1'); // 1 = fingerprint
  });

  it('rejects an ATTLOG line without pin+time', () => {
    expect(parseAttlogLine('')).toBeNull();
    expect(parseAttlogLine('\t')).toBeNull();
  });

  it('parses a USER record from OPERLOG', () => {
    const rec = parseOperlogLine(
      'USER PIN=99001\tName=TEST USER\tPri=0\tPasswd=\tCard=2654987\tGrp=1\tTZ=0000000100000000',
    );
    expect(rec.type).toBe('user');
    expect(rec.fields.PIN).toBe('99001');
    expect(rec.fields.Name).toBe('TEST USER');
    expect(rec.fields.Pri).toBe('0');
    expect(rec.fields.Card).toBe('2654987');
  });

  it('parses an FP (fingerprint template) record from OPERLOG', () => {
    const rec = parseOperlogLine('FP PIN=99001\tFID=6\tSize=1696\tValid=1\tTMP=TbtABC123==');
    expect(rec.type).toBe('fp');
    expect(rec.fields.PIN).toBe('99001');
    expect(rec.fields.FID).toBe('6');
    expect(rec.fields.TMP).toBe('TbtABC123==');
  });

  it('classifies BIODATA Type=2 as a face record and OPLOG as other', () => {
    expect(parseOperlogLine('BIODATA PIN=5\tType=2\tTMP=xyz').type).toBe('face');
    expect(parseOperlogLine('OPLOG 4\t1\t2026-10-23 21:47:17\t0\t0\t0\t0').type).toBe('other');
  });

  it('parses the devicecmd result', () => {
    const r = parseDeviceCmdResult('ID=28328&Return=0&CMD=DATA');
    expect(r.id).toBe('28328');
    expect(r.ret).toBe('0');
    expect(r.cmd).toBe('DATA');
  });

  it('parses the getrequest INFO heartbeat', () => {
    const info = parseInfo('Ver 8.0.4.3-20230515,2,2,3,192.168.68.54,10,-1,0,0,100,1,0,0');
    expect(info.firmware).toBe('8.0.4.3-20230515');
    expect(info.userCount).toBe(2);
    expect(info.fpCount).toBe(2);
    expect(info.ip).toBe('192.168.68.54');
  });

  it('builds a reversible push/delete command pair with a clean name', () => {
    expect(deviceName('  Nikhil\tAgrawal\n ')).toBe('Nikhil Agrawal');
    expect(deviceName('x'.repeat(40)).length).toBe(24);
    expect(buildPushUserPayload('1001', 'NIKHIL')).toBe(
      'DATA UPDATE USERINFO PIN=1001\tName=NIKHIL\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=',
    );
    expect(buildDeleteUserPayload('1001')).toBe('DATA DELETE USERINFO PIN=1001');
  });
});
