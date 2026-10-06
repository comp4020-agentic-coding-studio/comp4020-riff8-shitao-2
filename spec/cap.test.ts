import { expect, it } from "vitest";
import { FLOOR, START, capFor, pathLength, roomPhrase } from "../src/cap.ts";

// The length cap's two promises from PROCESS.md's decision record: it only
// ever shrinks as the wall fills, and it never shrinks to a length that makes
// a mark impossible.

it("measures a path as the sum of its segments, with M contributing nothing", () => {
  expect(pathLength("M0,0 L3,4")).toBe(5);
  expect(pathLength("M10,10 L10,20 L20,20")).toBe(20);
  expect(pathLength("M5,5 L5,5")).toBe(0);
});

it("gives an empty wall a generous first mark", () => {
  expect(capFor(0)).toBe(START);
  expect(capFor(0)).toBeGreaterThan(1000); // more than a stroke right across the wall
});

it("shrinks strictly as the wall's total drawn length grows", () => {
  const totals = [0, 1, 50, 1_000, 20_000, 100_000, 1e6, 1e7, 1e9, 1e12];
  const caps = totals.map(capFor);
  for (let i = 1; i < caps.length; i++) expect(caps[i]).toBeLessThan(caps[i - 1]);
});

it("never shrinks to a length a hand couldn't draw a stroke in", () => {
  for (const total of [1e6, 1e9, 1e15, 1e300, Number.MAX_VALUE]) {
    expect(capFor(total)).toBeGreaterThanOrEqual(FLOOR);
  }
  expect(FLOOR).toBeGreaterThanOrEqual(50); // ~5% of the 1000-wide wall
});

it("describes the room in terms of the wall's width", () => {
  expect(roomPhrase(3000)).toBe("a stroke about 3 times the wall's width");
  expect(roomPhrase(1000)).toBe("a stroke about the wall's width");
  expect(roomPhrase(300)).toBe("a stroke about 30% of the wall's width");
  expect(roomPhrase(FLOOR)).toBe("a stroke about 5% of the wall's width");
});
