import { expect, it } from "vitest";
import { continuityLine, marksPhrase, sincePhrase } from "../src/pages.ts";

// What the page tells a hand about its own continuity is computed from two
// stored facts, so it's checked here with the clock passed in rather than
// waiting weeks over HTTP.
const DAY = 24 * 3_600_000;

it("says how long ago a hand first came by in durations, never calendar days", () => {
  expect(sincePhrase(3_600_000)).toBe("less than a day ago");
  expect(sincePhrase(DAY + 1)).toBe("a day ago");
  expect(sincePhrase(5 * DAY)).toBe("5 days ago");
  expect(sincePhrase(21 * DAY)).toBe("3 weeks ago");
  expect(sincePhrase(100 * DAY)).toBe("3 months ago");
  expect(sincePhrase(400 * DAY)).toBe("over a year ago");
});

it("counts a hand's own marks in plain words", () => {
  expect(marksPhrase(0)).toBe("no marks yet");
  expect(marksPhrase(1)).toBe("1 mark");
  expect(marksPhrase(7)).toBe("7 marks");
});

it("greets a brand-new hand as new, and a returning one with its history", () => {
  const now = 1_000 * DAY;
  expect(continuityLine(now - 60_000, 0, now)).toMatch(/^You've just arrived and have added .*no marks yet/);
  expect(continuityLine(now - 9 * DAY, 3, now)).toMatch(/^You first came by 9 days ago and have added .*3 marks/);
  // A hand that marked within minutes of arriving isn't "just arriving" any more.
  expect(continuityLine(now - 60_000, 1, now)).toMatch(/^You first came by less than a day ago/);
});
