import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS versions (
      image_id TEXT NOT NULL REFERENCES images(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      pattern TEXT NOT NULL,
      boundary_rule_version TEXT NOT NULL,
      result_json TEXT,
      reconstructed_at TEXT,
      PRIMARY KEY (image_id, version)
    );
    CREATE TABLE IF NOT EXISTS raw_samples (
      image_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      value REAL NOT NULL,
      phase TEXT NOT NULL,
      PRIMARY KEY (image_id, version, x, y),
      FOREIGN KEY (image_id, version) REFERENCES versions(image_id, version) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_raw_samples_pixel
      ON raw_samples(image_id, version, y, x);
  `);
}
