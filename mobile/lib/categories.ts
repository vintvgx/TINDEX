export const CATEGORIES = [
  'Stocks',
  'Technology',
  'Science',
  'Business',
  'Health',
  'Environment',
  'Politics',
  'Sports',
  'Entertainment',
  'Education',
  'Travel',
] as const;

export type CategoryType = typeof CATEGORIES[number]; 