import { expect, it, vi } from "vitest";
import { logEvent } from "../src/log.ts";

// `flyctl logs` is how the pod narrates who did what, so a log line has to
// name its hand and stay one line, whatever the event.
it("writes one line per event, led by its time and name, naming the hand", () => {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((line: string) => lines.push(line));
  logEvent("mark.accepted", "flippingplatypus1", { mark: 42, room_used: "11%" });
  logEvent("stream.opened", undefined, { watching: 2 });
  spy.mockRestore();

  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z mark\.accepted hand=flippingplatypus1 mark=42 room_used=11%$/);
  expect(lines[1]).toMatch(/ stream\.opened hand=- watching=2$/);
});
