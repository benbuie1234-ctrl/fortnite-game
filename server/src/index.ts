import { MatchRoom, type Env } from "./match";

export { MatchRoom };

/** How many public rooms quickplay will walk before giving up. */
const PUBLIC_ROOMS = 12;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      return routeToMatch(request, env, url);
    }

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, rooms: PUBLIC_ROOMS });
    }

    // Everything else is the game client, served from the CDN for free.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function routeToMatch(request: Request, env: Env, url: URL): Promise<Response> {
  const code = url.searchParams.get("room")?.trim().toUpperCase();

  // A private room code always goes to exactly that room, so friends who share
  // a code land together even if it is full-ish.
  if (code && code.length > 0) {
    const id = env.MATCH.idFromName(`room:${sanitizeCode(code)}`);
    return env.MATCH.get(id).fetch(request);
  }

  // Quickplay: walk the public rooms and take the first with space. A full
  // room answers 503, which costs one cheap round trip inside Cloudflare.
  for (let i = 0; i < PUBLIC_ROOMS; i++) {
    const id = env.MATCH.idFromName(`public:${i}`);
    // A websocket upgrade carries no body, so cloning per attempt is safe.
    const res = await env.MATCH.get(id).fetch(request.clone() as unknown as Request);
    if (res.status !== 503) return res;
  }
  return new Response("all matches full, try again in a moment", { status: 503 });
}

function sanitizeCode(code: string): string {
  let out = "";
  for (const ch of code) {
    if (/[A-Z0-9]/.test(ch)) out += ch;
  }
  return out.slice(0, 12) || "LOBBY";
}
