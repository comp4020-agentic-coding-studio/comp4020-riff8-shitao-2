import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathLength } from "./cap.ts";

export interface Hand {
  id: string;
  name: string;
  colour: string;
  created_at: number;
}

export interface Mark {
  id: number;
  hand_id: string;
  path: string;
  colour: string;
  created_at: number;
}

const dbPath = process.env.DB_PATH ?? "./data/trace.db";
mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS hands (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    colour TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hand_id TEXT NOT NULL REFERENCES hands(id),
    path TEXT NOT NULL,
    colour TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

const insertHandStmt = db.prepare(
  "INSERT INTO hands (id, name, colour, created_at) VALUES (?, ?, ?, ?)",
);
const getHandStmt = db.prepare("SELECT * FROM hands WHERE id = ?");
const insertMarkStmt = db.prepare(
  "INSERT INTO marks (hand_id, path, colour, created_at) VALUES (?, ?, ?, ?)",
);
const allMarksStmt = db.prepare("SELECT * FROM marks ORDER BY created_at ASC");
const latestMarkStmt = db.prepare("SELECT MAX(created_at) as t FROM marks WHERE hand_id = ?");

export function getHand(id: string): Hand | undefined {
  return getHandStmt.get(id) as unknown as Hand | undefined;
}

export function createHand(id: string, name: string, colour: string): Hand {
  const created_at = Date.now();
  insertHandStmt.run(id, name, colour, created_at);
  return { id, name, colour, created_at };
}

export function allMarks(): Mark[] {
  return allMarksStmt.all() as unknown as Mark[];
}

// "A day" is the 24 hours since a hand's last mark, not a calendar day: any
// calendar boundary (UTC midnight is 11am in Canberra) lets a hand mark twice
// in an hour across it, or refuses one that comes back "tomorrow" in its own
// time zone.
export const MARK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function msUntilNextMark(handId: string, now = Date.now()): number {
  const row = latestMarkStmt.get(handId) as unknown as { t: number | null };
  return row.t === null ? 0 : Math.max(0, row.t + MARK_INTERVAL_MS - now);
}

// The total drawn length of every mark on the wall, summed from allMarks()
// once and then kept current by addMark, so a POST doesn't re-parse the whole
// wall. Safe because one process owns this database (fly.toml pins one
// machine) and every write goes through addMark.
let total: number | undefined;

export function totalLength(): number {
  total ??= allMarks().reduce((sum, m) => sum + pathLength(m.path), 0);
  return total;
}

export function addMark(handId: string, path: string, colour: string, created_at = Date.now()): Mark {
  const before = totalLength();
  const result = insertMarkStmt.run(handId, path, colour, created_at);
  total = before + pathLength(path);
  return { id: Number(result.lastInsertRowid), hand_id: handId, path, colour, created_at };
}
