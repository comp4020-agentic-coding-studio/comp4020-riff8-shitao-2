// One line per decision, to stdout, which is all `flyctl logs` tails: an
// event name first, then key=value pairs, always with the hand's username
// (`-` when a request carries no hand). Usernames, not hand ids: the cookie's
// id is the hand's credential and has no business in a log, and a name is
// what someone narrating two people at once can actually say aloud. Nothing
// logged here is ever sent to a browser.
//
// Every value is server-made (a username, a number, a fixed reason) or a
// URL pathname, which arrives percent-encoded, so no value can carry a space
// or a newline: nothing needs quoting and nobody can forge a line.
type Value = string | number;

export function logEvent(event: string, hand: string | undefined, fields: Record<string, Value> = {}): void {
  const pairs = Object.entries(fields).map(([key, value]) => `${key}=${value}`);
  console.log([new Date().toISOString(), event, `hand=${hand ?? "-"}`, ...pairs].join(" "));
}
