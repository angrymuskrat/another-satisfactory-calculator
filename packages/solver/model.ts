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
  serialize(objective: Expression, maximize = false): string {
    const rows = this.constraints.map((c, i) => ` c${i}: ${format(c.expression)} ${c.operator} ${c.rhs}`);
    const bounds = [...this.variables].map(([name, { upper }]) => ` 0 <= ${name}${upper === null ? '' : ` <= ${upper}`}`);
    const integers = [...this.variables].filter(([, v]) => v.integer).map(([name]) => name);
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
