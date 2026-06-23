// Library module constants.
//
// DDC summaries are seeded into the global `library_ddc` table on first use
// (see library-ddc-service). Per-school managed lookups (color, age band,
// almirah, shelf, edition, publisher, source) live in `library_lookup`; the
// seeds below populate the ones with sensible defaults on first use.

// ---- Fixed enums ----

export const LANGUAGES = [
  { value: "english", label: "English", letter: "E" },
  { value: "hindi", label: "Hindi", letter: "H" },
  { value: "bilingual", label: "Bilingual", letter: "B" },
] as const;

// Language code letter used as the trailing element of the local call number.
export const LANGUAGE_LETTER: Record<string, string> = {
  english: "E",
  hindi: "H",
  bilingual: "B",
};

export const COPY_STATUSES = [
  { value: "available", label: "Available" },
  { value: "issued", label: "Issued" },
  { value: "lost", label: "Lost" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "damaged", label: "Damaged" },
] as const;

export const BOOK_CONDITIONS = [
  { value: "new", label: "New" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "damaged", label: "Damaged" },
  { value: "poor", label: "Poor" },
] as const;

export const CIRCULATION_STATUSES = ["issued", "returned", "lost"] as const;
export const BORROWER_TYPES = ["student", "employee"] as const;
export const FINE_TYPES = ["overdue", "lost"] as const;
export const FINE_STATUSES = ["pending", "paid", "waived"] as const;
export const LOST_CHARGE_MODES = ["price", "fixed", "multiplier"] as const;
export const LOOKUP_TYPES = [
  "color",
  "age_band",
  "almirah",
  "shelf",
  "edition",
  "publisher",
  "source",
] as const;
export const STATUS_VALUES = ["active", "deleted"] as const;

// ---- Author normalization ----

// Honorifics / titles stripped before parsing a name. Excluded from the Cutter
// and not stored. Matched case-insensitively, with or without a trailing dot.
export const HONORIFICS = [
  "dr",
  "mr",
  "mrs",
  "ms",
  "miss",
  "prof",
  "professor",
  "sir",
  "madam",
  "shri",
  "sri",
  "smt",
  "kum",
  "kumari",
  "pt",
  "pandit",
  "late",
  "rev",
  "capt",
  "captain",
  "col",
  "colonel",
  "maj",
  "major",
  "gen",
  "lt",
];

// Name suffixes stripped from the end (excluded from the Cutter).
export const NAME_SUFFIXES = [
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "phd",
  "md",
  "esq",
];

// Minimal Devanagari -> Roman map for building the Cutter from a Hindi surname.
// Maps independent vowels and base consonants to their Roman form; matras and
// halant are dropped (good enough for a 3-letter author mark). Falls back to
// the raw character when unmapped.
export const DEVANAGARI_TO_ROMAN: Record<string, string> = {
  अ: "a",
  आ: "aa",
  इ: "i",
  ई: "ii",
  उ: "u",
  ऊ: "uu",
  ए: "e",
  ऐ: "ai",
  ओ: "o",
  औ: "au",
  ऋ: "ri",
  क: "k",
  ख: "kh",
  ग: "g",
  घ: "gh",
  ङ: "n",
  च: "ch",
  छ: "chh",
  ज: "j",
  झ: "jh",
  ञ: "n",
  ट: "t",
  ठ: "th",
  ड: "d",
  ढ: "dh",
  ण: "n",
  त: "t",
  थ: "th",
  द: "d",
  ध: "dh",
  न: "n",
  प: "p",
  फ: "ph",
  ब: "b",
  भ: "bh",
  म: "m",
  य: "y",
  र: "r",
  ल: "l",
  व: "v",
  श: "sh",
  ष: "sh",
  स: "s",
  ह: "h",
  क्ष: "ksh",
  त्र: "tr",
  ज्ञ: "gy",
  ड़: "r",
  ढ़: "rh",
  फ़: "f",
  ज़: "z",
};

// ---- DDC summaries (publicly usable: 10 classes + 100 divisions) ----
// Selecting a division fills ddc_number (the division code), subject_type
// (its parent class label) and topic (the division label) on the work. The
// decimal/section refinement (e.g. 954.04) is entered free-form on top.

export const DDC_CLASSES: { code: string; label: string }[] = [
  { code: "000", label: "Computer science, information & general works" },
  { code: "100", label: "Philosophy & psychology" },
  { code: "200", label: "Religion" },
  { code: "300", label: "Social sciences" },
  { code: "400", label: "Language" },
  { code: "500", label: "Science" },
  { code: "600", label: "Technology" },
  { code: "700", label: "Arts & recreation" },
  { code: "800", label: "Literature" },
  { code: "900", label: "History & geography" },
];

export const DDC_DIVISIONS: { code: string; label: string; parent: string }[] =
  [
    {
      code: "000",
      label: "Computer science, knowledge & systems",
      parent: "000",
    },
    { code: "010", label: "Bibliographies", parent: "000" },
    { code: "020", label: "Library & information sciences", parent: "000" },
    { code: "030", label: "Encyclopedias & books of facts", parent: "000" },
    { code: "040", label: "Unassigned", parent: "000" },
    { code: "050", label: "Magazines, journals & serials", parent: "000" },
    {
      code: "060",
      label: "Associations, organizations & museums",
      parent: "000",
    },
    {
      code: "070",
      label: "News media, journalism & publishing",
      parent: "000",
    },
    { code: "080", label: "Quotations", parent: "000" },
    { code: "090", label: "Manuscripts & rare books", parent: "000" },
    { code: "100", label: "Philosophy", parent: "100" },
    { code: "110", label: "Metaphysics", parent: "100" },
    { code: "120", label: "Epistemology", parent: "100" },
    { code: "130", label: "Parapsychology & occultism", parent: "100" },
    { code: "140", label: "Philosophical schools of thought", parent: "100" },
    { code: "150", label: "Psychology", parent: "100" },
    { code: "160", label: "Logic", parent: "100" },
    { code: "170", label: "Ethics", parent: "100" },
    {
      code: "180",
      label: "Ancient, medieval & eastern philosophy",
      parent: "100",
    },
    { code: "190", label: "Modern western philosophy", parent: "100" },
    { code: "200", label: "Religion", parent: "200" },
    { code: "210", label: "Philosophy & theory of religion", parent: "200" },
    { code: "220", label: "The Bible", parent: "200" },
    { code: "230", label: "Christianity", parent: "200" },
    { code: "240", label: "Christian practice & observance", parent: "200" },
    {
      code: "250",
      label: "Christian pastoral practice & religious orders",
      parent: "200",
    },
    {
      code: "260",
      label: "Christian organization, social work & worship",
      parent: "200",
    },
    { code: "270", label: "History of Christianity", parent: "200" },
    { code: "280", label: "Christian denominations", parent: "200" },
    { code: "290", label: "Other religions", parent: "200" },
    {
      code: "300",
      label: "Social sciences, sociology & anthropology",
      parent: "300",
    },
    { code: "310", label: "Statistics", parent: "300" },
    { code: "320", label: "Political science", parent: "300" },
    { code: "330", label: "Economics", parent: "300" },
    { code: "340", label: "Law", parent: "300" },
    {
      code: "350",
      label: "Public administration & military science",
      parent: "300",
    },
    { code: "360", label: "Social problems & social services", parent: "300" },
    { code: "370", label: "Education", parent: "300" },
    {
      code: "380",
      label: "Commerce, communications & transportation",
      parent: "300",
    },
    { code: "390", label: "Customs, etiquette & folklore", parent: "300" },
    { code: "400", label: "Language", parent: "400" },
    { code: "410", label: "Linguistics", parent: "400" },
    { code: "420", label: "English & Old English languages", parent: "400" },
    { code: "430", label: "German & related languages", parent: "400" },
    { code: "440", label: "French & related languages", parent: "400" },
    {
      code: "450",
      label: "Italian, Romanian & related languages",
      parent: "400",
    },
    { code: "460", label: "Spanish, Portuguese, Galician", parent: "400" },
    { code: "470", label: "Latin & Italic languages", parent: "400" },
    { code: "480", label: "Classical & modern Greek languages", parent: "400" },
    { code: "490", label: "Other languages", parent: "400" },
    { code: "500", label: "Science", parent: "500" },
    { code: "510", label: "Mathematics", parent: "500" },
    { code: "520", label: "Astronomy", parent: "500" },
    { code: "530", label: "Physics", parent: "500" },
    { code: "540", label: "Chemistry", parent: "500" },
    { code: "550", label: "Earth sciences & geology", parent: "500" },
    { code: "560", label: "Fossils & prehistoric life", parent: "500" },
    { code: "570", label: "Biology", parent: "500" },
    { code: "580", label: "Plants (Botany)", parent: "500" },
    { code: "590", label: "Animals (Zoology)", parent: "500" },
    { code: "600", label: "Technology", parent: "600" },
    { code: "610", label: "Medicine & health", parent: "600" },
    { code: "620", label: "Engineering", parent: "600" },
    { code: "630", label: "Agriculture", parent: "600" },
    { code: "640", label: "Home & family management", parent: "600" },
    { code: "650", label: "Management & public relations", parent: "600" },
    { code: "660", label: "Chemical engineering", parent: "600" },
    { code: "670", label: "Manufacturing", parent: "600" },
    { code: "680", label: "Manufacture for specific uses", parent: "600" },
    { code: "690", label: "Building & construction", parent: "600" },
    { code: "700", label: "Arts", parent: "700" },
    { code: "710", label: "Landscaping & area planning", parent: "700" },
    { code: "720", label: "Architecture", parent: "700" },
    { code: "730", label: "Sculpture, ceramics & metalwork", parent: "700" },
    { code: "740", label: "Drawing & decorative arts", parent: "700" },
    { code: "750", label: "Painting", parent: "700" },
    { code: "760", label: "Graphic arts", parent: "700" },
    { code: "770", label: "Photography & computer art", parent: "700" },
    { code: "780", label: "Music", parent: "700" },
    { code: "790", label: "Sports, games & entertainment", parent: "700" },
    { code: "800", label: "Literature, rhetoric & criticism", parent: "800" },
    { code: "810", label: "American literature in English", parent: "800" },
    { code: "820", label: "English & Old English literatures", parent: "800" },
    { code: "830", label: "German & related literatures", parent: "800" },
    { code: "840", label: "French & related literatures", parent: "800" },
    {
      code: "850",
      label: "Italian, Romanian & related literatures",
      parent: "800",
    },
    {
      code: "860",
      label: "Spanish, Portuguese, Galician literatures",
      parent: "800",
    },
    { code: "870", label: "Latin & Italic literatures", parent: "800" },
    {
      code: "880",
      label: "Classical & modern Greek literatures",
      parent: "800",
    },
    { code: "890", label: "Other literatures", parent: "800" },
    { code: "900", label: "History", parent: "900" },
    { code: "910", label: "Geography & travel", parent: "900" },
    { code: "920", label: "Biography & genealogy", parent: "900" },
    {
      code: "930",
      label: "History of ancient world (to ca. 499)",
      parent: "900",
    },
    { code: "940", label: "History of Europe", parent: "900" },
    { code: "950", label: "History of Asia", parent: "900" },
    { code: "960", label: "History of Africa", parent: "900" },
    { code: "970", label: "History of North America", parent: "900" },
    { code: "980", label: "History of South America", parent: "900" },
    { code: "990", label: "History of other areas", parent: "900" },
  ];

// ---- Per-school managed lookup seeds (defaults populated on first use) ----

// Color coding is driven by the DDC main class (the first digit of the call
// number) so books on the same subject shelve together with the same color.
// `ddcClass` is the leading digit ('0'-'9'); `code` is the stored colorCode.
export const DDC_CLASS_COLORS: {
  ddcClass: string;
  code: string;
  label: string;
  hex: string;
}[] = [
  { ddcClass: "0", code: "grey", label: "000 General & Computing", hex: "#757575" },
  { ddcClass: "1", code: "indigo", label: "100 Philosophy & Psychology", hex: "#5C6BC0" },
  { ddcClass: "2", code: "brown", label: "200 Religion", hex: "#6D4C41" },
  { ddcClass: "3", code: "orange", label: "300 Social Sciences", hex: "#FB8C00" },
  { ddcClass: "4", code: "teal", label: "400 Language", hex: "#00ACC1" },
  { ddcClass: "5", code: "blue", label: "500 Science", hex: "#1E88E5" },
  { ddcClass: "6", code: "green", label: "600 Technology", hex: "#43A047" },
  { ddcClass: "7", code: "red", label: "700 Arts & Recreation", hex: "#E53935" },
  { ddcClass: "8", code: "purple", label: "800 Literature", hex: "#8E24AA" },
  { ddcClass: "9", code: "yellow", label: "900 History & Geography", hex: "#FDD835" },
];

// Map a DDC number to its color code via the leading digit. Returns undefined
// when there is no usable DDC number.
export function colorForDdc(ddcNumber?: string | null): string | undefined {
  if (!ddcNumber) return undefined;
  const digit = ddcNumber.trim().charAt(0);
  return DDC_CLASS_COLORS.find((c) => c.ddcClass === digit)?.code;
}

export const AGE_BAND_SEEDS: { code: string; label: string }[] = [
  { code: "3-5", label: "3-5 years" },
  { code: "6-8", label: "6-8 years" },
  { code: "9-11", label: "9-11 years" },
  { code: "12-14", label: "12-14 years" },
  { code: "15-17", label: "15-17 years" },
  { code: "18+", label: "18+ years" },
];

// Lookup types that get default seeds on first use. Others (almirah, shelf,
// edition, publisher, source) are entirely school-defined and start empty.
export const LOOKUP_SEEDS: Record<
  string,
  { code: string; label: string; extra?: any }[]
> = {
  color: DDC_CLASS_COLORS.map((c) => ({
    code: c.code,
    label: c.label,
    extra: { hex: c.hex, ddcClass: c.ddcClass },
  })),
  age_band: AGE_BAND_SEEDS,
};

// ---- Defaults ----

export const DEFAULT_POLICY = {
  loanPeriodDays: 14,
  maxCopiesPerBorrower: 3,
  graceDays: 0,
  overdueRatePerDay: 1.0,
  maxFineCap: 500.0,
  renewLimit: 2,
  lostChargeMode: "multiplier" as const,
  lostChargeValue: 1.5,
};

export const DEFAULTS = {
  STATUS: "active",
  COPY_STATUS: "available",
  QUANTITY: 1,
  RECEIPT_PREFIX: "LIB",
} as const;

// ---- Type exports ----

// DDC standard subdivisions (Table 1) - appended to any class number. The most
// common in a school context; the cataloguer one-clicks these onto a base
// number (e.g. 796.358 + 092 -> 796.358092 for a cricket biography).
export const STANDARD_SUBDIVISIONS: { suffix: string; label: string }[] = [
  { suffix: "092", label: "Biography / a person" },
  { suffix: "0922", label: "Collected biography" },
  { suffix: "03", label: "Dictionary / encyclopedia" },
  { suffix: "05", label: "Periodical / serial" },
  { suffix: "09", label: "History & geography of the subject" },
  { suffix: "02", label: "Handbook / miscellany" },
  { suffix: "01", label: "Philosophy & theory" },
  { suffix: "083", label: "For children / young people" },
];

export type Language = (typeof LANGUAGES)[number]["value"];
export type CopyStatus = (typeof COPY_STATUSES)[number]["value"];
export type BookCondition = (typeof BOOK_CONDITIONS)[number]["value"];
export type CirculationStatus = (typeof CIRCULATION_STATUSES)[number];
export type BorrowerType = (typeof BORROWER_TYPES)[number];
export type FineType = (typeof FINE_TYPES)[number];
export type FineStatus = (typeof FINE_STATUSES)[number];
export type LostChargeMode = (typeof LOST_CHARGE_MODES)[number];
export type LookupType = (typeof LOOKUP_TYPES)[number];
export type StatusValue = (typeof STATUS_VALUES)[number];
