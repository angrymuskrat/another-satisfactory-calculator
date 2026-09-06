export interface Item {
  id: string;
  name: string;
  nameEn: string;
  category: string;
  icon?: string;
  fluid: boolean;
  raw: boolean;
  sinkable: boolean;
}
export interface Building {
  buildCost?: Ingredient[];
  id: string;
  name: string;
  nameEn: string;
  power: number;
  powerMax?: number;
  powerEstimated?: boolean;
  icon?: string;
}
export interface Ingredient { itemId: string; amount: number }
export interface Recipe {
  id: string;
  name: string;
  nameEn: string;
  category: string;
  buildingId: string;
  seconds: number;
  inputs: Ingredient[];
  outputs: Ingredient[];
  alternate: boolean;
  power?: number;
  powerMax?: number;
  powerEstimated?: boolean;
}
export interface Miner {
  buildCost?: Ingredient[];
  id: string; name: string; rate: number; power: number; resourceIds: string[];
}
export interface Transport { id: string; name: string; rate: number }
export interface Catalog {
  unlocks?: Unlock[];
  version: string;
  provenance: { source: string; commit: string; importedAt: string; verified: boolean; notes: string[] };
  items: Item[];
  buildings: Building[];
  recipes: Recipe[];
  miners: Miner[];
  belts: Transport[];
  pipes: Transport[];
  categories: string[];
}
export interface Source {
  name?: string;
  id: string;
  itemId: string;
  kind: 'flow' | 'node';
  limit: number | null;
  count: number;
  purity: 0.5 | 1 | 2;
  minerId: string;
  clock: number;
}
export interface Unlock {
  id: string; name: string; kind: 'hub' | 'mam' | 'other'; tier?: number;
  recipeIds: string[]; buildingIds: string[]; beltIds: string[]; pipeIds: string[];
  minerIds?: string[]; schematicIds?: string[];
  prerequisiteGroups?: string[][]; prerequisitesKnown?: boolean;
  overclock: boolean; prerequisiteIds: string[];
}
export interface WorldSnapshot {
  id: string; revision: number; unlockedRecipeIds: string[]; unlockedBuildingIds: string[];
  beltId: string; pipeId: string; overclockUnlocked: boolean; unlockedMilestoneIds: string[];
}
export interface Target { itemId: string; rate: number; weight: number; scale: number; minRate?: number; maxRate?: number | null }
export interface Settings {
  enabledRecipeIds: string[];
  enabledBuildingIds: string[];
  beltId: string;
  pipeId: string;
  clock: number;
  resourcePolicy: 'listed-only' | 'unlimited-unlisted';
  objective: 'power' | 'resources' | 'buildings';
  peakPowerLimit?: number | null;
  powerReserve?: number;
  buildingLimits?: Record<string, number>;
  powerLimit: number | null;
  outputSlack: number;
  allowSink: boolean;
  resourceWeights: Record<string, number>;
}
export interface Plan {
  world?: WorldSnapshot;
  schemaVersion: 1;
  catalogVersion: string;
  name: string;
  mode: 'maximize' | 'target';
  policy: 'proportional' | 'priority' | 'weighted';
  targets: Target[];
  sources: Source[];
  settings: Settings;
}
export interface ProductResult { itemId: string; rate: number }
export interface StepResult {
  recipeId: string; cycles: number; machines: number; installedMachines: number;
  power: number; powerMax: number; inputs: ProductResult[]; outputs: ProductResult[];
}
export interface ResourceResult {
  installedMachines?: number;
  sourceId: string; itemId: string; rate: number; limit: number | null; power: number;
}
export interface Result {
  feasibleAlternative?: { products: ProductResult[]; fraction: number; power: number; bottlenecks: string[] };
  status: 'optimal' | 'infeasible' | 'unbounded' | 'error' | 'timeout';
  message: string;
  products: ProductResult[];
  steps: StepResult[];
  resources: ResourceResult[];
  surplus: ProductResult[];
  power: number;
  productionPower: number;
  extractionPower: number;
  sinkPower: number;
  installedPower: number;
  objectiveValue: number;
  warnings: string[];
  diagnostics: string[];
  maxBalanceError: number;
}
