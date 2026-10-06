# All at once

## The breakthrough

The breakthrough was making the decision record's "cost" section something
I had watched happen, not something I had reasoned out. The design truncates
a stroke at the cap the hand was shown when it started, and the server
refuses anything longer. On paper the gap between those two is a footnote:
two hands, the same few seconds. So I drove it. One browser session drew
right up to the limit and held the pointer down while a second hand's mark
landed underneath. The room line above the wall dropped from "2.5 times the
wall's width" to "2 times" with no reload, which is exactly the live
behaviour the crit asks for. Then the first hand let go and lost its whole
stroke to a 422. That is the reject-on-submit experience the design was
chosen to avoid, reached through a side door. Seeing it changed the record
from "rare, acceptable" to a named cost with an obvious next fix: re-truncate
to the new cap and say so.

The same run turned up an old test posting a stroke a hundred times wider
than the wall just to get a unique path. It had passed since it was written because
nothing measured length.

## Who I want to be

I want to be a developer who writes down a multi-user decision's costs only
after making them happen with more than one person, or more than one
session, actually on the app. A decision record is an argument; its
consequences section should be evidence. Reproducing the bad case takes a
few minutes and two browser sessions, and it's the difference between
defending a choice at the crit and understanding it.
