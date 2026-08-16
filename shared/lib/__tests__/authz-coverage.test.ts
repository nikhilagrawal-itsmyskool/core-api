import * as fs from 'fs';
import * as path from 'path';
import { FEE_ACTIONS, FEE_PUBLIC } from '../../../modules/fees/fees-actions';
import { TRANSFER_ACTIONS, TRANSFER_PUBLIC } from '../../../modules/transfer/transfer-actions';
import { EMPLOYEE_ACTIONS, EMPLOYEE_PUBLIC } from '../../../modules/employee/employee-actions';
import { COMMUNICATION_ACTIONS, COMMUNICATION_PUBLIC } from '../../../modules/communication/communication-actions';
import { ATTENDANCE_ACTIONS, ATTENDANCE_PUBLIC } from '../../../modules/attendance/attendance-actions';
import { ASSISTANT_ACTIONS, ASSISTANT_PUBLIC } from '../../../modules/assistant/assistant-actions';
import { STUDENT_ACTIONS, STUDENT_PUBLIC } from '../../../modules/student/student-actions';
import { TRANSPORT_ACTIONS, TRANSPORT_PUBLIC } from '../../../modules/transport/transport-actions';

// One coverage guard for every gated module: each `handler:` in the module's
// *-endpoints.yml must have an explicit authorization decision — gated (in the
// <M>_ACTIONS map) or explicitly public (<M>_PUBLIC). Adding an endpoint without a
// decision fails here, so no route is ever silently left ungated. Add a row to
// MODULES when a new module is gated.
const MODULES: Array<{ name: string; yml: string; actions: Record<string, string>; pub: string[] }> = [
  { name: 'fees', yml: 'modules/fees/fees-endpoints.yml', actions: FEE_ACTIONS, pub: FEE_PUBLIC },
  { name: 'transfer', yml: 'modules/transfer/transfer-endpoints.yml', actions: TRANSFER_ACTIONS, pub: TRANSFER_PUBLIC },
  { name: 'employee', yml: 'modules/employee/employee-endpoints.yml', actions: EMPLOYEE_ACTIONS, pub: EMPLOYEE_PUBLIC },
  { name: 'communication', yml: 'modules/communication/communication-endpoints.yml', actions: COMMUNICATION_ACTIONS, pub: COMMUNICATION_PUBLIC },
  { name: 'attendance', yml: 'modules/attendance/attendance-endpoints.yml', actions: ATTENDANCE_ACTIONS, pub: ATTENDANCE_PUBLIC },
  { name: 'assistant', yml: 'modules/assistant/assistant-endpoints.yml', actions: ASSISTANT_ACTIONS, pub: ASSISTANT_PUBLIC },
  { name: 'student', yml: 'modules/student/student-endpoints.yml', actions: STUDENT_ACTIONS, pub: STUDENT_PUBLIC },
  { name: 'transport', yml: 'modules/transport/transport-endpoints.yml', actions: TRANSPORT_ACTIONS, pub: TRANSPORT_PUBLIC },
];

function handlerRefs(ymlRel: string): string[] {
  const yml = fs.readFileSync(path.join(__dirname, '../../..', ymlRel), 'utf8');
  const refs: string[] = [];
  const re = /handler:\s*([A-Za-z0-9_.-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(yml)) !== null) refs.push(m[1]);
  return refs;
}

describe.each(MODULES)('authorization coverage: $name', ({ yml, actions, pub }) => {
  const refs = handlerRefs(yml);
  const decided = new Set([...Object.keys(actions), ...pub]);

  it('finds endpoints in the yml', () => {
    expect(refs.length).toBeGreaterThan(0);
  });

  it('every handler has an authorization decision (gated or explicitly public)', () => {
    expect(refs.filter((r) => !decided.has(r))).toEqual([]);
  });

  it('has no stale manifest/public entries (every one still exists in the yml)', () => {
    const inYml = new Set(refs);
    expect([...decided].filter((r) => !inYml.has(r))).toEqual([]);
  });
});
