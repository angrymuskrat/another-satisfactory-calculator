/// <reference lib="webworker" />
import './schematicElkShim';
import type { SchematicModel } from '../../../packages/domain/schematic';
import { layoutBoth, type MediumLayout } from './schematicElk';

export type SchematicLayoutRequest = { id: number; graph: SchematicModel };
export type SchematicLayoutWorkerKey = 'layoutFailed';
export type SchematicLayoutResponse = { id: number } & ({ layout: { medium: MediumLayout; close: MediumLayout } } | { error: string } | { errorKey: SchematicLayoutWorkerKey });

self.onmessage = async (event: MessageEvent<SchematicLayoutRequest>) => {
  const { id, graph } = event.data;
  try {
    self.postMessage({ id, layout: await layoutBoth(graph) } satisfies SchematicLayoutResponse);
  } catch (error) {
    console.error(error);
    self.postMessage({ id, ...(error instanceof Error ? { error: error.message } : { errorKey: 'layoutFailed' }) } satisfies SchematicLayoutResponse);
  }
};
