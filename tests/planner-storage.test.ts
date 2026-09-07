import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../apps/api/app';
import { createDefaultPlan } from '../packages/domain/defaults';
import { createFactory, createWorld, emptyWorkspace } from '../packages/domain/worlds';
import { parseCatalogPlan } from '../apps/web/src/planStorage';
import type { Catalog } from '../packages/domain/types';
import catalogJson from '../packages/game-data/catalog.json';

const catalog = catalogJson as Catalog;

it('импорт отклоняет прежнюю цель, не меняя её молча', () => {
  const old = createDefaultPlan(catalog); old.settings.objective = 'power';
  expect(() => parseCatalogPlan(old, catalog)).toThrow(/прежн.*цел/i);
  expect(old.settings.objective).toBe('power');
  old.catalogVersion = 'previous-game-catalog';
  expect(() => parseCatalogPlan(old, catalog)).toThrow(/прежн.*цел/i);
  expect(parseCatalogPlan(createDefaultPlan(catalog), catalog).settings.objective).toBe('smooth-power');
});

it('очистка удаляет только прежние планы владельца, сохраняет миры и новые записи при повторной загрузке', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'planner-storage-'));
  const databasePath = join(directory, 'test.sqlite');
  const app = createApp({ databasePath });
  let db: DatabaseSync | undefined;
  try {
    const register = async (username: string) => {
      const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'test-password-123' } });
      expect(response.statusCode).toBe(201);
      return { id: response.json().user.id, cookie: response.cookies.map(c => `${c.name}=${c.value}`).join('; ') };
    };
    const alice = await register('alice'), bob = await register('bob');
    const current = createDefaultPlan(catalog), old = structuredClone(current); old.settings.objective = 'resources';
    const world = createWorld(catalog, 'Сохранённый мир', 'world', current);
    const workspace = { ...emptyWorkspace(catalog.version), worlds: [world], factories: [createFactory(old, 'old', world), createFactory(current, 'current', world)] };
    db = new DatabaseSync(databasePath);
    const insert = db.prepare('INSERT INTO documents (id,user_id,kind,name,revision,updated_at,data) VALUES (?,?,?,?,1,?,?)');
    for (const owner of [alice, bob]) {
      insert.run(randomUUID(), owner.id, 'profiles', 'Старый', '2026-09-01', JSON.stringify(old));
      insert.run(randomUUID(), owner.id, 'plans', 'Новый', '2026-09-07', JSON.stringify(current));
      db.prepare('INSERT INTO workspaces (user_id,revision,data) VALUES (?,1,?)').run(owner.id, JSON.stringify(workspace));
    }
    const session = await app.inject({ url: '/api/session', headers: { cookie: alice.cookie } });
    expect(session.json().removedLegacyPlans).toBe(2);
    expect(db.prepare('SELECT count(*) AS n FROM documents WHERE user_id=?').get(alice.id)?.n).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM documents WHERE user_id=?').get(bob.id)?.n).toBe(2);
    const saved = (await app.inject({ url: '/api/workspace', headers: { cookie: alice.cookie } })).json();
    expect(saved.revision).toBe(2);
    expect(saved.workspace.worlds).toEqual(workspace.worlds);
    expect(saved.workspace.factories.map((f: { id: string }) => f.id)).toEqual(['current']);
    expect((await app.inject({ url: '/api/session', headers: { cookie: alice.cookie } })).json().removedLegacyPlans).toBe(0);
    const staleSave = await app.inject({ method: 'PUT', url: '/api/workspace', headers: { cookie: alice.cookie }, payload: { expectedOwnerId: alice.id, revision: 1, workspace: saved.workspace } });
    expect(staleSave.statusCode).toBe(409);
    const rejected = await app.inject({ method: 'POST', url: '/api/profiles', headers: { cookie: alice.cookie }, payload: { name: 'Старый', data: old } });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toMatch(/прежн.*цел/i);
    const accepted = await app.inject({ method: 'POST', url: '/api/profiles', headers: { cookie: alice.cookie }, payload: { name: 'Новый профиль', data: current } });
    expect(accepted.statusCode).toBe(201);
    expect((await app.inject({ url: '/api/profiles', headers: { cookie: alice.cookie } })).json().profiles).toHaveLength(1);
  } finally { db?.close(); await app.close(); rmSync(directory, { recursive: true, force: true }); }
});
