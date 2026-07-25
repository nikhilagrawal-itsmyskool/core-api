import { DB } from '../db';
import { resolveEffectiveClassId } from '../effective-class';

// Unit tests for the shared student -> effective-class resolver. DB.query is mocked so no
// server/DB is needed; each test drives one branch of the resolution logic.
describe('resolveEffectiveClassId', () => {
  const SCHOOL = 'sch1';
  const STUDENT = 'stu1';
  const YEAR = 'yr1';

  let querySpy: jest.SpyInstance;

  afterEach(() => {
    querySpy.mockRestore();
  });

  it('returns null when the student has no active enrolment for the year', async () => {
    querySpy = jest.spyOn(DB, 'query').mockResolvedValueOnce([]); // enrolment lookup

    const result = await resolveEffectiveClassId(SCHOOL, STUDENT, YEAR);

    expect(result).toBeNull();
    expect(querySpy).toHaveBeenCalledTimes(1); // stream lookup never runs
  });

  it('falls back to the enrolment class when no stream is set', async () => {
    querySpy = jest
      .spyOn(DB, 'query')
      .mockResolvedValueOnce([{ classId: 'baseXI', streamCode: null }]);

    const result = await resolveEffectiveClassId(SCHOOL, STUDENT, YEAR);

    expect(result).toEqual({ classId: 'baseXI', streamCode: null, isStream: false });
    expect(querySpy).toHaveBeenCalledTimes(1); // no stream => no second query
  });

  it('resolves to the stream-child class when one exists', async () => {
    querySpy = jest
      .spyOn(DB, 'query')
      .mockResolvedValueOnce([{ classId: 'baseXI', streamCode: 'SCI' }]) // enrolment
      .mockResolvedValueOnce([{ uuid: 'xiScience' }]); // stream-child lookup

    const result = await resolveEffectiveClassId(SCHOOL, STUDENT, YEAR);

    expect(result).toEqual({ classId: 'xiScience', streamCode: 'SCI', isStream: true });
    expect(querySpy).toHaveBeenCalledTimes(2);
    // second call is the stream lookup, keyed on base class + stream code
    expect(querySpy.mock.calls[1][1]).toEqual([SCHOOL, 'baseXI', 'SCI']);
  });

  it('falls back to the base class when a stream is set but no stream-child row exists', async () => {
    querySpy = jest
      .spyOn(DB, 'query')
      .mockResolvedValueOnce([{ classId: 'baseXI', streamCode: 'COM' }]) // enrolment
      .mockResolvedValueOnce([]); // no matching stream-child class

    const result = await resolveEffectiveClassId(SCHOOL, STUDENT, YEAR);

    expect(result).toEqual({ classId: 'baseXI', streamCode: 'COM', isStream: false });
    expect(querySpy).toHaveBeenCalledTimes(2);
  });
});
