/**
 * The curated Kenney catalogue.
 *
 * Kept apart from build-assets.mjs because it is data, not process: adding art
 * to the game should be a line here and nothing else.
 *
 * Every kit on kenney.nl is CC0, and every kit is authored at roughly half a
 * metre to the unit -- a fridge measures 0.92, a dining table 0.33, a sofa
 * 0.98 across. Doubling puts all of them in the game's metres at once, which
 * is the same factor the hand-authored trees already use (1.71 -> 3.6), so one
 * constant covers the whole library instead of a fudge per model.
 */
export const KENNEY_SCALE = 2.0;

/** Where each kit keeps its GLBs. Tried in order; kits disagree. */
export const MODEL_DIRS = ['Models/GLB format', 'Models/GLTF format', 'Models'];

/**
 * id -> [kit, file] or [kit, file, axis, metres].
 *
 * The id is what the game asks for and is deliberately plain English: the
 * placement code reads better for saying `sofa` than `loungeSofa`, and it
 * means a model can be swapped for a different source file without touching
 * a single call site.
 *
 * The four-element form overrides the blanket doubling for models the kits
 * did not author to scale -- Kenney's beds are nearly four metres long and its
 * street lights come up to your chest. Rather than a magic multiplier, it
 * states the REAL dimension the thing has in the world and lets the build work
 * the factor out: `['y', 5.0]` on a street light is a fact anyone can check
 * against a street, and it stays correct if the source model is ever replaced.
 */
export const CATALOGUE = {
  // --- living rooms ---
  sofa: ['furniture-kit', 'loungeSofa'],
  sofa_long: ['furniture-kit', 'loungeSofaLong'],
  sofa_corner: ['furniture-kit', 'loungeSofaCorner'],
  armchair: ['furniture-kit', 'loungeChair'],
  armchair_relax: ['furniture-kit', 'loungeChairRelax'],
  coffee_table: ['furniture-kit', 'tableCoffee'],
  coffee_table_glass: ['furniture-kit', 'tableCoffeeGlass'],
  tv: ['furniture-kit', 'televisionModern'],
  tv_vintage: ['furniture-kit', 'televisionVintage'],
  tv_cabinet: ['furniture-kit', 'cabinetTelevision'],
  rug: ['furniture-kit', 'rugRectangle'],
  rug_round: ['furniture-kit', 'rugRound'],
  floor_lamp: ['furniture-kit', 'lampRoundFloor'],
  table_lamp: ['furniture-kit', 'lampSquareTable'],
  bookcase: ['furniture-kit', 'bookcaseOpen'],
  bookcase_closed: ['furniture-kit', 'bookcaseClosedDoors'],
  books: ['furniture-kit', 'books'],
  potted_plant: ['furniture-kit', 'pottedPlant'],
  plant_small: ['furniture-kit', 'plantSmall1'],
  speaker: ['furniture-kit', 'speaker'],
  radio: ['furniture-kit', 'radio'],

  // --- kitchens ---
  fridge: ['furniture-kit', 'kitchenFridge'],
  fridge_large: ['furniture-kit', 'kitchenFridgeLarge', 'y', 2.00],
  stove: ['furniture-kit', 'kitchenStove'],
  kitchen_sink: ['furniture-kit', 'kitchenSink'],
  cabinet: ['furniture-kit', 'kitchenCabinet'],
  cabinet_drawer: ['furniture-kit', 'kitchenCabinetDrawer'],
  cabinet_upper: ['furniture-kit', 'kitchenCabinetUpper'],
  kitchen_bar: ['furniture-kit', 'kitchenBar'],
  microwave: ['furniture-kit', 'kitchenMicrowave'],
  coffee_machine: ['furniture-kit', 'kitchenCoffeeMachine'],
  bar_stool: ['furniture-kit', 'stoolBar'],
  dining_table: ['furniture-kit', 'table'],
  round_table: ['furniture-kit', 'tableRound'],
  chair: ['furniture-kit', 'chair'],
  chair_cushion: ['furniture-kit', 'chairCushion'],
  bench_cushion: ['furniture-kit', 'benchCushion'],

  // --- bedrooms and bathrooms ---
  bed_double: ['furniture-kit', 'bedDouble', 'z', 2.05],
  bed_single: ['furniture-kit', 'bedSingle', 'z', 2.00],
  bed_bunk: ['furniture-kit', 'bedBunk', 'z', 2.00],
  nightstand: ['furniture-kit', 'sideTableDrawers'],
  coat_rack: ['furniture-kit', 'coatRackStanding'],
  bathtub: ['furniture-kit', 'bathtub', 'x', 1.75],
  toilet: ['furniture-kit', 'toilet', 'y', 0.78],
  bath_sink: ['furniture-kit', 'bathroomSink'],
  shower: ['furniture-kit', 'shower', 'y', 2.20],
  washer: ['furniture-kit', 'washer'],
  dryer: ['furniture-kit', 'dryer'],

  // --- desks, and the clutter that sells a room as lived in ---
  desk: ['furniture-kit', 'desk'],
  desk_chair: ['furniture-kit', 'chairDesk'],
  monitor: ['furniture-kit', 'computerScreen', 'x', 0.60],
  laptop: ['furniture-kit', 'laptop', 'x', 0.38],
  box_closed: ['furniture-kit', 'cardboardBoxClosed'],
  box_open: ['furniture-kit', 'cardboardBoxOpen'],
  trashcan: ['furniture-kit', 'trashcan', 'y', 1.00],
  ceiling_fan: ['furniture-kit', 'ceilingFan'],
  ceiling_lamp: ['furniture-kit', 'lampSquareCeiling'],

  // --- streets ---
  dumpster: ['retro-urban-kit', 'detail-dumpster-closed', 'x', 1.80],
  dumpster_open: ['retro-urban-kit', 'detail-dumpster-open', 'x', 1.80],
  street_bench: ['retro-urban-kit', 'detail-bench', 'x', 1.80],
  street_light: ['retro-urban-kit', 'detail-light-single', 'y', 5.00],
  street_light_double: ['retro-urban-kit', 'detail-light-double', 'y', 5.00],
  traffic_light: ['retro-urban-kit', 'detail-light-traffic', 'y', 3.40],
  barrier: ['retro-urban-kit', 'detail-barrier-type-a', 'x', 1.20],
  barrier_strong: ['retro-urban-kit', 'detail-barrier-strong-type-a'],
  pallet: ['retro-urban-kit', 'pallet', 'x', 1.20],
  pallet_small: ['retro-urban-kit', 'pallet-small'],
  planks: ['retro-urban-kit', 'planks'],
  awning: ['retro-urban-kit', 'detail-awning-small', 'x', 2.50],
  awning_wide: ['retro-urban-kit', 'detail-awning-wide'],
  scaffold: ['retro-urban-kit', 'scaffolding-structure'],
  parasol: ['city-kit-commercial', 'detail-parasol-a', 'y', 2.60],

  // --- yards, camps and the harbour ---
  barrel: ['survival-kit', 'barrel'],
  barrel_open: ['survival-kit', 'barrel-open'],
  crate_wood: ['survival-kit', 'box', 'x', 0.90],
  crate_large: ['survival-kit', 'box-large'],
  campfire: ['survival-kit', 'campfire-pit', 'x', 1.20],
  tent: ['survival-kit', 'tent', 'x', 2.50],
  chest: ['survival-kit', 'chest'],
  workbench: ['survival-kit', 'workbench', 'x', 1.60],
  signpost: ['survival-kit', 'signpost', 'y', 2.00],
  bucket: ['survival-kit', 'bucket'],
  log: ['survival-kit', 'tree-log'],
  stump: ['survival-kit', 'tree-trunk'],
  rock_a: ['survival-kit', 'rock-a'],
  rock_b: ['survival-kit', 'rock-b'],
  rock_c: ['survival-kit', 'rock-c'],

  // --- a graveyard to build a named location around ---
  gravestone: ['graveyard-kit', 'gravestone-bevel'],
  gravestone_cross: ['graveyard-kit', 'gravestone-cross'],
  gravestone_round: ['graveyard-kit', 'gravestone-round'],
  crypt: ['graveyard-kit', 'crypt-small', 'y', 3.20],
  iron_fence: ['graveyard-kit', 'iron-fence'],
  lamp_post: ['graveyard-kit', 'lightpost-single', 'y', 4.20],
  pumpkin: ['graveyard-kit', 'pumpkin'],
  dead_tree: ['graveyard-kit', 'trunk', 'y', 3.50],

};

/** Kits the catalogue draws on, for the credits file. */
export const KITS = [...new Set(Object.values(CATALOGUE).map(([kit]) => kit))].sort();
