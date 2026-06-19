export interface CountryInfo {
  country: string;
  countryCode: string;
}

export const COUNTRY_FLAG_MAP: Array<[string, string, string]> = [
  ['🇭🇰', 'Hong Kong', 'HK'],
  ['🇯🇵', 'Japan', 'JP'],
  ['🇺🇸', 'United States', 'US'],
  ['🇸🇬', 'Singapore', 'SG'],
  ['🇹🇼', 'Taiwan', 'TW'],
  ['🇰🇷', 'Korea', 'KR'],
  ['🇬🇧', 'United Kingdom', 'GB'],
  ['🇩🇪', 'Germany', 'DE'],
  ['🇫🇷', 'France', 'FR'],
  ['🇳🇱', 'Netherlands', 'NL'],
  ['🇦🇺', 'Australia', 'AU'],
  ['🇨🇦', 'Canada', 'CA'],
  ['🇮🇳', 'India', 'IN'],
  ['🇧🇷', 'Brazil', 'BR'],
  ['🇷🇺', 'Russia', 'RU'],
  ['🇹🇷', 'Turkey', 'TR'],
  ['🇦🇷', 'Argentina', 'AR'],
  ['🇲🇾', 'Malaysia', 'MY'],
  ['🇹🇭', 'Thailand', 'TH'],
  ['🇻🇳', 'Vietnam', 'VN'],
  ['🇮🇩', 'Indonesia', 'ID'],
  ['🇵🇭', 'Philippines', 'PH'],
  ['🇿🇦', 'South Africa', 'ZA'],
  ['🇮🇱', 'Israel', 'IL'],
  ['🇸🇦', 'Saudi Arabia', 'SA'],
  ['🇦🇪', 'United Arab Emirates', 'AE'],
  ['🇮🇷', 'Iran', 'IR'],
  ['🇵🇱', 'Poland', 'PL'],
  ['🇮🇹', 'Italy', 'IT'],
  ['🇪🇸', 'Spain', 'ES'],
  ['🇵🇹', 'Portugal', 'PT'],
  ['🇨🇿', 'Czech Republic', 'CZ'],
  ['🇸🇪', 'Sweden', 'SE'],
  ['🇳🇴', 'Norway', 'NO'],
  ['🇩🇰', 'Denmark', 'DK'],
  ['🇫🇮', 'Finland', 'FI'],
  ['🇨🇭', 'Switzerland', 'CH'],
  ['🇦🇹', 'Austria', 'AT'],
  ['🇧🇪', 'Belgium', 'BE'],
];

export const COUNTRY_KEYWORD_MAP: Array<[RegExp, string, string]> = [
  [/\b(hong\s*kong|hongkong|hk)\b/i, 'Hong Kong', 'HK'],
  [/\b(japan|jp|tokyo)\b/i, 'Japan', 'JP'],
  [/\b(usa|united\s+states|america)\b/i, 'United States', 'US'],
  [/\b(singapore|sg)\b/i, 'Singapore', 'SG'],
  [/\b(taiwan|tw)\b/i, 'Taiwan', 'TW'],
  [/\b(korea|kr)\b/i, 'Korea', 'KR'],
  [/\b(uk|britain|england|london)\b/i, 'United Kingdom', 'GB'],
  [/\b(germany|german|de)\b/i, 'Germany', 'DE'],
  [/\b(france|fr)\b/i, 'France', 'FR'],
  [/\b(netherlands|nl|dutch)\b/i, 'Netherlands', 'NL'],
  [/\b(australia|au)\b/i, 'Australia', 'AU'],
  [/\b(canada|ca)\b/i, 'Canada', 'CA'],
];

export function detectCountry(name: string): CountryInfo | null {
  for (const [flag, country, code] of COUNTRY_FLAG_MAP) {
    if (name.includes(flag)) {
      return { country, countryCode: code };
    }
  }

  for (const [pattern, country, code] of COUNTRY_KEYWORD_MAP) {
    if (pattern.test(name)) {
      return { country, countryCode: code };
    }
  }

  return null;
}

export function countryCodeToFlag(countryCode: string): string | undefined {
  const normalizedCode = countryCode.trim().toUpperCase();
  return COUNTRY_FLAG_MAP.find(([, , code]) => code === normalizedCode)?.[0];
}
