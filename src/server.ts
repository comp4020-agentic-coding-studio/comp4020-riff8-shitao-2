import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { capFor, pathLength, roomPhrase } from "./cap.ts";
import { addMark, allMarks, createHand, getHand, msUntilNextMark, totalLength } from "./db.ts";
import { colourFor, nameFor, newHandId, parseHandCookie, setHandCookie } from "./identity.ts";
import { readmePage, untilPhrase, wallPage } from "./pages.ts";

const PORT = Number(process.env.PORT ?? 8080);
// Fly's proxy terminates TLS and forwards plain http; FLY_APP_NAME is only
// set on a real Fly machine, so it's a reliable stand-in for "the browser's
// connection is actually https" without trusting a header the app can't verify.
const isProd = Boolean(process.env.FLY_APP_NAME);

const STATIC_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 100_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// One "M" then one or more "L" segments, in the viewBox's integer-ish
// coordinate space --- exactly what public/wall.js emits. Capped at 2000
// points so a hand-rolled request can't post an arbitrarily large stroke.
const PATH_RE = /^M-?\d+(\.\d+)?,-?\d+(\.\d+)?(\sL-?\d+(\.\d+)?,-?\d+(\.\d+)?){1,2000}$/;

interface HandInfo {
  id: string;
  colour: string;
}

function ensureHand(req: IncomingMessage, res: ServerResponse): HandInfo {
  const existing = parseHandCookie(req.headers.cookie);
  const found = existing ? getHand(existing) : undefined;
  if (found) return { id: found.id, colour: found.colour };

  const id = newHandId();
  const hand = createHand(id, nameFor(id), colourFor(id));
  res.setHeader("Set-Cookie", setHandCookie(id, isProd));
  return { id: hand.id, colour: hand.colour };
}

// The real-time layer: every open tab holds one of these open, and a mark
// lands in all of them (this one included --- wall.js tells its own gesture
// apart from the echo by the nonce it posted, not by asking the server to
// skip it) the moment `addMark` commits. A plain in-memory Set is enough
// because fly.toml runs exactly one machine --- there's no cross-machine
// fan-out to build.
interface SseClient {
  res: ServerResponse;
  heartbeat: ReturnType<typeof setInterval>;
}

const sseClients = new Set<SseClient>();

// Every mark also carries the wall's new length cap, so every open tab's
// "room left" shrinks the moment any hand's mark lands --- the client never
// computes the cap itself.
function broadcastMark(mark: { path: string; colour: string; nonce?: string }): void {
  const cap = capFor(totalLength());
  const payload = JSON.stringify({
    path: mark.path,
    colour: mark.colour,
    nonce: mark.nonce,
    cap,
    room: roomPhrase(cap),
  });
  for (const client of sseClients) {
    client.res.write(`event: mark\ndata: ${payload}\n\n`);
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/") {
      const hand = ensureHand(req, res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(wallPage(allMarks(), hand, msUntilNextMark(hand.id), capFor(totalLength())));
      return;
    }

    if (req.method === "GET" && url.pathname === "/readme/") {
      const readme = readFileSync("README.md", "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(readmePage(readme));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/marks/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      // Fly's proxy (and some browsers) will drop an idle connection; a
      // comment line every 20s is invisible to EventSource but keeps it open.
      const heartbeat = setInterval(() => res.write(": ping\n\n"), 20_000);
      const client: SseClient = { res, heartbeat };
      sseClients.add(client);
      req.on("close", () => {
        clearInterval(heartbeat);
        sseClients.delete(client);
      });
      return;
    }

    if (req.method === "GET" && (url.pathname === "/style.css" || url.pathname === "/wall.js")) {
      const filePath = join("public", url.pathname);
      const type = STATIC_TYPES[extname(filePath)] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
      res.end(readFileSync(filePath));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/marks") {
      const hand = ensureHand(req, res);

      const raw = await readBody(req);
      let path: unknown;
      let nonce: unknown;
      try {
        const body = JSON.parse(raw) as { path?: unknown; nonce?: unknown };
        path = body.path;
        nonce = body.nonce;
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Malformed request.");
        return;
      }

      if (typeof path !== "string" || !PATH_RE.test(path)) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("That doesn't look like a mark.");
        return;
      }
      // An opaque, client-chosen token so a tab can recognise its own mark
      // coming back over SSE --- never stored, never rendered, just echoed.
      // Comparing path *content* instead (the previous approach) breaks the
      // moment two hands draw the same short stroke, which rounded,
      // low-point-count coordinates make a real possibility, not a
      // hypothetical one.
      const markNonce = typeof nonce === "string" && nonce.length <= 200 ? nonce : undefined;

      // Both checks have to be the last thing before the insert, with no
      // `await` between them: a client that holds its request body open
      // (a slow POST, or just a second tab) can otherwise pass a check
      // before another request has inserted --- posting twice in one day,
      // or measuring itself against a cap another mark has since shrunk.
      // node:sqlite's DatabaseSync is fully synchronous, so once nothing
      // separates them, nothing can interleave here.
      const wait = msUntilNextMark(hand.id);
      if (wait > 0) {
        res.writeHead(429, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`Your mark is already on the wall. You can add another ${untilPhrase(wait)}.`);
        return;
      }
      // Measured here from the path itself, never from anything the client
      // says about its own length; wall.js truncates a gesture at the cap it
      // was shown, so this only refuses a client that didn't, or one whose
      // cap shrank under another hand's mark while it was drawing.
      const cap = capFor(totalLength());
      if (pathLength(path) > cap) {
        res.writeHead(422, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(
          `That mark is longer than the wall has room for right now: ${roomPhrase(cap)}. Try a shorter one.`,
        );
        return;
      }

      const mark = addMark(hand.id, path, hand.colour);
      broadcastMark({ ...mark, nonce: markNonce });
      res.writeHead(201, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found.");
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Something went wrong.");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Trace listening on 0.0.0.0:${PORT}`);
});
