import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../apps/api/app';
import type { Plan } from '../packages/domain/types';
import type { Catalog } from '../packages/domain/types';
import catalogJson from '../packages/game-data/catalog.json';
import { createDefaultPlan } from '../packages/domain/defaults';
import { applyWorldUpdate, createFactory, createWorld, emptyWorkspace, previewWorldUpdate } from '../packages/domain/worlds';

const plan: Plan = {
  schemaVersion: 1, catalogVersion: 'fixture-v1', name: 'Стальной завод',
  mode: 'maximize', policy: 'proportional',
  targets: [{ itemId: 'iron-plate', rate: 10, weight: 1, scale: 1 }],
  sources: [{ id: 'ore-1', itemId: 'iron-ore', kind: 'flow', limit: 60, count: 1, purity: 1, minerId: 'miner-mk1', clock: 100 }],
  settings: {
    enabledRecipeIds: ['iron-ingot'], enabledBuildingIds: ['smelter'],
    beltId: 'mk1', pipeId: 'mk1', clock: 100, resourcePolicy: 'listed-only',
    objective: 'power', powerLimit: null, outputSlack: 0, allowSink: false,
    resourceWeights: { 'iron-ore': 2 },
  },
};
const apps: FastifyInstance[] = [];
const directories: string[] = [];
function app(databasePath = ':memory:', secureCookies = false) {
  const instance = createApp({ databasePath, secureCookies });
  apps.push(instance);
  return instance;
}
async function register(instance: FastifyInstance, username = 'alice') {
  const response = await instance.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'correct-horse-battery' } });
  expect(response.statusCode).toBe(201);
  return { cookie: response.cookies.map(c => `${c.name}=${c.value}`).join('; '), user: response.json().user, response };
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map(instance => instance.close()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

const worldCatalog = catalogJson as Catalog;
function worldFixture() {
  const completePlan = createDefaultPlan(worldCatalog);
  const world = createWorld(worldCatalog, 'Мой мир', 'my-world', completePlan);
  return { ...emptyWorkspace(worldCatalog.version), worlds: [world], factories: [
    createFactory(completePlan, 'first', world), createFactory({ ...completePlan, name: 'Вторая фабрика' }, 'second', world),
    createFactory(completePlan, 'legacy'),
  ] };
}
describe('API миров и фабрик', () => {
  it('сохраняет и восстанавливает профиль с целью ровной нагрузки', async () => {
    const instance = app(); const { cookie } = await register(instance);
    const data = structuredClone(plan); data.settings.objective = 'smooth-power';
    const created = await instance.inject({ method: 'POST', url: '/api/profiles', headers: { cookie }, payload: { name: 'Ровная нагрузка', data } });
    expect(created.statusCode).toBe(201);
    const restored = await instance.inject({ url: `/api/profiles/${created.json().profile.id}`, headers: { cookie } });
    expect(restored.statusCode).toBe(200); expect(restored.json().profile.data).toEqual(data);
  });
  it('изолирует workspace аккаунтов, не принимает чужого владельца и сохраняет полные фабрики', async () => {
    const instance = app();
    expect((await instance.inject('/api/workspace')).statusCode).toBe(401);
    expect((await instance.inject({ method: 'PUT', url: '/api/workspace', payload: {} })).statusCode).toBe(401);
    const a = await register(instance);
    const b = await register(instance, 'bob');
    const workspace = worldFixture();
    const payload = { expectedOwnerId: a.user.id, revision: 0, workspace };
    const created = await instance.inject({ method: 'PUT', url: '/api/workspace', headers: { cookie: a.cookie }, payload });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual({ ownerId: a.user.id, revision: 1, workspace });
    expect((await instance.inject({ url: '/api/workspace', headers: { cookie: b.cookie } })).json().workspace.factories).toEqual([]);
    expect((await instance.inject({ method: 'PUT', url: '/api/workspace', headers: { cookie: b.cookie }, payload })).statusCode).toBe(409);
    const own = await instance.inject({ method: 'PUT', url: '/api/workspace', headers: { cookie: b.cookie }, payload: { ...payload, expectedOwnerId: b.user.id } });
    expect(own.statusCode).toBe(200); // Одинаковые ID внутри другого аккаунта допустимы.
    expect((await instance.inject({ url: '/api/workspace', headers: { cookie: a.cookie } })).json().workspace).toEqual(workspace);
    expect((await instance.inject({ method: 'PUT', url: '/api/workspace', headers: { cookie: a.cookie, origin: 'https://evil.example' }, payload: { ...payload, revision: 1 } })).statusCode).toBe(403);
  });
  it('атомарно применяет мир ко всем snapshots, отклоняет конфликт revision без потери данных', async () => {
    const instance = app(); const { cookie, user } = await register(instance);
    const workspace = worldFixture();
    await instance.inject({ method: 'PUT', url: '/api/workspace', headers: { cookie }, payload: { expectedOwnerId: user.id, revision: 0, workspace } });
    const preview = previewWorldUpdate(workspace, { ...workspace.worlds[0], unlockedRecipeIds: [] });
    const next = applyWorldUpdate(workspace, preview);
    const responses = await Promise.all([next, workspace].map(workspace => instance.inject({ method: 'PUT', url: '/api/workspace', headers: { cookie }, payload: { expectedOwnerId: user.id, revision: 1, workspace } })));
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
    const winner = responses.find(r => r.statusCode === 200)!.json();
    expect(winner.revision).toBe(2);
    expect((await instance.inject({ url: '/api/workspace', headers: { cookie } })).json()).toEqual(winner);
    expect(winner.workspace.factories[2]).toEqual(workspace.factories[2]);
  });
  it('отклоняет висячие ссылки и несовместимые snapshots, сохраняя прежнюю запись', async () => {
    const instance = app(); const { cookie, user } = await register(instance);
    const workspace = worldFixture();
    const payload = { expectedOwnerId: user.id, revision: 0, workspace };
    await instance.inject({ method: 'PUT', url: '/api/workspace', headers: { cookie }, payload });
    const missing = structuredClone(workspace); missing.worlds = [];
    const stale = structuredClone(workspace); stale.worlds[0].revision++;
    const badRecipe = structuredClone(workspace); badRecipe.factories[0].plan.settings.enabledRecipeIds.push('unknown-recipe');
    for (const bad of [missing, stale, badRecipe, { ...workspace, catalogVersion: 'unknown' }]) {
      const response = await instance.inject({ method: 'PUT', url: '/api/workspace', headers: { cookie }, payload: { ...payload, revision: 1, workspace: bad } });
      expect(response.statusCode).toBe(400);
    }
    expect((await instance.inject({ url: '/api/workspace', headers: { cookie } })).json().workspace).toEqual(workspace);
  });
  it('после перезапуска БД восстанавливает workspace и оставляет legacy profiles/plans', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'satisfactory-worlds-')); directories.push(directory);
    const path = join(directory, 'store.sqlite'); const first = app(path);
    const { cookie, user } = await register(first);
    const workspace = worldFixture();
    for (const kind of ['plans', 'profiles']) await first.inject({ method: 'POST', url: `/api/${kind}`, headers: { cookie }, payload: { name: 'Legacy', data: plan } });
    await first.inject({ method: 'PUT', url: '/api/workspace', headers: { cookie }, payload: { expectedOwnerId: user.id, revision: 0, workspace } });
    await first.close(); apps.splice(apps.indexOf(first), 1);
    const second = app(path);
    expect((await second.inject({ url: '/api/workspace', headers: { cookie } })).json().workspace).toEqual(workspace);
    for (const kind of ['plans', 'profiles']) expect((await second.inject({ url: `/api/${kind}`, headers: { cookie } })).json()[kind][0].data).toEqual(plan);
  });
  it('миграция БД v1 добавляет workspace без изменения legacy документов и сессий', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'satisfactory-worlds-migration-')); directories.push(directory);
    const path = join(directory, 'store.sqlite'); const first = app(path);
    const { cookie } = await register(first);
    await first.inject({ method: 'POST', url: '/api/profiles', headers: { cookie }, payload: { name: 'Legacy', data: plan } });
    await first.close(); apps.splice(apps.indexOf(first), 1);
    const db = new DatabaseSync(path); db.exec('DROP TABLE workspaces; PRAGMA user_version = 1;'); db.close();
    const second = app(path);
    expect((await second.inject({ url: '/api/profiles', headers: { cookie } })).json().profiles[0].data).toEqual(plan);
    expect((await second.inject({ url: '/api/workspace', headers: { cookie } })).json().revision).toBe(0);
  });
});

describe('API пользователей и сохранённых конфигураций', () => {
  it('сохраняет все поля P2 без потерь и отклоняет отрицательный резерв', async () => {
    const instance = app(); const { cookie } = await register(instance);
    const data: Plan = { ...structuredClone(plan), batch: { minutes: 30, items: [{ itemId: 'iron-plate', required: 100, stock: 40 }] },
      lines: [{ id: 'old', name: 'Цех', recipeId: 'iron-ingot', count: 2, clock: 50, duty: 0.5, somersloops: 0, locked: true }], expansion: 'add', somersloopBudget: 3,
      exports: [{ itemId: 'iron-plate', limit: 5, name: 'Снабжение' }] };
    data.sources[0] = { ...data.sources[0], name: 'Запад', notes: 'Для соседней фабрики', reserve: 10, importPower: 2 };
    const created = await instance.inject({ method: 'POST', url: '/api/profiles', headers: { cookie }, payload: { name: 'P2', data } });
    expect(created.statusCode).toBe(201);
    const restored = await instance.inject({ url: `/api/profiles/${created.json().profile.id}`, headers: { cookie } });
    expect(restored.json().profile.data).toEqual(data);
    data.sources[0].reserve = -1;
    expect((await instance.inject({ method: 'POST', url: '/api/profiles', headers: { cookie }, payload: { name: 'Ошибка', data } })).statusCode).toBe(400);
  });
  it('создаёт сессию, сохраняет и восстанавливает полный профиль', async () => {
    const instance = app();
    expect((await instance.inject('/api/session')).json()).toEqual({ user: null });
    expect((await instance.inject('/api/profiles')).statusCode).toBe(401);
    const { cookie, user, response } = await register(instance);
    expect(user).toEqual({ id: expect.any(String), username: 'alice' });
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=Lax');
    expect((await instance.inject({ url: '/api/session', headers: { cookie } })).json()).toEqual({ user });
    const created = await instance.inject({ method: 'POST', url: '/api/profiles', headers: { cookie }, payload: { name: 'Мой профиль', data: plan } });
    expect(created.statusCode).toBe(201);
    const profile = created.json().profile;
    expect(profile).toMatchObject({ name: 'Мой профиль', revision: 1, data: plan });
    expect((await instance.inject({ url: `/api/profiles/${profile.id}`, headers: { cookie } })).json()).toEqual({ profile });
    expect((await instance.inject({ url: '/api/profiles', headers: { cookie } })).json()).toEqual({ profiles: [profile] });
  });

  it('изолирует чтение, обновление и удаление двух пользователей', async () => {
    const instance = app();
    const a = await register(instance);
    const b = await register(instance, 'bob');
    const created = await instance.inject({ method: 'POST', url: '/api/profiles', headers: { cookie: a.cookie }, payload: { name: 'A', data: plan } });
    const id = created.json().profile.id;
    expect((await instance.inject({ url: '/api/profiles', headers: { cookie: b.cookie } })).json()).toEqual({ profiles: [] });
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      const response = await instance.inject({ method, url: `/api/profiles/${id}`, headers: { cookie: b.cookie }, ...(method === 'PUT' ? { payload: { name: 'Чужой', data: plan, revision: 1 } } : {}) });
      expect(response.statusCode).toBe(404);
    }
    expect((await instance.inject({ url: `/api/profiles/${id}`, headers: { cookie: a.cookie } })).json().profile.name).toBe('A');
  });

  it('отклоняет устаревшую версию без перезаписи и удаляет собственный профиль', async () => {
    const instance = app();
    const { cookie } = await register(instance);
    const created = await instance.inject({ method: 'POST', url: '/api/profiles', headers: { cookie }, payload: { name: 'A', data: plan } });
    const id = created.json().profile.id;
    const responses = await Promise.all(['B', 'C'].map(name => instance.inject({ method: 'PUT', url: `/api/profiles/${id}`, headers: { cookie }, payload: { name, data: plan, revision: 1 } })));
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
    const winner = responses.find(r => r.statusCode === 200)!.json().profile;
    expect(winner.revision).toBe(2);
    expect((await instance.inject({ url: `/api/profiles/${id}`, headers: { cookie } })).json().profile).toEqual(winner);
    expect((await instance.inject({ method: 'DELETE', url: `/api/profiles/${id}`, headers: { cookie } })).statusCode).toBe(204);
    expect((await instance.inject({ url: `/api/profiles/${id}`, headers: { cookie } })).statusCode).toBe(404);
  });

  it('проверяет пароль, уникальность логина и выход из сессии', async () => {
    const instance = app();
    const { cookie, user } = await register(instance);
    expect((await instance.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'ALICE', password: 'some-other-password' } })).statusCode).toBe(409);
    expect((await instance.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice', password: 'wrong-password' } })).statusCode).toBe(401);
    expect((await instance.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })).statusCode).toBe(204);
    expect((await instance.inject({ url: '/api/session', headers: { cookie } })).json()).toEqual({ user: null });
    const login = await instance.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ALICE', password: 'correct-horse-battery' } });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ user });
    expect(login.cookies[0].value).not.toBe(cookie.split('=')[1]);
  });

  it('сохраняет пользователей и данные после открытия БД, отклоняет истёкшую сессию', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'satisfactory-api-'));
    directories.push(directory);
    const databasePath = join(directory, 'store.sqlite');
    const first = app(databasePath);
    const { cookie } = await register(first);
    await first.inject({ method: 'POST', url: '/api/profiles', headers: { cookie }, payload: { name: 'Перезапуск', data: plan } });
    await first.close();
    apps.splice(apps.indexOf(first), 1);
    const second = app(databasePath);
    expect((await second.inject({ url: '/api/profiles', headers: { cookie } })).json().profiles[0].data).toEqual(plan);
    const db = new DatabaseSync(databasePath);
    const stored = db.prepare('SELECT token_hash FROM sessions').get()!;
    expect(stored.token_hash).not.toBe(cookie.split('=')[1]);
    db.prepare('UPDATE sessions SET expires_at = 0').run();
    db.close();
    expect((await second.inject({ url: '/api/profiles', headers: { cookie } })).statusCode).toBe(401);
    expect((await second.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice', password: 'correct-horse-battery' } })).statusCode).toBe(200);
  });

  it('валидирует полный план и запрещает произвольного владельца', async () => {
    const instance = app();
    const { cookie } = await register(instance);
    const invalid = [
      { name: 'X', data: plan, userId: 'someone-else' },
      { name: '', data: plan },
      { name: 'X', data: { ...plan, schemaVersion: 2 } },
      { name: 'X', data: { ...plan, settings: { ...plan.settings, clock: 0 } } },
      { name: 'X', data: { ...plan, settings: { ...plan.settings, powerLimit: -1 } } },
      { name: 'X', data: { ...plan, settings: { ...plan.settings, outputSlack: 101 } } },
      { name: 'X', data: { ...plan, targets: [{ itemId: 'x', rate: 2, weight: -1, scale: 1 }] } },
      { name: 'X', data: { ...plan, sources: [{ ...plan.sources[0], limit: -1 }] } },
      { name: 'X', data: { ...plan, sources: [{ ...plan.sources[0], count: 1.5 }] } },
      { name: 'X', data: { ...plan, targets: Array(257).fill(plan.targets[0]) } },
    ];
    for (const payload of invalid) {
      const response = await instance.inject({ method: 'POST', url: '/api/profiles', headers: { cookie }, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toEqual(expect.any(String));
    }
    const zero = { ...plan, sources: [{ ...plan.sources[0], limit: 0 }], settings: { ...plan.settings, powerLimit: 0 } };
    expect((await instance.inject({ method: 'POST', url: '/api/profiles', headers: { cookie }, payload: { name: 'Ноль', data: zero } })).statusCode).toBe(201);
  });

  it('защищает изменения от чужого Origin и выставляет Secure при HTTPS', async () => {
    const instance = app(':memory:', true);
    const cross = await instance.inject({ method: 'POST', url: '/api/auth/register', headers: { origin: 'https://evil.example' }, payload: { username: 'alice', password: 'correct-horse-battery' } });
    expect(cross.statusCode).toBe(403);
    const registered = await instance.inject({ method: 'POST', url: '/api/auth/register', headers: { host: 'factory.example', origin: 'https://factory.example' }, payload: { username: 'alice', password: 'correct-horse-battery' } });
    expect(registered.statusCode).toBe(201);
    expect(registered.headers['set-cookie']).toContain('Secure');
  });

  it('ограничивает частоту попыток входа и размер пароля', async () => {
    const instance = app();
    expect((await instance.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'alice', password: 'x'.repeat(129) } })).statusCode).toBe(400);
    const responses = [];
    for (let i = 0; i < 21; i++) responses.push(await instance.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice', password: '' } }));
    expect(responses.some(response => response.statusCode === 429)).toBe(true);
  });

  it('хранит планы отдельно от профилей с теми же правилами владения', async () => {
    const instance = app();
    const { cookie } = await register(instance);
    const created = await instance.inject({ method: 'POST', url: '/api/plans', headers: { cookie }, payload: { name: 'План', data: plan } });
    expect(created.statusCode).toBe(201);
    const saved = created.json().plan;
    expect((await instance.inject({ url: '/api/plans', headers: { cookie } })).json()).toEqual({ plans: [saved] });
    expect((await instance.inject({ url: `/api/profiles/${saved.id}`, headers: { cookie } })).statusCode).toBe(404);
  });
});
