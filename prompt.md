# Prompt for crit 10: Fly by Instruments

## Context

Crit 10 ("Fly by Instruments") requires, in case the brief page below isn't
reachable when this runs: the app must tell two or more simultaneous people
apart, on shared state, with that distinction enforced server-side --- and at
the crit, two pod members load only the deployed URL in separate Chrome
profiles (no shared cookies) while the pod narrates what's happening by
tailing `flyctl logs`, not by clicking through the UI. Permissions and
identity must be checked server-side, and the logging this needs has to keep
running after the crit, as a real diagnostic, not a one-off demo hook.

This app already has a notion of "person" that satisfies the brief's "what
counts as a person is your call" clause: the `hand` cookie `src/identity.ts`
mints on first visit, checked server-side on every `POST /api/marks`
(`src/db.ts`'s one-mark-a-day check). Don't replace it with accounts or a
login screen --- that would break `README.md`'s "no accounts, ever" stance for
no reason the brief requires. But in practice a session is still untracked:
`nameFor` already generates a name for every hand and `createHand` already
stores it, but nothing ever reads it back --- no page shows it, no log
mentions it, so there's nothing a person or an operator reading logs could
call a given hand by that stays stable across its visits. What's missing is
three things crit 10 actually tests: a visible, stable username per session;
persistent server-side logs that say which hand did what, by that username;
and a way for a hand's own persistence (that it's the *same* hand coming
back) to become visible rather than just enforced silently. The three
features below exist to make that distinction legible, not just correct.

## Feature 1: Give every session a visible, stable username

Rework `nameFor` in `src/identity.ts` so a hand's username reads like an
anonymous multiplayer handle, not a hyphenated pair of words: a word, a word,
a number, run together with no separator, e.g. `flippingplatypus1`,
`heavyrhino5`. Keep it deterministic from the hand's id, the same way
`nameFor`/`colourFor` already hash the id into a word-list index --- this is
a reshape of the existing scheme, not a second one alongside it, so the same
cookie always produces the same username on every visit. Widen or adjust the
adjective/noun lists if needed so the concatenated form reads cleanly (no
pair that runs together looking like a different word), and derive the
number from the id too, not randomly per request, so it's just as stable.

Surface it: show a hand its own username on the wall page, next to the
existing "You draw as this colour" line, so a returning visitor has
something to recognise itself by beyond a colour swatch. Never send one
hand's username to another hand's page --- a username is still an identity,
just a friendlier one than a UUID, and the same "nobody else can tell whose
mark is whose" rule that already governs hand ids applies to it. This is not
a second identity system or an account: it's cosmetic on top of the same
cookie, carries no login, and is worthless without that cookie.

## Feature 2: Server-side logs that tell hands apart

Add structured, persistent logging (plain `console.log`/`console.error` to
stdout is enough --- `flyctl logs -a <repo>` tails that directly, which is the
brief's own suggested tool) for every server-side decision that currently
depends on *which hand* is asking:

- a mark accepted: hand's username (Feature 1 --- far more readable in a
  live-narrated log than a raw UUID), mark id, path length, how much wall
  room it used
- a mark refused for being too early: which hand, how long until it can mark
  again
- a mark refused for exceeding the current length cap: which hand, the
  cap at that moment, the length it tried
- a new hand minted (first visit, cookie issued)

Log one line per event, not a dump at request end, and make sure two hands
acting within the same second produce two distinguishable lines --- this is
the exact thing the crit's live test checks: two classmates draw at once from
separate profiles, and the pod reads the log stream and says, correctly,
which line is which person, with no UI to fall back on. Walk through this
yourself before calling it done: run the server, hit it from two different
`hand` cookies (`curl` with two separate `-b`/`-c` cookie jars, or two
private-browsing windows), and confirm the log output alone --- not the
wall --- tells you who did what. This is the thing crit 10 is actually
testing; the features below are in service of it, not separate from it.

Do not log anything that lets one hand's identity leak to *another hand* (no
new field sent to the browser, no id embedded in the page) --- the logs are
server-side diagnostics for whoever has `flyctl logs` access, which is a
different audience than a visitor, and `README.md`'s "nobody else can tell
whose mark is whose" claim is about what a visitor can see, not about
whether the operator's logs are useless. Keep that distinction explicit if
you write about it.

## Feature 3: A hand's own persistence, surfaced back to it

Right now the `hand` cookie quietly lasts a year from first visit and is
never mentioned again. Change two things:

**Make it a sliding window.** Re-issue `setHandCookie` (same year-long
`Max-Age`) on every request that already resolves a hand, in
`src/server.ts`, not only at creation --- a hand drawing regularly should
never have its identity lapse just because a year passed since its *first*
visit specifically. A hand that's been silent for over a year is still fine
to treat as new; this only protects a hand that keeps coming back.

**Say so, on the page.** `hands.created_at` already records when a hand was
first seen, and `pages.ts`'s `wallPage` already computes `own` (that hand's
own marks). Use both to tell a returning hand something true about its own
continuity --- how long it's been coming back, and how many marks it's
added --- next to the username line Feature 1 adds, or folded into it. Keep
it to one unobtrusive line, plain language over exact
timestamps, and only ever about the hand looking at the page, never about
any other hand. This is a small, honest instance of the same thing crit 10
is testing in the logs: the app telling one visitor apart from the rest, just
surfaced in the UI instead of a log line, for the one case where it's the
visitor's own business to know.

## Feature 4: A replay of the wall's growth

Add a way to watch the wall redraw itself from empty, mark by mark, in the
order they actually landed (`allMarks()`'s existing `created_at ASC` order).
This is the "timeline" view of the same distinction crit 10 is about: the
wall is really many hands' marks layered over time, and right now a visitor
only ever sees the final, flattened state.

- **Trigger it on demand**, with a clearly labelled control near the wall
  (e.g. a "Replay" button) --- it should never autoplay on page load, and a
  visitor who never presses it should see exactly what the wall shows today.
- **Whole-wall replay is the default**: every hand's marks, in order, each in
  its own stored colour. Stay anonymous the same way the live wall already
  is --- colour only, no hand id or name ever reaches the page for marks that
  aren't the viewer's own, replay included.
- **Add a way to replay just the viewer's own marks** --- reusing the `own`
  filter `wallPage` already computes --- so a hand can watch its own
  contribution's history without that requiring exposing anyone else's
  identity to do it.
- **Respect `prefers-reduced-motion`**: skip the animated reveal and just
  flip between states instantly (or offer a scrub control instead of an
  auto-advancing animation) for a visitor who's asked for that.
- **Don't let replay interfere with real-time or drawing.** A mark landing
  over SSE mid-replay, or a hand's own eligibility to draw, must behave
  exactly as it does today once replay ends or is dismissed --- replay is a
  view of history, not an alternate mode the rest of the app has to know
  about. The simplest correct approach is almost certainly to do this
  entirely client-side in `public/wall.js` from data already available to
  the page (or a small addition to it), without touching the one-mark-a-day
  or length-cap logic in `src/db.ts`/`src/cap.ts` at all.
- No new third-party script or library --- same constraint the rest of the
  page already follows.

## What to keep, what to leave alone

No accounts, no login, no text or per-mark captions, no way to see another
hand's name or id from the browser, no erasing or altering an existing mark.
The one-mark-a-day rule and the length cap are unchanged by any of this ---
replay and the logging above only ever *read* existing state. If a log line
or the UI persistence message would require storing anything beyond what
`hands`/`marks` already capture, keep the new field minimal and additive in
`src/db.ts` rather than reshaping the schema.

## Required write-up

Add a decision record to `PROCESS.md` in the style of its existing decision
records (Context, Decision, Alternatives considered, Consequences), covering:
- what "a person" means in this app and why the existing cookie identity
  satisfies crit 10's requirement without becoming an account system
- why the username is cosmetic on the existing cookie rather than a new
  identity layer, and why that distinction matters
- what you chose to log and why those events specifically are the ones that
  make two simultaneous hands distinguishable in `flyctl logs`
- why the cookie's persistence became a sliding window, and what surfacing
  it to the hand costs or risks (e.g. anything that could read as tracking)
- one or two sentences on what replay deliberately does *not* do (no
  per-hand labelling, no speed-through-time control beyond what's needed)
  and why

Update `README.md`'s "What's enforced, and what's judged" section wherever
this changes what's actually true, and add a short section explaining the
replay feature in the same voice as the rest of the doc. Add spec coverage
for whatever here is mechanical (a hand's username is stable across repeat
visits and two different hand ids don't collide on the same username within
the word lists chosen; the cookie's `Max-Age` resets on a resolving request;
a returning hand's own-marks/first-seen data is correct; replay reproduces
the exact same final SVG state the normal render does),
following `spec/wall-client.test.ts`'s pattern of driving the real
`public/wall.js` for anything client-side. Keep `spec/invariants.test.ts`
green.

Write `reflections/crit-10.md` in the shape of `reflections/crit-9.md` (one
entry, the breakthrough that moved the work forward and what it changed
about the developer you want to be, title taken from the brief's own title
field, not a week number).

Keep commits small and sequenced the way the existing history is --- one
change, one reason --- not a single dump at the end. Your last commit
deletes this file.

## Pointers

- `src/identity.ts` --- `newHandId`, `nameFor` (reshape into the
  `word-word-number` username format), `colourFor` (the hashing pattern to
  match), `setHandCookie`, the cookie shape to extend, not replace
- `src/server.ts` --- where the `hand` cookie is resolved per request (reissue
  it here) and where `POST /api/marks`'s accept/reject decisions happen (log
  here)
- `src/db.ts` --- `allMarks()`, `Hand.created_at`, the data both the log lines
  and the "how long you've been here" message are drawn from; keep any schema
  addition additive
- `src/pages.ts` --- `wallPage`'s existing `own` computation, to reuse for
  both the persistence message and the own-marks replay filter
- `public/wall.js` --- where the replay control and its client-side playback
  belong
