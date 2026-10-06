// Captures one pointer gesture on the wall's SVG and posts it as a mark, and
// listens for every hand's marks (including this one's, echoed back) over
// SSE so the wall updates live with no reload. No frameworks: this is the
// whole client.
(() => {
  const script = document.currentScript;
  const svg = document.getElementById("wall");
  const status = document.getElementById("status");
  const roomPhrase = document.getElementById("room-phrase");
  const handColour = script.dataset.handColour;
  let canDraw = script.dataset.canDraw === "true";
  // The longest mark the wall has room for, in view-box units. The server
  // computes it, embeds it in the page and sends a fresh one with every mark
  // over SSE; this file only ever obeys the latest number it was told.
  let cap = Number(script.dataset.cap);
  let points = [];
  let live = null;
  let drawing = false;
  // True from the moment a finished gesture's POST goes out until it
  // settles. Without this, pointerdown doesn't check anything but canDraw
  // (which only flips false on *success*), so a hand could start a second
  // gesture while the first mark's request was still in flight --- both
  // post, the server's one-mark-a-day check correctly rejects the loser,
  // but the single pendingNonce below belongs to whichever gesture started
  // last, orphaning the winner's own nonce and making its own echo draw a
  // visible duplicate of a stroke already on the wall.
  let submitting = false;
  // The nonce of the mark this tab just posted, so its own echo over SSE
  // draws nothing twice --- the gesture is already on the wall as `live`. A
  // second open tab for the *same* hand has no `live` element and still
  // needs the echo. Set synchronously before the POST even goes out (not
  // after it resolves), and compared by this opaque token rather than path
  // content: two different hands can draw byte-identical short strokes, and
  // the SSE push for this tab's own mark can genuinely arrive before its own
  // fetch's promise resolves.
  let pendingNonce = null;

  const toViewBox = (evt) => {
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const x = ((evt.clientX - rect.left) / rect.width) * vb.width + vb.x;
    const y = ((evt.clientY - rect.top) / rect.height) * vb.height + vb.y;
    return [Math.round(x), Math.round(y)];
  };

  const pathFrom = (pts) => pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");

  const appendStroke = (path, colour) => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", path);
    p.setAttribute("stroke", colour);
    // Under this hand's own strokes, which the server paints last.
    svg.insertBefore(p, svg.querySelector(".halo, .mine"));
  };

  // The stroke being drawn, over its halo, mirroring what the server renders
  // for a hand's own marks.
  let halo = null;
  // A gesture runs out of room at the cap it started under, not one that
  // arrives mid-stroke: the hand was shown that figure, and the server stays
  // the backstop if another mark shrank the real one meanwhile. The hundredth
  // of a unit keeps a stroke drawn right to the limit clear of any rounding
  // difference between this browser's arithmetic and the server's.
  let gestureCap = cap;
  let used = 0;
  let full = false;
  let idleStatus = "";

  const beginGesture = (point) => {
    drawing = true;
    points = [point];
    gestureCap = cap - 0.01;
    used = 0;
    full = false;
    idleStatus = status.textContent;
    halo = document.createElementNS("http://www.w3.org/2000/svg", "path");
    halo.setAttribute("class", "halo");
    live = document.createElementNS("http://www.w3.org/2000/svg", "path");
    live.setAttribute("stroke", handColour);
    live.setAttribute("class", "mine");
    svg.append(halo, live);
  };

  // Past the cap, the stroke stops where the room runs out (each coordinate
  // rounded towards the previous point, so rounding can't carry it over) and
  // ignores everything after, so a hand feels the wall fill up rather than
  // finishing a stroke only to have it refused.
  const addPoint = (point) => {
    if (full) return;
    const [lx, ly] = points[points.length - 1];
    let step = Math.hypot(point[0] - lx, point[1] - ly);
    if (used + step > gestureCap) {
      full = true;
      status.textContent = "That's all the room the wall has for one mark right now: finish it here.";
      const t = (gestureCap - used) / step;
      point = [lx + Math.trunc((point[0] - lx) * t), ly + Math.trunc((point[1] - ly) * t)];
      step = Math.hypot(point[0] - lx, point[1] - ly);
      if (step === 0 || used + step > gestureCap) return;
    }
    used += step;
    points.push(point);
    halo.setAttribute("d", pathFrom(points));
    live.setAttribute("d", pathFrom(points));
  };

  const dropLive = () => {
    halo?.remove();
    live?.remove();
  };

  if (canDraw) {
    svg.addEventListener("pointerdown", (evt) => {
      if (!canDraw || submitting) return;
      beginGesture(toViewBox(evt));
      svg.setPointerCapture(evt.pointerId);
    });

    svg.addEventListener("pointermove", (evt) => {
      if (!drawing) return;
      addPoint(toViewBox(evt));
    });

    const finish = async () => {
      if (!drawing) return;
      drawing = false;
      if (points.length < 2) {
        dropLive();
        status.textContent = idleStatus;
        return;
      }
      const path = pathFrom(points);
      // Chosen and recorded before the fetch is even issued, so the echo
      // check below is already armed no matter which I/O completes first.
      const nonce = crypto.randomUUID();
      pendingNonce = nonce;
      submitting = true;
      status.textContent = "Adding your mark…";
      try {
        const res = await fetch("/api/marks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, nonce }),
        });
        if (!res.ok) {
          const text = await res.text();
          status.textContent = text || "That mark wasn't accepted.";
          dropLive();
          pendingNonce = null;
          return;
        }
        canDraw = false;
        status.textContent =
          "Your mark is on the wall: the thicker stroke, on top. You can add another in 24 hours.";
      } catch {
        status.textContent = "Couldn't reach the wall --- try again.";
        dropLive();
        pendingNonce = null;
      } finally {
        submitting = false;
      }
    };

    svg.addEventListener("pointerup", finish);
    svg.addEventListener("pointercancel", finish);

    // A pointer is the only way to draw unless this exists: Enter/Space
    // starts a gesture at the wall's centre, the arrow keys add a point each
    // in that direction (mirroring pointermove), and Enter/Space again hands
    // off to the same finish() a pointer gesture uses. Escape cancels before
    // anything is sent, the same way lifting a pointer after barely moving
    // does (finish() drops any gesture under two points).
    const STEP = 30;
    const ARROW_DELTAS = {
      ArrowUp: [0, -STEP],
      ArrowDown: [0, STEP],
      ArrowLeft: [-STEP, 0],
      ArrowRight: [STEP, 0],
    };
    svg.addEventListener("keydown", (evt) => {
      if (!canDraw || submitting) return;
      if (!drawing) {
        if (evt.key !== "Enter" && evt.key !== " ") return;
        evt.preventDefault();
        const vb = svg.viewBox.baseVal;
        beginGesture([Math.round(vb.x + vb.width / 2), Math.round(vb.y + vb.height / 2)]);
        return;
      }
      if (evt.key in ARROW_DELTAS) {
        evt.preventDefault();
        const [dx, dy] = ARROW_DELTAS[evt.key];
        const [x, y] = points[points.length - 1];
        addPoint([x + dx, y + dy]);
        return;
      }
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        finish();
        return;
      }
      if (evt.key === "Escape") {
        evt.preventDefault();
        drawing = false;
        dropLive();
        status.textContent = idleStatus;
      }
    });
  }

  const stream = new EventSource("/api/marks/stream");
  stream.addEventListener("mark", (evt) => {
    const mark = JSON.parse(evt.data);
    // Every mark shrinks the room for the next, whoever drew it.
    if (typeof mark.cap === "number") cap = mark.cap;
    if (roomPhrase && mark.room) roomPhrase.textContent = mark.room;
    if (mark.nonce && mark.nonce === pendingNonce) {
      pendingNonce = null;
      return;
    }
    appendStroke(mark.path, mark.colour);
  });
})();
