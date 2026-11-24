/// <reference lib="webworker" />
import { DistributionSearch, validateDistribution } from '../../../packages/domain/beltRouting';
import type { Distribution } from '../../../packages/domain/beltRouting';

export interface CatalogResponse {
  results: Distribution[];
  complete: boolean;
  visited: number;
  error?: string;
}

let search: DistributionSearch | undefined;
let maxDepth: 1 | 2 | 3 | 4 = 1;
self.onmessage = (event: MessageEvent<{ maxDepth?: 1 | 2 | 3 | 4 }>) => {
  try {
    if (event.data.maxDepth !== undefined) {
      maxDepth = event.data.maxDepth;
      search = new DistributionSearch(maxDepth);
    }
    if (!search) throw new Error('Поиск справочника не запущен.');
    const batch = search.advance({ maxStates: 1000, maxResults: 200, deadline: Date.now() + 200 });
    for (const distribution of batch.results) {
      if (validateDistribution(distribution, maxDepth).length) throw new Error('Не удалось подтвердить схему распределения.');
    }
    self.postMessage(batch satisfies CatalogResponse);
  } catch (error) {
    self.postMessage({ results: [], complete: false, visited: 0, error: error instanceof Error ? error.message : 'Ошибка поиска распределений.' } satisfies CatalogResponse);
  }
};
