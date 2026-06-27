// Display-layer helper: feasibility/warning strings produced by the pure solver
// (build-lessons, feasibility, registration, cross-wing) embed raw 12-char ids
// (class, subject, teacher). This turns those ids into human labels for the API
// response without touching the solver, so its unit tests keep asserting on ids.

export interface SolverLabels {
  class: Map<string, string>; // id -> name
  subject: Map<string, string>; // id -> "name (code)"
  teacher: Map<string, string>; // id -> name
}

// Short uuids are exactly 12 lowercase-alphanumeric chars (shared/util/generate-uuid.js),
// so they never collide with words in the surrounding English text.
const ID = /[a-z0-9]{12}/g;

// Replace ids with labels. groupKey forms (`cs:<classId>:<subjectId>`) are flattened
// to "<class> <subject>" first; bare ids are then swapped one-for-one. Unknown ids
// (e.g. elective-band ids, out of scope) are left untouched.
export function humanizeMessages(
  messages: string[],
  labels: SolverLabels,
): string[] {
  const subjectOf = (id: string) => labels.subject.get(id) ?? id;
  const anyOf = (id: string) =>
    labels.class.get(id) ?? labels.subject.get(id) ?? labels.teacher.get(id);

  return messages.map((msg) =>
    msg
      // `cs:<classId>:<subjectId>` -> "<class> <subject>"
      .replace(
        /cs:([a-z0-9]{12}):([a-z0-9]{12})/g,
        (_m, c, s) => `${labels.class.get(c) ?? c} ${subjectOf(s)}`,
      )
      // any remaining standalone id -> its label (if known)
      .replace(ID, (id) => anyOf(id) ?? id),
  );
}
