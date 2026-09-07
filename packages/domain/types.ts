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
  researchTrees?: ResearchTree[];
  researchNames?: Record<string, string>;
  gamePhases?: GamePhase[];
  categorySource?: 'game-assets';
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
export interface ResearchNode {
  schematicId: string; name: string;
  parents: (string | null)[]; unhiddenBy: (string | null)[];
  unresolvedCoordinates: number[][]; prerequisiteGroups: string[][];
  conditions?: string[];
}
export interface ResearchTree {
  id: string; name: string; seasonal: boolean; conditions: string[]; nodes: ResearchNode[];
}
export interface GamePhase { id: string; name: string; lastTier: number }
export interface Source {
  notes?: string;
  reserve?: number;
  sharedNodeId?: string;
  importPower?: number | null;
  well?: { satellites: { purity: 0.5 | 1 | 2; count: number }[] };
  name?: string;
  id: string;
  itemId: string;
  kind: 'flow' | 'node' | 'well';
  limit: number | null;
  count: number;
  purity: 0.5 | 1 | 2;
  minerId: string;
  clock: number;
}
export interface Unlock {
  sourceType?: string;
  /** Все сериализованные условия схемы распознаны; не подтверждает её покупку или внешние события. */
  selectionDependenciesKnown?: boolean;
  id: string; name: string; kind: 'hub' | 'mam' | 'other'; tier?: number;
  recipeIds: string[]; buildingIds: string[]; beltIds: string[]; pipeIds: string[];
  minerIds?: string[]; schematicIds?: string[];
  prerequisiteGroups?: string[][]; prerequisitesKnown?: boolean;
  overclock: boolean; prerequisiteIds: string[];
}
export interface WorldSnapshot {
  id: string; revision: number; unlockedRecipeIds: string[]; unlockedBuildingIds: string[];
  beltId: string; pipeId: string; overclockUnlocked: boolean; unlockedMilestoneIds: string[];
  resourceNodes?: SharedResourceNode[];
}
export interface SharedResourceNode { id: string; name: string; itemId: string; limit: number }
export interface Target { itemId: string; rate: number; weight: number; scale: number; minRate?: number; maxRate?: number | null }
export interface Settings {
  variantOptions?: { outputLoss: number; extraMachines: number };
  smoothPowerExtraMachines?: number;
  enabledRecipeIds: string[];
  enabledBuildingIds: string[];
  beltId: string;
  pipeId: string;
  clock: number;
  resourcePolicy: 'listed-only' | 'unlimited-unlisted';
  objective: 'power' | 'smooth-power' | 'resources' | 'buildings';
  peakPowerLimit?: number | null;
  powerReserve?: number;
  buildingLimits?: Record<string, number>;
  powerLimit: number | null;
  outputSlack: number;
  allowSink: boolean;
  resourceWeights: Record<string, number>;
}
export interface Plan {
  recipeProgress?: { unlockIds: string[] };
  batch?: { minutes: number; items: { itemId: string; required: number; stock: number }[] };
  lines?: { id: string; name: string; recipeId: string; count: number; clock: number; somersloops: number; duty: number; locked: boolean }[];
  expansion?: 'keep' | 'add' | 'rebuild';
  somersloopBudget?: number;
  exports?: { itemId: string; limit: number; name: string }[];
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
  clock?: number;
  configurationId?: string;
  recipeId: string; cycles: number; machines: number; installedMachines: number;
  power: number; powerMax: number; inputs: ProductResult[]; outputs: ProductResult[];
}
export interface ResourceResult {
  installedMachines?: number;
  sourceId: string; itemId: string; rate: number; limit: number | null; power: number;
}
export interface Result {
  machineBudget?: { minimum: number; limit: number; used: number };
  exports?: ProductResult[];
  somersloops?: number;
  feasibleAlternative?: { products: ProductResult[]; fraction: number; power: number; bottlenecks: string[] };
  status: 'optimal' | 'approximate' | 'infeasible' | 'unbounded' | 'error' | 'timeout';
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
export const hasSolution = (result: Result | null | undefined): result is Result & { status: 'optimal' | 'approximate' } => result?.status === 'optimal' || result?.status === 'approximate';
export interface ProductionVariant { id: 'maximum' | 'economy'; label: string; plan: Plan; result: Result }
export interface ProductionVariants { variants: ProductionVariant[]; equivalent: boolean }
