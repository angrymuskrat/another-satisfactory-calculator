import { useState } from 'react';
import type { ConstructionModel } from '../../../packages/domain/construction';
import type { MachineSpan } from '../../../packages/domain/schematic';
import { markBuilt, markFirst, type BuiltRanges } from '../../../packages/domain/constructionProgress';

const storageKey = 'satisfactory:construction:v1';
export const defaultScope = JSON.stringify(['guest', null]);
type SavedMarks = { fingerprint: string; scope?: string; ids: string[]; ranges?: BuiltRanges };
function readHistory(): SavedMarks[] {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return [];
  const stored: unknown = JSON.parse(raw);
  const valid = (entry: unknown): entry is SavedMarks => !!entry && typeof entry === 'object'
    && 'fingerprint' in entry && typeof entry.fingerprint === 'string'
    && 'ids' in entry && Array.isArray(entry.ids) && entry.ids.every(id => typeof id === 'string')
    && (!('ranges' in entry) || !!entry.ranges && typeof entry.ranges === 'object' && !Array.isArray(entry.ranges)
      && Object.values(entry.ranges).every(ranges => Array.isArray(ranges) && ranges.every((r, i) =>
        Array.isArray(r) && r.length === 2 && r.every(Number.isSafeInteger) && r[0] >= 0 && r[1] > r[0] && (!i || ranges[i - 1][1] <= r[0]))));
  // Migrate the initial one-configuration format on the next write.
  if (valid(stored)) return [stored];
  if (!stored || typeof stored !== 'object' || !('entries' in stored) || !Array.isArray(stored.entries) || !stored.entries.every(valid)) throw new Error('Invalid marks');
  return stored.entries.slice(-20);
}
function restoredRanges(model: ConstructionModel, scope: string, entries: SavedMarks[]) {
  const matching = entries.filter(entry => entry.fingerprint === model.fingerprint);
  // Old entries had no factory identity and applied to this exact configuration.
  const saved = matching.find(entry => entry.scope === scope) ?? matching.find(entry => entry.scope === undefined);
  const legacy = new Set(saved?.ids);
  const groups = [...model.extraction, ...model.production, ...model.sinks].filter(g => legacy.has(g.id));
  return markBuilt(saved?.ranges ?? {}, groups.map(g => ({ id: g.id, first: 0, count: g.count })), true);
}

/** Build marks of one configuration. The caller remounts on a new `model.fingerprint` or `scope`. */
export function useConstructionMarks(model: ConstructionModel, scope = defaultScope) {
  const [saved, setSaved] = useState(() => {
    try { return { ranges: restoredRanges(model, scope, readHistory()), error: '' }; }
    catch { return { ranges: {} as BuiltRanges, error: 'Не удалось загрузить отметки строительства из этого браузера.' }; }
  });
  const update = (change: (ranges: BuiltRanges) => BuiltRanges) => {
    let ranges = change(saved.ranges);
    let error = '';
    try {
      const history = readHistory();
      if (!saved.error) ranges = change(restoredRanges(model, scope, history));
      const entries = [...history.filter(entry => entry.fingerprint !== model.fingerprint || (entry.scope ?? defaultScope) !== scope),
        { fingerprint: model.fingerprint, scope, ids: [], ranges }].slice(-20);
      localStorage.setItem(storageKey, JSON.stringify({ entries }));
    }
    catch { error = 'Не удалось сохранить отметки. Они доступны только до закрытия этой инструкции.'; }
    setSaved({ ranges, error });
  };
  return {
    built: saved.ranges, error: saved.error,
    mark: (parts: MachineSpan[], count: number) => update(ranges => markFirst(ranges, parts, count)),
    markParts: (parts: MachineSpan[]) => update(ranges => markBuilt(ranges, parts, true)),
  };
}
export type ConstructionMarks = ReturnType<typeof useConstructionMarks>;
