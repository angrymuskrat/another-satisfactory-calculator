import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { emptyWorkspace, parseWorkspace, validateWorkspaceCatalog } from '../../packages/domain/worlds';
import type { Catalog } from '../../packages/domain/types';
import { parseCatalogPlan } from '../../packages/domain/worldPlanValidation';
import { requirePlannerObjective } from '../../packages/domain/plannerCompatibility';
import catalogJson from '../../packages/game-data/catalog.json';

const catalog = catalogJson as Catalog;
const bodySchema = z.strictObject({ expectedOwnerId: z.string().uuid(), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1), workspace: z.unknown() });
export function registerWorldRoutes(app: FastifyInstance, db: DatabaseSync) {
  app.register(async routes => {
    routes.addHook('preHandler', async (request, reply) => {
      if (!request.user) return reply.code(401).send({ error: 'Войдите, чтобы сохранить или загрузить миры.' });
    });
    routes.get('/api/workspace', async request => {
      const row = db.prepare('SELECT revision, data FROM workspaces WHERE user_id = ?').get(request.user!.id) as { revision: number; data: string } | undefined;
      return { ownerId: request.user!.id, revision: row?.revision ?? 0, workspace: row ? JSON.parse(row.data) : emptyWorkspace(catalog.version) };
    });
    routes.put('/api/workspace', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
      const body = bodySchema.parse(request.body);
      if (body.expectedOwnerId !== request.user!.id) return reply.code(409).send({ error: 'Аккаунт изменился. Загрузите его рабочее пространство перед сохранением.' });
      let workspace;
      try {
        workspace = parseWorkspace(body.workspace, value => requirePlannerObjective(parseCatalogPlan(value, catalog)));
        validateWorkspaceCatalog(workspace, catalog);
      } catch (error) {
        return reply.code(400).send({ error: error instanceof Error ? error.message : 'Некорректное рабочее пространство.' });
      }
      // Одна атомарная запись охватывает мир и все его snapshots. Владение берётся только из сессии.
      const row = db.prepare(`INSERT INTO workspaces (user_id, revision, data) SELECT ?, 1, ? WHERE ? = 0
        ON CONFLICT(user_id) DO NOTHING RETURNING revision`).get(request.user!.id, JSON.stringify(workspace), body.revision);
      const updated = row ?? db.prepare(`UPDATE workspaces SET revision = revision + 1, data = ?
        WHERE user_id = ? AND revision = ? RETURNING revision`).get(JSON.stringify(workspace), request.user!.id, body.revision);
      if (!updated) return reply.code(409).send({ error: 'Рабочее пространство изменено в другой вкладке. Экспортируйте текущие данные и загрузите актуальную версию.' });
      return { ownerId: request.user!.id, revision: updated.revision, workspace };
    });
  });
}
