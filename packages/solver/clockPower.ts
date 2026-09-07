import { Model } from './model';

const EXPONENT = Math.log2(2.5);
export const MIN_CLOCK = 0.01;

/** Convex, conservative secants of N * (cycles / (baseRate * N))^exponent.
 * Below the minimum clock, duty at 1% is linear. No arbitrary machine cap.
 * Equal clocks within a configuration minimize its convex power for fixed N.
 */
export function clockPower(model: Model, flow: string, count: string, baseRate: number, maxClock: number) {
  const average = model.variable(), peak = model.variable();
  const knots = new Set([0, MIN_CLOCK, maxClock]);
  for (let clock = MIN_CLOCK; clock < maxClock; clock *= 1.25) knots.add(clock);
  for (const clock of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25]) if (clock < maxClock) knots.add(clock);
  const points = [...knots].sort((a, b) => a - b);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const slope = (b ** EXPONENT - a ** EXPONENT) / (b - a);
    const intercept = a ** EXPONENT - slope * a;
    model.constrain(new Map([[average, 1], [flow, -slope / baseRate], [count, -intercept]]), '>=', 0);
  }
  model.constrain(new Map([[peak, 1], [average, -1]]), '>=', 0);
  model.constrain(new Map([[peak, 1], [count, -(MIN_CLOCK ** EXPONENT)]]), '>=', 0);
  return { average, peak };
}
