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
- [x] Falling through solid builds *(Claude — the remaining case was a floor
      with a ramp under it: the ramp surface snap pulled a player who had just
      landed on the floor down through it onto the slope, which is every
      staircase in the game. See `restingOnBox` in `sim.ts`.)*
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

- [x] Weapon bloom: spread grows while moving, shrinks when still, smallest when
      stopped *(Claude — back at a gentler strength. The cone grows by at most
      70% of the weapon's own spread rather than tripling, and the crosshair is
      a readout of a few pixels rather than a projection of the world angle,
      which is what made the first version unusable. `bloom` is reconciled
      state, so the crosshair and the shot always agree.)*
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
- [x] Touch layout reworked so the HUD and the thumbs stop sharing space: the
      readouts run down the right edge from the top, the two thumb clusters own
      the bottom corners, and landscape gets its own compressed pass *(Claude)*
- [x] A tap on FIRE or JUMP can no longer fall between input ticks and be
      swallowed; a cancelled touch can no longer leave the stick stuck on
      *(Claude — both are things phones do constantly and neither was handled)*
- [x] Aim lock removed entirely *(Claude — the key, the chord, the touch
      button, the HUD badge, the button bit, the server-side `lockOn` and its
      test are all gone)*

## World and content

- [x] Map needs more verticality, and tighter spacing for faster matches
      *(Claude — re-authored. MAP_HALF 360 → 240 and the districts 156 → 108 m
      out, so the longest walk is ~30% shorter. Each district sits on its own
      plateau at a different height, with rolling hills between them and a
      central mesa. Buildings flatten a pad under themselves, which is what
      lets structures and real terrain coexist.)*
- [x] Cars in the map — proper sports cars *(Claude — 16 of them, built from
      primitives like everything else, solid cover you can climb onto. Their
      positions are checked against the building footprints at load, so a
      re-authored district cannot park one inside a wall.)*
- [x] Birds in the air; shooting one grants health *(Claude)*
- [x] Fish; shooting one grants a little health *(Claude — both in
      `shared/src/critters.ts`. Positions are a pure function of index and
      time, so nothing about them is networked except "this one is gone".)*
- [x] Climb and sit inside trees *(Claude)*
- [x] ADS inside a tree makes it translucent for you *(Claude)*
- [x] Shooting a tree strips leaves, making it translucent to others *(Claude)*
- [x] One shield block per match that reflects bullets *(Claude — its own build
      slot, free, one per match, 45 s lifetime, immune to bullets and broken by
      a pickaxe. It sends rounds back down their own path rather than
      mirroring off its normal; see the comment in `combat.ts` for why.)*

## Architecture

- [x] **Double the build grid size** so the world can be bigger and more
      detailed while the player stays the same size *(Claude — TILE is 6.0 m)*.

      What made the two earlier attempts fail was that the figure `3` was
      written out by hand in the map data and the renderer, and several tuned
      constants silently assumed a tile they could fit inside. Both were fixed
      before the number was changed:

      * every cell-to-metre conversion goes through `TILE` (the hard-coded
        `*3` in `map.ts` and `landscape.ts` is gone);
      * `MANTLE_REACH`, `MANTLE_SPEED`, `BUILD_RANGE`, `EDIT_RANGE` and
        `RAMP_STEPS` are all derived from `TILE`. `RAMP_STEPS` is the one that
        actually breaks the game if it is not: at a fixed 8 steps a 6 m ramp
        has 75 cm stairs, which is taller than `STEP_HEIGHT`, so every ramp
        becomes a wall;
      * the map was re-authored, because the old coordinates put the districts
        at ±420 m once the cell grew.

      Setting `TILE` back to `3.0` restores the old scale exactly.

      **The honest trade:** a bigger cell is a *coarser* cell. The world is
      larger and more imposing, but each cell holds half as much detail, so
      fine structure now has to come from props, cars and terrain rather than
      from the grid. That is the opposite of what "more intricate environments"
      asks for, and it is worth knowing before anyone doubles it again.

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

**The stairwell alternates columns.** `buildArena` puts each floor's ramp in a
different column from the one below (`stairCol`), because a ramp fills its cell
and the flight above was acting as a solid ceiling over the flight below --
a player wedged about two thirds of the way up every flight. Anything with more
than one floor therefore needs at least three cells of width, so the two stair
columns and the doorway column do not collide; `tests/navigation.test.ts`
checks that and climbs every flight of every building style.

**Wildlife is derived, not networked.** `shared/src/critters.ts` gives every
bird and fish a position as a pure function of (index, time). The server and
the client must evaluate it at the SAME instant or the thing you shoot at is
not the thing the server tests, so both use the lag-compensated render time
that remote players already use.

**Ramps and cones are multi-box now.** `pieceBoxes()` in `shared/src/build.ts`
returns every solid box for a piece; ramps decompose into stair steps sized to
the lower edge of each span so collision never sits above the visible slope,
and the surface snap in the movement solver lifts the player the last fraction.
Use `pieceBoxes()`, not `pieceBox()`, for anything collision-related.
