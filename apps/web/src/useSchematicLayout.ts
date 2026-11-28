import { useEffect, useRef, useState } from 'react';
import type { SchematicModel } from '../../../packages/domain/schematic';
import { useT } from './i18n';
import type { MediumLayout } from './schematicElk';
import type { SchematicLayoutResponse } from './schematicLayout.worker';

export type SchematicLayoutState = { status: 'pending' } | { status: 'ready'; layout: { medium: MediumLayout; close: MediumLayout } } | { status: 'error'; message: string };
const cache = new WeakMap<SchematicModel, SchematicLayoutState>();

export function useSchematicLayout(graph: SchematicModel): SchematicLayoutState {
  const t = useT();
  // The effect must not restart the layout when the language changes, so it reads the texts through a ref.
  const texts = useRef(t);
  texts.current = t;
  const [state, setState] = useState<{ graph: SchematicModel; value: SchematicLayoutState } | null>(null);
  useEffect(() => {
    if (cache.has(graph)) return;
    let worker: Worker;
    const failure = (message = texts.current.useSchematicLayout.failed): SchematicLayoutState => ({ status: 'error', message });
    try { worker = new Worker(new URL('./schematicLayout.worker.ts', import.meta.url), { type: 'module' }); }
    catch { setState({ graph, value: failure() }); return; }
    const requestId = 1;
    const finish = (value: SchematicLayoutState) => {
      worker.terminate();
      if (value.status === 'ready') cache.set(graph, value);
      setState({ graph, value });
    };
    worker.onmessage = (event: MessageEvent<SchematicLayoutResponse>) => {
      if (event.data.id !== requestId) return;
      finish('layout' in event.data ? { status: 'ready', layout: event.data.layout } : failure('errorKey' in event.data ? texts.current.schematicLayoutWorker[event.data.errorKey] : undefined));
    };
    worker.onerror = () => finish(failure());
    worker.onmessageerror = () => finish(failure());
    worker.postMessage({ id: requestId, graph });
    return () => worker.terminate();
  }, [graph]);
  return cache.get(graph) ?? (state?.graph === graph ? state.value : { status: 'pending' });
}
