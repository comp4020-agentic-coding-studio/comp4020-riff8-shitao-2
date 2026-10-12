import { randomUUID } from "node:crypto";

// A hand's name and colour are derived once, at creation, and stored --- not
// recomputed from the id --- so they stay stable even if these lists change.
// A name reads like an anonymous multiplayer handle: adjective, animal and a
// number run together (`flippingplatypus1`). Every animal starts with a
// consonant and none is "y"-initial, so no pair blurs into a different word
// at the join.
const ADJECTIVES = [
  "flipping", "heavy", "sleepy", "brave", "fuzzy", "jolly", "lucky", "mighty",
  "nimble", "plucky", "quiet", "rusty", "sneaky", "sunny", "tiny", "witty",
  "bouncy", "clever", "dizzy", "eager", "gentle", "happy", "humble", "lanky",
  "merry", "misty", "proud", "shy", "snowy", "spotty", "swift", "wobbly",
];
const ANIMALS = [
  "platypus", "rhino", "badger", "wombat", "koala", "heron", "magpie", "penguin",
  "walrus", "gecko", "lemur", "panda", "marmot", "puffin", "falcon", "beaver",
  "ferret", "toucan", "possum", "numbat", "quokka", "dingo", "kestrel", "narwhal",
  "pelican", "bison", "camel", "donkey", "goose", "moose", "tapir", "lobster",
];
// Distinct hues, each lightness-adjusted (hue/saturation kept) so every
// colour clears WCAG 1.4.11's 3:1 non-text contrast against *both* a white
// and a black background --- `color-scheme: light dark` means a mark's
// stroke has to read against either, depending on the visitor's own system
// preference, not just the one a screenshot happens to be taken against.
// `spec/contrast.test.ts` checks this against the literal values below.
const COLOURS = [
  "#cc4a28",
  "#5177aa",
  "#4e8067",
  "#a06a13",
  "#9d4edd",
  "#457b9d",
  "#e63946",
  "#2a9d8f",
  "#bb5a0d",
  "#6d597a",
];

function pick<T>(list: T[], seed: number): T {
  return list[seed % list.length];
}

export function newHandId(): string {
  return randomUUID();
}

// FNV-1a: unlike the colour hash below, every bit of the result depends on
// every character, so the adjective, animal and number can each take their
// own slice of it.
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const ch of text) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return hash;
}

// `attempt` re-rolls the name for the same id; uniqueNameFor uses it when
// the first choice is already someone else's.
export function nameFor(id: string, attempt = 0): string {
  const hash = fnv1a(attempt === 0 ? id : `${id}#${attempt}`);
  return `${pick(ADJECTIVES, hash)}${pick(ANIMALS, hash >>> 5)}${((hash >>> 10) % 99) + 1}`;
}

// About 100,000 names is plenty for a wall, but not enough to rule out two
// hands drawing the same one, and two hands sharing a name would make the
// logs lie about who did what. The first free name in this id's own sequence
// is taken once, at creation, and stored, so it's as stable as nameFor.
export function uniqueNameFor(id: string, taken: (name: string) => boolean): string {
  for (let attempt = 0; ; attempt++) {
    const name = nameFor(id, attempt);
    if (!taken(name)) return name;
  }
}

export function colourFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 17 + ch.charCodeAt(0)) >>> 0;
  return pick(COLOURS, hash >>> 4);
}

const COOKIE_NAME = "hand";
const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function parseHandCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === COOKIE_NAME) return rest.join("=");
  }
  return undefined;
}

export function setHandCookie(id: string, secure: boolean): string {
  const attrs = [
    `${COOKIE_NAME}=${id}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${YEAR_SECONDS}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}
