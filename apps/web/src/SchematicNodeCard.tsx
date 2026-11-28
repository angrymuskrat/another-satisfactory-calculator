import type { ReactNode } from 'react';
import { Factory, GitFork, Minus, Plus } from 'lucide-react';
import type { Catalog } from '../../../packages/domain/types';
import type { MachineSpan, SchematicNode } from '../../../packages/domain/schematic';
import { builtCount, type BuiltRanges, type constructionDependencies, type MissingSupply } from '../../../packages/domain/constructionProgress';
import { format, ItemIcon, unit } from './controls';
import type { Rect } from './schematicLayout';

export const number = (n: number) => n !== 0 && Math.abs(n) < .001 ? n.toExponential(3) : format(n, 3);
export type Destination = Pick<MissingSupply, 'id' | 'index'>;
export type NodeProgress = ReturnType<ReturnType<typeof constructionDependencies>>;
type Item = Catalog['items'][number];
const kindLabels: Record<SchematicNode['kind'], string> = { building: 'Оборудование', source: 'Внешняя поставка', product: 'Готовый продукт', export: 'Потребитель', split: 'Разделитель', merge: 'Соединитель' };

export function nodeReadiness(node: SchematicNode, progress: NodeProgress | undefined, built: BuiltRanges) {
  if (!progress) return undefined;
  const parts = node.parts ?? [];
  return builtCount(built, parts) === parts.reduce((sum, p) => sum + p.count, 0) ? 'built' : progress.ready ? 'ready' : 'waiting';
}

type Mark = (parts: MachineSpan[], count: number) => void;

/** Build marks of a node; `adjustable` adds the count of built machines, taken in `parts` order. */
export function BuildMark({ node, progress, built, mark, items, onGoTo, adjustable = false }: {
  node: SchematicNode; progress: NodeProgress; built: BuiltRanges; mark: Mark; items: Map<string, Item>;
  onGoTo: (destination: Destination) => void; adjustable?: boolean;
}) {
  const parts = node.parts ?? [], total = parts.reduce((sum, p) => sum + p.count, 0), done = builtCount(built, parts);
  const verb = node.kind === 'source' ? 'Поставка готова' : 'Построено', counted = adjustable && total > 1;
  const set = (n: number) => mark(parts, Math.min(total, Math.max(0, Math.round(n))));
  const missing = progress.missing[0];
  return <div className="schematic-progress">
    <label><input type="checkbox" aria-label={`${verb}: ${node.label}`} checked={done === total}
      ref={el => { if (el) el.indeterminate = done > 0 && done < total; }} onChange={e => set(e.target.checked ? total : 0)} />
      {verb}{!counted && ` ${done} из ${total}`}</label>
    {counted && <span className="schematic-count">
      <button type="button" className="icon-button" aria-label={`Убрать одно здание: ${node.label}`} disabled={done <= 0} onClick={() => set(done - 1)}><Minus size={14} /></button>
      <input type="number" min={0} max={total} step={1} aria-label={`Построено зданий: ${node.label}`} value={done}
        onChange={e => { if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) set(e.target.valueAsNumber); }} />
      <button type="button" className="icon-button" aria-label={`Добавить одно здание: ${node.label}`} disabled={done >= total} onClick={() => set(done + 1)}><Plus size={14} /></button>
      из {total}</span>}
    {missing
      ? <button className="text-button" type="button" title={`${items.get(missing.itemId ?? '')?.name ?? 'Подключение'} · ${missing.label}`} onClick={() => onGoTo(missing)}>Ждёт поставку</button>
      : done < total && progress.ready > 0 && <small>{progress.together ? '↻ Строить вместе' : '→ Можно строить'}</small>}
  </div>;
}

export function SchematicNodeCard({ node, level, rect, items, progress, built, mark, selected, next = false, simple = false, muted, detailId, buttonRef, onSelect, onGoTo, children }: {
  node: SchematicNode; level: 'medium' | 'close'; rect: Rect; items: Map<string, Item>;
  progress?: NodeProgress; built: BuiltRanges; mark: Mark;
  selected: boolean; next?: boolean; simple?: boolean; muted: boolean; detailId: string; buttonRef: (element: HTMLButtonElement | null) => void;
  onSelect: () => void; onGoTo: (destination: Destination) => void; children?: ReactNode;
}) {
  const item = (id?: string) => id ? items.get(id) : undefined;
  const junction = node.kind === 'merge' || node.kind === 'split';
  const readiness = nodeReadiness(node, progress, built);
  const subtitle = node.configurations.length === 1 ? node.configurations[0].name
    : node.configurations.length > 1 ? `${node.configurations.length} конфигурации · раскрыть состав`
    : junction ? `${number(node.inputs[0]?.rate ?? 0)} ${unit(item(node.itemId))}` : kindLabels[node.kind];
  const differentClocks = new Set(node.configurations.map(g => g.clock)).size > 1;
  const flow = (direction: 'inputs' | 'outputs') => node[direction].map(f => <li key={direction + f.itemId} className={direction}>
    <ItemIcon item={item(f.itemId)} size={14} /><span>{item(f.itemId)?.name ?? f.itemId} · </span><strong>{number(f.rate)} {unit(item(f.itemId))}</strong></li>);
  const source = node.kind === 'source';
  return <article data-node-id={node.id} data-kind={node.kind} data-building-id={node.buildingId} data-count={node.count} data-progress={readiness}
    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    className={`schematic-node ${level} ${readiness ?? ''} ${junction ? 'junction' : ''} ${item(node.itemId)?.fluid ? 'fluid' : ''} ${selected ? 'selected' : muted ? 'muted-node' : ''} ${next ? 'next' : ''} ${simple ? 'simple' : ''}`}>
    {next && <span className="schematic-next-tag">Дальше</span>}
    <button type="button" ref={buttonRef} className="schematic-node-button" aria-pressed={selected} aria-controls={detailId} onClick={onSelect} title={simple ? `${node.label}${node.count ? ` ×${node.count}` : ''} · ${subtitle}` : undefined}>
      <span className="schematic-node-title">{junction ? <GitFork size={16} /> : simple && node.count ? <ItemIcon item={item(node.outputs[0]?.itemId ?? node.inputs[0]?.itemId)} size={30} /> : node.count ? <Factory size={16} /> : <ItemIcon item={item(node.itemId)} size={18} />}
        {node.count > 0 && !junction && <b>×{node.count}</b>}<strong>{node.label}</strong></span>
      <span className="schematic-recipe">{subtitle}</span>
    </button>
    {children}
    {level === 'close' && <>
      <div className="schematic-settings">
        {node.clock !== null && <span>{differentClocks ? 'Средняя частота' : 'Частота'} <strong>{number(node.clock)}%</strong></span>}
        {(node.configurations.length > 0 || source) && <span className="schematic-power">⚡ {node.averagePower === null ? 'Энергия поставки неизвестна' : <strong>{number(node.averagePower)} МВт</strong>}</span>}
      </div>
      <ul className="schematic-flows">{flow('inputs')}{flow('outputs')}</ul>
      {progress && <BuildMark node={node} progress={progress} built={built} mark={mark} items={items} onGoTo={onGoTo} />}
    </>}
  </article>;
}
