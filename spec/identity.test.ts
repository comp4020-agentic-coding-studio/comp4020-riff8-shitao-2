import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { nameFor, uniqueNameFor } from "../src/identity.ts";

// A hand's username is what the page calls it and what the logs call it, so
// it has to be the same on every visit and never shared by two hands. The
// legacy-name check runs src/db.ts's startup against a scratch database
// seeded the way the live volume was before names changed shape.
const HANDLE = /^[a-z]+[a-z]+[1-9]\d?$/;

it("gives the same id the same adjectiveanimalN username every time", () => {
  const id = "3f2b8c1e-0d4a-4b6f-9e7a-1c2d3e4f5a6b";
  expect(nameFor(id)).toMatch(HANDLE);
  expect(nameFor(id)).toBe(nameFor(id));
});

it("spreads ids across enough names that collisions are rare, and resolves the ones that happen", () => {
  const taken = new Set<string>();
  let firstChoiceCollisions = 0;
  for (let i = 0; i < 2000; i++) {
    const id = crypto.randomUUID();
    if (taken.has(nameFor(id))) firstChoiceCollisions++;
    const name = uniqueNameFor(id, (n) => taken.has(n));
    expect(name).toMatch(HANDLE);
    expect(taken.has(name)).toBe(false);
    taken.add(name);
  }
  expect(taken.size).toBe(2000);
  // ~100,000 names: about 20 first-choice collisions expected among 2,000.
  expect(firstChoiceCollisions).toBeLessThan(60);
});

it("re-rolls the same way for the same id, so a resolved name is reproducible", () => {
  const id = "c0ffee00-0000-4000-8000-000000000000";
  const blockFirst = (n: string) => n === nameFor(id);
  expect(uniqueNameFor(id, blockFirst)).toBe(nameFor(id, 1));
  expect(uniqueNameFor(id, blockFirst)).toBe(uniqueNameFor(id, blockFirst));
});

it("renames hands minted with the old hyphenated names, once, without collisions", async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "trace-names-")), "trace.db");
  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`CREATE TABLE hands (id TEXT PRIMARY KEY, name TEXT NOT NULL, colour TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  const insert = legacy.prepare("INSERT INTO hands VALUES (?, ?, '#000', 0)");
  insert.run("a", "quiet-sparrow");
  insert.run("b", "quiet-sparrow");
  legacy.close();

  process.env.DB_PATH = dbPath;
  const { getHand } = await import("../src/db.ts");
  const a = getHand("a")!.name;
  const b = getHand("b")!.name;
  expect(a).toBe(nameFor("a"));
  expect(a).toMatch(HANDLE);
  expect(b).toMatch(HANDLE);
  expect(a).not.toBe(b);
});
