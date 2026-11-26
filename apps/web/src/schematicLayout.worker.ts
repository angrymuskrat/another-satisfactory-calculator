/// <reference lib="webworker" />
import './schematicElkShim';
import type { SchematicModel } from '../../../packages/domain/schematic';
import { layoutBoth, type MediumLayout } from './schematicElk';

export type SchematicLayoutRequest = { id: number; graph: SchematicModel };
export type SchematicLayoutResponse = { id: number } & ({ layout: { medium: MediumLayout; close: MediumLayout } } | { error: string });

self.onmessage = async (event: MessageEvent<SchematicLayoutRequest>) => {
  const { id, graph } = event.data;
  try {
    self.postMessage({ id, layout: await layoutBoth(graph) } satisfies SchematicLayoutResponse);
  } catch (error) {
    console.error(error);
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Не удалось разложить схему.' } satisfies SchematicLayoutResponse);
  }
};
