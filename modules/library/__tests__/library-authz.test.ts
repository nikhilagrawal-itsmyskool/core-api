import { requireAction } from '../../auth/authz';
import { LIBRARY_ACTIONS } from '../library-actions';

// End-to-end guard check for the library module (see leave-authz.test.ts for the pattern).
// Teachers may browse the catalog only; admin + library-incharge hold the library.* wildcard.
const prevOffline = process.env.IS_OFFLINE;
beforeAll(() => {
  process.env.IS_OFFLINE = 'true';
});
afterAll(() => {
  process.env.IS_OFFLINE = prevOffline;
});

function eventFor(roles: string): any {
  return {
    headers: { 'X-School-Code': 'DBPASN' },
    requestContext: { authorizer: { principalId: 'u1', context: { type: 'employee', roles } } },
  };
}

function result(roles: string, action: string): number | 'allowed' {
  let status: number | 'allowed' = 'allowed';
  const cb = (_err: any, res: any) => {
    if (res && res.statusCode) status = res.statusCode;
  };
  const caller = requireAction(eventFor(roles), action, cb as any);
  return caller ? 'allowed' : status;
}

describe('library authorization (guard end-to-end)', () => {
  it('teacher: may browse the catalog (incl. lookups)', () => {
    expect(result('teacher', LIBRARY_ACTIONS['library-work-handler.catalog'])).toBe('allowed');
    expect(result('teacher', LIBRARY_ACTIONS['library-lookup-handler.getDdc'])).toBe('allowed');
  });

  it('teacher: cannot manage catalog, circulate, touch fines or config -> 403', () => {
    expect(result('teacher', LIBRARY_ACTIONS['library-work-handler.createWork'])).toBe(403);
    expect(result('teacher', LIBRARY_ACTIONS['library-circulation-handler.issue'])).toBe(403);
    expect(result('teacher', LIBRARY_ACTIONS['library-circulation-handler.list'])).toBe(403);
    expect(result('teacher', LIBRARY_ACTIONS['library-fine-handler.list'])).toBe(403);
    expect(result('teacher', LIBRARY_ACTIONS['library-policy-handler.get'])).toBe(403);
  });

  it('admin + library-incharge hold everything via the library.* wildcard', () => {
    expect(result('admin', LIBRARY_ACTIONS['library-circulation-handler.issue'])).toBe('allowed');
    expect(result('admin', LIBRARY_ACTIONS['library-policy-handler.update'])).toBe('allowed');
    expect(result('library-incharge', LIBRARY_ACTIONS['library-fine-handler.waive'])).toBe('allowed');
  });
});
