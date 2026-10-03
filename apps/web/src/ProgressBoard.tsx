import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Catalog, ResearchNode, ResearchTree, Unlock } from '../../../packages/domain/types';

type Change = (ids: string[], on: boolean) => void;

export function GroupCheck({ label, ids, selected, change, children }: { label: string; ids: string[]; selected: string[]; change: Change; children?: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const count = ids.filter(id => selected.includes(id)).length;
  useEffect(() => { if (input.current) input.current.indeterminate = count > 0 && count < ids.length; }, [count, ids.length]);
  return <label className="setup-check"><input ref={input} type="checkbox" aria-label={label} checked={ids.length > 0 && count === ids.length} disabled={!ids.length}
    onChange={e => change(ids, e.target.checked)} />{children ?? label}<small>{count}/{ids.length}</small></label>;
}

const contents = (u: Unlock) => {
  const parts = [u.recipeIds.length && `рецептов ${u.recipeIds.length}`, (u.buildingIds.length + (u.minerIds?.length ?? 0)) && `зданий ${u.buildingIds.length + (u.minerIds?.length ?? 0)}`,
    (u.beltIds.length + u.pipeIds.length) && 'транспорт', u.overclock && 'разгон'].filter(Boolean);
  return parts.join(' · ');
};

export interface HubPhase { id: string; name: string; tiers: number[] }

/** Уровни HUB идут слева направо, как вкладки терминала; этапы уровня — карточками в столбце. */
export function HubBoard({ hubs, phases, selected, change }: { hubs: Unlock[]; phases: HubPhase[]; selected: string[]; change: Change }) {
  return <div className="hub-board" role="group" aria-label="Этапы HUB по уровням">
    {phases.map(phase => {
      const members = hubs.filter(u => phase.tiers.includes(u.tier ?? 0));
      return <section className="hub-phase" key={phase.id} aria-label={`Фаза: ${phase.name}`}>
        <header className="hub-phase-header"><GroupCheck label={`Вся фаза: ${phase.name}`} ids={members.map(u => u.id)} selected={selected} change={change}>
          <strong>{phase.name}</strong></GroupCheck></header>
        <div className="hub-tiers">{phase.tiers.map(t => {
          const tier = members.filter(u => (u.tier ?? 0) === t);
          return <section className="hub-tier" key={t} aria-label={`Уровень HUB ${t}`}>
            <header className="hub-tier-header"><GroupCheck label={`Весь уровень HUB ${t}`} ids={tier.map(u => u.id)} selected={selected} change={change}>
              <span>Уровень {t}</span></GroupCheck></header>
            <ul className="hub-milestones">{tier.map(u => <li key={u.id}>
              <label className={`progress-card${selected.includes(u.id) ? ' is-checked' : ''}`}>
                <input type="checkbox" aria-label={`Этап: ${u.name}`} checked={selected.includes(u.id)} onChange={e => change([u.id], e.target.checked)} />
                <span><strong>{u.name}</strong>{contents(u) && <small>{contents(u)}</small>}</span>
              </label></li>)}</ul>
          </section>;
        })}</div>
      </section>;
    })}
  </div>;
}

const CELL_W = 172, CELL_H = 112, NODE_W = 152, NODE_H = 80, EMPTY = 0.35;

/** Смещения строк/столбцов: пустые клетки сохраняют порядок дерева, но занимают меньше места. */
function offsets(used: Set<number>, max: number, size: number) {
  const start: number[] = [];
  let at = 0;
  for (let i = 0; i <= max; i++) { start.push(at); at += used.has(i) ? size : size * EMPTY; }
  return { start, total: at };
}

export function MamTree({ catalog, tree, selectable, selected, change }: { catalog: Catalog; tree: ResearchTree; selectable: Unlock[]; selected: string[]; change: Change }) {
  const placed = tree.nodes.filter((n): n is ResearchNode & { coordinates: number[] } => n.coordinates?.length === 2)
    .sort((a, b) => a.coordinates[1] - b.coordinates[1] || a.coordinates[0] - b.coordinates[0]);
  const loose = tree.nodes.filter(n => n.coordinates?.length !== 2);
  const cols = offsets(new Set(placed.map(n => n.coordinates[0])), Math.max(0, ...placed.map(n => n.coordinates[0])), CELL_W);
  const rows = offsets(new Set(placed.map(n => n.coordinates[1])), Math.max(0, ...placed.map(n => n.coordinates[1])), CELL_H);
  const position = (n: { coordinates: number[] }) => ({ left: cols.start[n.coordinates[0]] + (CELL_W - NODE_W) / 2, top: rows.start[n.coordinates[1]] + (CELL_H - NODE_H) / 2 });
  const byId = new Map(placed.map(n => [n.schematicId, n]));
  const unlock = (id: string) => selectable.find(u => u.id === id);
  const reachable = (n: ResearchNode) => {
    const parents = n.parents.filter((p): p is string => p !== null);
    return !parents.length || parents.some(p => selected.includes(p));
  };
  const edges = placed.flatMap(child => child.parents.flatMap(id => {
    const parent = id ? byId.get(id) : undefined;
    if (!parent) return [];
    const p = position(parent), c = position(child), gap = (CELL_H - NODE_H) / 2;
    const [px, py] = parent.coordinates, [cx, cy] = child.coordinates;
    // Вертикаль через чужую карточку того же столбца уводится в промежуток между столбцами.
    const blocked = placed.some(n => n.coordinates[0] === px && n.coordinates[1] > py && n.coordinates[1] < cy);
    const gutter = cols.start[px] + (cx >= px ? CELL_W : 0);
    const d = cy <= py
      ? `M${p.left + (c.left > p.left ? NODE_W : 0)},${p.top + NODE_H / 2} H${c.left + (c.left > p.left ? 0 : NODE_W)}`
      : blocked
        ? `M${p.left + NODE_W / 2},${p.top + NODE_H} V${p.top + NODE_H + gap} H${gutter} V${c.top - gap} H${c.left + NODE_W / 2} V${c.top}`
        : `M${p.left + NODE_W / 2},${p.top + NODE_H} V${c.top - gap} H${c.left + NODE_W / 2} V${c.top}`;
    return [{ key: `${parent.schematicId}>${child.schematicId}`, d, done: selected.includes(parent.schematicId) && selected.includes(child.schematicId) }];
  }));
  const node = (n: ResearchNode, style?: CSSProperties) => {
    const u = unlock(n.schematicId);
    const checked = selected.includes(n.schematicId);
    const className = `progress-card mam-node${checked ? ' is-checked' : ''}${reachable(n) ? '' : ' is-locked'}`;
    return u ? <label key={n.schematicId} className={className} style={style} title={n.name}>
      <input type="checkbox" aria-label={`Исследование: ${u.name}`} checked={checked} onChange={e => change([u.id], e.target.checked)} />
      <span><strong>{u.name}</strong>{contents(u) && <small>{contents(u)}</small>}</span>
    </label> : <div key={n.schematicId} className={`${className} is-reference`} style={style} title={n.name}>
      <span><strong>{n.name}</strong><small>справочно</small></span></div>;
  };
  const unresolved = tree.nodes.filter(n => n.unresolvedCoordinates.length);
  return <>
    <div className="mam-canvas" role="group" aria-label={`Дерево исследований: ${tree.name}`}>
      <div className="mam-grid" style={{ width: cols.total, height: rows.total }}>
        <svg className="mam-edges" width={cols.total} height={rows.total} aria-hidden="true">
          {edges.map(e => <path key={e.key} d={e.d} className={e.done ? 'is-done' : undefined} />)}
        </svg>
        {placed.map(n => node(n, { ...position(n), width: NODE_W, height: NODE_H }))}
      </div>
    </div>
    {!!loose.length && <div className="mam-loose"><p className="hint">Узлы без координат в assets:</p>{loose.map(n => node(n))}</div>}
    {!!unresolved.length && <p className="hint">Связи по неизвестным координатам не нарисованы: {unresolved.map(n => catalog.researchNames?.[n.schematicId] ?? n.name).join(', ')}.</p>}
  </>;
}

export function MamBoard({ catalog, selectable, selected, change }: { catalog: Catalog; selectable: Unlock[]; selected: string[]; change: Change }) {
  const trees = catalog.researchTrees?.filter(t => !t.seasonal && t.nodes.length) ?? [];
  const [treeId, setTreeId] = useState(trees[0]?.id);
  const tree = trees.find(t => t.id === treeId) ?? trees[0];
  if (!tree) return <p className="hint">В каталоге нет дерева исследований MAM.</p>;
  const members = (t: ResearchTree) => selectable.filter(u => t.nodes.some(n => n.schematicId === u.id)).map(u => u.id);
  const ids = members(tree);
  return <div className="mam-board">
    <div className="mam-tabs" role="group" aria-label="Ветки MAM">{trees.map(t => {
      const all = members(t), count = all.filter(id => selected.includes(id)).length;
      return <button type="button" key={t.id} aria-pressed={t.id === tree.id} aria-label={`Ветка MAM: ${t.name}, отмечено ${count} из ${all.length}`}
        onClick={() => setTreeId(t.id)}>{t.name}<small>{count}/{all.length}</small></button>;
    })}</div>
    <div className="mam-tree-header">
      <GroupCheck label={`Вся ветка: ${tree.name}`} ids={ids} selected={selected} change={change}><strong>{tree.name}</strong></GroupCheck>
      <span className="hint">Линии — связи «родитель → потомок» (ИЛИ). Приглушены узлы без отмеченного родителя; их можно отметить вручную.</span>
    </div>
    {tree.conditions.map((condition, i) => <p className="hint" key={i}>{condition}</p>)}
    <MamTree catalog={catalog} tree={tree} selectable={selectable} selected={selected} change={change} />
  </div>;
}
