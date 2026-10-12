import { marked } from "marked";
import { roomPhrase } from "./cap.ts";
import type { Hand, Mark } from "./db.ts";

const escape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const layout = (title: string, body: string): string => `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(title)}</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
${body}
  </body>
</html>
`;

// Hours, not a clock time: the server doesn't know a hand's time zone, and a
// duration reads the same in every one.
export function untilPhrase(ms: number): string {
  const hours = Math.ceil(ms / 3_600_000);
  return ms <= 3_600_000 ? "within the hour" : `in about ${hours} hours`;
}

const DAY = 24 * 3_600_000;

// How long ago a hand first came by, in durations rather than calendar days,
// for the same reason untilPhrase does: the server doesn't know whose "today".
export function sincePhrase(ms: number): string {
  if (ms < DAY) return "less than a day ago";
  if (ms < 2 * DAY) return "a day ago";
  if (ms < 14 * DAY) return `${Math.floor(ms / DAY)} days ago`;
  if (ms < 60 * DAY) return `${Math.floor(ms / (7 * DAY))} weeks ago`;
  if (ms < 365 * DAY) return `${Math.floor(ms / (30 * DAY))} months ago`;
  return "over a year ago";
}

export function marksPhrase(count: number): string {
  return count === 0 ? "no marks yet" : count === 1 ? "1 mark" : `${count} marks`;
}

// One true sentence about this hand's own continuity, from what the server
// already stores: when its cookie was minted and how many marks it has drawn.
// The count sits in its own element so wall.js can bump it when a mark lands.
export function continuityLine(createdAt: number, ownCount: number, now = Date.now()): string {
  const age = now - createdAt;
  const opening = ownCount === 0 && age < 10 * 60_000 ? "You've just arrived" : `You first came by ${sincePhrase(age)}`;
  return `${opening} and have added <span id="own-count" data-count="${ownCount}">${marksPhrase(ownCount)}</span>.`;
}

export function wallPage(
  marks: Mark[],
  hand: Hand,
  msUntilNextMark: number,
  cap: number,
): string {
  const alreadyMarked = msUntilNextMark > 0;
  // Ten colours across every hand means colour alone can't tell a returning
  // hand which strokes are theirs; `mine` is only ever rendered to the hand
  // that drew it, and never leaves the server as a hand id. A hand's own
  // strokes are painted last, each over a background-coloured halo, so a
  // busy wall's later marks can't bury them.
  // `data-seq` is each mark's place in the order marks landed (`marks` comes
  // from allMarks(), oldest first), which painting own marks last otherwise
  // loses; wall.js's replay reveals strokes in that order. It says when a
  // mark landed relative to the others, never whose it is.
  const seqOf = new Map(marks.map((m, i) => [m, i]));
  const own = marks.filter((m) => m.hand_id === hand.id);
  const strokes = [
    ...marks
      .filter((m) => m.hand_id !== hand.id)
      .map((m) => `<path d="${escape(m.path)}" stroke="${escape(m.colour)}" data-seq="${seqOf.get(m)}" />`),
    ...own.flatMap((m) => [
      `<path d="${escape(m.path)}" class="halo" data-seq="${seqOf.get(m)}" />`,
      `<path d="${escape(m.path)}" stroke="${escape(m.colour)}" class="mine" data-seq="${seqOf.get(m)}" />`,
    ]),
  ].join("\n      ");
  const ownCount = own.length;
  const handColour = hand.colour;
  // A username is still an identity: it's rendered only to the hand it
  // names, from that hand's own cookie, and never sent anywhere else.

  const prompt = alreadyMarked
    ? `<p id="status">Your mark is already on the wall. You can add another ${untilPhrase(msUntilNextMark)}.</p>`
    : `<p id="status">Draw one mark with a pointer, or focus the wall and press Enter: arrow keys draw, Enter again finishes.</p>`;

  const svgAttrs = alreadyMarked
    ? `role="img" aria-label="The shared drawing, one mark per hand"`
    : `tabindex="0" role="application" aria-label="The shared drawing, one mark per hand. Press Enter or Space to start your mark, arrow keys to draw it, Enter or Space to finish, Escape to cancel."`;

  return layout(
    "Trace",
    `    <main>
      <h1>Trace</h1>
      <p>One wall. One mark each, once a day. Nothing else.</p>
      <p id="room">The wall has room for <strong id="room-phrase" aria-live="polite">${roomPhrase(cap)}</strong> right now. Every mark leaves less for the next.</p>
      <svg id="wall" viewBox="0 0 1000 600" ${svgAttrs}>
      ${strokes}
      </svg>
      <div id="replay" hidden>
        <button type="button" id="replay-all">Replay the wall</button>
        <button type="button" id="replay-own"${ownCount > 0 ? "" : " hidden"}>Replay my marks</button>
        <span id="replay-scrub" hidden>
          <label for="replay-step">Marks shown</label>
          <input type="range" id="replay-step" min="0" max="0" value="0" />
          <output id="replay-count" for="replay-step" aria-live="polite"></output>
          <button type="button" id="replay-stop">Back to the live wall</button>
        </span>
      </div>
      ${prompt}
      <p id="you"><small>You're <strong id="username">${escape(hand.name)}</strong>, drawing in <strong style="color:${escape(handColour)}">this colour</strong>. ${continuityLine(hand.created_at, ownCount)}${ownCount > 0 ? ` ${ownCount === 1 ? "It's the thicker stroke" : "They're the thicker strokes"}.` : ""} <a href="/readme/">What this is, and why</a>.</small></p>
    </main>
    <script
      src="/wall.js"
      data-can-draw="${alreadyMarked ? "false" : "true"}"
      data-hand-colour="${escape(handColour)}"
      data-cap="${cap}"
    ></script>`,
  );
}

export function readmePage(readmeMarkdown: string): string {
  const html = marked.parse(readmeMarkdown, { async: false }) as string;
  return layout("About Trace", `    <main>\n${html}\n    </main>`);
}
