import { Lesson, Placement, SolverInput, Timetable, ValidationIssue } from './types';
import { getDay, firstTeachingSlot } from './grid';
import { checkHardTeacherConstraints, expandOccupancy } from './constraint-checks';

// Independent re-check of every HARD rule. Used by tests (as the solver oracle)
// and by validate-move. When `requireComplete` is true it also checks that every
// lesson is placed and that each class's first daily teaching slot is its pin.
export function validateTimetable(input: SolverInput, timetable: Timetable, requireComplete = true): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lessonsById = new Map<string, Lesson>(input.lessons.map((l) => [l.id, l]));
  const placements = timetable.placements;

  // 1. Each placement's slots must be valid teaching slots, contiguous, size-matched.
  for (const p of placements) {
    const lesson = lessonsById.get(p.lessonId);
    if (!lesson) { issues.push({ rule: 'unknown_lesson', message: `placement references unknown lesson ${p.lessonId}` }); continue; }
    if (p.slotIds.length !== lesson.size) {
      issues.push({ rule: 'size_mismatch', message: `lesson ${p.lessonId} needs ${lesson.size} slots, got ${p.slotIds.length}` });
    }
    const day = getDay(input.grid, p.dayOfWeek);
    if (!day) { issues.push({ rule: 'invalid_day', message: `lesson ${p.lessonId} placed on non-existent day ${p.dayOfWeek}` }); continue; }
    const teachingByseq = new Map(day.slots.filter((s) => s.slotType === 'teaching').map((s) => [s.sequence, s.slotId]));
    for (let k = 0; k < p.slotIds.length; k++) {
      const seq = p.startSequence + k;
      const expected = teachingByseq.get(seq);
      if (!expected) issues.push({ rule: 'non_teaching_slot', message: `lesson ${p.lessonId} occupies a non-teaching/missing slot at day ${p.dayOfWeek} seq ${seq}` });
      else if (expected !== p.slotIds[k]) issues.push({ rule: 'slot_mismatch', message: `lesson ${p.lessonId} slot id mismatch at day ${p.dayOfWeek} seq ${seq}` });
    }
  }

  // 2. No class double-booked: at most one placement per (class, day, sequence).
  const classSlot = new Map<string, string>();
  for (const p of placements) {
    for (let k = 0; k < p.size; k++) {
      const key = `${p.classId}|${p.dayOfWeek}|${p.startSequence + k}`;
      if (classSlot.has(key)) {
        issues.push({ rule: 'class_double_book', message: `class ${p.classId} double-booked at day ${p.dayOfWeek} seq ${p.startSequence + k}` });
      } else {
        classSlot.set(key, p.lessonId);
      }
    }
  }

  // 3. No teacher double-booked.
  const teacherSlot = new Map<string, string>();
  for (const o of expandOccupancy(placements)) {
    const key = `${o.teacherId}|${o.day}|${o.sequence}`;
    if (teacherSlot.has(key)) {
      issues.push({ rule: 'teacher_double_book', message: `teacher ${o.teacherId} double-booked at day ${o.day} seq ${o.sequence}` });
    } else {
      teacherSlot.set(key, o.slotId);
    }
  }

  // 4. Class-teacher pin: each pinned lesson sits at the first teaching slot of its day.
  for (const p of placements) {
    const lesson = lessonsById.get(p.lessonId);
    if (!lesson?.pinnedDay) continue;
    const day = getDay(input.grid, lesson.pinnedDay);
    const first = day ? firstTeachingSlot(day) : undefined;
    if (!first || p.dayOfWeek !== lesson.pinnedDay || p.startSequence !== first.sequence) {
      issues.push({ rule: 'class_teacher_pin', message: `class-teacher pin ${p.lessonId} is not at the first teaching slot of day ${lesson.pinnedDay}` });
    }
  }

  // 5. Block rules: maxPerDay / notTwiceSameDay per group.
  const groupDayCount = new Map<string, number>();
  for (const p of placements) {
    const lesson = lessonsById.get(p.lessonId);
    if (!lesson?.groupKey) continue;
    const key = `${lesson.groupKey}|${p.dayOfWeek}`;
    groupDayCount.set(key, (groupDayCount.get(key) || 0) + 1);
  }
  for (const lesson of input.lessons) {
    if (!lesson.groupKey) continue;
    for (const p of placements) {
      if (p.lessonId !== lesson.id) continue;
      const key = `${lesson.groupKey}|${p.dayOfWeek}`;
      const count = groupDayCount.get(key) || 0;
      if (lesson.notTwiceSameDay && count > 1) {
        issues.push({ rule: 'not_twice_same_day', message: `group ${lesson.groupKey} appears ${count} times on day ${p.dayOfWeek}` });
      }
      if (lesson.maxPerDay !== undefined && count > lesson.maxPerDay) {
        issues.push({ rule: 'max_per_day', message: `group ${lesson.groupKey} exceeds maxPerDay ${lesson.maxPerDay} on day ${p.dayOfWeek} (${count})` });
      }
      break;
    }
  }

  // 6. Hard teacher constraints.
  issues.push(...checkHardTeacherConstraints(placements, input.constraints));

  // 7. Completeness.
  if (requireComplete) {
    const placedIds = new Set(placements.map((p) => p.lessonId));
    for (const lesson of input.lessons) {
      if (!placedIds.has(lesson.id)) issues.push({ rule: 'unplaced_lesson', message: `lesson ${lesson.id} (${lesson.groupKey || ''}) was not placed` });
    }
    // Where a class-teacher pin exists for (class, day), it must own the first
    // teaching slot of that day. (Classes without a configured class teacher are
    // not forced — config completeness is the admin's responsibility.)
    const pinByClassDay = new Set<string>();
    for (const l of input.lessons) {
      if (l.pinnedDay) pinByClassDay.add(`${l.classId}|${l.pinnedDay}`);
    }
    for (const classId of input.classIds) {
      for (const day of input.grid.days) {
        if (!pinByClassDay.has(`${classId}|${day.dayOfWeek}`)) continue;
        const first = firstTeachingSlot(day);
        if (!first) continue;
        const occupant = classSlot.get(`${classId}|${day.dayOfWeek}|${first.sequence}`);
        const lesson = occupant ? lessonsById.get(occupant) : undefined;
        if (!lesson || lesson.pinnedDay !== day.dayOfWeek || lesson.classId !== classId) {
          issues.push({ rule: 'first_period_not_class_teacher', message: `class ${classId} day ${day.dayOfWeek} first period is not the class teacher's` });
        }
      }
    }
  }

  // De-duplicate identical messages.
  const seen = new Set<string>();
  return issues.filter((i) => { const k = `${i.rule}|${i.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function isValid(input: SolverInput, timetable: Timetable, requireComplete = true): boolean {
  return validateTimetable(input, timetable, requireComplete).length === 0;
}
