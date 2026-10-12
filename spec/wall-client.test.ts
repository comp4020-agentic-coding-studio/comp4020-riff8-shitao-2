import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";

// Every other test in spec/ drives the server over HTTP; none of them execute
// public/wall.js itself, so a client-only bug (like the stuck pointerdown
// listener fixed in 2e59190, where a hand could keep drawing after its mark
// had already landed) has no automated check at all --- only a manual
// agent-browser sequence caught it. This loads the real file into jsdom and
// drives it with synthetic pointer events instead, with fetch/EventSource
// stubbed since there's no server here.
const wallSource = readFileSync("public/wall.js", "utf8");

function buildWall({
  canDraw,
  deferFetch = false,
  cap = 3000,
  strokes = "",
  reducedMotion = false,
}: {
  canDraw: boolean;
  deferFetch?: boolean;
  cap?: number;
  strokes?: string;
  reducedMotion?: boolean;
}) {
  const dom = new JSDOM(
    `<!doctype html><body>
      <svg id="wall" viewBox="0 0 100 100">${strokes}</svg>
      <div id="replay" hidden>
        <button type="button" id="replay-all">Replay the wall</button>
        <button type="button" id="replay-own" hidden>Replay my marks</button>
        <span id="replay-scrub" hidden>
          <input type="range" id="replay-step" min="0" max="0" value="0" />
          <output id="replay-count"></output>
          <button type="button" id="replay-stop">Back to the live wall</button>
        </span>
      </div>
      <p id="room">The wall has room for <strong id="room-phrase">a stroke</strong> right now.</p>
      <p id="status"></p>
      <p id="you">You've just arrived and have added <span id="own-count" data-count="0">no marks yet</span>.</p>
    </body>`,
    { runScripts: "dangerously", url: "http://localhost/" },
  );
  const { window } = dom;
  const svg = window.document.getElementById("wall") as unknown as SVGSVGElement;
  const status = window.document.getElementById("status")!;
  const roomPhrase = window.document.getElementById("room-phrase")!;

  // jsdom has no layout engine (getBoundingClientRect is always zero) and no
  // pointer-capture implementation; stub both so wall.js's own coordinate
  // math and capture call don't blow up on a geometry jsdom never computes.
  (svg as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
  (svg as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};

  // jsdom has no matchMedia; replay asks it about prefers-reduced-motion.
  (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: reducedMotion });
  // Route wall.js's timers through Node's, so vi.useFakeTimers() reaches them.
  (window as unknown as { setTimeout: unknown }).setTimeout = (fn: () => void, ms: number) => setTimeout(fn, ms);
  (window as unknown as { clearTimeout: unknown }).clearTimeout = (id: ReturnType<typeof setTimeout>) =>
    clearTimeout(id);

  const posted: { path: string; nonce: string }[] = [];
  // deferFetch lets a test fire the SSE echo for a post while its own fetch
  // promise is still pending --- the exact ordering server.ts's comment
  // warns is possible (broadcast is written to the wire before the POST
  // response is), and the shape that broke the old path-content echo check.
  let resolveFetch: (() => void) | undefined;
  (window as unknown as { fetch: typeof fetch }).fetch = (async (_url, init) => {
    posted.push(JSON.parse((init as RequestInit).body as string));
    if (deferFetch) {
      await new Promise<void>((resolve) => {
        resolveFetch = resolve;
      });
    }
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  // wall.js opens one unconditionally on load; there's no server to answer it,
  // so tests dispatch "mark" events through this stub directly.
  let markListener: ((evt: { data: string }) => void) | undefined;
  (window as unknown as { EventSource: unknown }).EventSource = class {
    addEventListener(_type: string, listener: (evt: { data: string }) => void) {
      markListener = listener;
    }
  };

  const script = window.document.createElement("script");
  script.dataset.handColour = "#123456";
  script.dataset.canDraw = String(canDraw);
  script.dataset.cap = String(cap);
  script.textContent = wallSource;
  window.document.body.appendChild(script);

  const gesture = (x: number, y: number, type: string) =>
    svg.dispatchEvent(
      new window.PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }),
    );
  const stroke = (from: number, to: number) => {
    gesture(from, from, "pointerdown");
    gesture(to, to, "pointermove");
    gesture(to + 1, to + 1, "pointerup");
  };
  const key = (k: string) => svg.dispatchEvent(new window.KeyboardEvent("keydown", { key: k }));
  // Enter, one arrow step, Enter: the keyboard-only path through the exact
  // same beginGesture/addPoint/finish a pointer gesture drives.
  const keyboardStroke = () => {
    key("Enter");
    key("ArrowRight");
    key("Enter");
  };
  // Flush the microtask queue fetch's promise chain runs on.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const emitMark = (mark: {
    path: string;
    colour: string;
    nonce?: string;
    cap?: number;
    room?: string;
  }) =>
    markListener?.({ data: JSON.stringify(mark) });
  const releaseFetch = () => resolveFetch?.();

  return {
    document: window.document,
    svg,
    status,
    roomPhrase,
    posted,
    gesture,
    stroke,
    key,
    keyboardStroke,
    settle,
    emitMark,
    releaseFetch,
  };
}

it("posts one mark for one pointer gesture when a hand can draw", async () => {
  const { svg, posted, stroke, settle } = buildWall({ canDraw: true });
  stroke(1, 9);
  await settle();
  expect(posted.length).toBe(1);
  expect(svg.querySelectorAll("path:not(.halo)").length).toBe(1);
});

it("tells a hand which stroke is theirs the moment its first mark lands", async () => {
  // The page footer only names "the thicker stroke" once a reload finds this
  // hand's marks on the server; without this, a first-time hand's only cue
  // is a line that vanishes into a busy wall.
  const { status, stroke, settle } = buildWall({ canDraw: true });
  stroke(1, 9);
  await settle();
  expect(status.textContent).toContain("the thicker stroke");
});

it("counts the new mark in the hand's own line as soon as it lands", async () => {
  const { document, stroke, settle } = buildWall({ canDraw: true });
  stroke(1, 9);
  await settle();
  expect(document.getElementById("own-count")?.textContent).toBe("1 mark");
});

it("never attaches drawing listeners at all when canDraw starts false", async () => {
  const { svg, posted, stroke, keyboardStroke, settle } = buildWall({ canDraw: false });
  stroke(1, 9);
  keyboardStroke();
  await settle();
  expect(posted.length).toBe(0);
  expect(svg.querySelectorAll("path:not(.halo)").length).toBe(0);
});

it("posts one mark for a keyboard-only gesture: Enter, an arrow step, Enter", async () => {
  // A pointer is otherwise the only way to draw at all --- a keyboard-only
  // visitor couldn't use the app's one interaction without this path, which
  // mirrors pointerdown/pointermove/pointerup through the same
  // beginGesture/addPoint/finish functions.
  const { svg, posted, keyboardStroke, settle } = buildWall({ canDraw: true });
  keyboardStroke();
  await settle();
  expect(posted.length).toBe(1);
  expect(svg.querySelectorAll("path:not(.halo)").length).toBe(1);
});

it("Escape cancels a keyboard gesture in progress without posting anything", async () => {
  const { svg, posted, key, settle } = buildWall({ canDraw: true });
  key("Enter");
  key("ArrowUp");
  key("Escape");
  await settle();
  expect(posted.length).toBe(0);
  expect(svg.querySelectorAll("path").length).toBe(0); // halo included
});

it("refuses a second gesture in the same tab once the first mark has landed", async () => {
  // Regression check for 2e59190: before that fix, the pointerdown listener
  // never rechecked canDraw after attaching, so a second gesture in the same
  // tab still appended a path and posted, only to be rejected (and removed)
  // at submit time by the server --- a contradiction the UI had no way to
  // avoid showing a visitor who kept gesturing after their mark landed.
  const { svg, posted, stroke, settle } = buildWall({ canDraw: true });
  stroke(1, 9);
  await settle();
  expect(posted.length).toBe(1);

  stroke(20, 40);
  await settle();
  expect(posted.length).toBe(1);
  expect(svg.querySelectorAll("path:not(.halo)").length).toBe(1);
});

it("draws another hand's mark even when its path is byte-identical to this tab's own", async () => {
  // Regression check: the echo filter used to compare by path string, not by
  // a per-mark token, so two different hands drawing the same short stroke
  // (a real possibility --- paths are rounded integer coordinates) would
  // have one hand's live view silently drop the other's genuine mark.
  const { svg, posted, stroke, settle, emitMark } = buildWall({ canDraw: true });
  stroke(1, 9);
  await settle();
  expect(posted.length).toBe(1);
  expect(svg.querySelectorAll("path:not(.halo)").length).toBe(1); // this tab's own `live` stroke

  emitMark({ path: posted[0].path, colour: "#abcdef", nonce: "someone-elses-nonce" });
  expect(svg.querySelectorAll("path:not(.halo)").length).toBe(2);
  // Another hand's mark goes under this tab's own stroke and its halo, not on top.
  expect(svg.firstElementChild?.getAttribute("stroke")).toBe("#abcdef");
  expect(svg.lastElementChild?.classList.contains("mine")).toBe(true);
});

it("refuses a second gesture while the first one's post is still in flight", async () => {
  // Regression check: pointerdown only ever checked canDraw, which stays
  // true until the first post *succeeds* --- so a hand could start a second
  // gesture while the first was still in flight. Both posted; the server's
  // one-mark-a-day check correctly rejected the loser, but the single
  // pendingNonce belonged to whichever gesture started last, so the
  // winner's own nonce was orphaned and its own echo drew a visible
  // duplicate of a stroke already on the wall.
  const { svg, posted, stroke, settle, emitMark, releaseFetch } = buildWall({
    canDraw: true,
    deferFetch: true,
  });
  stroke(1, 9); // gesture 1, fetch pending
  await settle();
  expect(posted.length).toBe(1);

  stroke(20, 40); // gesture 2, started before gesture 1's fetch resolved
  await settle();
  expect(posted.length).toBe(1); // refused outright, never posted
  expect(svg.querySelectorAll("path:not(.halo)").length).toBe(1); // just gesture 1's own `live` stroke

  emitMark({ path: posted[0].path, colour: "#123456", nonce: posted[0].nonce });
  expect(svg.querySelectorAll("path:not(.halo)").length).toBe(1); // still recognised as its own echo

  releaseFetch();
  await settle();
  expect(svg.querySelectorAll("path:not(.halo)").length).toBe(1);
});

it("doesn't duplicate its own mark when the SSE echo arrives before the post resolves", async () => {
  // Regression check: server.ts broadcasts before it replies to the POST, so
  // a tab's own echo can genuinely arrive before its fetch promise settles.
  // The nonce is recorded synchronously before the fetch is even issued, so
  // this ordering must not produce a second path for the same gesture.
  const { svg, posted, stroke, settle, emitMark, releaseFetch } = buildWall({
    canDraw: true,
    deferFetch: true,
  });
  stroke(1, 9);
  await settle();
  expect(posted.length).toBe(1);
  expect(svg.querySelectorAll("path:not(.halo)").length).toBe(1); // the `live` stroke, fetch still pending

  emitMark({ path: posted[0].path, colour: "#123456", nonce: posted[0].nonce });
  expect(svg.querySelectorAll("path:not(.halo)").length).toBe(1); // recognised as its own echo, not drawn again

  releaseFetch();
  await settle();
  expect(svg.querySelectorAll("path:not(.halo)").length).toBe(1);
});

// The same measure server.ts applies: the sum of each segment's length.
const lengthOf = (path: string): number => {
  const pts = path.split(" ").map((t) => t.slice(1).split(",").map(Number));
  return pts.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - pts[i][0], y - pts[i][1]), 0);
};

it("stops a pointer gesture where it runs out of room, and posts the truncated stroke", async () => {
  // Running out of room should feel like the wall filling up mid-stroke,
  // not like finishing a stroke and then being told it didn't count.
  const { svg, status, posted, gesture, settle } = buildWall({ canDraw: true, cap: 50 });
  gesture(0, 10, "pointerdown");
  gesture(30, 10, "pointermove");
  gesture(60, 10, "pointermove");
  expect(status.textContent).toMatch(/all the room/);
  gesture(90, 40, "pointermove"); // ignored: there's no room left
  gesture(90, 40, "pointerup");
  await settle();

  expect(posted.length).toBe(1);
  expect(posted[0].path).toBe("M0,10 L30,10 L49,10");
  expect(lengthOf(posted[0].path)).toBeLessThanOrEqual(50);
  expect(svg.querySelector("path.mine")?.getAttribute("d")).toBe(posted[0].path);
});

it("stops a keyboard gesture at the cap too, through the same addPoint", async () => {
  const { posted, key, settle } = buildWall({ canDraw: true, cap: 70 });
  key("Enter"); // starts at the centre, 50,50
  for (let i = 0; i < 5; i++) key("ArrowRight"); // 150 units asked for
  key("Enter");
  await settle();
  expect(posted.length).toBe(1);
  expect(posted[0].path).toBe("M50,50 L80,50 L110,50 L119,50");
  expect(lengthOf(posted[0].path)).toBeLessThanOrEqual(70);
});

it("refuses a stroke landing exactly on the cap, and leaves one inside it untouched", async () => {
  const { status, posted, gesture, settle } = buildWall({ canDraw: true, cap: 50 });
  gesture(0, 0, "pointerdown");
  gesture(30, 40, "pointermove"); // exactly 50 long: still refused, by a hundredth of a unit
  gesture(20, 0, "pointermove");
  expect(status.textContent).toMatch(/all the room/);
  gesture(20, 0, "pointerup");
  await settle();
  expect(lengthOf(posted[0].path)).toBeLessThanOrEqual(50);

  const roomy = buildWall({ canDraw: true, cap: 500 });
  roomy.gesture(0, 0, "pointerdown");
  roomy.gesture(30, 40, "pointermove");
  roomy.gesture(60, 0, "pointermove");
  roomy.gesture(60, 0, "pointerup");
  await roomy.settle();
  expect(roomy.posted[0].path).toBe("M0,0 L30,40 L60,0");
  expect(roomy.status.textContent).not.toMatch(/all the room/);
});

it("shows the new room the moment any hand's mark arrives, and uses it for the next gesture", async () => {
  const { roomPhrase, posted, gesture, emitMark, settle } = buildWall({ canDraw: true, cap: 3000 });
  emitMark({
    path: "M1,1 L2,2",
    colour: "#abcdef",
    nonce: "another-hand",
    cap: 40,
    room: "a stroke about 5% of the wall's width",
  });
  expect(roomPhrase.textContent).toBe("a stroke about 5% of the wall's width");

  gesture(0, 0, "pointerdown");
  gesture(0, 90, "pointermove");
  gesture(0, 90, "pointerup");
  await settle();
  expect(posted[0].path).toBe("M0,0 L0,39");
});

it("keeps a gesture already in progress to the cap it started under", async () => {
  // The hand was shown one figure when it started; a mark landing mid-stroke
  // doesn't yank the room out from under it. The server is the backstop.
  const { posted, gesture, emitMark, settle } = buildWall({ canDraw: true, cap: 80 });
  gesture(0, 0, "pointerdown");
  emitMark({ path: "M1,1 L2,2", colour: "#abcdef", nonce: "another-hand", cap: 20, room: "less" });
  gesture(0, 60, "pointermove");
  gesture(0, 60, "pointerup");
  await settle();
  expect(posted[0].path).toBe("M0,0 L0,60");
});

// Three marks as the server renders them for a hand whose own mark landed
// second: everyone else's in landing order, then its own (halo and stroke)
// painted last. Replay has to reveal them in landing order, not paint order.
const WALL = [
  `<path d="M1,1 L10,10" stroke="#aa0000" data-seq="0" />`,
  `<path d="M3,3 L30,30" stroke="#0000aa" data-seq="2" />`,
  `<path d="M2,2 L20,20" class="halo" data-seq="1" />`,
  `<path d="M2,2 L20,20" stroke="#123456" class="mine" data-seq="1" />`,
].join("");

const visibleSeqs = (svg: SVGSVGElement) =>
  [...svg.querySelectorAll("path:not(.halo)")]
    .filter((p) => p.getAttribute("data-replay") !== "hidden")
    .map((p) => Number(p.getAttribute("data-seq")))
    .sort();

const scrubTo = (document: Document, n: number) => {
  const step = document.getElementById("replay-step") as HTMLInputElement;
  step.value = String(n);
  step.dispatchEvent(new document.defaultView!.Event("input"));
};

afterEach(() => {
  vi.useRealTimers();
});

it("steps through the wall in the order marks landed, and leaves it exactly as rendered", () => {
  const { document, svg } = buildWall({ canDraw: false, strokes: WALL, reducedMotion: true });
  const before = svg.outerHTML;
  expect(document.getElementById("replay")!.hidden).toBe(false);

  (document.getElementById("replay-all") as HTMLButtonElement).click();
  expect(visibleSeqs(svg)).toEqual([]);
  expect((document.getElementById("replay-step") as HTMLInputElement).max).toBe("3");
  scrubTo(document, 1);
  expect(visibleSeqs(svg)).toEqual([0]);
  scrubTo(document, 2);
  expect(visibleSeqs(svg)).toEqual([0, 1]); // the hand's own, painted last, landed second
  expect(document.getElementById("replay-count")!.textContent).toBe("2 of 3");
  // Reduced motion flips straight to each state: nothing is mid-draw.
  expect(svg.querySelector("[data-replay=drawing]")).toBeNull();
  scrubTo(document, 3);
  expect(visibleSeqs(svg)).toEqual([0, 1, 2]);

  (document.getElementById("replay-stop") as HTMLButtonElement).click();
  expect(svg.outerHTML).toBe(before);
});

it("plays itself through, drawing each mark in, then hands back the same wall", () => {
  vi.useFakeTimers();
  const { document, svg } = buildWall({ canDraw: false, strokes: WALL });
  const before = svg.outerHTML;

  (document.getElementById("replay-all") as HTMLButtonElement).click();
  expect(visibleSeqs(svg)).toEqual([]);
  vi.advanceTimersByTime(600);
  expect(svg.querySelector("[data-replay=drawing]")?.getAttribute("data-seq")).toBe("0");
  vi.advanceTimersByTime(1200);
  expect(visibleSeqs(svg)).toEqual([0, 1, 2]);
  vi.advanceTimersByTime(2000);
  expect(svg.outerHTML).toBe(before);
  expect(document.getElementById("replay-all")!.hidden).toBe(false);
});

it("replays only the hand's own marks, keeping everyone else's hidden until it ends", () => {
  const { document, svg } = buildWall({ canDraw: false, strokes: WALL, reducedMotion: true });
  const before = svg.outerHTML;
  const own = document.getElementById("replay-own") as HTMLButtonElement;
  expect(own.hidden).toBe(false);

  own.click();
  expect((document.getElementById("replay-step") as HTMLInputElement).max).toBe("1");
  scrubTo(document, 1);
  expect(visibleSeqs(svg)).toEqual([1]);
  expect(svg.querySelector(".halo")!.getAttribute("data-replay")).toBeNull();

  (document.getElementById("replay-stop") as HTMLButtonElement).click();
  expect(svg.outerHTML).toBe(before);
});

it("offers no own-marks replay to a hand with no marks", () => {
  const { document } = buildWall({ canDraw: true, strokes: WALL.split("<path").slice(0, 3).join("<path") });
  expect(document.getElementById("replay-own")!.hidden).toBe(true);
});

it("lets a live mark land mid-replay, and includes it in the next one", () => {
  const { document, svg, emitMark } = buildWall({ canDraw: false, strokes: WALL, reducedMotion: true });
  (document.getElementById("replay-all") as HTMLButtonElement).click();
  emitMark({ path: "M5,5 L50,50", colour: "#00aa00", nonce: "another-hand" });
  const arrived = svg.querySelector('path[stroke="#00aa00"]')!;
  expect(arrived.getAttribute("data-replay")).toBeNull();
  expect(arrived.getAttribute("data-seq")).toBe("3");

  (document.getElementById("replay-stop") as HTMLButtonElement).click();
  expect(arrived.getAttribute("data-replay")).toBeNull();
  (document.getElementById("replay-all") as HTMLButtonElement).click();
  expect((document.getElementById("replay-step") as HTMLInputElement).max).toBe("4");
});

it("ends a replay when the hand starts drawing, and the mark posts as normal", async () => {
  const { document, svg, posted, stroke, settle } = buildWall({ canDraw: true, strokes: WALL, reducedMotion: true });
  (document.getElementById("replay-all") as HTMLButtonElement).click();
  stroke(40, 60);
  await settle();
  expect(svg.querySelector("[data-replay]")).toBeNull();
  expect(posted.length).toBe(1);
  // The new mark takes the next place in landing order, as this hand's own.
  expect(svg.querySelector("path.mine:last-child")?.getAttribute("data-seq")).toBe("3");
});
