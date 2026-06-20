export const SPORT_TYPES = [
  { value: 'cricket', label: 'Cricket' },
  { value: 'football', label: 'Football' },
  { value: 'hockey', label: 'Hockey' },
  { value: 'basketball', label: 'Basketball' },
  { value: 'volleyball', label: 'Volleyball' },
  { value: 'badminton', label: 'Badminton' },
  { value: 'table_tennis', label: 'Table Tennis' },
  { value: 'athletics', label: 'Athletics' },
  { value: 'kabaddi', label: 'Kabaddi' },
  { value: 'swimming', label: 'Swimming' },
  { value: 'archery', label: 'Archery' },
  { value: 'shooting', label: 'Shooting' },
  { value: 'kho_kho', label: 'Kho Kho' },
  { value: 'racquetball', label: 'Racquetball' },
  { value: 'squash', label: 'Squash' },
  { value: 'fencing', label: 'Fencing' },
  { value: 'horse_riding', label: 'Horse Riding' },
  { value: 'chess', label: 'Chess' },
  { value: 'tennis', label: 'Tennis' },
  { value: 'throwball', label: 'Throwball' },
  { value: 'handball', label: 'Handball' },
  { value: 'gymnastics', label: 'Gymnastics' },
  { value: 'yoga', label: 'Yoga' },
  { value: 'karate', label: 'Karate' },
  { value: 'taekwondo', label: 'Taekwondo' },
  { value: 'skating', label: 'Skating' },
  { value: 'carrom', label: 'Carrom' },
  { value: 'general', label: 'General' },
  { value: 'other', label: 'Other' },
] as const;

export const SPORT_UNITS = [
  { value: 'piece', label: 'Piece' },
  { value: 'set', label: 'Set' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'packet', label: 'Packet' },
  { value: 'ml', label: 'ML (Milliliter)' },
  { value: 'gm', label: 'GM (Gram)' },
  { value: 'kg', label: 'KG (Kilogram)' },
  { value: 'box', label: 'Box' },
  { value: 'roll', label: 'Roll' },
  { value: 'pair', label: 'Pair' },
  { value: 'strip', label: 'Strip' },
  { value: 'litre', label: 'Litre' },
  { value: 'dozen', label: 'Dozen' },
  { value: 'ream', label: 'Ream' },
] as const;

export const ITEM_TYPES = ['equipment', 'consumable'] as const;

export const ITEM_CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'needs_repair', label: 'Needs Repair' },
  { value: 'condemned', label: 'Condemned' },
] as const;

export const ISSUE_TYPES = [
  { value: 'class_use', label: 'Class Use' },
  { value: 'individual', label: 'Individual Issue' },
  { value: 'disposed', label: 'Disposed' },
  { value: 'transferred', label: 'Transferred' },
] as const;

export const ISSUED_TO_TYPES = ['student', 'employee', 'class'] as const;

export const RESPONSIBLE_TYPES = ['student', 'teacher', 'wear_and_tear', 'unknown'] as const;

export const BREAKAGE_CAUSES = ['accident', 'mishandling', 'wear_and_tear', 'manufacturing_defect'] as const;

export const BREAKAGE_ACTIONS = ['replaced', 'repaired', 'written_off', 'cost_recovered'] as const;

export const BREAKAGE_STATUSES = ['reported', 'resolved'] as const;

export const RETURN_CONDITIONS = ['good', 'damaged', 'lost'] as const;

export const CATEGORIES_BY_SPORT_TYPE: Record<string, string[]> = {
  cricket: ['Bats', 'Balls', 'Protective Gear', 'Stumps & Bails', 'Training Aids', 'Clothing', 'General'],
  football: ['Balls', 'Goalkeeping', 'Field Equipment', 'Training Aids', 'Clothing', 'General'],
  hockey: ['Sticks', 'Balls', 'Protective Gear', 'Goalkeeping', 'Training Aids', 'General'],
  basketball: ['Balls', 'Hoops & Nets', 'Training Aids', 'General'],
  volleyball: ['Balls', 'Nets & Posts', 'Training Aids', 'General'],
  badminton: ['Racquets', 'Shuttlecocks', 'Nets & Posts', 'General'],
  table_tennis: ['Bats', 'Balls', 'Tables', 'Nets', 'General'],
  athletics: ['Track Equipment', 'Field Equipment', 'Measurement', 'Training Aids', 'General'],
  kabaddi: ['Mats', 'Clothing', 'General'],
  swimming: ['Swimwear', 'Floats & Aids', 'Safety', 'General'],
  archery: ['Bows', 'Arrows', 'Targets', 'Protective Gear', 'General'],
  shooting: ['Rifles', 'Pistols', 'Targets', 'Pellets & Ammo', 'Safety', 'General'],
  kho_kho: ['Poles', 'Clothing', 'General'],
  racquetball: ['Racquets', 'Balls', 'Eyewear', 'General'],
  squash: ['Racquets', 'Balls', 'Eyewear', 'General'],
  fencing: ['Weapons', 'Masks', 'Protective Gear', 'Clothing', 'General'],
  horse_riding: ['Saddles & Tack', 'Riding Gear', 'Helmets', 'Grooming', 'General'],
  chess: ['Boards', 'Pieces', 'Clocks', 'General'],
  tennis: ['Racquets', 'Balls', 'Nets & Posts', 'General'],
  throwball: ['Balls', 'Nets & Posts', 'General'],
  handball: ['Balls', 'Goals', 'General'],
  gymnastics: ['Mats', 'Apparatus', 'Protective Gear', 'General'],
  yoga: ['Mats', 'Props', 'General'],
  karate: ['Uniforms', 'Protective Gear', 'Training Aids', 'General'],
  taekwondo: ['Uniforms', 'Protective Gear', 'Training Aids', 'General'],
  skating: ['Skates', 'Protective Gear', 'General'],
  carrom: ['Boards', 'Coins & Strikers', 'General'],
  general: ['General'],
  other: ['General'],
};

export const STATUS_VALUES = ['active', 'deleted'] as const;

export const DEFAULTS = {
  REORDER_LEVEL: 0,
  CURRENT_STOCK: 0,
  STATUS: 'active',
  QUANTITY: 1,
  ITEM_CONDITION: 'good',
  BREAKAGE_STATUS: 'reported',
} as const;

// Type exports
export type SportType = typeof SPORT_TYPES[number]['value'];
export type SportUnit = typeof SPORT_UNITS[number]['value'];
export type ItemType = typeof ITEM_TYPES[number];
export type ItemCondition = typeof ITEM_CONDITIONS[number]['value'];
export type IssueType = typeof ISSUE_TYPES[number]['value'];
export type IssuedToType = typeof ISSUED_TO_TYPES[number];
export type ResponsibleType = typeof RESPONSIBLE_TYPES[number];
export type BreakageCause = typeof BREAKAGE_CAUSES[number];
export type BreakageAction = typeof BREAKAGE_ACTIONS[number];
export type BreakageStatus = typeof BREAKAGE_STATUSES[number];
export type ReturnCondition = typeof RETURN_CONDITIONS[number];
export type StatusValue = typeof STATUS_VALUES[number];
