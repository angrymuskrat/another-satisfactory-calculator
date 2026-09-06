import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from './db';

export const SESSION_COOKIE = 'satisfactory_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await derivePassword(password, salt);
  return `scrypt-v1:${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored?: string) {
  // Неизвестный логин тоже выполняет scrypt: отсутствие пользователя не даёт быстрый ответ.
  const [version, salt, digest] = (stored ?? `scrypt-v1:${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  if (version !== 'scrypt-v1' || !/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{128}$/.test(digest)) return false;
  const actual = await derivePassword(password, salt);
  return timingSafeEqual(actual, Buffer.from(digest, 'hex')) && stored !== undefined;
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function currentUser(db: DatabaseSync, request: FastifyRequest): User | null {
  const token = request.cookies[SESSION_COOKIE];
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = db.prepare(`SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(tokenHash(token), Date.now());
  return row ? { id: row.id as string, username: row.username as string } : null;
}

export function revokeSession(db: DatabaseSync, request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

export function setSession(db: DatabaseSync, request: FastifyRequest, reply: FastifyReply, user: User, secure: boolean) {
  revokeSession(db, request);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash(token), user.id, Date.now() + SESSION_SECONDS * 1000);
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: SESSION_SECONDS,
  });
}
