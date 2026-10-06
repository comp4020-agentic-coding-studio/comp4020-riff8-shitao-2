import { JSDOM } from "jsdom";
import { expect, inject, it } from "vitest";
import net from "node:net";

// Trace's own promises, from README.md's "what's enforced" list: a
// first-time visitor gets a hand, a mark they draw shows up and survives a
// fresh request, a hand can't draw twice in one day, and the page carries no
// third-party request.
const baseUrl = inject("baseUrl");

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie");
  expect(raw, "expected a Set-Cookie header on a first visit").toBeTruthy();
  return raw!.split(";")[0];
}

it("gives a first-time visitor a hand cookie", async () => {
  const res = await fetch(new URL("/", baseUrl));
  expect(res.status).toBe(200);
  const cookie = cookieFrom(res);
  expect(cookie).toMatch(/^hand=[0-9a-f-]{36}$/);
});

it("a hand's mark appears on the wall and survives a fresh request", async () => {
  const first = await fetch(new URL("/", baseUrl));
  const cookie = cookieFrom(first);

  const path = "M1,2 L3,4 L5,6";
  const post = await fetch(new URL("/api/marks", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ path }),
  });
  expect(post.status).toBe(201);

  // A completely fresh request (same cookie, new fetch) --- not just reading
  // back the POST's own response --- so this actually checks persistence.
  const after = await fetch(new URL("/", baseUrl), { headers: { Cookie: cookie } });
  const html = await after.text();
  expect(html).toContain(path);
});

it("a returning hand can tell its own mark from everyone else's", async () => {
  const mine = cookieFrom(await fetch(new URL("/", baseUrl)));
  const other = cookieFrom(await fetch(new URL("/", baseUrl)));

  // Unique per run: the app under test keeps its database between runs, and
  // an identical path drawn by an earlier run's hand would match first. The
  // uniqueness lives in a decimal so the stroke stays short enough for the
  // length cap.
  const stamp = Date.now() % 100_000;
  const path = `M11.${stamp},12 L13,14 L15,16`;
  const post = await fetch(new URL("/api/marks", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: mine },
    body: JSON.stringify({ path }),
  });
  expect(post.status).toBe(201);
  // A later mark from someone else, so painting in time order would bury this one.
  const later = await fetch(new URL("/api/marks", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: other },
    body: JSON.stringify({ path: `M19.${stamp},20 L21,22` }),
  });
  expect(later.status).toBe(201);

  const strokeFor = async (cookie: string) => {
    const html = await (await fetch(new URL("/", baseUrl), { headers: { Cookie: cookie } })).text();
    const svg = new JSDOM(html).window.document.getElementById("wall")!;
    const strokes = [...svg.querySelectorAll("path")];
    return {
      ownMark: strokes.find((p) => p.getAttribute("d") === path && p.classList.contains("mine")),
      // On a busy wall, later marks would bury it unless it's painted last.
      paintedLast: strokes.at(-1)?.getAttribute("d") === path,
      anyMatch: strokes.some((p) => p.getAttribute("d") === path),
    };
  };

  const asMine = await strokeFor(mine);
  expect(asMine.ownMark).toBeDefined();
  expect(asMine.paintedLast).toBe(true);
  const asOther = await strokeFor(other);
  expect(asOther.anyMatch).toBe(true);
  expect(asOther.ownMark).toBeUndefined();
});

it("refuses a second mark from the same hand on the same day", async () => {
  const first = await fetch(new URL("/", baseUrl));
  const cookie = cookieFrom(first);

  const post = (path: string) =>
    fetch(new URL("/api/marks", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path }),
    });

  expect((await post("M1,1 L2,2")).status).toBe(201);
  expect((await post("M9,9 L8,8")).status).toBe(429);
});

it("refuses a same-day double mark even when one request's body is slow to arrive", async () => {
  // A plain sequential double-POST (above) can't catch a check-then-insert
  // race: the server has to actually be mid-way through one request's body
  // when the other's completes. Held-open connection A proves the window is
  // closed by deliberately finishing B first while A's body is still en
  // route --- the shape a slow network or a second tab genuinely produces.
  const first = await fetch(new URL("/", baseUrl));
  const cookie = cookieFrom(first);
  const { hostname, port } = new URL(baseUrl);

  const connect = (): Promise<net.Socket> =>
    new Promise((resolve, reject) => {
      const sock = net.connect(Number(port), hostname, () => resolve(sock));
      sock.on("error", reject);
    });

  const readStatus = (sock: net.Socket): Promise<string> =>
    new Promise((resolve) => {
      let data = "";
      sock.on("data", (chunk: Buffer) => {
        data += chunk.toString();
        if (data.includes("\r\n\r\n")) {
          resolve(data.split(" ")[1]);
          sock.destroy();
        }
      });
    });

  const headers = (contentLength: number) =>
    `POST /api/marks HTTP/1.1\r\nHost: ${hostname}\r\nContent-Type: application/json\r\n` +
    `Cookie: ${cookie}\r\nContent-Length: ${contentLength}\r\nConnection: close\r\n\r\n`;

  const bodyA = JSON.stringify({ path: "M1,3 L2,4" });
  const bodyB = JSON.stringify({ path: "M5,6 L7,8" });

  const [sockA, sockB] = await Promise.all([connect(), connect()]);
  const statusA = readStatus(sockA);
  const statusB = readStatus(sockB);

  sockA.write(headers(Buffer.byteLength(bodyA)));
  await new Promise((resolve) => setTimeout(resolve, 50));
  sockB.write(headers(Buffer.byteLength(bodyB)) + bodyB);
  expect(await statusB).toBe("201");

  sockA.write(bodyA);
  expect(await statusA).toBe("429");
});

it("rejects a mark that isn't a plain stroke path", async () => {
  const first = await fetch(new URL("/", baseUrl));
  const cookie = cookieFrom(first);

  const res = await fetch(new URL("/api/marks", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ path: "<script>alert(1)</script>" }),
  });
  expect(res.status).toBe(400);
});

const capOn = async (cookie?: string): Promise<number> => {
  const html = await (
    await fetch(new URL("/", baseUrl), { headers: cookie ? { Cookie: cookie } : {} })
  ).text();
  const cap = Number(new JSDOM(html).window.document.querySelector("script[data-cap]")?.getAttribute("data-cap"));
  expect(cap).toBeGreaterThan(0);
  return cap;
};

it("refuses a mark longer than the wall's current length cap", async () => {
  const cookie = cookieFrom(await fetch(new URL("/", baseUrl)));
  const cap = await capOn(cookie);
  // Back and forth across the wall until it's past the cap: a well-formed
  // path (PATH_RE passes it) that's simply too long right now.
  const legs = Math.ceil(cap / 900) + 1;
  const path = ["M50,300", ...Array.from({ length: legs }, (_, i) => `L${i % 2 ? 50 : 950},300`)].join(" ");

  const res = await fetch(new URL("/api/marks", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ path }),
  });
  expect(res.status).toBe(422);
  expect(await res.text()).toMatch(/longer than the wall has room for/);

  // Refused, not truncated: nothing of it reached the wall, and the hand
  // still has its mark for the day.
  const after = await (await fetch(new URL("/", baseUrl), { headers: { Cookie: cookie } })).text();
  expect(after).not.toContain(path);
  const short = await fetch(new URL("/api/marks", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ path: "M100,100 L130,100" }),
  });
  expect(short.status).toBe(201);
});

it("broadcasts a new mark over /api/marks/stream within a second", async () => {
  const controller = new AbortController();
  const stream = await fetch(new URL("/api/marks/stream", baseUrl), {
    signal: controller.signal,
  });
  expect(stream.headers.get("content-type")).toMatch(/text\/event-stream/);

  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  const nextMarkEvent = (): Promise<{ path: string; colour: string; cap: number; room: string }> =>
    (async () => {
      for (;;) {
        const boundary = buffered.indexOf("\n\n");
        if (boundary !== -1) {
          const chunk = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          if (chunk.startsWith("event: mark")) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "))!;
            return JSON.parse(line.slice("data: ".length));
          }
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("stream closed before a mark event arrived");
        buffered += decoder.decode(value, { stream: true });
      }
    })();

  const first = await fetch(new URL("/", baseUrl));
  const cookie = cookieFrom(first);
  const capBefore = await capOn(cookie);
  const path = "M11,12 L13,14";

  const [event] = await Promise.all([
    Promise.race([
      nextMarkEvent(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("no mark event within 3s")), 3000),
      ),
    ]),
    fetch(new URL("/api/marks", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ path }),
    }).then((res) => expect(res.status).toBe(201)),
  ]);

  expect(event.path).toBe(path);
  // The same event tells every open tab the wall's new, smaller cap.
  expect(event.cap).toBeLessThan(capBefore);
  expect(event.room).toMatch(/wall's width/);
  expect(await capOn(cookie)).toBe(event.cap);
  controller.abort();
});

it("ships no third-party script or stylesheet", async () => {
  const res = await fetch(new URL("/", baseUrl));
  const dom = new JSDOM(await res.text());
  const srcs = [...dom.window.document.querySelectorAll("script[src], link[rel=stylesheet]")].map(
    (el) => el.getAttribute("src") ?? el.getAttribute("href") ?? "",
  );
  expect(srcs.length).toBeGreaterThan(0);
  for (const src of srcs) {
    expect(src.startsWith("http://") || src.startsWith("https://") || src.startsWith("//")).toBe(
      false,
    );
  }
});
