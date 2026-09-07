import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z, ZodError } from 'zod';
import { parsePlannerPlan } from '../../packages/domain/plannerCompatibility';
import { removeLegacyPlans } from './legacyPlans';
import { openDatabase, savedDocument, type SavedRow, type User, type UserRow } from './db';
import { currentUser, hashPassword, revokeSession, SESSION_COOKIE, setSession, verifyPassword } from './auth';
import { registerWorldRoutes } from './worlds';

declare module 'fastify' {
  interface FastifyRequest { user: User | null }
}

const credentials = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[\p{L}\p{N}_.-]+$/u).transform(value => value.normalize('NFKC').toLowerCase()),
  password: z.string().min(8).max(128),
}).strict();
const documentBody = z.object({ name: z.string().trim().min(1).max(120), data: z.unknown() }).strict();
const updateBody = documentBody.extend({ revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1) }).strict();
const params = z.object({ id: z.string().uuid() });

function invalid(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function createApp(options: { databasePath?: string; serveStatic?: boolean; secureCookies?: boolean } = {}) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const db = openDatabase(options.databasePath ?? join(root, '.data', 'users.sqlite'));
  const secure = options.secureCookies ?? false;
  const app = Fastify({ bodyLimit: 1024 * 1024, trustProxy: false });
  app.register(cookie);
  app.register(rateLimit, { global: false });
  app.decorateRequest('user', null);
  app.addHook('onClose', async () => { db.close(); });
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin) {
      const expectedOrigin = `${secure ? 'https' : request.protocol}://${request.headers.host}`;
      if (request.headers.origin !== expectedOrigin) return reply.code(403).send({ error: 'Источник запроса не разрешён.' });
    }
    request.user = currentUser(db, request);
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: 'Некорректные поля запроса.' });
    const statusCode = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    if (statusCode === 500) request.log.error(error);
    return reply.code(statusCode).send({ error: statusCode === 500 ? 'Внутренняя ошибка сервера.' : statusCode === 429 ? 'Слишком много попыток. Повторите позже.' : error.message });
  });

  app.get('/api/session', async request => ({ user: request.user,
    removedLegacyPlans: request.user ? removeLegacyPlans(db, request.user.id) : 0 }));
  app.register(async authRoutes => {
    const authLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };
    authRoutes.post('/api/auth/register', authLimit, async (request, reply) => {
      const { username, password } = credentials.parse(request.body);
      if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return reply.code(409).send({ error: 'Этот логин уже занят.' });
      const hash = await hashPassword(password);
      const user: User = { id: randomUUID(), username };
      // После await ещё одна регистрация могла занять логин.
      if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return reply.code(409).send({ error: 'Этот логин уже занят.' });
      try {
        db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
          .run(user.id, username, hash, new Date().toISOString());
      } catch (error) {
        if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return reply.code(409).send({ error: 'Этот логин уже занят.' });
        throw error;
      }
      setSession(db, request, reply, user, secure);
      return reply.code(201).send({ user });
    });
    authRoutes.post('/api/auth/login', authLimit, async (request, reply) => {
      const { username, password } = credentials.parse(request.body);
      const row = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username) as unknown as UserRow | undefined;
      if (!await verifyPassword(password, row?.password_hash) || !row) return reply.code(401).send({ error: 'Неверный логин или пароль.' });
      const user: User = { id: row.id, username: row.username };
      setSession(db, request, reply, user, secure);
      return { user };
    });
  });
  app.post('/api/auth/logout', async (request, reply) => {
    revokeSession(db, request);
    reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure });
    return reply.code(204).send();
  });

  for (const kind of ['profiles', 'plans'] as const) {
    const singular = kind === 'profiles' ? 'profile' : 'plan';
    app.register(async routes => {
      routes.addHook('preHandler', async (request, reply) => {
        if (!request.user) return reply.code(401).send({ error: 'Войдите, чтобы сохранить или загрузить данные.' });
      });
      routes.get(`/api/${kind}`, async request => {
        const rows = db.prepare('SELECT id, name, revision, updated_at, data FROM documents WHERE user_id = ? AND kind = ? ORDER BY updated_at DESC, id')
          .all(request.user!.id, kind) as unknown as SavedRow[];
        return { [kind]: rows.map(savedDocument) };
      });
      routes.post(`/api/${kind}`, async (request, reply) => {
        const body = documentBody.parse(request.body);
        let data;
        try { data = parsePlannerPlan(body.data); } catch (error) { throw invalid(error instanceof Error ? error.message : 'Некорректные данные плана.'); }
        const row: SavedRow = { id: randomUUID(), name: body.name, revision: 1, updated_at: new Date().toISOString(), data: JSON.stringify(data) };
        db.prepare('INSERT INTO documents (id, user_id, kind, name, revision, updated_at, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(row.id, request.user!.id, kind, row.name, row.revision, row.updated_at, row.data);
        return reply.code(201).send({ [singular]: savedDocument(row) });
      });
      routes.get(`/api/${kind}/:id`, async (request, reply) => {
        const { id } = params.parse(request.params);
        const row = db.prepare('SELECT id, name, revision, updated_at, data FROM documents WHERE id = ? AND user_id = ? AND kind = ?')
          .get(id, request.user!.id, kind) as unknown as SavedRow | undefined;
        if (!row) return reply.code(404).send({ error: 'Запись не найдена.' });
        return { [singular]: savedDocument(row) };
      });
      routes.put(`/api/${kind}/:id`, async (request, reply) => {
        const { id } = params.parse(request.params);
        const body = updateBody.parse(request.body);
        let data;
        try { data = parsePlannerPlan(body.data); } catch (error) { throw invalid(error instanceof Error ? error.message : 'Некорректные данные плана.'); }
        const row = db.prepare(`UPDATE documents SET name = ?, data = ?, updated_at = ?, revision = revision + 1
          WHERE id = ? AND user_id = ? AND kind = ? AND revision = ? RETURNING id, name, revision, updated_at, data`)
          .get(body.name, JSON.stringify(data), new Date().toISOString(), id, request.user!.id, kind, body.revision) as unknown as SavedRow | undefined;
        if (!row) {
          const exists = db.prepare('SELECT id FROM documents WHERE id = ? AND user_id = ? AND kind = ?').get(id, request.user!.id, kind);
          return reply.code(exists ? 409 : 404).send({ error: exists ? 'Запись изменена в другой вкладке. Загрузите актуальную версию.' : 'Запись не найдена.' });
        }
        return { [singular]: savedDocument(row) };
      });
      routes.delete(`/api/${kind}/:id`, async (request, reply) => {
        const { id } = params.parse(request.params);
        const deleted = db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ? AND kind = ?').run(id, request.user!.id, kind);
        if (!deleted.changes) return reply.code(404).send({ error: 'Запись не найдена.' });
        return reply.code(204).send();
      });
    });
  }

  registerWorldRoutes(app, db);
  const staticRoot = join(root, 'dist', 'web');
  if (options.serveStatic && existsSync(join(staticRoot, 'index.html'))) {
    app.register(fastifyStatic, { root: staticRoot, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method)) return reply.code(404).send({ error: 'Адрес не найден.' });
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Адрес не найден.' }));
  }
  return app;
}
