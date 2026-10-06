# Process

Trace started from the brief's question --- what would make this app good ---
before it started from a stack. The first commit,
[`2828f3e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/2828f3e),
landed the README's argument (a mark is a gesture, not a post; the wall grows
by care, not engagement) and `CLAUDE.md`'s rules in the same change as the
code, so every later session read the argument before it read the source.
Those rules are the harness: no text field, no accounts, one mark a day
enforced in `src/db.ts` rather than the client, no third-party requests,
broadcast only after persistence.

## Decision record: the stack

**Context.** One `shared-cpu-1x` Fly machine with 256 MB, one volume at
`/data`, no separate database server. The core interaction is tiny: mint a
cookie, store one SVG path per hand per day, render every path, push new ones
to open tabs.

**Decision.** A framework-free `node:http` server in TypeScript, run directly
by Node 24's type-stripping (no build step), with `node:sqlite` for
persistence at `DB_PATH` and server-sent events for the live layer. The only
runtime dependency is `marked`, for rendering `README.md` at `/readme/`.

**Alternatives I rejected.** Astro SSR with `better-sqlite3`, which I'd used for
the previous crit, would be most of the code for two pages and three routes,
and its native addon has to compile in the slim image; `node:sqlite` ships
with the runtime. WebSockets lost to SSE because the
wall only ever pushes one thing one way --- a finished mark, server to browser
--- so a long-lived HTTP response is the smaller mechanism
([`f080752`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/f080752)).
An in-memory set of open connections is enough because `fly.toml` pins one
machine; that stops being true the day there are two, and that's when this
record needs a successor.

**Consequences.** Nothing hides concurrency from me. The first real bug was a
race: `hasMarkedToday` ran before `await readBody`, so a client holding its
body open could mark twice. Ordinary concurrent requests never reproduced it;
it only showed up once a test sent one request's headers, let a second
request finish, then released the first body
([`7a89c68`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/7a89c68)).
That held-open-body shape is now the regression test, because a
fire-two-and-hope test passes against the broken code.

## The client needed its own harness

Early tests only drove the server over HTTP. After a browser session found a hand could
start a second stroke once its daily mark had landed
([`2e59190`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/2e59190)),
I added `spec/wall-client.test.ts`, which loads the real `wall.js` into jsdom
and dispatches real pointer events at it, stubbing only what jsdom lacks
(layout boxes, pointer capture, `EventSource`)
([`ec78095`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/ec78095)).
Each fix since must fail its new test against the pre-fix file and pass
against the fixed one. That caught the self-echo
filter matching marks by content rather than a nonce
([`672e486`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/672e486)),
a second gesture starting while the first was still posting
([`176b787`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/176b787)),
and a keyboard-only hand having no way to draw at all
([`5138836`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/5138836)).

Rereading the spec itself, one line at a time, turned up gaps no test had
a reason to look for. "Find their trace still there when they come back" was
checked as "the mark persists," but ten colours shared across every hand
meant a returning stranger couldn't tell which stroke was theirs. A hand's
own marks now render thicker, for that hand only
([`6e07998`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/6e07998)).
That held on a test wall but not a busy one: seeding a scratch database with
300 marks showed later strokes burying a hand's own, so its marks now paint
last, over a halo
([`a9d92f3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/a9d92f3)),
and a first-time hand is told which stroke is theirs the moment it lands
([`51bbd82`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/51bbd82)).
Reading the README the same way caught "one mark a day" meaning a UTC day,
which reopens at 11am in Canberra; it is now 24 hours since a hand's last
mark
([`79989b6`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/79989b6)).

Another change came from a comment, not a test: `identity.ts`
said its hand colours were "not tuned for contrast," and nothing tuned them.
Five of ten failed WCAG's 3:1 non-text minimum against white or black; they
were retuned and `spec/contrast.test.ts` now reads the palette from source
([`de8164a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-shitao/commit/de8164a)).

## Decision record: the wall decides how long the next mark can be

**Context.** Crit 9 asks for one decision about how Trace behaves with several
hands on it at once. Real-time was already there: two browser sessions, one
drawing and one watching, showed the mark land in the watcher within a
second, with no reload, before anything changed. What the wall didn't have
was any sense of itself filling up. One mark a day limits how *often* a hand
draws, not how *much*: the first stranger could scribble three thousand
units of line and leave the same wall to everyone after them. The pod that
wrote this crit's prompt chose the answer: the room a new mark gets should
shrink as the wall fills, wall-wide and live.

**Decision.** The longest mark a hand may draw is
`cap = 50 + 2950 / (1 + total / 20000)` view-box units, where `total` is the
summed length of every segment of every mark already on the wall
([`2151caf`](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-shitao-2/commit/2151caf)).
An empty wall allows 3000, three times the wall's width. The room above the
floor is half gone at 20,000 units of drawing (about twenty strokes right
across), and the cap is still shrinking at a million units, where it's 108.
It never reaches 50, about 5% of the width: always enough for a stroke, never
so little a mark becomes a dot. I chose a hyperbola over an exponential
because the exponential halves its room every fixed amount of drawing, so
after a few hundred marks it sits on the floor and the wall stops responding
to anything drawn on it. The hyperbola spends room fast while the wall is
young, when each mark changes its character most, and keeps visibly
tightening for as long as anyone draws. The server is the only place this runs.
`POST /api/marks` measures the posted path itself and refuses one over the
cap with a 422 and a plain-language reason, after `PATH_RE` and the
one-mark-a-day check and with no `await` before the insert, so two posts
can't both measure against a total the other is about to change. The cap is
embedded in the wall page, said in words above the wall before anyone draws,
and sent with every SSE mark event, so every open tab's "room left" shrinks
the moment any hand's mark lands
([`7de1ea4`](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-shitao-2/commit/7de1ea4),
[`b8a128b`](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-shitao-2/commit/b8a128b)).
`public/wall.js` only obeys the number it was told: a gesture stops taking
points where it runs out of room, and the truncated stroke is what's posted,
for pointer and keyboard alike
([`bfc41c7`](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-shitao-2/commit/bfc41c7)).

**Alternatives considered.** *Mark count instead of length:* cheaper, but
twenty short ticks and two long scrawls read very differently as how full a
wall is, and only length is honest about that. *Reject a finished stroke on
submit instead of truncating mid-gesture:* the server would be the only
enforcement and the client would need no length logic at all, and a hand
would always get exactly the stroke they drew or nothing, never one cut short
against their intent. But the cost lands on the person least able to bear it:
a stranger with no account and one mark a day finishes a gesture, is told it
didn't count, and has to draw again shorter while guessing how much
shorter. Truncating makes the limit something felt in the hand, like running
out of ink, rather than a verdict after the fact; it's the same reasoning
that already hides drawing in advance once a hand has marked today, instead
of letting it draw and refusing the post. *Per-hand state* (a cap that
shrinks with how much *you've* drawn) would have needed the cap to know who
is drawing, which this wall deliberately never weighs; it would also do
nothing about the wall filling up, since every new hand would start
generous. *Spatial caps* (less room where the wall is already dense) would
make the wall's shape matter, not just its total, but each hand's limit
would depend on where they started, the client would need a density map, and
"how much room do I have" would stop having one answer anyone could print
above the wall.

**Consequences.** The live figure is the real-time feature the pod will test:
two tabs side by side, one drawing, the other's room line shrinking with no
reload. A gesture keeps the cap it started under even if a mark lands
mid-stroke, as the prompt asked, so a hand drawing right to the old limit
while another hand's mark arrives is refused by the server's backstop and
loses the whole stroke. I reproduced exactly that in two browser sessions;
it's rare (two hands, the same few seconds, one of them drawing to the
limit) but it is the reject-on-submit cost this design was chosen to avoid,
and the obvious next change is to have the client re-truncate to the new cap
and say so, rather than drop the stroke. The running total lives in memory
in `src/db.ts`, rebuilt from every mark on boot, which is only correct while
`fly.toml` pins one machine --- the same assumption the SSE fan-out already
makes. `spec/cap.test.ts` checks the formula's two promises (it only
shrinks, and it never makes a mark impossible); `spec/wall.test.ts` that an
over-cap post is refused and the SSE event carries the smaller cap;
`spec/wall-client.test.ts` drives the real `wall.js` to the cap with both
input paths. The new client tests fail against the pre-change `wall.js`.
