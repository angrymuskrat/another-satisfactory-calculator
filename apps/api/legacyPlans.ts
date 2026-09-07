import type { DatabaseSync } from 'node:sqlite';
import { parsePlan } from '../../packages/domain/validation';
import { parseWorkspace } from '../../packages/domain/worlds';
import { removeLegacyFactories } from '../../packages/domain/plannerCompatibility';

/** Очистка только данных текущего владельца; ревизия не позволяет вернуть старый snapshot. */
export function removeLegacyPlans(db: DatabaseSync, ownerId: string): number {
  db.exec('BEGIN IMMEDIATE');
  try {
    let removed = 0;
    const rows = db.prepare('SELECT id, data FROM documents WHERE user_id = ?').all(ownerId) as { id: string; data: string }[];
    for (const row of rows) {
      if (parsePlan(JSON.parse(row.data)).settings.objective === 'smooth-power') continue;
      removed += Number(db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?').run(row.id, ownerId).changes);
    }
    const row = db.prepare('SELECT data FROM workspaces WHERE user_id = ?').get(ownerId) as { data: string } | undefined;
    if (row) {
      const cleaned = removeLegacyFactories(parseWorkspace(JSON.parse(row.data)));
      if (cleaned.removed) {
        db.prepare('UPDATE workspaces SET data = ?, revision = revision + 1 WHERE user_id = ?').run(JSON.stringify(cleaned.workspace), ownerId);
        removed += cleaned.removed;
      }
    }
    db.exec('COMMIT');
    return removed;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
