import { createRequire } from 'node:module';
import type loadHighs from 'highs';
const require = createRequire(import.meta.url);
/** Node loader; browser worker imports the generated ES module directly. */
export const createHighs: typeof loadHighs = require('./vendor/highs.cjs');
