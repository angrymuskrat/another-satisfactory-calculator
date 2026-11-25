import type { Catalog } from '../../../packages/domain/types';
import { powerCoverage, type CoverageRate } from '../../../packages/domain/powerCoverage';
import { format, unit } from './controls';

export function PowerCoverage({ catalog, average, peak, reserve }: { catalog: Catalog; average: number; peak: number; reserve: number }) {
  const generators = powerCoverage(catalog, average, peak + reserve);
  if (!generators || Math.max(average, peak + reserve) <= 0) return null;
  const item = (id: string) => catalog.items.find(i => i.id === id);
  const rate = (generatorId: string, r: CoverageRate) => <tr key={`${generatorId}:${r.itemId}`}><td>{item(r.itemId)?.name ?? r.itemId}</td><td>{format(r.average)} {unit(item(r.itemId))}</td><td>{format(r.peak)} {unit(item(r.itemId))}</td></tr>;
  return <details className="power-coverage"><summary>Чем покрыть</summary>
    <div className="table-scroll"><table><thead><tr><th>Генератор и топливо</th><th>Средняя</th><th>{reserve > 0 ? 'Пик + резерв' : 'Пик'}</th></tr></thead>
      <tbody>{generators.map(g => [<tr key={g.id} className="generator-row"><th scope="row">{g.name} · {format(g.power)} МВт</th><td>{g.average} шт. · запас {format(Math.max(0, g.average * g.power - average))} МВт</td><td>{g.peak} шт. · запас {format(Math.max(0, g.peak * g.power - peak - reserve))} МВт</td></tr>, ...g.fuels.map(f => rate(g.id, f)), ...(g.supplemental ? [rate(g.id, g.supplemental)] : [])])}</tbody></table></div>
    <p className="hint">В этой справке генерация не входит в оптимизацию. Все указанные установки работают на 100%. Для каждого вида топлива показан расход всей группы. Добыча топлива и воды рассчитывается отдельно.</p>
  </details>;
}
