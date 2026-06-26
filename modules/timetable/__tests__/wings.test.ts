import { crossWingTeacherWarnings } from '../cross-wing';
import { buildLessons } from '../solver';

// Pure unit tests (no server) for the per-wing generation helpers.

describe('crossWingTeacherWarnings', () => {
  const pairs = [
    { teacherId: 'T1', classId: 'M1' }, // middle only
    { teacherId: 'T1', classId: 'M2' },
    { teacherId: 'T2', classId: 'M1' }, // shared: middle + senior
    { teacherId: 'T2', classId: 'S1' },
    { teacherId: 'T3', classId: 'S1' }, // senior only
  ];
  const middle = ['M1', 'M2'];

  it('warns only for teachers who teach both inside and outside the wing', () => {
    const warnings = crossWingTeacherWarnings(pairs, middle);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/Teacher T2/);
    expect(warnings.join(' ')).not.toMatch(/T1|T3/);
  });

  it('returns no warnings when the wing is teacher-disjoint', () => {
    const disjoint = [
      { teacherId: 'T1', classId: 'M1' },
      { teacherId: 'T3', classId: 'S1' },
    ];
    expect(crossWingTeacherWarnings(disjoint, middle)).toEqual([]);
  });

  it('ignores empty/teacher-less pairs', () => {
    expect(crossWingTeacherWarnings([{ teacherId: '', classId: 'M1' }], middle)).toEqual([]);
  });
});

describe('wing-scoped build input', () => {
  // The data-loader filters class_subject/teaching_assignment/etc. to the wing's
  // classes before buildLessons. Simulate that filter and assert only wing
  // classes produce lessons (mirrors loadConfigForSolve's wingClassIds filter).
  it('produces lessons only for the wing classes', () => {
    const all = {
      classSubjects: [
        { classId: 'M1', subjectId: 'MATH', periodsPerWeek: 3 },
        { classId: 'S1', subjectId: 'PHY', periodsPerWeek: 3 },
      ],
      teachingAssignments: [
        { classId: 'M1', subjectId: 'MATH', teacherId: 'T1' },
        { classId: 'S1', subjectId: 'PHY', teacherId: 'T2' },
      ],
    };
    const wing = new Set(['M1']);
    const { lessons } = buildLessons({
      classIds: ['M1'],
      teachingDays: [1, 2, 3],
      classSubjects: all.classSubjects.filter((c) => wing.has(c.classId)),
      teachingAssignments: all.teachingAssignments.filter((a) => wing.has(a.classId)),
      classTeachers: [],
      electiveBands: [],
    });
    expect(lessons.length).toBe(3); // only M1's MATH
    expect(lessons.every((l) => l.classId === 'M1')).toBe(true);
    expect(lessons.some((l) => l.classId === 'S1')).toBe(false);
  });
});
