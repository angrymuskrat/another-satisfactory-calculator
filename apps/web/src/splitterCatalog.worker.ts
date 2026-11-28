/// <reference lib="webworker" />
import { DistributionSearch, validateDistribution } from '../../../packages/domain/beltRouting';
import type { Distribution } from '../../../packages/domain/beltRouting';

export type CatalogErrorKey = 'searchNotStarted' | 'unverifiedDistribution' | 'searchFailed';

export interface CatalogResponse {
  results: Distribution[];
  complete: boolean;
  visited: number;
  error?: string;
  errorKey?: CatalogErrorKey;
}

class CatalogError extends Error {
  constructor(readonly key: CatalogErrorKey) { super(key); }
}

let search: DistributionSearch | undefined;
let maxDepth: 1 | 2 | 3 | 4 = 1;
self.onmessage = (event: MessageEvent<{ maxDepth?: 1 | 2 | 3 | 4 }>) => {
  try {
    if (event.data.maxDepth !== undefined) {
      maxDepth = event.data.maxDepth;
      search = new DistributionSearch(maxDepth);
    }
    if (!search) throw new CatalogError('searchNotStarted');
    const batch = search.advance({ maxStates: 1000, maxResults: 200, deadline: Date.now() + 200 });
    for (const distribution of batch.results) {
      if (validateDistribution(distribution, maxDepth).length) throw new CatalogError('unverifiedDistribution');
    }
    self.postMessage(batch satisfies CatalogResponse);
  } catch (error) {
    const failure = error instanceof CatalogError ? { errorKey: error.key } : error instanceof Error ? { error: error.message } : { errorKey: 'searchFailed' as const };
    self.postMessage({ results: [], complete: false, visited: 0, ...failure } satisfies CatalogResponse);
  }
};
