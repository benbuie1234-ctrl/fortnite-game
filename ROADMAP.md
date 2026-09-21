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
- [ ] Floor and ramp placed at the same spot don't line up in height
- [ ] Can't build in many open places in certain areas
- [ ] Climbing mechanic bugs
- [ ] Fall damage feels random — needs a readable curve
- [ ] Jumping backwards gives a speed boost
- [ ] Camera glitches when walking into ramps
- [ ] Camera should only pull in when actually against a solid object
- [ ] ADS is glitchy with character movement
- [ ] Clouds visible at the edge of view when looking up

## Combat feel

- [ ] Weapon bloom: spread grows while moving, shrinks when still, smallest when stopped
- [ ] Inconsistent fire delay — sometimes present, sometimes not
- [ ] Bullet drop past a certain distance
- [ ] Damage falls off further out (tune existing falloff)
- [x] Sniper vs materials: one-shot wood, ~99% brick, half metal *(ChatGPT)*
- [ ] Red directional vignette showing where damage came from
- [ ] Breaking blocks turn translucent as they break
- [ ] Don't show other players' health bars — damage numbers only

## Movement

- [x] Sprinting *(ChatGPT)*
- [ ] Sliding
- [ ] Crouching
- [x] Scroll wheel weapon switching *(ChatGPT)*
- [ ] Customisable key binds
- [x] Touchpad / touch controls *(ChatGPT)*

## UI

- [x] FPS counter in the UI
- [ ] Health bar doesn't track health and shield proportionally
- [ ] Builds inventory is bugged
- [ ] Kills / wins leaderboard
- [ ] Online player list
- [ ] Nametags floating over characters (verify existing)
- [ ] Compass showing the direction incoming gunshots come from

## World and content

- [ ] Map needs more verticality, and tighter spacing for faster matches
- [ ] Cars in the map — proper sports cars
- [ ] Birds in the air; shooting one grants health
- [ ] Fish; shooting one grants a little health
- [ ] Climb and sit inside trees
- [ ] ADS inside a tree makes it translucent for you
- [ ] Shooting a tree strips leaves, making it translucent to others
- [ ] One shield block per match that reflects bullets

## Architecture

- [ ] **Double the build grid size** so the world can be bigger and more
      detailed while the player stays the same size.
      *Attempted by ChatGPT and reverted twice — see `a47353c`, `b9bfc7b`,
      `c42d033`. Needs a plan before a third attempt: the grid size is baked
      into placement, collision, the packed piece key, the map data and every
      tuned constant, so it cannot be changed in one pass.*

---

## Notes for whoever picks these up

**Movement basis changed.** `wishX`/`wishZ` in `shared/src/sim.ts` had their
strafe terms negated, so `moveX: 1` now travels −X. Any test written against
the old convention will appear to fail when the code is fine. Prefer testing
with forward motion, which is stable.

**Ramps and cones are multi-box now.** `pieceBoxes()` in `shared/src/build.ts`
returns every solid box for a piece; ramps decompose into stair steps sized to
the lower edge of each span so collision never sits above the visible slope,
and the surface snap in the movement solver lifts the player the last fraction.
Use `pieceBoxes()`, not `pieceBox()`, for anything collision-related.
