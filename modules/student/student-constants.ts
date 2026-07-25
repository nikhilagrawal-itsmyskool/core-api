// Student module constants.

// Default password for student family logins (same as employee logins). Set on
// first login-row creation and on admin reset.
export const DEFAULT_PASSWORD = 'Itsmyskool@123';

export const STATUS_VALUES = ['active', 'inactive', 'deleted'] as const;

export const GUARDIAN_RELATIONS = ['father', 'mother', 'guardian', 'other'] as const;

// camelCase response keys carrying a sensitive contact/identity value on a student
// row. Masked for non admin/god callers. `familyUniqueNumber` = father's mobile
// (family-login username); `aadhaarNumber` = national ID (more sensitive than a phone).
export const STUDENT_MASKED_FIELDS = [
  'studentMobile',
  'studentWhatsapp',
  'fatherMobile',
  'fatherWhatsapp',
  'motherMobile',
  'motherWhatsapp',
  'guardianMobile',
  'guardianWhatsapp',
  'familyUniqueNumber',
  'aadhaarNumber',
] as const;

export const GENDERS = ['M', 'F', 'O'] as const;

// Photo upload guards (student & guardian photos go to shared file_storage).
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const PHOTO_ALLOWED_MIME = ['image/jpeg', 'image/png'] as const;

export const PHOTO_ENTITY_TYPES = ['student', 'guardian'] as const;

// Photo variants: the full-size image and a small thumbnail.
export const PHOTO_VARIANTS = ['original', 'thumb'] as const;

export const DEFAULTS = {
  STATUS: 'active',
  PHOTO_VARIANT: 'original',
  COUNTRY_CODE: 'india',
  NATIONALITY_CODE: 'indian',
} as const;

// ---- Per-school lookups (student_lookup) ----

// All valid lookup types. `city` and `locality` are auto-created on first use
// (start empty); the rest are seeded per school on first access.
export const LOOKUP_TYPES = [
  'category',
  'blood_group',
  'nationality',
  'country',
  'mother_tongue',
  'relationship',
  'state',
  'city',
  'locality',
] as const;

// Types whose values are created on demand during data entry (reuse exact code,
// else insert). They are not pre-seeded.
export const AUTO_CREATE_TYPES = ['city', 'locality'] as const;

type LookupSeed = { code: string; label: string; extra?: any };

const STATE_SEEDS: LookupSeed[] = [
  ['andhra-pradesh', 'Andhra Pradesh'],
  ['arunachal-pradesh', 'Arunachal Pradesh'],
  ['assam', 'Assam'],
  ['bihar', 'Bihar'],
  ['chhattisgarh', 'Chhattisgarh'],
  ['goa', 'Goa'],
  ['gujarat', 'Gujarat'],
  ['haryana', 'Haryana'],
  ['himachal-pradesh', 'Himachal Pradesh'],
  ['jharkhand', 'Jharkhand'],
  ['karnataka', 'Karnataka'],
  ['kerala', 'Kerala'],
  ['madhya-pradesh', 'Madhya Pradesh'],
  ['maharashtra', 'Maharashtra'],
  ['manipur', 'Manipur'],
  ['meghalaya', 'Meghalaya'],
  ['mizoram', 'Mizoram'],
  ['nagaland', 'Nagaland'],
  ['odisha', 'Odisha'],
  ['punjab', 'Punjab'],
  ['rajasthan', 'Rajasthan'],
  ['sikkim', 'Sikkim'],
  ['tamil-nadu', 'Tamil Nadu'],
  ['telangana', 'Telangana'],
  ['tripura', 'Tripura'],
  ['uttar-pradesh', 'Uttar Pradesh'],
  ['uttarakhand', 'Uttarakhand'],
  ['west-bengal', 'West Bengal'],
  ['andaman-and-nicobar-islands', 'Andaman and Nicobar Islands'],
  ['chandigarh', 'Chandigarh'],
  ['dadra-and-nagar-haveli-and-daman-and-diu', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['delhi', 'Delhi'],
  ['jammu-and-kashmir', 'Jammu and Kashmir'],
  ['ladakh', 'Ladakh'],
  ['lakshadweep', 'Lakshadweep'],
  ['puducherry', 'Puducherry'],
].map(([code, label]) => ({ code, label }));

// Only types present here are seeded on first use. city/locality intentionally absent.
export const LOOKUP_SEEDS: Record<string, LookupSeed[]> = {
  category: [
    { code: 'general', label: 'General' },
    { code: 'obc', label: 'OBC' },
    { code: 'sc', label: 'SC' },
    { code: 'st', label: 'ST' },
    { code: 'ews', label: 'EWS' },
  ],
  blood_group: [
    { code: 'a+', label: 'A+' },
    { code: 'a-', label: 'A-' },
    { code: 'b+', label: 'B+' },
    { code: 'b-', label: 'B-' },
    { code: 'ab+', label: 'AB+' },
    { code: 'ab-', label: 'AB-' },
    { code: 'o+', label: 'O+' },
    { code: 'o-', label: 'O-' },
  ],
  nationality: [{ code: 'indian', label: 'Indian' }],
  country: [{ code: 'india', label: 'India' }],
  mother_tongue: [
    { code: 'hindi', label: 'Hindi' },
    { code: 'english', label: 'English' },
    { code: 'urdu', label: 'Urdu' },
  ],
  relationship: [
    { code: 'father', label: 'Father' },
    { code: 'mother', label: 'Mother' },
    { code: 'uncle', label: 'Uncle' },
    { code: 'aunt', label: 'Aunt' },
    { code: 'brother', label: 'Brother' },
    { code: 'sister', label: 'Sister' },
    { code: 'grandfather', label: 'Grandfather' },
    { code: 'grandmother', label: 'Grandmother' },
    { code: 'other', label: 'Other' },
  ],
  state: STATE_SEEDS,
};

export type StatusValue = typeof STATUS_VALUES[number];
export type GuardianRelation = typeof GUARDIAN_RELATIONS[number];
export type Gender = typeof GENDERS[number];
export type PhotoEntityType = typeof PHOTO_ENTITY_TYPES[number];
export type PhotoVariant = typeof PHOTO_VARIANTS[number];
export type LookupType = typeof LOOKUP_TYPES[number];
