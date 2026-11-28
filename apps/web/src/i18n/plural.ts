export function plural(
  tag: string,
  count: number,
  forms: { one?: string; few?: string; many?: string; other: string },
): string {
  const category = new Intl.PluralRules(tag).select(count);
  if (category === 'one' || category === 'few' || category === 'many') {
    return forms[category] ?? forms.other;
  }
  return forms.other;
}
