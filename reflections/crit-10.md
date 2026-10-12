# Fly by instruments

## The breakthrough

The breakthrough was treating the log as the interface and asking what it
would take for it to never lie. The obvious build was "log the hand's name
on every decision", and the names were already there: every hand got one
at creation. But there were only a hundred of them (ten adjectives, ten
nouns), so on any wall with a few dozen hands two people would share one,
and a narrator reading two `mark.accepted` lines with the same name would
confidently tell the room the wrong story. Nothing had ever caught it
because nothing had ever displayed a name. Widening the lists made
collisions rare; it took a unique index and a deterministic re-roll to make
them impossible, plus a one-off rename of the old names so the index could
exist. Then I drove it the way the crit will: two browser sessions drawing
within a few milliseconds, identical stroke lengths, and only the handles
in the log to tell them apart. They did.

The same pass showed what the log can't say: a second mark the client
refuses to start never reaches the server, so it leaves no line. That went
into the decision record as a stated limit rather than a surprise at the
crit.

## Who I want to be

I want to be a developer who treats diagnostics as a product with its own
correctness bar, not a print statement added the day before a demo. A log
that's usually right is worse than no log, because it gets believed. The
test is the same as for any feature: put two real people on it at once and
read only what it says.
