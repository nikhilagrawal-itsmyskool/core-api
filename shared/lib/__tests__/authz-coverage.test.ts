import * as fs from 'fs';
import * as path from 'path';
import { FEE_ACTIONS, FEE_PUBLIC } from '../../../modules/fees/fees-actions';
import { FEE_EXT_ACTIONS, FEE_EXT_PUBLIC } from '../../../modules/fees-ext/fees-ext-actions';
import { TRANSFER_ACTIONS, TRANSFER_PUBLIC } from '../../../modules/transfer/transfer-actions';
import { EMPLOYEE_ACTIONS, EMPLOYEE_PUBLIC } from '../../../modules/employee/employee-actions';
import { COMMUNICATION_ACTIONS, COMMUNICATION_PUBLIC } from '../../../modules/communication/communication-actions';
import { ATTENDANCE_ACTIONS, ATTENDANCE_PUBLIC } from '../../../modules/attendance/attendance-actions';
import { ASSISTANT_ACTIONS, ASSISTANT_PUBLIC } from '../../../modules/assistant/assistant-actions';
import { STUDENT_ACTIONS, STUDENT_PUBLIC } from '../../../modules/student/student-actions';
import { TRANSPORT_ACTIONS, TRANSPORT_PUBLIC } from '../../../modules/transport/transport-actions';
import { TIMETABLE_ACTIONS, TIMETABLE_PUBLIC } from '../../../modules/timetable/timetable-actions';
import { TIMETABLE_EXT_ACTIONS, TIMETABLE_EXT_PUBLIC } from '../../../modules/timetable-ext/timetable-ext-actions';
import { LEAVE_ACTIONS, LEAVE_PUBLIC } from '../../../modules/leave/leave-actions';
import { MEDICAL_ACTIONS, MEDICAL_PUBLIC } from '../../../modules/medical/medical-actions';
import { LAB_ACTIONS, LAB_PUBLIC } from '../../../modules/lab/lab-actions';
import { SPORT_ACTIONS, SPORT_PUBLIC } from '../../../modules/sports/sport-actions';
import { ASSET_ACTIONS, ASSET_PUBLIC } from '../../../modules/asset/asset-actions';
import { LIBRARY_ACTIONS, LIBRARY_PUBLIC } from '../../../modules/library/library-actions';
import { SUPPLY_ACTIONS, SUPPLY_PUBLIC } from '../../../modules/supplies/supply-actions';
import { UNIFORM_ACTIONS, UNIFORM_PUBLIC } from '../../../modules/uniform/uniform-actions';
import { SHOP_ACTIONS, SHOP_PUBLIC } from '../../../modules/shop/shop-actions';
import { FINE_ACTIONS, FINE_PUBLIC } from '../../../modules/fine/fine-actions';
import { HIRING_ACTIONS, HIRING_PUBLIC } from '../../../modules/hiring/hiring-actions';
import { HOMEWORK_ACTIONS, HOMEWORK_PUBLIC } from '../../../modules/homework/homework-actions';
import { OUTREACH_ACTIONS, OUTREACH_PUBLIC } from '../../../modules/outreach/outreach-actions';
import { WEBSITE_ACTIONS, WEBSITE_PUBLIC } from '../../../modules/website/website-actions';
import { ACADEMIC_CALENDAR_ACTIONS, ACADEMIC_CALENDAR_PUBLIC } from '../../../modules/academic-calendar/academic-calendar-actions';
import { FEEDBACK_ACTIONS, FEEDBACK_PUBLIC } from '../../../modules/feedback/feedback-actions';
import { PROGRAMME_ACTIONS, PROGRAMME_PUBLIC } from '../../../modules/programmes/programmes-actions';
import { ASSEMBLY_ACTIONS, ASSEMBLY_PUBLIC } from '../../../modules/assembly/assembly-actions';

// One coverage guard for every gated module: each `handler:` in the module's
// *-endpoints.yml must have an explicit authorization decision — gated (in the
// <M>_ACTIONS map) or explicitly public (<M>_PUBLIC). Adding an endpoint without a
// decision fails here, so no route is ever silently left ungated. Add a row to
// MODULES when a new module is gated.
const MODULES: Array<{ name: string; yml: string; actions: Record<string, string>; pub: string[] }> = [
  { name: 'fees', yml: 'modules/fees/fees-endpoints.yml', actions: FEE_ACTIONS, pub: FEE_PUBLIC },
  { name: 'fees-ext', yml: 'modules/fees-ext/fees-ext-endpoints.yml', actions: FEE_EXT_ACTIONS, pub: FEE_EXT_PUBLIC },
  { name: 'transfer', yml: 'modules/transfer/transfer-endpoints.yml', actions: TRANSFER_ACTIONS, pub: TRANSFER_PUBLIC },
  { name: 'employee', yml: 'modules/employee/employee-endpoints.yml', actions: EMPLOYEE_ACTIONS, pub: EMPLOYEE_PUBLIC },
  { name: 'communication', yml: 'modules/communication/communication-endpoints.yml', actions: COMMUNICATION_ACTIONS, pub: COMMUNICATION_PUBLIC },
  { name: 'attendance', yml: 'modules/attendance/attendance-endpoints.yml', actions: ATTENDANCE_ACTIONS, pub: ATTENDANCE_PUBLIC },
  { name: 'assistant', yml: 'modules/assistant/assistant-endpoints.yml', actions: ASSISTANT_ACTIONS, pub: ASSISTANT_PUBLIC },
  { name: 'student', yml: 'modules/student/student-endpoints.yml', actions: STUDENT_ACTIONS, pub: STUDENT_PUBLIC },
  { name: 'transport', yml: 'modules/transport/transport-endpoints.yml', actions: TRANSPORT_ACTIONS, pub: TRANSPORT_PUBLIC },
  { name: 'timetable', yml: 'modules/timetable/timetable-endpoints.yml', actions: TIMETABLE_ACTIONS, pub: TIMETABLE_PUBLIC },
  { name: 'timetable-ext', yml: 'modules/timetable-ext/timetable-ext-endpoints.yml', actions: TIMETABLE_EXT_ACTIONS, pub: TIMETABLE_EXT_PUBLIC },
  { name: 'leave', yml: 'modules/leave/leave-endpoints.yml', actions: LEAVE_ACTIONS, pub: LEAVE_PUBLIC },
  { name: 'medical', yml: 'modules/medical/medical-endpoints.yml', actions: MEDICAL_ACTIONS, pub: MEDICAL_PUBLIC },
  { name: 'lab', yml: 'modules/lab/lab-endpoints.yml', actions: LAB_ACTIONS, pub: LAB_PUBLIC },
  { name: 'sports', yml: 'modules/sports/sport-endpoints.yml', actions: SPORT_ACTIONS, pub: SPORT_PUBLIC },
  { name: 'asset', yml: 'modules/asset/asset-endpoints.yml', actions: ASSET_ACTIONS, pub: ASSET_PUBLIC },
  { name: 'library', yml: 'modules/library/library-endpoints.yml', actions: LIBRARY_ACTIONS, pub: LIBRARY_PUBLIC },
  { name: 'supplies', yml: 'modules/supplies/supply-endpoints.yml', actions: SUPPLY_ACTIONS, pub: SUPPLY_PUBLIC },
  { name: 'uniform', yml: 'modules/uniform/uniform-endpoints.yml', actions: UNIFORM_ACTIONS, pub: UNIFORM_PUBLIC },
  { name: 'shop', yml: 'modules/shop/shop-endpoints.yml', actions: SHOP_ACTIONS, pub: SHOP_PUBLIC },
  { name: 'fine', yml: 'modules/fine/fine-endpoints.yml', actions: FINE_ACTIONS, pub: FINE_PUBLIC },
  { name: 'hiring', yml: 'modules/hiring/hiring-endpoints.yml', actions: HIRING_ACTIONS, pub: HIRING_PUBLIC },
  { name: 'homework', yml: 'modules/homework/homework-endpoints.yml', actions: HOMEWORK_ACTIONS, pub: HOMEWORK_PUBLIC },
  { name: 'outreach', yml: 'modules/outreach/outreach-endpoints.yml', actions: OUTREACH_ACTIONS, pub: OUTREACH_PUBLIC },
  { name: 'website', yml: 'modules/website/website-endpoints.yml', actions: WEBSITE_ACTIONS, pub: WEBSITE_PUBLIC },
  { name: 'academic-calendar', yml: 'modules/academic-calendar/academic-calendar-endpoints.yml', actions: ACADEMIC_CALENDAR_ACTIONS, pub: ACADEMIC_CALENDAR_PUBLIC },
  { name: 'feedback', yml: 'modules/feedback/feedback-endpoints.yml', actions: FEEDBACK_ACTIONS, pub: FEEDBACK_PUBLIC },
  { name: 'programmes', yml: 'modules/programmes/programmes-endpoints.yml', actions: PROGRAMME_ACTIONS, pub: PROGRAMME_PUBLIC },
  { name: 'assembly', yml: 'modules/assembly/assembly-endpoints.yml', actions: ASSEMBLY_ACTIONS, pub: ASSEMBLY_PUBLIC },
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
