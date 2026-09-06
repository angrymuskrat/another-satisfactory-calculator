import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Plan } from '../../packages/domain/types';

export interface User { id: string; username: string }
export interface UserRow extends User { password_hash: string }
export interface SavedRow {
  id: string; name: string; revision: number; updated_at: string; data: string;
}

export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  const version = db.prepare('PRAGMA user_version').get()!.user_version as number;
  if (version > 2) {
    db.close();
    throw new Error('Версия базы данных новее поддерживаемой.');
  }
  if (version === 0) {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX sessions_expiry ON sessions(expires_at);
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('profiles', 'plans')),
        name TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX documents_owner_kind ON documents(user_id, kind);
      PRAGMA user_version = 1;
      COMMIT;
    `);
  }
  if (version < 2) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE workspaces (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK(revision >= 1),
        data TEXT NOT NULL
      );
      PRAGMA user_version = 2;
      COMMIT;`);
  }
  return db;
}

export function savedDocument(row: SavedRow) {
  return {
    id: row.id, name: row.name, revision: row.revision,
    updatedAt: row.updated_at, data: JSON.parse(row.data) as Plan,
  };
}
