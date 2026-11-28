import type { Plan, ResourceResult } from '../../../packages/domain/types';

export const usedResources = (plan: Plan, resources: ResourceResult[]) => resources.filter(source => source.rate !== 0 || plan.sources.some(s => s.id === source.sourceId));
