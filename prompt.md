# Prompt for crit 9: All at once

## Context

Crit 9 ("All at once") requires, in case the brief page below isn't
reachable when this runs: (1) a change one person makes appears in every
other open session within about a second, with no reload, tested live by
opening the app on multiple devices at once; (2) one documented, defensible
decision about multi-user behaviour, written down with the options
considered and the cost of the one chosen; (3) `PROCESS.md` kept current,
`reflections/crit-9.md` added, and commits that grew with the work, not a
single dump.

Real-time already exists in this app: `GET /api/marks/stream` (SSE)
broadcasts every mark to every open tab within about a second of it landing,
with no reload, and `wall.js`'s nonce handling means a tab never
double-renders its own echoed mark. Verify this before touching anything
else. If it doesn't hold up, that's a bug to fix, not a feature to add; read
`src/server.ts`'s `broadcastMark`/`sseClients` and `public/wall.js`'s
`EventSource` listener rather than replacing them.

## The decision: a mark's length is capped by how much is already on the wall

Make the maximum length of a new mark a function of the total drawn length
already on the wall, recomputed from live data, so the wall's own growth is
what governs how much room the next hand has.

**The metric is total path length, not mark count.** Sum the Euclidean
length of every segment across every mark already persisted (each `L`
segment is a line from the previous point; an `M` is just a start, with no
length of its own). Mark count is a worse proxy -- two long strokes and
twenty short ones read very differently as "how full is the wall," and
length is honest about that; `src/db.ts`'s `allMarks()` is the only place
this can be computed from.

**The cap must get strictly smaller as total length grows, and must never
reach a point where a hand can't make a mark at all.** Pick the decay
formula yourself -- there's no fixed shape this prompt requires -- but it
must satisfy both ends: an empty wall gives a generously long first mark,
and the cap never drops below roughly 50 of the wall's 1000 view-box width
units (about 5% of the wall's width) no matter how much is already drawn --
short enough to feel constrained, long enough to still read as a stroke and
not a dot or a misclick. Document the formula and *why that shape*, not
just its output, in the write-up below.

**Enforce it server-side, as the authority, for both drawing methods.** The
check applies to a posted path regardless of whether it came from a pointer
gesture or the keyboard-arrows path (`public/wall.js`'s `ARROW_DELTAS`
handling posts through the same endpoint) -- there is no separate code path
to special-case. Use the same pattern already used for the one-mark-a-day
check and the existing 2000-point `PATH_RE` cap in `src/server.ts`: never
trust a client's own idea of how long its stroke is, and this check runs *in
addition to* `PATH_RE`'s structural validity check, not instead of it --
`PATH_RE` asks "is this a well-formed path," the new check asks "is this
path short enough right now," and a path can fail either independently.
Follow the same no-`await`-between-check-and-insert discipline the
one-mark-a-day check already uses, so two concurrent posts can't each read a
stale total and both squeeze in over the real cap. A request posting a path
longer than the currently-allowed maximum is rejected the same way an early
second mark is, with a clear reason in the response body -- not silently
truncated on the server.

**The server is also the only place the cap's value is computed -- never
duplicate the formula in client-side JS.** Send the current cap as data the
server already produces: embed it in the initial page render (`wallPage` in
`src/pages.ts`) so a fresh visitor sees it immediately, and include it as a
field in the same SSE `mark` event `broadcastMark` already sends (no new
event type needed) so every open tab's shown figure updates the moment any
mark lands, wall-wide, within about a second, with no reload -- not just in
the tab that drew it. `public/wall.js` only ever displays a number it was
told; it never recomputes the rule. This is the concrete, testable instance
of crit 9's real-time requirement for this feature, and what the pod will
test together at the crit: two tabs open side by side, one hand drawing,
the other tab's displayed room-left should visibly shrink with no reload.

**Show the live cap before a hand starts drawing, not only on rejection.** A
stranger with no account to appeal to can't contest a rejected mark after
the fact, so the wall page should tell them, before they start a stroke,
roughly how much room they currently have (plain language is fine; exact
numbers aren't the point).

**The client truncates a gesture in progress once it hits the currently-known
cap, rather than letting it run and rejecting on submit.** A hand drawing
right up to the limit should feel like running out of room, not like
finishing a stroke and then being told after the fact that it didn't count --
closer to how the one-mark-a-day limit already disables drawing in advance
(`data-can-draw`) than to a rejected `fetch`. `public/wall.js`'s gesture
handling (`addPoint`, the arrow-key path) is where this stops accepting new
points once the in-progress path's length would exceed the cap it was shown
at the start of the gesture; the finished, truncated path is what gets
posted. The server's own check (above) still applies regardless -- it is the
backstop for a client that doesn't behave, not the only enforcement.

## What to keep, what to leave alone

Everything about marking that crit 8 already settled stays exactly as it
is: one mark per rolling 24 hours per hand, no accounts, no text or images
in a mark, same-origin only, the "mine" halo/thicker-stroke rendering, the
keyboard drawing path, the WCAG-checked colour palette. None of this is what
crit 9 is testing and none of it should change.

Do not add any way to erase, hide, downvote, or otherwise act on another
hand's existing mark. The cap only ever affects a *new* mark before it's
drawn; nothing already on the wall is ever touched, resized, or removed.
The wall still never resets.

Do not add accounts, voting, or any per-hand reputation. The cap is a
function of the wall's total state, never of who is drawing.

## Required write-up

Add a decision record to `PROCESS.md` in the same style as its existing
"Decision record: the stack" section (Context, Decision, Alternatives
considered, Consequences), covering:
- the length-cap formula and why that shape, not another
- why total path length over mark count
- why truncating mid-gesture was chosen over rejecting a finished stroke on
  submit, and what rejecting on submit would have cost instead -- this is
  the option the pod will argue for at the crit
- a sentence or two on what would differ if this were per-hand state
  instead of wall-wide, or spatial/local instead of global

Update whatever in `README.md`'s "What's enforced, and what's judged"
section this feature changes the truth of. Add spec coverage for whatever
about this feature is actually mechanical (the cap shrinks monotonically
with total length; it never reaches a value that makes a mark impossible; a
request over the current cap is rejected), following `spec/wall-client.test.ts`'s
existing pattern of driving the real `public/wall.js` for anything that has
to be verified client-side rather than described. Keep
`spec/invariants.test.ts` itself green.

Write `reflections/crit-9.md` in the shape of `reflections/crit-8.md` (a
breakthrough, and who you want to be). Keep commits small and sequenced the
way crit 8's history is -- one change, one reason -- not a single dump at
the end.

## Pointers

- `src/server.ts` -- `broadcastMark`, `sseClients`, the existing `PATH_RE`
  cap and the one-mark-a-day check, for enforcement style and the race
  discipline to match
- `src/db.ts` -- `allMarks()`, the source for total path length
- `public/wall.js` -- the `EventSource` listener and the status line, for
  showing the live cap
- `PROCESS.md` -- "Decision record: the stack," the ADR format to match
- `reflections/crit-8.md` -- the format to match for `reflections/crit-9.md`
- the crit 9 brief: https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/crits/09-all-at-once/
