import { useEffect, useState } from 'react';
import type { SchematicModel } from '../../../packages/domain/schematic';
import type { MediumLayout } from './schematicElk';
import type { SchematicLayoutResponse } from './schematicLayout.worker';

export type SchematicLayoutState = { status: 'pending' } | { status: 'ready'; layout: { medium: MediumLayout; close: MediumLayout } } | { status: 'error'; message: string };
const ERROR: SchematicLayoutState = { status: 'error', message: 'Не удалось разложить схему.' };
const cache = new WeakMap<SchematicModel, SchematicLayoutState>();

export function useSchematicLayout(graph: SchematicModel): SchematicLayoutState {
  const [state, setState] = useState<{ graph: SchematicModel; value: SchematicLayoutState } | null>(null);
  useEffect(() => {
    if (cache.has(graph)) return;
    let worker: Worker;
    try { worker = new Worker(new URL('./schematicLayout.worker.ts', import.meta.url), { type: 'module' }); }
    catch { setState({ graph, value: ERROR }); return; }
    const requestId = 1;
    const finish = (value: SchematicLayoutState) => {
      worker.terminate();
      if (value.status === 'ready') cache.set(graph, value);
      setState({ graph, value });
    };
    worker.onmessage = (event: MessageEvent<SchematicLayoutResponse>) => {
      if (event.data.id !== requestId) return;
      finish('layout' in event.data ? { status: 'ready', layout: event.data.layout } : ERROR);
    };
    worker.onerror = () => finish(ERROR);
    worker.onmessageerror = () => finish(ERROR);
    worker.postMessage({ id: requestId, graph });
    return () => worker.terminate();
  }, [graph]);
  return cache.get(graph) ?? (state?.graph === graph ? state.value : { status: 'pending' });
}
