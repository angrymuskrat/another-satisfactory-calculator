/** Only generated variable names enter CPLEX LP text, never user strings. */
export type Expression = Map<string, number>;
export interface Constraint { expression: Expression; operator: '=' | '<=' | '>='; rhs: number }
export class Model {
  variables = new Map<string, { upper: number | null; integer: boolean }>();
  constraints: Constraint[] = [];
  constructor() { this.variables.set('zero', { upper: 0, integer: false }); }
  variable(upper: number | null = null, integer = false): string {
    const name = `v${this.variables.size}`;
    this.variables.set(name, { upper, integer }); return name;
  }
  constrain(expression: Expression, operator: Constraint['operator'], rhs: number) {
    this.constraints.push({ expression: new Map(expression), operator, rhs });
  }
  accepts(values: Record<string, number>): boolean {
    for (const [name, { upper, integer }] of this.variables) {
      const v = values[name];
      if (!Number.isFinite(v) || v < -1e-8 || (upper !== null && v > upper + 1e-8)
        || (integer && Math.abs(v - Math.round(v)) > 1e-8)) return false;
    }
    return this.constraints.every(({ expression, rhs, operator }) => {
      const difference = dot(expression, values) - rhs;
      const tolerance = 1e-8 + Math.abs(rhs) * 1e-9;
      return (operator === '>=' || difference <= tolerance) && (operator === '<=' || difference >= -tolerance);
    });
  }
  serialize(objective: Expression, maximize = false, relaxIntegers = false): string {
    const rows = this.constraints.map((c, i) => ` c${i}: ${format(c.expression)} ${c.operator} ${c.rhs}`);
    const bounds = [...this.variables].map(([name, { upper }]) => ` 0 <= ${name}${upper === null ? '' : ` <= ${upper}`}`);
    const integers = relaxIntegers ? [] : [...this.variables].filter(([, v]) => v.integer).map(([name]) => name);
    return `${maximize ? 'Maximize' : 'Minimize'}\n obj: ${format(objective)}\nSubject To\n${rows.join('\n')}\nBounds\n${bounds.join('\n')}\n${integers.length ? `Generals\n ${integers.join(' ')}\n` : ''}End`;
  }
}
export function add(expression: Expression, variable: string, coefficient: number) {
  expression.set(variable, (expression.get(variable) ?? 0) + coefficient);
}
export function dot(expression: Expression, values: Record<string, number>) {
  return [...expression].reduce((sum, [name, coefficient]) => sum + coefficient * (values[name] ?? 0), 0);
}
function format(expression: Expression): string {
  const terms = [...expression].filter(([, c]) => Math.abs(c) > 1e-12);
  if (!terms.length) return '0 zero';
  return terms.map(([name, c]) => `${c < 0 ? '-' : '+'} ${Math.abs(c)} ${name}`).join(' ');
}
