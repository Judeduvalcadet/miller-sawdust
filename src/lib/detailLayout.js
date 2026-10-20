// Shared spacing and dividers for V2 label/value detail sections.
const rowSpacing = '[&>div]:py-3 [&>div:first-child]:pt-0 [&>div:last-child]:pb-0';
export const DETAIL_ROWS = `divide-y divide-gray-200/70 ${rowSpacing}`;
export const DARK_DETAIL_ROWS = `divide-y divide-gray-700/70 ${rowSpacing}`;
export const DETAIL_GRID = 'grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-sm [&>div]:border-b [&>div]:border-gray-200/70 [&>div]:py-3';
export const DETAIL_FOOTER = 'border-t border-gray-200/70 pt-4';
