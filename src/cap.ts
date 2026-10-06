// How long a new mark may be, as a function of how much is already drawn.
// The server is the only place this runs: pages.ts embeds the result in the
// wall page, server.ts checks posts against it and broadcasts it with every
// mark, and public/wall.js only ever displays and obeys the number it's told.

// The wall's viewBox is 1000 wide. An empty wall allows a stroke three
// widths long; however full it gets, the cap only ever approaches FLOOR,
// about 5% of the width --- short enough to feel the squeeze, long enough to
// read as a stroke rather than a misclick.
export const START = 3000;
export const FLOOR = 50;
// The total drawn length at which half the room above FLOOR is gone: about
// twenty strokes right across the wall.
export const HALF = 20_000;

// Sum of every segment's Euclidean length. `M` starts a path and has no
// length of its own; each `L` is a line from the previous point. Assumes a
// path that already passed server.ts's PATH_RE.
export function pathLength(path: string): number {
  let length = 0;
  let prev: [number, number] | undefined;
  for (const token of path.split(" ")) {
    const [x, y] = token.slice(1).split(",").map(Number);
    if (prev) length += Math.hypot(x - prev[0], y - prev[1]);
    prev = [x, y];
  }
  return length;
}

// Hyperbolic, not exponential: the room above FLOOR halves at HALF, halves
// again by 3 × HALF, again by 7 × HALF, so the first strokes on an empty
// wall shape it far more than the thousandth on a crowded one, yet the cap
// keeps visibly shrinking for as long as anyone draws instead of flattening
// onto FLOOR after a few hundred marks the way an exponential would.
export function capFor(totalLength: number): number {
  return FLOOR + (START - FLOOR) / (1 + totalLength / HALF);
}

// Plain language for the room a hand has right now, relative to the wall's
// own width rather than in units nobody can see.
export function roomPhrase(cap: number): string {
  const widths = cap / 1000;
  if (widths >= 1.5) return `a stroke about ${Math.round(widths * 2) / 2} times the wall's width`;
  if (widths >= 0.9) return "a stroke about the wall's width";
  return `a stroke about ${Math.max(5, Math.round(widths * 20) * 5)}% of the wall's width`;
}
