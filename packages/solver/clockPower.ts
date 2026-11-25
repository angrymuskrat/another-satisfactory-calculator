import { CLOCK_POWER_EXPONENT, MIN_CLOCK_RATIO } from '../domain/gameMechanics';
import { Model } from './model';

/** Convex, conservative secants of N * (cycles / (baseRate * N))^exponent.
 * Below the minimum clock, duty at 1% is linear. No arbitrary machine cap.
 * Equal clocks within a configuration minimize its convex power for fixed N.
 */
export function clockPower(model: Model, flow: string, count: string, baseRate: number, maxClock: number) {
  const average = model.variable(), peak = model.variable();
  const knots = new Set([0, MIN_CLOCK_RATIO, maxClock]);
  for (let clock = MIN_CLOCK_RATIO; clock < maxClock; clock *= 1.25) knots.add(clock);
  for (const clock of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25]) if (clock < maxClock) knots.add(clock);
  const points = [...knots].sort((a, b) => a - b);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const slope = (b ** CLOCK_POWER_EXPONENT - a ** CLOCK_POWER_EXPONENT) / (b - a);
    const intercept = a ** CLOCK_POWER_EXPONENT - slope * a;
    model.constrain(new Map([[average, 1], [flow, -slope / baseRate], [count, -intercept]]), '>=', 0);
  }
  model.constrain(new Map([[peak, 1], [average, -1]]), '>=', 0);
  model.constrain(new Map([[peak, 1], [count, -(MIN_CLOCK_RATIO ** CLOCK_POWER_EXPONENT)]]), '>=', 0);
  return { average, peak };
}
