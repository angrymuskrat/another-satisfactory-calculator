import { readFileSync } from 'node:fs';
import type { Catalog } from '../../packages/domain/types';

export const catalog: Catalog = JSON.parse(readFileSync(new URL('../../packages/game-data/catalog.json', import.meta.url), 'utf8'));
