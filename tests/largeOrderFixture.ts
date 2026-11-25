import type { Catalog, Plan } from '../packages/domain/types';
import { createDefaultPlan } from '../packages/domain/defaults';

// Regression order from the November 2026 SCIM audit, including the missing caterium supply.
export function largeOrder(catalog: Catalog): Plan {
  const plan = createDefaultPlan(catalog);
  plan.mode = 'target';
  plan.targets = Object.entries({
    'turbofuel': 270, 'packaged-turbofuel': 320, 'heavy-modular-frame': 4, 'computer': 7,
    'supercomputer': 1.875, 'radio-control-unit': 5, 'crystal-oscillator': 2, 'filter': 7.5,
    'iodine-infused-filter': 7, 'explosive-rebar': 5, 'rifle-ammo': 75, 'turbo-rifle-ammo': 50,
    'nobelisk': 1, 'cluster-nobelisk': 1,
  }).map(([itemId, rate]) => ({ itemId, rate, weight: 1, scale: 1 }));
  plan.sources = Object.entries({
    'iron-ore': 1200, 'copper-ore': 900, 'coal': 1050, 'raw-quartz': 1200,
    'sulfur': 600, 'bauxite': 600, 'water': 10000, 'crude-oil': 1500,
    'limestone': 600, 'caterium-ore': 600,
  }).map(([itemId, limit]) => ({ id: itemId, itemId, kind: 'flow', limit, count: 1, purity: 1, clock: 100, minerId: '' }));
  plan.settings.beltId = 'belt5';
  plan.settings.pipeId = 'pipe2';
  plan.settings.resourceWeights = {};
  plan.settings.enabledBuildingIds = [
    'smelter', 'constructor', 'foundry', 'oil-refinery', 'awesome-sink',
    'packager', 'manufacturer', 'assembler', 'blender',
  ];
  plan.settings.enabledRecipeIds = [
    'iron-ingot', 'iron-plate', 'iron-rod', 'copper-ingot', 'wire',
    'cable', 'concrete', 'screw', 'reinforced-iron-plate', 'biomass-from-wood',
    'biomass-from-leaves', 'silica', 'steel-ingot', 'steel-beam', 'steel-pipe',
    'versatile-framework', 'alt-residual-plastic', 'alt-residual-rubber', 'residual-fuel', 'petroleum-coke',
    'circuit-board', 'plastic', 'rubber', 'fuel', 'quickwire',
    'encased-industrial-beam', 'stator', 'motor', 'automated-wiring', 'quartz-crystal',
    'crystal-oscillator', 'unpackage-alumina-solution', 'alumina-solution', 'packaged-alumina-solution', 'aluminum-scrap',
    'aluminum-ingot', 'alclad-aluminum-sheet', 'aluminum-casing', 'unpackage-water', 'unpackage-oil',
    'unpackage-fuel', 'unpackage-heavy-oil-residue', 'unpackage-liquid-biofuel', 'alt-coal', 'alt-charcoal',
    'alt-biocoal', 'turbofuel', 'packaged-turbofuel', 'unpackage-turbofuel', 'empty-canister',
    'packaged-water', 'packaged-oil', 'packaged-fuel', 'packaged-heavy-oil-residue', 'packaged-liquid-biofuel',
    'liquid-biofuel', 'computer', 'heavy-modular-frame', 'modular-engine', 'adaptive-control-unit',
    'smokeless-powder', 'high-speed-connector', 'black-powder', 'copper-sheet', 'rotor',
    'modular-frame', 'smart-plating', 'fabric', 'solid-biofuel', 'ai-limiter',
    'turbo-rifle-ammo', 'alt-turbo-rifle-ammo', 'homing-rifle-ammo', 'stun-rebar', 'shatter-rebar',
    'explosive-rebar', 'iodine-infused-filter', 'pulse-nobelisk', 'gas-nobelisk', 'cluster-nobelisk',
    'nobelisk', 'iron-rebar', 'rifle-ammo', 'power-shard-purple', 'power-shard-yellow',
    'power-shard-blue', 'filter', 'alt-fabric', 'biomass-from-mycelia', 'caterium-ingot',
    'sam-fluctuator', 'reanimated-sam', 'stinger-protein', 'hatcher-protein', 'alien-dna-capsule',
    'biomass-from-alien-protein', 'spitter-protein', 'hog-protein', 'unpackage-sulfuric-acid', 'sulfuric-acid',
    'packaged-sulfuric-acid', 'battery', 'radio-control-unit', 'supercomputer', 'assembly-director-system',
    'alt-iron-wire', 'alt-screw', 'alt-copper-rotor', 'alt-stitched-iron-plate', 'alt-bolted-iron-plate',
    'alt-modular-frame2', 'alt-copper-sheet', 'alt-copper-ingot', 'alt-rotor', 'alt-modular-frame',
    'alt-steel-beam', 'alt-leached-caterium-ingot', 'alt-silica', 'alt-distilled-silica', 'alt-tempered-copper-ingot',
    'alt-packaged-fuel', 'alt-caterium-circuit-board', 'alt-caterium-wire', 'alt-computer', 'alt-circuit-board',
    'alt-heavy-oil-residue', 'alt-concrete', 'alt-quartz-purification', 'alt-smart-plating', 'alt-steel-ingot',
    'alt-adhered-iron-plate', 'alt-iron-ingot', 'alt-pure-iron-ingot', 'alt-pure-copper-ingot', 'alt-turbo-blend-fuel',
    'alt-fused-wire', 'alt-quickwire', 'alt-steel-screw', 'alt-turbofuel', 'alt-molded-beam',
    'alt-electrode-circuit-board',
  ];
  return plan;
}
