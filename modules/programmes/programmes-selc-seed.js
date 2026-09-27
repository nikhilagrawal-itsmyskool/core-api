/**
 * Seed vocabulary for the "Spoken English & Life Communication" programme (SELC),
 * transcribed from the frozen ERP specification (Developer Handover §4, §6–§9).
 * CommonJS so the CLI importer (scripts/import-programmes.js) can require it.
 * This is DATA — a second programme (Scout, …) ships its own seed file.
 */

const PROGRAMME = {
  code: "SELC",
  name: "Spoken English & Life Communication",
  motto: "Communicate with Clarity, Confidence, Courtesy & Purpose",
  philosophy:
    "English is the medium. Communication is the skill. Thinking is the foundation. Life is the context. Responsible action is the outcome.",
};

// §6 — the 15 monthly fields (code -> heading), in display order.
const FIELD_TYPES = [
  { code: "F01", name: "Theme" },
  { code: "F02", name: "Life Connection" },
  { code: "F03", name: "Learning Outcomes" },
  { code: "F04", name: "Key Vocabulary" },
  { code: "F05", name: "Communication Expressions / Sentence Frames" },
  { code: "F06", name: "Model Conversation" },
  { code: "F07", name: "Listening Task" },
  { code: "F08", name: "Picture Talk / Observation" },
  { code: "F09", name: "Story / Narration" },
  { code: "F10", name: "Situational Communication & Role Play" },
  { code: "F11", name: "Think & Speak" },
  { code: "F12", name: "Pair / Group Activity" },
  { code: "F13", name: "Monthly Speaking Task" },
  { code: "F14", name: "Teacher Guidance" },
  { code: "F15", name: "Assessment / Observation" },
];

// §7 — the 15 controlled material types.
const MATERIAL_TYPES = [
  { code: "MT01", name: "Vocabulary" },
  { code: "MT02", name: "Useful Expressions" },
  { code: "MT03", name: "Sentence Frames" },
  { code: "MT04", name: "Conversation" },
  { code: "MT05", name: "Listening Task" },
  { code: "MT06", name: "Situational Communication" },
  { code: "MT07", name: "Picture Talk" },
  { code: "MT08", name: "Story" },
  { code: "MT09", name: "Role Play" },
  { code: "MT10", name: "Pair Activity" },
  { code: "MT11", name: "Group Activity" },
  { code: "MT12", name: "Think & Speak" },
  { code: "MT13", name: "Presentation" },
  { code: "MT14", name: "Teacher Notes" },
  { code: "MT15", name: "Assessment" },
];

// §9 — the 24 controlled domains.
const DOMAINS = [
  { code: "D01", name: "Myself & My Identity" },
  { code: "D02", name: "Family & Relationships" },
  { code: "D03", name: "Home & Daily Life" },
  { code: "D04", name: "School & Learning" },
  { code: "D05", name: "Friends & Social Interaction" },
  { code: "D06", name: "Health, Hygiene & Well-being" },
  { code: "D07", name: "Food & Nutrition" },
  { code: "D08", name: "Nature & Environment" },
  { code: "D09", name: "Animals & Living World" },
  { code: "D10", name: "Community & People Around Us" },
  { code: "D11", name: "India & Our Heritage" },
  { code: "D12", name: "Festivals, Culture & Traditions" },
  { code: "D13", name: "Values, Character & Good Conduct" },
  { code: "D14", name: "Emotions & Emotional Expression" },
  { code: "D15", name: "Safety & Responsible Behaviour" },
  { code: "D16", name: "Time, Planning & Personal Responsibility" },
  { code: "D17", name: "Money & Financial Awareness" },
  { code: "D18", name: "Travel, Directions & Public Places" },
  { code: "D19", name: "Technology & Digital Life" },
  { code: "D20", name: "Stories, Literature & Imagination" },
  { code: "D21", name: "Creativity, Hobbies & Interests" },
  { code: "D22", name: "Problem Solving & Decision Making" },
  { code: "D23", name: "Leadership, Teamwork & Citizenship" },
  { code: "D24", name: "Career, Future & Independent Life" },
];

// §8 — the controlled skills, grouped by category.
const SKILLS = [
  ["Foundational Communication", "Listening"],
  ["Foundational Communication", "Understanding"],
  ["Foundational Communication", "Speaking"],
  ["Foundational Communication", "Vocabulary"],
  ["Foundational Communication", "Pronunciation"],
  ["Foundational Communication", "Questioning"],
  ["Foundational Communication", "Description"],
  ["Foundational Communication", "Narration"],
  ["Foundational Communication", "Interaction"],
  ["Thinking & Communication", "Explanation"],
  ["Thinking & Communication", "Reasoning"],
  ["Thinking & Communication", "Comparison"],
  ["Thinking & Communication", "Discussion"],
  ["Thinking & Communication", "Analysis"],
  ["Thinking & Communication", "Evidence / Source Evaluation"],
  ["Thinking & Communication", "Problem Solving"],
  ["Thinking & Communication", "Decision Making"],
  ["Thinking & Communication", "Argument"],
  ["Thinking & Communication", "Presentation"],
  ["Thinking & Communication", "Adaptation"],
  ["Life Communication", "Emotional / Social Communication"],
  ["Life Communication", "Safety Communication"],
  ["Life Communication", "Financial Communication"],
  ["Life Communication", "Consumer Communication"],
  ["Life Communication", "Digital Communication"],
  ["Life Communication", "Academic Communication"],
  ["Life Communication", "Professional Communication"],
  ["Life Communication", "Independent-Life Communication"],
  ["Advanced Communication", "Negotiation"],
  ["Advanced Communication", "Leadership"],
  ["Advanced Communication", "Responsible Communication"],
].map(([category, name]) => ({ category, name }));

// §4 — per-grade developmental stage master (grade, band, master focus, emphasis, band).
const STAGES = [
  ["Nursery", "Early Years", "Recognise → Listen → Respond", "Listen → Understand → Respond → Speak → Interact", "early"],
  ["LKG", "Early Years", "Ask → Answer → Describe", "Ask → Answer → Describe → Connect → Express", "early"],
  ["UKG", "Early Years", "Describe → Connect → Express", "Describe → Connect → Express → Explain → Narrate", "early"],
  ["I", "Primary Foundation", "Interact → Narrate → Request → Explain", "Functional everyday interaction", "i_viii"],
  ["II", "Primary Foundation", "Interact → Narrate → Request → Explain → Respond", "Responsive continuation and clarification", "i_viii"],
  ["III", "Primary Development", "Explain → Reason → Solve", "Transition to purposeful reasoning", "i_viii"],
  ["IV", "Primary Development", "Explain → Reason → Solve → Discuss", "Reasoned discussion", "i_viii"],
  ["V", "Primary Development", "Explain → Reason → Solve → Discuss → Present", "Organised presentation", "i_viii"],
  ["VI", "Middle", "Discuss → Analyse → Respond", "Discuss & Examine", "i_viii"],
  ["VII", "Middle", "Discuss → Analyse → Respond", "Discuss & Evaluate", "i_viii"],
  ["VIII", "Middle", "Discuss → Analyse → Respond", "Discuss, Evaluate & Defend", "i_viii"],
  ["IX", "Secondary", "Argue → Present → Adapt", "Formal argument and evidence-aware presentation", "ix_xii"],
  ["X", "Secondary", "Argue → Present → Adapt", "Greater independent judgement and register adaptation", "ix_xii"],
  ["XI", "Senior Secondary", "Communicate → Negotiate → Function Independently", "Functional academic/professional/independent-life communication", "ix_xii"],
  ["XII", "Senior Secondary", "Communicate → Negotiate → Lead → Function Independently", "Programme culmination: independent, responsible leadership communication", "ix_xii"],
].map(([grade, band, masterFocus, emphasis, assessmentBand]) => ({
  grade,
  developmentalBand: band,
  masterFocus,
  stageEmphasis: emphasis,
  assessmentBand,
}));

// A few class modules use a focus-skill wording that isn't a canonical §8 skill.
// Map it to the closest master skill so the focus skill still links. (Keyed by
// lower-cased source name -> canonical master skill name.)
const SKILL_ALIASES = {
  responsiveness: "Interaction",
};

// Maps a class-module filename to its grade string (the 15 source .docx files).
// The importer uses this when a file's grade can't be auto-detected.
function gradeFromFilename(fileName) {
  const base = (fileName || "").replace(/\.docx$/i, "");
  let m = base.match(/^\s*Class\s+([IVXL]+)\b/i);
  if (m) return m[1].toUpperCase();
  m = base.match(/^\s*(Nursery|LKG|UKG)\b/i);
  if (m) return m[1].replace(/^(nursery|lkg|ukg)$/i, (s) =>
    s.length === 3 ? s.toUpperCase() : s[0].toUpperCase() + s.slice(1).toLowerCase());
  return null;
}

module.exports = {
  PROGRAMME,
  FIELD_TYPES,
  MATERIAL_TYPES,
  DOMAINS,
  SKILLS,
  STAGES,
  SKILL_ALIASES,
  gradeFromFilename,
};
