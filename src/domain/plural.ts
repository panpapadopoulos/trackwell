const rules = new Intl.PluralRules('en-US');
const fmt = new Intl.NumberFormat('en-US');

/** "1 payment", "1,284 payments": never "1 payments". */
export function count(n: number, one: string, other = `${one}s`): string {
  return `${fmt.format(n)} ${rules.select(n) === 'one' ? one : other}`;
}
