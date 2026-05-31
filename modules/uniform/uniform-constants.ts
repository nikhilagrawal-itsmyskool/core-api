export const UNIFORM_CATEGORIES = [
  { value: 'summer', label: 'Summer Dress' },
  { value: 'winter', label: 'Winter Dress' },
  { value: 'sports', label: 'Sports / PT' },
  { value: 'general', label: 'General' },
] as const;

export const UNIFORM_GENDERS = [
  { value: 'male', label: 'Boys' },
  { value: 'female', label: 'Girls' },
  { value: 'unisex', label: 'Unisex' },
] as const;

export const SALE_TYPES = [
  { value: 'student', label: 'Student Sale' },
  { value: 'bulk', label: 'Bulk / Institutional' },
] as const;

export const PAYMENT_STATUSES = [
  { value: 'paid', label: 'Fully Paid' },
  { value: 'partial', label: 'Partially Paid' },
  { value: 'due', label: 'Due' },
] as const;

export const CATEGORY_VALUES = UNIFORM_CATEGORIES.map(c => c.value);
export const GENDER_VALUES = UNIFORM_GENDERS.map(g => g.value);
export const SALE_TYPE_VALUES = SALE_TYPES.map(s => s.value);
export const PAYMENT_STATUS_VALUES = PAYMENT_STATUSES.map(p => p.value);

export type UniformCategory = typeof CATEGORY_VALUES[number];
export type UniformGender = typeof GENDER_VALUES[number];
export type SaleType = typeof SALE_TYPE_VALUES[number];
export type PaymentStatus = typeof PAYMENT_STATUS_VALUES[number];

export const DEFAULTS = {
  STATUS: 'active',
  CURRENT_STOCK: 0,
  RETURNED_QUANTITY: 0,
  SORT_ORDER: 0,
};

// Pre-seeded catalog items — schools activate these and add sizes/pricing
export const SEEDED_ITEMS: Array<{ name: string; category: UniformCategory; gender: UniformGender }> = [
  { name: 'Full Shirt (Boys)', category: 'summer', gender: 'male' },
  { name: 'Half Shirt (Boys)', category: 'summer', gender: 'male' },
  { name: 'Full Pant (Boys)', category: 'summer', gender: 'male' },
  { name: 'Half Pant (Boys)', category: 'summer', gender: 'male' },
  { name: 'Full Shirt (Girls)', category: 'summer', gender: 'female' },
  { name: 'Half Shirt (Girls)', category: 'summer', gender: 'female' },
  { name: 'Skirt', category: 'summer', gender: 'female' },
  { name: 'Salwar Kameez', category: 'summer', gender: 'female' },
  { name: 'White Pant', category: 'summer', gender: 'unisex' },
  { name: 'Tie', category: 'general', gender: 'unisex' },
  { name: 'Belt', category: 'general', gender: 'unisex' },
  { name: 'Socks', category: 'general', gender: 'unisex' },
  { name: 'Shoes', category: 'general', gender: 'unisex' },
  { name: 'PT Shoes', category: 'sports', gender: 'unisex' },
  { name: 'House T-Shirt', category: 'sports', gender: 'unisex' },
  { name: 'Full Sweater (Boys)', category: 'winter', gender: 'male' },
  { name: 'Half Sweater (Boys)', category: 'winter', gender: 'male' },
  { name: 'Full Sweater (Girls)', category: 'winter', gender: 'female' },
  { name: 'Half Sweater (Girls)', category: 'winter', gender: 'female' },
];
