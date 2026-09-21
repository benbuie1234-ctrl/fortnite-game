# Roadmap

Everything requested, captured so nothing gets lost. Two agents work in this
repo, so **claim an item here before starting it** — that is the only thing
stopping duplicated or conflicting work.

Status: `[ ]` open · `[~]` in progress · `[x]` done

---

## Physics and collision bugs

These make the game feel broken, so they come first.

- [x] Ramps have no solid collision — you walk through the sides
- [x] Sitting on a ramp drops you through it
- [x] Cones fill the whole block and can't be stood on
- [ ] Falling through solid builds (other cases)
- [x] Floor and ramp placed at the same spot don't line up in height *(Claude)*
- [x] Can't build in many open places in certain areas *(Claude)*
- [x] Climbing mechanic bugs *(Claude)*
- [x] Fall damage feels random — needs a readable curve *(Claude)*
- [x] Jumping backwards gives a speed boost — the accidental version is gone;
      it is now a deliberate mechanic, see Movement *(Claude)*
- [x] Camera glitches when walking into ramps *(Claude)*
- [x] Camera should only pull in when actually against a solid object *(Claude)*
- [x] ADS is glitchy with character movement *(Claude)*
- [x] Clouds visible at the edge of view when looking up *(Claude)*

## Combat feel

- [ ] Weapon bloom: spread grows while moving, shrinks when still, smallest when
      stopped. *Built, then removed at request: the cone tripled at its ceiling
      and dragged the crosshair with it, so both went back to the per-weapon
      values. Recover from git if it is wanted again, at a gentler strength.*
- [x] Inconsistent fire delay — sometimes present, sometimes not *(Claude)*
- [x] Bullet drop past a certain distance *(Claude)*
- [x] Damage falls off further out (tune existing falloff) *(Claude)*
- [x] Sniper vs materials: one-shot wood, ~99% brick, half metal *(ChatGPT, metal corrected by Claude — it was doing 30%, not half)*
- [x] Red directional vignette showing where damage came from *(Claude)*
- [x] Breaking blocks turn translucent as they break *(Claude)*
- [x] Don't show other players' health bars — damage numbers only *(Claude)*

## Movement

- [x] Sprinting *(ChatGPT)*
- [x] Sliding *(Claude — tiered: crouch to slide, sprint first to slide further)*
- [x] Crouching *(Claude)*
- [x] Sprint stamina, with a recovery delay *(Claude)*
- [x] Backwards in the AIR is fast, on the ground slow, so retreating rewards a
      jump rather than a strafe *(Claude)*
- [x] Crouching actually poses the character *(Claude)*
- [x] Scroll wheel cycles build pieces as well as weapons *(Claude)*
- [x] Scroll wheel weapon switching *(ChatGPT)*
- [x] Customisable key binds *(Claude)*
- [x] Touchpad / touch controls *(ChatGPT wired the handlers; Claude added the
      markup they bound to, which did not exist, plus the layout and
      `pointer-events` that made them reachable)*

## UI

- [x] FPS counter in the UI *(already present in #netstat)*
- [x] Health bar doesn't track health and shield proportionally *(Claude)*
- [x] Builds inventory is bugged *(Claude)*
- [x] Kills / wins leaderboard *(Claude)*
- [x] Online player list *(Claude)*
- [x] Nametags floating over characters — verified; health bar removed from them
- [x] Compass showing the direction incoming gunshots come from *(Claude)*
- [x] Real sniper scope when aiming *(Claude)*
- [x] Full touch playability: tappable weapon/build/material bars, latched aim
      and sprint, on-screen sprint, build, crouch, reload and scoreboard *(Claude)*
- [x] Cmd/Ctrl+M aim-assist dev toggle, with a permanent on-screen badge *(Claude)*

## World and content

- [ ] Map needs more verticality, and tighter spacing for faster matches
- [ ] Cars in the map — proper sports cars *(deferred by request)*
- [ ] Birds in the air; shooting one grants health *(deferred by request)*
- [ ] Fish; shooting one grants a little health *(deferred by request)*
- [x] Climb and sit inside trees *(Claude)*
- [x] ADS inside a tree makes it translucent for you *(Claude)*
- [x] Shooting a tree strips leaves, making it translucent to others *(Claude)*
- [ ] One shield block per match that reflects bullets *(deferred by request)*

## Architecture

- [ ] **Double the build grid size** so the world can be bigger and more
      detailed while the player stays the same size.
      *Attempted by ChatGPT and reverted twice — see `a47353c`, `b9bfc7b`,
      `c42d033`. Needs a plan before a third attempt: the grid size is baked
      into placement, collision, the packed piece key, the map data and every
      tuned constant, so it cannot be changed in one pass. Deferred by request.*

---

## Notes for whoever picks these up

**Movement basis changed.** `wishX`/`wishZ` in `shared/src/sim.ts` had their
strafe terms negated, so `moveX: 1` now travels −X. Any test written against
the old convention will appear to fail when the code is fine. Prefer testing
with forward motion, which is stable.

**A floor's surface is now its own cell line.** `pieceBox(SLOT_FLOOR)` returns
a slab that hangs BELOW `gy * TILE` instead of sitting on top of it, so the
walking surface is exactly `gy * TILE` — the same height a ramp in that cell
starts at and a ramp in the cell below ends at. Anything that assumed a floor
surface at `gy * TILE + PIECE_THICKNESS` needs updating; `placeMesh()` in
`client/src/render/pieces.ts` was the only renderer that did.

**Movement state grew.** `MovementState` now carries `crouch`, `sliding`,
`slideLockout`, `fallPeakY` and `lastFallHeight`. Build one with
`newMovementState()` rather than by hand — a missing `crouch` used to produce a
NaN capsule height and silently disable all collision. `crouch` is reconciled
through the snapshot (`self.stance`), so it must stay in sync on both sides.

**Fall damage reads height, not speed.** `fallDamage(height, impactSpeed)` in
`shared/src/sim.ts`. `lastLandingSpeed` still exists but now only drives the
landing sound and the camera dip.

**Mantling searches candidates.** `findLedge()` in `shared/src/sim.ts` collects
every distinct surface height in front of the player and tries them from the
lowest up, taking the first with headroom. It also requires the box to overlap
the player's capsule vertically, which is what stops a ceiling being climbed.
Reach is `MANTLE_REACH` — a full tile plus a margin — and it fires while
airborne as well as when blocked, which is what makes thin things (tree trunks)
climbable.

**Floors above ramps are one-way.** `World.collidersNear()` takes an optional
`feetY`; when the caller passes it, a floor whose cell sits directly above a
ramp is skipped for bodies below its surface. Pass `feetY` for players, leave it
out for anything that should treat the world as fully solid.

**Trees are climbable and fadeable.** `buildArena()` adds a branch platform
collider per tree sharing the trunk's key. `treeIndexFromKey()` maps a collider
back to its `SCENERY` index; the server emits `EV_FOLIAGE` with that index when
a tree is shot, and the client fades it through `Landscape.setTreeAlpha()`,
which drives a per-instance alpha attribute on the foliage material.

**Ramps and cones are multi-box now.** `pieceBoxes()` in `shared/src/build.ts`
returns every solid box for a piece; ramps decompose into stair steps sized to
the lower edge of each span so collision never sits above the visible slope,
and the surface snap in the movement solver lifts the player the last fraction.
Use `pieceBoxes()`, not `pieceBox()`, for anything collision-related.
