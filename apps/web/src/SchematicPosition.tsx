import { useRef, useState, type PointerEvent } from 'react';
import { GripVertical } from 'lucide-react';
import { SCHEMATIC_TOP, type Point } from './schematicLayout';

type Positions = Record<string, Point>;
type SavedPositions = { fingerprint: string; positions: Positions };
type PositionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
// v1 positions belong to the old 280 px layout; they are left untouched.
export const schematicPositionsKey = (scope: string, mode: string) => 'satisfactory:schematic-layout:v2:' + JSON.stringify([scope, mode]);

export function readPositions(storage: PositionStorage, key: string): SavedPositions[] {
  const entries: unknown = JSON.parse(storage.getItem(key) ?? '[]');
  const valid = (entry: unknown): entry is SavedPositions => !!entry && typeof entry === 'object'
    && 'fingerprint' in entry && typeof entry.fingerprint === 'string' && 'positions' in entry && !!entry.positions
    && typeof entry.positions === 'object' && !Array.isArray(entry.positions)
    && Object.values(entry.positions).every(p => p && typeof p.x === 'number' && Number.isSafeInteger(Math.trunc(p.x))
      && typeof p.y === 'number' && Number.isSafeInteger(Math.trunc(p.y)));
  if (!Array.isArray(entries) || !entries.every(valid)) throw new Error();
  return entries;
}

/** Replaces the entry for `fingerprint`; `null` removes it. Keeps the 20 newest entries. */
export function writePositions(storage: PositionStorage, key: string, fingerprint: string, positions: Positions | null) {
  const entries = readPositions(storage, key).filter(entry => entry.fingerprint !== fingerprint);
  if (positions) entries.push({ fingerprint, positions });
  if (entries.length) storage.setItem(key, JSON.stringify(entries.slice(-20)));
  else storage.removeItem(key);
}

export function useSchematicPositions(scope: string, mode: string, fingerprint: string) {
  const key = schematicPositionsKey(scope, mode);
  const [saved, setSaved] = useState(() => {
    try {
      return { positions: readPositions(localStorage, key).find(entry => entry.fingerprint === fingerprint)?.positions ?? {}, error: '' };
    } catch { return { positions: {} as Positions, error: 'Не удалось прочитать сохранённые позиции блоков.' }; }
  });
  const save = (id?: string, point?: Point) => {
    let positions = id && point ? { ...saved.positions, [id]: point } : {};
    let error = '';
    try {
      if (id && point) {
        const previous = readPositions(localStorage, key).find(entry => entry.fingerprint === fingerprint);
        if (previous && !saved.error) positions = { ...previous.positions, [id]: point };
      }
      writePositions(localStorage, key, fingerprint, id && point ? positions : null);
    } catch { error = 'Позиции изменены на схеме. Сохранить их в этом браузере не удалось.'; }
    setSaved({ positions, error });
  };
  return { ...saved, save };
}

export function MoveNode({ name, position, zoom, preview, save }: {
  name: string; position: Point; zoom: number; preview: (p: Point | null) => void; save: (p: Point) => void;
}) {
  const gesture = useRef<{ pointer: number; start: Point; origin: Point; zoom: number } | null>(null);
  const translate = (origin: Point, dx: number, dy: number) => ({ x: Math.max(0, origin.x + dx), y: Math.max(SCHEMATIC_TOP, origin.y + dy) });
  const pointAt = (e: PointerEvent) => {
    const g = gesture.current;
    if (g?.pointer === e.pointerId) return translate(g.origin, (e.clientX - g.start.x) / g.zoom, (e.clientY - g.start.y) / g.zoom);
  };
  const cancel = () => { if (gesture.current) { gesture.current = null; preview(null); } };
  return <button type="button" className="schematic-move" aria-label={`Переместить: ${name}`} title="Перетащите ручку или используйте стрелки. Shift увеличивает шаг."
    onKeyDown={e => {
      const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
      if (!delta) return;
      e.preventDefault(); e.stopPropagation();
      const step = e.shiftKey ? 48 : 12;
      save(translate(position, step * delta[0], step * delta[1]));
    }}
    onPointerDown={e => {
      if (e.button !== 0 || !e.isPrimary) return;
      e.stopPropagation();
      gesture.current = { pointer: e.pointerId, start: { x: e.clientX, y: e.clientY }, origin: position, zoom };
      e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerMove={e => { const p = pointAt(e); if (p) { e.stopPropagation(); preview(p); } }}
    onPointerUp={e => {
      const point = pointAt(e);
      if (!point) return;
      e.stopPropagation();
      if (point.x !== gesture.current!.origin.x || point.y !== gesture.current!.origin.y) save(point);
      cancel();
    }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}>
    <GripVertical size={17} aria-hidden="true" />
  </button>;
}
