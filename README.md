# Clutch

A browser-based build-and-shoot arena game in the 1v1.lol / Fortnite mould.
Third-person, grid-snapped building, five weapons, authoritative multiplayer on
Cloudflare Workers + Durable Objects.

No installs, no accounts, no plugins — open a link and you are in a match.

```bash
npm install
npm run build      # build the client into dist/
npx wrangler dev   # serves the client and the game server on :8787
```

Open <http://localhost:8787>, hit **Quick Play**, and open a second tab to play
against yourself.

| Command | What it does |
|---|---|
| `npm run build` | Typecheck and bundle the client into `dist/` |
| `npm test` | Run the simulation, protocol, and arena test suites |
| `npm run check` | Typecheck only |
| `npx wrangler dev` | Run client + server locally on `:8787` |
| `npm run deploy` | Build and push to Cloudflare |

## Controls

**WASD** move · **Space** jump · **Left click** shoot or place · **Right click** aim
**1-5** weapons · **Q E R F** wall, floor, ramp, cone · **Z X C** wood, brick, metal
**G** reload · **Esc** release mouse

## How it is put together

```
shared/   simulation, collision, protocol  <- both sides import this
server/   Cloudflare Worker + MatchRoom Durable Object
client/   Three.js renderer, input, HUD
tests/    node test suites, no framework
```

The important architectural decision is that **`shared/` is imported by both the
client and the server.** Movement, collision, build-piece geometry and the wire
format exist exactly once. The client predicts using the same `stepPlayer()` the
server uses to decide what really happened, so prediction and authority cannot
drift apart through code duplication.

### Netcode

Standard authoritative-server model, the same shape Valve and Epic use:

- **30 Hz** server simulation, fixed timestep.
- **15 Hz** client sends, batching 2 input frames per message.
- **15 Hz** server snapshots.
- **Client prediction**: your input applies locally the instant you press it.
- **Reconciliation**: each snapshot snaps you to the authoritative state, then
  replays every input the server has not acknowledged yet. Without the replay
  you would visibly jump backwards by your ping on every snapshot.
- **Entity interpolation**: other players render ~133 ms in the past so there
  are always two snapshots to blend between. No extrapolation — on a hitch we
  hold the last pose rather than guessing and rubber-banding.
- **Lag compensation**: when you shoot, the server rewinds every other player to
  where *you* saw them (half your RTT plus the interpolation delay) before
  tracing the ray. You hit what your crosshair was on.

The client never asserts a hit. It reports that you pulled the trigger; the
server decides what that hit and for how much damage. Build placement, fire
rate, material cost and reach are all validated server-side too.

### Why the network tick is not on `requestAnimationFrame`

Browsers pause rAF in background tabs. Driving the network from it means a
player who alt-tabs stops sending input and gets dropped for inactivity. The
input loop runs on a timer instead, which keeps running (throttled) when hidden.
Pings also refresh the inactivity deadline.

### The build grid

Every piece is addressed by a single packed 30-bit integer — `gx(10) | gz(10) |
gy(7) | slot(3)` — so the world is a flat `Map<number, Piece>` with no string
keys anywhere in the hot path.

Walls are shared between neighbouring cells, so every wall placement is
canonicalised onto the cell on its +X/+Z side. Two players aiming at opposite
faces of the same wall address the same piece instead of stacking two
coincident walls.

Placement lives in `shared/src/placement.ts` and is used by **both** the
client's build ghost and the server's validation, so the yellow preview can
never point at a different cell than the one that actually gets built.

## What Cloudflare actually costs

The client is static and served from Cloudflare's CDN, which is free and
effectively unmetered. The cost is entirely in the Durable Objects running
matches. Two meters matter:

- **Duration**: every DO is billed as 128 MB of wall-clock time while alive.
- **Requests**: incoming WebSocket messages bill at **20:1** — 20 messages count
  as one request. This applies to the Hibernation API *and* the regular one.

Because inbound message volume is a real meter, the client batches 2 input
frames per message and sends at 15 Hz rather than 30. That halves the billed
message count for no felt difference in responsiveness.

| | Workers Free | Workers Paid ($5/mo) |
|---|---|---|
| DO duration | 13,000 GB-s/day | 400,000 GB-s/month |
| DO requests | 100,000/day (= 2M WS messages) | 1M/month, then $0.15/M |
| Realistic ceiling | **~30-50 player-hours/day** | effectively uncapped |

Worked example — 50 players, 1 hour a day, 30 days (1,500 player-hours/month):

- Messages: 1500 h × 3600 s × 15/s ÷ 20 = **4.05M requests** → $0.46 after the
  1M included.
- Duration: ~750 match-hours × 2 players × 128 MB ≈ **337,500 GB-s** → within
  the 400,000 included.
- **Total: about $5.46/month.**

Free tier is genuinely fine to launch on. It runs out at roughly 25 players
putting in an hour a day.

A room shuts its tick loop down and clears its builds when the last player
leaves, so empty rooms cost nothing.

## Deploying

```bash
npx wrangler login
npm run deploy
```

Quick Play walks 12 public rooms and joins the first with space (4 players per
room). A private room code always routes to that exact room, so friends who
share a code land together.

## Status

Working: movement, collision, building (wall/floor/ramp/cone × 3 materials with
grow-in and destruction), 5 weapons with falloff and headshots, lag-compensated
hit registration, respawns, scoring, rounds, kill feed, quickplay and room
codes.

Not built yet:

- **Build editing** (the Fortnite `T` edit mechanic). The input bit is already
  on the wire; the server ignores it.
- **Crouch** — also on the wire, not in the simulation.
- **Sound.** There is none at all yet, and it matters more than it sounds like.
- **Skins are a catalogue, not a store.** `shared/src/skins.ts` defines six
  skins and the rendering path is a pure recolour, but there is no purchase
  flow. Unlocks must be granted server-side from a Stripe webhook — never
  trusted from the client.
- **Battle royale.** The engine is mode-agnostic; a BR mode needs a larger map,
  loot, and a storm circle.

## Testing

`npm test` runs three suites on plain node, no framework:

- `sim.test.ts` — gravity, walls, floors, ramps, jumping, and a **determinism
  check** that the same state plus the same inputs lands in exactly the same
  place. That last one is load-bearing: if it fails, client prediction breaks.
- `protocol.test.ts` — input batch round-trip including quantisation.
- `arena.test.ts` — spawns face the middle of the map.
