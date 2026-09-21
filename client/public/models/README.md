# Drop 3D models here

The game works fine with nothing in this folder. Every model you add replaces
one of the built-in procedural shapes, so you can add art one piece at a time
and never break the build.

## Where to get free models

All three give you models you can use without paying or crediting anyone:

- **https://kenney.nl/assets** — public domain (CC0). The low-poly style
  matches this game closely. Look at "Nature Kit", "Survival Kit",
  "Blaster Kit".
- **https://quaternius.com** — free low-poly characters, weapons, buildings.
- **https://poly.pizza** — searchable, mostly CC0 and CC-BY.

Download a pack, and put the `.glb` files in this folder. If a pack only has
`.obj` or `.fbx`, open it in Blender and export as glTF (`.glb`) — or just
pick a different pack, most offer `.glb` directly.

## Then list them in manifest.json

Create `manifest.json` next to this file:

```json
{
  "models": {
    "tree": "tree_pine.glb",
    "rock": "rock_large.glb"
  },
  "scale": {
    "tree": 1.0
  },
  "offsetY": {
    "tree": 0
  }
}
```

Only `models` is required. Slots you leave out keep their built-in shape.

**`scale`** exists because free packs disagree wildly about units — one pack's
tree is 1 unit tall, another's is 100. If a model comes in comedically huge or
invisibly small, change its scale here rather than editing the file. One world
unit is one metre, and a player is 1.8 tall.

**`offsetY`** is for models whose origin sits at their centre instead of their
base, so they end up half-buried. Nudge them up here.

## Slots the game currently uses

| Slot | Used for | Status |
|---|---|---|
| `tree` | Every tree on the map | **wired up** |
| `rock` | Rocks and scattered props | not yet |
| `house` | Map buildings | not yet |
| `crate`, `barrel` | Props | not yet |
| `weapon_ar` and friends | The gun in your hands | not yet |

Adding a slot to this list is a few lines — ask and it gets wired.

## A note on size

The game is currently about 170 kB and loads in roughly a second. A reasonable
set of low-poly models adds a few MB, which is a few extra seconds on the first
visit and nothing afterwards because the browser caches them. That is a good
trade. Avoid photo-realistic packs with 4K textures — those run to hundreds of
megabytes and would wreck the thing that makes this game easy to share.
