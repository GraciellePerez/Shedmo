export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
] as const;

export type USStateCode = (typeof US_STATES)[number][0];
const stateCodes = new Set<string>(US_STATES.map(([code]) => code));
const stateNames = new Map<string, USStateCode>(
  US_STATES.flatMap(([code, name]) => [[code.toLowerCase(), code], [name.toLowerCase(), code]]),
);

export const normalizeCity = (value: string) =>
  value.trim().replace(/\s+/g, ' ').replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
export const normalizeState = (value: string) => value.trim().toUpperCase();
export const normalizePostalCode = (value: string) => value.trim();

export function isValidCity(value: string) {
  const city = normalizeCity(value);
  return city.length >= 2
    && city.length <= 80
    && /[\p{L}]/u.test(city)
    && !/^\d+$/u.test(city)
    && /^[\p{L}\p{M} .'-]+$/u.test(city);
}

export function isValidState(value: string): value is USStateCode {
  return stateCodes.has(normalizeState(value));
}

export function stateCodeForRegion(value: string | null | undefined) {
  return value ? stateNames.get(value.trim().toLowerCase()) ?? null : null;
}

export function isValidPostalCode(value: string) {
  return value.trim() === '' || /^\d{5}(?:-\d{4})?$/.test(value.trim());
}

export function validateManualLocation(city: string, state: string, postalCode = '') {
  if (!isValidCity(city)) return 'Enter a valid city name.';
  if (!isValidState(state)) return 'Select a valid US state.';
  if (!isValidPostalCode(postalCode)) return 'Use a 5-digit ZIP code or ZIP+4.';
  return null;
}
