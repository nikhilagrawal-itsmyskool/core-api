// Default seed types (the "columns"). Seeded per-school on first use; schools add
// their own beyond these. `code` is the stable programmatic handle:
//   - THEME_CODE      -> the daily thought/value the assembly module surfaces
//   - REMEMBRANCE     -> bundles the "personality" (role) into the entry's `detail`
// The Academic-Activities column (N) and others are intentionally NOT seeded — a
// school adds them as custom types if needed.
export const THEME_CODE = "theme";

export const DEFAULT_TYPES: { code: string; name: string; sortOrder: number }[] = [
  { code: "festival", name: "Festivals/Celebrations", sortOrder: 10 },
  { code: "important_day", name: "Important Days", sortOrder: 20 },
  { code: "celebration_type", name: "Type of Celebration", sortOrder: 30 },
  { code: "remembrance", name: "Remembrance", sortOrder: 40 },
  { code: THEME_CODE, name: "Theme", sortOrder: 50 },
  { code: "academics", name: "Academics", sortOrder: 60 },
];

export const HOLIDAY_KINDS = ["full", "restricted"] as const;
export type HolidayKind = (typeof HOLIDAY_KINDS)[number];

// Weekly-off rule: Sunday only (getUTCDay() === 0). Saturdays are working days.
export const WEEKLY_OFF_DOW = [0];
