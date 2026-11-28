import type { Catalog } from '../../../packages/domain/types';
import { powerCoverage, type CoverageRate } from '../../../packages/domain/powerCoverage';
import { format, unit } from './controls';
import { useT } from './i18n';
import { gameName } from './i18n/gameNames';

export function PowerCoverage({ catalog, average, peak, reserve }: { catalog: Catalog; average: number; peak: number; reserve: number }) {
  const text = useT().powerCoverage;
  const generators = powerCoverage(catalog, average, peak + reserve);
  if (!generators || Math.max(average, peak + reserve) <= 0) return null;
  const item = (id: string) => catalog.items.find(i => i.id === id);
  const rate = (generatorId: string, r: CoverageRate) => <tr key={`${generatorId}:${r.itemId}`}><td>{gameName('item', r.itemId, item(r.itemId)?.name ?? r.itemId)}</td><td>{format(r.average)} {unit(item(r.itemId))}</td><td>{format(r.peak)} {unit(item(r.itemId))}</td></tr>;
  return <details className="power-coverage"><summary>{text.title}</summary>
    <div className="table-scroll"><table><thead><tr><th>{text.colGenerator}</th><th>{text.colAverage}</th><th>{reserve > 0 ? text.colPeakReserve : text.colPeak}</th></tr></thead>
      <tbody>{generators.map(g => [<tr key={g.id} className="generator-row"><th scope="row">{text.generator(gameName('generator', g.id, g.name), format(g.power))}</th><td>{text.count(g.average, format(Math.max(0, g.average * g.power - average)))}</td><td>{text.count(g.peak, format(Math.max(0, g.peak * g.power - peak - reserve)))}</td></tr>, ...g.fuels.map(f => rate(g.id, f)), ...(g.supplemental ? [rate(g.id, g.supplemental)] : [])])}</tbody></table></div>
    <p className="hint">{text.hint}</p>
  </details>;
}
