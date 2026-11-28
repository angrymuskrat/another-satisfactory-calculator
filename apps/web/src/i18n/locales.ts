export type LocaleId = 'ru';

export const LOCALES: readonly { id: LocaleId; label: string; tag: string }[] = [
  { id: 'ru', label: 'Русский', tag: 'ru-RU' },
];

export const LOCALE_KEY = 'planovy-otdel:locale:v1';

export function detectLocale(
  languages: readonly string[],
  stored: string | null,
  available: readonly string[],
): string {
  if (stored !== null && available.includes(stored)) return stored;
  for (const language of languages) {
    const primary = language.split('-')[0]?.toLowerCase() ?? '';
    if (available.includes(primary)) return primary;
  }
  return available.includes('en') ? 'en' : available[0] ?? 'en';
}
