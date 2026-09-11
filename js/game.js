/* ================================================================
   SLENDER: DEAD SIGNAL — game.js
   IIFE to avoid polluting the global scope. Comments explain the
   state management step by step.
   ================================================================ */
(function () {
  'use strict';

  /* ==============================================================
     [1] CONFIG — all balancing gathered in a single place
     ============================================================== */
  var CONFIG = {
    GRID: 5,                  // 5x5 grid
    TOTAL_PAGES: 8,           // pages needed to win
    TOTAL_BATTERIES: 5,       // recharge packs on the map
    BATTERY_START: 100,       // starting charge (%)
    BATTERY_DRAIN_MOVE: 1,    // drain per move (%) — there is NO background timer
    BATTERY_PICKUP: 20,       // recharge from one pack (%)

    // Static. The two headline values from the brief are kept (adjacent +25,
    // contact +50) in spirit, but a pure pursuer on a 5x5 makes adjacency
    // lethal too fast, so the ADJACENT figure was lowered and RECOVERY at
    // distance was added — calibrated by simulation for "hard but winnable".
    STATIC_SAME_CELL: 35,     // static when reached (same cell) — the scare stays brutal
    STATIC_ADJACENT: 7,       // static at 1 cell away
    STATIC_NEAR: -8,          // at 2 cells: relief (regain a breath)
    STATIC_DECAY: 18,         // strong recovery at 3+ cells

    LIGHT_RANGE: 1,           // radius (in cells) of the flashlight beam

    // Escalation: the double-step chance grows with pages collected.
    DOUBLE_STEP_PER_PAGE: 0.055, // + chance per page
    DOUBLE_STEP_MAX: 0.40,       // cap on the double-step chance

    // Fairness: the Entity "loses the trail" and stays put on some steps.
    ENTITY_MISS: 0.26,        // chance the Entity does NOT move on a given step

    // "Blink" (retreat into the shadows). A deterministic pursuer on a 5x5
    // sticks to you: once adjacent it mirrors your steps and static climbs
    // every turn until death — measured: 0% wins without this rule. So after
    // STALK_LIMIT turns glued to you (or once it reaches you) it vanishes from
    // frame and reappears far away. The chase stays relentless BETWEEN blinks;
    // the blink is the escape window that makes Hard Mode fair.
    STALK_LIMIT: 2,            // turns at 1 cell (or less) before the blink

    BATTERY_PICKUP: 24,        // recharge from one pack (%)
    MISSION_RECHARGE: 40,      // battery refilled at the start of each new sector (heavy drain in late sectors)

    // Run-level aggression: per sector already cleared this run, the Entity's
    // double-step cap rises and its miss-chance falls (kept mild — the per-sector
    // MISSIONS tuning is the main difficulty ramp).
    AGGRO_DOUBLE: 0.03,
    AGGRO_MISS: 0.015
  };

  /* ==============================================================
     [1b] PHASE 2 — MISSIONS
     The single 8-page run is split into 3 fast, continuous sectors.
     Each mission has its own environment, its own freshly-generated
     map (page/battery placement), and its own difficulty tuning that
     ramps threat, static and battery drain to keep the player in flow.
     ============================================================== */
  // Phase 3 — 5 escalating sectors. Difficulty is calculated as a smooth ramp
  // per sector: pages ↑, battery drain ↑, entityMiss ↓ (it appears / stays near
  // far more often), double-step cap ↑, and static costs ↑ — while distance
  // recovery ↓. Battery packs and MISSION_RECHARGE keep it just survivable with
  // the instant [RETRY SECTOR] flow. Each row also drives its scene + heartBpm.
  var MISSIONS = [
    { // Sector 1 — Warmup: slow Slender, calm
      env: 'moonwoods', name: 'MOONLIT PINE WOODS', pages: 2, batteries: 3,
      entityMiss: 0.46, doubleStepPerPage: 0.02, doubleStepMax: 0.10,
      staticSameCell: 30, staticAdjacent: 6, staticNear: -10, staticDecay: 24,
      batteryDrainMove: 0.8, stalkLimit: 2, heartBpm: 52, staticBurst: 0
    },
    { // Sector 2 — Escalation: pulse kicks in
      env: 'shack', name: 'THE ABANDONED SHACK', pages: 3, batteries: 3,
      entityMiss: 0.30, doubleStepPerPage: 0.04, doubleStepMax: 0.26,
      staticSameCell: 34, staticAdjacent: 8, staticNear: -8, staticDecay: 19,
      batteryDrainMove: 1.0, stalkLimit: 2, heartBpm: 70, staticBurst: 0
    },
    { // Sector 3 — Desperation: aggressive, frequent static bursts
      env: 'concrete', name: 'DESOLATE CONCRETE RUINS', pages: 3, batteries: 3,
      entityMiss: 0.20, doubleStepPerPage: 0.05, doubleStepMax: 0.38,
      staticSameCell: 38, staticAdjacent: 9, staticNear: -6, staticDecay: 15,
      batteryDrainMove: 1.5, stalkLimit: 2, heartBpm: 88, staticBurst: 5
    },
    { // Sector 4 — Frenzy: fast Slender, heavy shake
      env: 'industrial', name: 'FLOODED INDUSTRIAL CORRIDOR', pages: 4, batteries: 4,
      entityMiss: 0.18, doubleStepPerPage: 0.06, doubleStepMax: 0.44,
      staticSameCell: 40, staticAdjacent: 9, staticNear: -6, staticDecay: 15,
      batteryDrainMove: 2.0, stalkLimit: 2, heartBpm: 104, staticBurst: 4
    },
    { // Sector 5 — Nightmare: hyper-active, intense distortion (hard but winnable)
      env: 'nightmare', name: 'THE NIGHTMARE MONOLITH', pages: 5, batteries: 5,
      entityMiss: 0.15, doubleStepPerPage: 0.07, doubleStepMax: 0.52,
      staticSameCell: 42, staticAdjacent: 10, staticNear: -6, staticDecay: 14,
      batteryDrainMove: 2.5, stalkLimit: 2, heartBpm: 122, staticBurst: 3
    }
  ];
  var TOTAL_SECTORS = MISSIONS.length;

  /* Convenience accessor for the currently active mission's tuning. */
  function mission() { return MISSIONS[state ? state.missionIndex : 0]; }

  /* ==============================================================
     [2] STATE — single object describing the whole match
     ============================================================== */
  var state = null;

  /* Builds a fresh MISSION on the shared state. Battery persists across
     missions (only Mission 1 starts full); static, map and positions reset. */
  function newMission(missionIndex, carryBattery) {
    var size = CONFIG.GRID;
    var m = MISSIONS[missionIndex];
    var battery = (typeof carryBattery === 'number') ? carryBattery : CONFIG.BATTERY_START;

    state = {
      size: size,
      cells: [],
      player: { x: 0, y: 0 },        // player starts in corner (0,0) = (1,1) in the UI
      entity: { x: size - 1, y: size - 1 }, // Entity in the opposite corner (4,4) = (5,5)
      battery: battery,
      entryBattery: battery,         // battery at sector start (for [RETRY SECTOR])
      staticLevel: 0,
      pages: 0,                      // pages collected THIS mission
      pagesTarget: m.pages,          // pages needed to clear this mission
      totalPages: 0,                 // pages across the whole run (for the win screen)
      missionIndex: missionIndex,    // 0-based
      moves: 0,
      stalkTurns: 0,                 // consecutive turns with the Entity at dist<=1
      running: false,
      paused: false,
      over: false,
      runOver: false                 // true only when the whole 3-mission run ends
    };

    // 2.1 — empty cells
    for (var y = 0; y < size; y++) {
      var row = [];
      for (var x = 0; x < size; x++) row.push({ type: 'empty', scanned: false });
      state.cells.push(row);
    }

    // 2.2 — draw free positions (neither the player nor the Entity)
    var free = [];
    for (var yy = 0; yy < size; yy++) {
      for (var xx = 0; xx < size; xx++) {
        var isPlayer = (xx === state.player.x && yy === state.player.y);
        var isEntity = (xx === state.entity.x && yy === state.entity.y);
        if (!isPlayer && !isEntity) free.push({ x: xx, y: yy });
      }
    }
    shuffle(free);

    // 2.3 — distribute this mission's pages and battery packs on the fresh map
    var i, spot;
    for (i = 0; i < m.pages; i++)     { spot = free.pop(); state.cells[spot.y][spot.x].type = 'page'; }
    for (i = 0; i < m.batteries; i++) { spot = free.pop(); state.cells[spot.y][spot.x].type = 'battery'; }

    // 2.4 — light up what's under the flashlight at the start
    revealAround(state.player.x, state.player.y);
  }

  /* Carries the run-total pages forward when starting a later mission. */
  function newMissionKeepingTotals(missionIndex, carryBattery, totalSoFar) {
    newMission(missionIndex, carryBattery);
    state.totalPages = totalSoFar;
  }

  /* ==============================================================
     [3] UTILITIES
     ============================================================== */
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function chebyshev(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }
  function clamp(v, mn, mx) { return Math.min(mx, Math.max(mn, v)); }
  function inBounds(x, y) { return x >= 0 && y >= 0 && x < CONFIG.GRID && y < CONFIG.GRID; }

  /* Textual bearing player→entity (compass) — essential for skillful escape. */
  function bearingTo(fx, fy, tx, ty) {
    var dx = tx - fx, dy = ty - fy;
    var vert = dy < 0 ? 'NORTH' : (dy > 0 ? 'SOUTH' : '');
    var horiz = dx < 0 ? 'WEST' : (dx > 0 ? 'EAST' : '');
    if (vert && horiz) return vert + '-' + horiz;
    return vert || horiz || 'HERE';
  }
  function bearingArrow(b) {
    var m = { 'NORTH':'↑','SOUTH':'↓','WEST':'←','EAST':'→','NORTH-WEST':'↖','NORTH-EAST':'↗','SOUTH-WEST':'↙','SOUTH-EAST':'↘','HERE':'✖' };
    return m[b] || '•';
  }

  /* ==============================================================
     [4] DOM CACHE
     ============================================================== */
  var el = {
    tabs:  document.querySelectorAll('.tab'),
    views: { home:document.getElementById('view-home'), game:document.getElementById('view-game'), help:document.getElementById('view-help') },
    grid:  document.getElementById('grid'),
    monitor: document.getElementById('monitor'),
    statusline: document.getElementById('statusline'),
    log: document.getElementById('log'),
    coords: document.getElementById('tag-coords'),
    radar: document.getElementById('radar'),

    valBattery: document.getElementById('val-battery'),
    valStatic:  document.getElementById('val-static'),
    valPages:   document.getElementById('val-pages'),
    fillBattery:document.getElementById('fill-battery'),
    fillStatic: document.getElementById('fill-static'),
    fillPages:  document.getElementById('fill-pages'),
    pbBattery:  document.getElementById('pb-battery'),
    pbStatic:   document.getElementById('pb-static'),
    pbPages:    document.getElementById('pb-pages'),
    meterBattery: document.getElementById('meter-battery'),
    meterStatic:  document.getElementById('meter-static'),

    jumpscare: document.getElementById('jumpscare'),
    transition: document.getElementById('transition'),
    trTitle:  document.getElementById('tr-title'),
    trNext:   document.getElementById('tr-next'),
    overlay:  document.getElementById('overlay'),
    ovTitle:  document.getElementById('overlay-title'),
    ovDesc:   document.getElementById('overlay-desc'),
    ovStats:  document.getElementById('overlay-stats'),

    pads: document.querySelectorAll('.pad[data-dir]'),
    btnStart: document.getElementById('btn-start'),
    btnGameStart: document.getElementById('btn-game-start'),
    btnPause: document.getElementById('btn-pause'),
    btnSound: document.getElementById('btn-sound'),
    btnRestart: document.getElementById('btn-restart'),
    btnRetry:  document.getElementById('btn-retry'),
    btnOvHome: document.getElementById('btn-overlay-home'),
    btnToHelp: document.getElementById('btn-to-help'),
    btnHelpPlay: document.getElementById('btn-help-play')
  };

  var cellNodes = [];  // 25 reused divs (we don't rebuild the DOM every frame)

  function buildGrid() {
    el.grid.innerHTML = '';
    cellNodes = [];
    for (var y = 0; y < CONFIG.GRID; y++) {
      var rowNodes = [];
      for (var x = 0; x < CONFIG.GRID; x++) {
        var d = document.createElement('div');
        d.className = 'cell';
        d.setAttribute('role', 'gridcell');
        d.dataset.x = x; d.dataset.y = y;
        d.innerHTML = '<span class="icon" aria-hidden="true">░</span><span class="cell-label"></span>';
        el.grid.appendChild(d);
        rowNodes.push(d);
      }
      cellNodes.push(rowNodes);
    }
  }

  /* ==============================================================
     [4b] PHASE 2 — DYNAMIC SCENARIO SCENES
     Each scene is a self-contained inline SVG (no external assets, so
     it works offline and inside the artifact sandbox). changeEnvironment()
     swaps the art, retunes the ambient tokens (via data-env on <html>),
     and updates the on-screen sector label.
     ============================================================== */
  var SCENES = {
    // Sector 1 — MOONLIT PINE WOODS (bright, high-contrast, misty)
    moonwoods:
      '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">' +
        '<defs>' +
          '<linearGradient id="mwSky" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#3f6488"/><stop offset="0.6" stop-color="#5b7f9c"/><stop offset="1" stop-color="#8aa6b8"/></linearGradient>' +
          '<radialGradient id="mwMoon" cx="0.5" cy="0.5" r="0.5">' +
            '<stop offset="0" stop-color="#ffffff"/><stop offset="0.4" stop-color="#eef6ff"/><stop offset="1" stop-color="#8aa6b8" stop-opacity="0"/></radialGradient>' +
          '<filter id="fBlur"><feGaussianBlur stdDeviation="2.2"/></filter>' +
        '</defs>' +
        '<rect width="100" height="100" fill="url(#mwSky)"/>' +
        '<circle cx="68" cy="26" r="20" fill="url(#mwMoon)"/>' +          // moon glow
        '<circle cx="68" cy="26" r="8" fill="#f4f9ff"/>' +
        // dark pine silhouettes against the bright sky = high contrast
        '<g fill="#0f2230">' +
          '<polygon points="6,86 16,34 26,86"/><polygon points="26,90 40,28 54,90"/>' +
          '<polygon points="52,88 64,32 76,88"/><polygon points="74,90 88,36 100,90"/></g>' +
        '<g fill="#081521">' +
          '<polygon points="0,98 14,46 28,98"/><polygon points="46,98 62,42 78,98"/></g>' +
        // bright drifting mist
        '<g class="drift" filter="url(#fBlur)" fill="#dfeef5" opacity="0.22">' +
          '<ellipse cx="40" cy="74" rx="62" ry="8"/><ellipse cx="66" cy="86" rx="58" ry="10"/>' +
          '<ellipse cx="28" cy="92" rx="70" ry="9"/></g>' +
      '</svg>',

    // Sector 2 — THE ABANDONED SHACK (brighter, moonlight spilling through the door)
    shack:
      '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">' +
        '<defs>' +
          '<linearGradient id="sWall" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#4a3a24"/><stop offset="1" stop-color="#241a10"/></linearGradient>' +
          '<linearGradient id="sDoor" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#9fb3bd"/><stop offset="1" stop-color="#3f5560"/></linearGradient>' +
        '</defs>' +
        '<rect width="100" height="100" fill="url(#sWall)"/>' +
        '<g stroke="#63492c" stroke-width="0.7">' +                       // plank seams (lighter)
          '<line x1="8" y1="0" x2="8" y2="100"/><line x1="20" y1="0" x2="20" y2="100"/>' +
          '<line x1="80" y1="0" x2="80" y2="100"/><line x1="92" y1="0" x2="92" y2="100"/></g>' +
        '<g fill="#5a4326" opacity="0.5"><rect x="8" width="12" height="100"/><rect x="80" width="12" height="100"/></g>' +
        // bright doorway (moonlight) + light spill on the floor = high contrast
        '<polygon points="38,82 62,82 74,100 26,100" fill="#8194a0" opacity="0.28"/>' +
        '<rect x="39" y="24" width="22" height="58" fill="url(#sDoor)"/>' +
        '<rect x="39" y="24" width="22" height="58" fill="none" stroke="#c9d6dd" stroke-width="0.8"/>' +
        '<g stroke="#3a2c18" stroke-width="0.6"><line x1="0" y1="82" x2="100" y2="82"/><line x1="0" y1="91" x2="100" y2="91"/></g>' +
        '<g fill="#f2e6c4" opacity="0.35">' +                             // bright dust motes
          '<circle cx="30" cy="40" r="0.6"/><circle cx="70" cy="52" r="0.7"/><circle cx="50" cy="34" r="0.5"/>' +
          '<circle cx="64" cy="66" r="0.6"/><circle cx="34" cy="60" r="0.5"/></g>' +
      '</svg>',

    // Sector 3 — DESOLATE CONCRETE RUINS (grey, cracked, a hard shaft of light)
    concrete:
      '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">' +
        '<defs>' +
          '<linearGradient id="cSky" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#8a929a"/><stop offset="0.5" stop-color="#4c545b"/><stop offset="1" stop-color="#23282c"/></linearGradient>' +
        '</defs>' +
        '<rect width="100" height="100" fill="url(#cSky)"/>' +
        // broken ceiling with a bright shaft of daylight
        '<polygon points="40,0 60,0 74,100 26,100" fill="#c6cdd2" opacity="0.16"/>' +
        '<rect x="0" y="0" width="100" height="16" fill="#20252a"/>' +     // ceiling slab
        '<polygon points="42,0 58,0 55,16 45,16" fill="#3a4045"/>' +       // hole in ceiling
        // concrete pillars
        '<g fill="#2b3136" stroke="#565e66" stroke-width="0.6">' +
          '<rect x="10" y="16" width="12" height="84"/><rect x="78" y="16" width="12" height="84"/></g>' +
        '<g fill="#3a4147"><rect x="10" y="16" width="4" height="84"/><rect x="78" y="16" width="4" height="84"/></g>' +
        // rubble + rebar
        '<g fill="#31373c"><polygon points="0,92 18,86 30,100 0,100"/><polygon points="70,100 84,88 100,94 100,100"/></g>' +
        '<g stroke="#6b7178" stroke-width="0.5" opacity="0.8">' +
          '<line x1="72" y1="100" x2="78" y2="90"/><line x1="76" y1="100" x2="82" y2="92"/>' +
          '<line x1="18" y1="100" x2="24" y2="92"/></g>' +
        // cracks
        '<g stroke="#161a1d" stroke-width="0.6" fill="none"><path d="M50 16 L48 40 L54 58 L50 78"/><path d="M30 30 L36 50"/></g>' +
      '</svg>',

    // Sector 4 — FLOODED INDUSTRIAL CORRIDOR (perspective, pipes, a flickering lamp)
    industrial:
      '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">' +
        '<defs>' +
          '<radialGradient id="iLamp" cx="0.5" cy="0.5" r="0.5">' +
            '<stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#ffe08a" stop-opacity="0"/></radialGradient>' +
        '</defs>' +
        '<rect width="100" height="100" fill="#2b343a"/>' +
        // corridor perspective to a vanishing point
        '<polygon points="0,0 100,0 62,44 38,44" fill="#3c474e"/>' +      // ceiling
        '<polygon points="0,100 100,100 62,56 38,56" fill="#151b1f"/>' +   // floor (wet, dark)
        '<polygon points="0,0 0,100 38,56 38,44" fill="#222a2f"/>' +       // left wall
        '<polygon points="100,0 100,100 62,56 62,44" fill="#222a2f"/>' +   // right wall
        '<rect x="38" y="44" width="24" height="12" fill="#0c1113"/>' +    // dark far door
        // perspective seams
        '<g stroke="#4c575e" stroke-width="0.5">' +
          '<line x1="0" y1="0" x2="38" y2="44"/><line x1="100" y1="0" x2="62" y2="44"/>' +
          '<line x1="0" y1="100" x2="38" y2="56"/><line x1="100" y1="100" x2="62" y2="56"/></g>' +
        // pipes along the walls
        '<g stroke="#5b676e" stroke-width="1.6" fill="none">' +
          '<path d="M2 24 L36 47"/><path d="M98 24 L64 47"/><path d="M2 40 L37 52"/><path d="M98 40 L63 52"/></g>' +
        // wet-floor reflection streak
        '<polygon points="44,100 56,100 52,58 48,58" fill="#3a4a52" opacity="0.5"/>' +
        // flickering ceiling lamp (glowing) — the .drift class gives it life
        '<ellipse cx="50" cy="20" rx="16" ry="7" fill="url(#iLamp)" class="drift"/>' +
        '<rect x="44" y="17" width="12" height="3" rx="1" fill="#ffe9a8"/>' +
      '</svg>',

    // Sector 5 — THE NIGHTMARE MONOLITH (violent violet/red, distortion)
    nightmare:
      '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">' +
        '<defs>' +
          '<radialGradient id="nSky" cx="0.5" cy="0.62" r="0.7">' +
            '<stop offset="0" stop-color="#7a1230"/><stop offset="0.5" stop-color="#2a0d24"/><stop offset="1" stop-color="#0a0410"/></radialGradient>' +
          '<linearGradient id="nStone" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="#413a5e"/><stop offset="1" stop-color="#160f22"/></linearGradient>' +
          '<filter id="nB"><feGaussianBlur stdDeviation="0.5"/></filter>' +
        '</defs>' +
        '<rect width="100" height="100" fill="url(#nSky)"/>' +
        '<rect x="0" y="80" width="100" height="20" fill="#120616"/>' +
        '<line x1="0" y1="80" x2="100" y2="80" stroke="#4a1030" stroke-width="0.8"/>' +
        // jagged, distorted monolith
        '<path d="M41,82 L43,24 L48,14 L52,22 L50,40 L56,30 L58,82 Z" fill="url(#nStone)" stroke="#6a3a6a" stroke-width="0.8"/>' +
        // burning red runes
        '<g stroke="#ff3b3b" stroke-width="1.2" fill="none" opacity="0.95" filter="url(#nB)">' +
          '<polygon points="50,34 46,41 54,41"/><line x1="50" y1="45" x2="50" y2="58"/>' +
          '<circle cx="50" cy="64" r="2.6"/></g>' +
        // red static shards radiating from the stone
        '<g stroke="#ff2f2f" stroke-width="0.9" opacity="0.6">' +
          '<line x1="50" y1="20" x2="50" y2="4"/><line x1="44" y1="30" x2="30" y2="18"/>' +
          '<line x1="56" y1="30" x2="70" y2="18"/><line x1="42" y1="52" x2="24" y2="52"/>' +
          '<line x1="58" y1="52" x2="76" y2="52"/></g>' +
        // ground crack with red light
        '<path d="M50 82 L46 92 L52 100" stroke="#ff3b3b" stroke-width="0.8" fill="none" opacity="0.7"/>' +
      '</svg>'
  };

  // Human-readable sector names shown in the monitor tag
  var ENV_NAMES = {
    moonwoods: 'MOONLIT PINE WOODS', shack: 'ABANDONED SHACK', concrete: 'DESOLATE CONCRETE RUINS',
    industrial: 'FLOODED INDUSTRIAL CORRIDOR', nightmare: 'THE NIGHTMARE MONOLITH'
  };
  // stageLevel (1..5) → scene key. changeEnvironment(stageLevel) uses this map.
  var STAGE_ENV = [null, 'moonwoods', 'shack', 'concrete', 'industrial', 'nightmare'];
  var currentEnv = 'moonwoods';

  /* THE ENTITY — a VERY DARK 8-bit / pixel-art faceless silhouette.
     Built entirely from crisp-edged blocks and staircase polygons (no curves)
     for a deliberate low-res, dread-inducing look. The fill is near-black so it
     BLENDS into the dark tile / dark jumpscare backdrop — it only reads as a
     figure once you notice the outline. Chaotic, ASYMMETRICAL sharp tentacles
     rake outward from behind its back at uneven lengths and angles.
     Drawn once and reused for both the grid marker (CSS background) and the
     full-screen jumpscare; the red aura/backlight is added in CSS (drop-shadow),
     never baked into the art, so the silhouette itself stays pitch-dark. */
  var SLENDER_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48" shape-rendering="crispEdges">' +
      // TENTACLES — drawn first so they sit BEHIND the body. Pure black, jagged,
      // sharp-tipped, and intentionally asymmetric (different sides, lengths, angles).
      '<g fill="#050506">' +
        '<polygon points="10,14 12,13 6,9 7,5 2,1 3,7 8,12"/>' +      // long spike, upper-left
        '<polygon points="9,20 12,20 3,20 0,23 4,22 9,22"/>' +        // low reach, hard left
        '<polygon points="22,15 20,13 27,8 26,3 31,1 28,8 22,13"/>' + // long spike, upper-right
        '<polygon points="22,24 20,22 29,26 32,32 27,28 21,25"/>' +   // heavy droop, lower-right
        '<polygon points="15,13 18,13 17,5 16,0 14,6 14,13"/>' +      // thin blade straight up
        '<polygon points="12,31 14,30 7,35 3,39 8,34 12,32"/>' +      // stray whip, lower-left
      '</g>' +
      // BODY — faceless, suited, unnaturally tall. Blocky near-black pixels.
      '<g fill="#0b0c11">' +
        '<rect x="13" y="5"  width="6"  height="7"/>' +   // head, no face
        '<rect x="9"  y="12" width="14" height="3"/>' +   // shoulders (wide)
        '<rect x="11" y="15" width="10" height="15"/>' +  // torso
        '<rect x="8"  y="13" width="2"  height="21"/>' +  // long left arm
        '<rect x="22" y="13" width="2"  height="19"/>' +  // long right arm
        '<rect x="8"  y="34" width="3"  height="2"/>' +   // left hand
        '<rect x="21" y="32" width="3"  height="2"/>' +   // right hand
        '<rect x="12" y="30" width="3"  height="16"/>' +  // left leg
        '<rect x="17" y="30" width="3"  height="16"/>' +  // right leg
      '</g>' +
      // SUIT DETAIL — a barely-there dark-crimson tie, only caught in bright light
      '<rect x="15" y="15" width="2" height="9" fill="#16060a"/>' +
    '</svg>';
  var SLENDER_URI = 'data:image/svg+xml,' + encodeURIComponent(SLENDER_SVG);

  /* changeEnvironment(stageLevel)
     Accepts either a stage number 1..5 (mapped through STAGE_ENV) or a scene
     key string. Swaps the scene art, retunes the ambient tokens (via data-env
     on <html> → brighter wash / border glow / UI accent per stage), and updates
     the on-screen sector label. */
  function changeEnvironment(stageLevel) {
    var key = (typeof stageLevel === 'number') ? STAGE_ENV[stageLevel] : stageLevel;
    if (!SCENES[key]) key = 'moonwoods';
    currentEnv = key;
    var art = document.getElementById('scene-art');
    if (art) art.innerHTML = SCENES[key];
    document.documentElement.setAttribute('data-env', key);   // retunes --env-* tokens
    var lbl = document.getElementById('tag-env');
    if (lbl) lbl.textContent = ENV_NAMES[key] || key.toUpperCase();
  }
  // expose for console/testing and the mission logic
  window.changeEnvironment = changeEnvironment;

  /* ==============================================================
     [5] NAVIGATION BETWEEN THE 3 VIEWS
     ============================================================== */
  function showView(name) {
    Object.keys(el.views).forEach(function (k) { el.views[k].hidden = (k !== name); });
    Array.prototype.forEach.call(el.tabs, function (t) { t.setAttribute('aria-selected', String(t.dataset.view === name)); });

    window.scrollTo(0, 0);
    try { el.views[name].focus({ preventScroll: true }); } catch (e) { el.views[name].focus(); }

    // Leaving the game tab pauses the match
    if (name !== 'game' && state && state.running && !state.paused) togglePause(true);
    // The static is a monitor effect: it disappears outside the game tab
    document.documentElement.style.setProperty('--static-level',
      name === 'game' && state && !state.over ? (state.staticLevel / 100).toFixed(2) : '0');
  }
  Array.prototype.forEach.call(el.tabs, function (t) {
    t.addEventListener('click', function () { showView(t.dataset.view); });
  });

  /* ==============================================================
     [6] RENDERING
     ============================================================== */
  function revealAround(cx, cy) {
    var r = CONFIG.LIGHT_RANGE;
    for (var y = cy - r; y <= cy + r; y++)
      for (var x = cx - r; x <= cx + r; x++)
        if (inBounds(x, y)) state.cells[y][x].scanned = true;
  }

  function renderGrid() {
    var px = state.player.x, py = state.player.y;
    var eDist = chebyshev(px, py, state.entity.x, state.entity.y);

    for (var y = 0; y < CONFIG.GRID; y++) {
      for (var x = 0; x < CONFIG.GRID; x++) {
        var cell = state.cells[y][x];
        var node = cellNodes[y][x];
        var icon = node.querySelector('.icon');
        var label = node.querySelector('.cell-label');

        var isPlayer = (x === px && y === py);
        var isLit = chebyshev(x, y, px, py) <= CONFIG.LIGHT_RANGE;
        // The Entity is only drawn when it's within the beam (dist <= 1)
        var isEntity = (x === state.entity.x && y === state.entity.y && eDist <= 1);

        node.className = 'cell'
          + (cell.scanned ? ' is-scanned' : '')
          + (isLit ? ' is-lit' : '')
          + (isPlayer ? ' is-player' : '')
          + (isEntity ? ' is-entity' : '')
          + (cell.type === 'page' && cell.scanned ? ' has-page' : '')
          + (cell.type === 'battery' && cell.scanned ? ' has-batt' : '');

        // RADAR TILE STATES — never colour-alone: each carries a text label + aria.
        var glyph = '░', text = '', aria = 'unscanned';
        if (isEntity)            { glyph = '';  text = 'DANGER'; aria = 'DANGER — entity present'; }  // dark silhouette drawn via CSS
        else if (isPlayer)       { glyph = '◉'; text = 'YOU';    aria = 'your position'; }
        else if (cell.scanned) {
          if (cell.type === 'page')        { glyph = '📄'; text = 'PAGE';    aria = 'journal page'; }
          else if (cell.type === 'battery'){ glyph = '🔋'; text = 'BATTERY'; aria = 'battery pack'; }
          else                             { glyph = '·';  text = 'CLEAR';   aria = 'clear'; }
        }
        icon.textContent = glyph;
        label.textContent = text;
        node.setAttribute('aria-label', 'Column ' + (x + 1) + ', row ' + (y + 1) + ': ' + aria);
      }
    }
    el.coords.textContent = 'POS ' + (px + 1) + '-' + (py + 1);
  }

  function renderHUD() {
    var bat = Math.round(state.battery), sta = Math.round(state.staticLevel);
    el.valBattery.textContent = bat + '%';
    el.valStatic.textContent  = sta + '%';
    var tgt = state.pagesTarget || CONFIG.TOTAL_PAGES;
    el.valPages.textContent   = state.pages + ' / ' + tgt;
    el.fillBattery.style.width = bat + '%';
    el.fillStatic.style.width  = sta + '%';
    el.fillPages.style.width   = (state.pages / tgt * 100) + '%';
    el.pbBattery.setAttribute('aria-valuenow', bat);
    el.pbStatic.setAttribute('aria-valuenow', sta);
    el.pbPages.setAttribute('aria-valuemax', tgt);
    el.pbPages.setAttribute('aria-valuenow', state.pages);
    el.meterBattery.classList.toggle('is-critical', bat <= 20);
    el.meterStatic.classList.toggle('is-critical', sta >= 60);
    document.documentElement.style.setProperty('--static-level', (sta / 100).toFixed(2));
  }

  function setStatus(msg, level) {
    el.statusline.textContent = msg;
    el.statusline.className = 'statusline' + (level ? ' lv-' + level : '');
  }
  function setRadar(text, level) {
    el.radar.textContent = text;
    el.radar.className = 'pad-core' + (level ? ' lv-' + level : '');
  }
  function addLog(msg, level) {
    var li = document.createElement('li');
    li.textContent = msg;
    if (level) li.className = 'lv-' + level;
    el.log.appendChild(li);
    while (el.log.children.length > 30) el.log.removeChild(el.log.firstChild);
    el.log.scrollTop = el.log.scrollHeight;
  }

  /* Screen-shake on the monitor. hard=true for the contact scare. */
  function shake(hard) {
    el.monitor.classList.remove('is-shaking', 'hard');
    void el.monitor.offsetWidth; // restart the animation
    el.monitor.classList.add('is-shaking');
    if (hard) el.monitor.classList.add('hard');
    setTimeout(function () { el.monitor.classList.remove('is-shaking', 'hard'); }, hard ? 520 : 420);
  }

  /* Jumpscare: the payoff of the DANGER tile. When the Entity shares the
     player's cell (see resolveProximity → the caught/dist===0 branch, which
     is what fires this), the pitch-dark pixel silhouette lunges full-screen,
     backlit by a red aura, with a hard flash + shake + distorted audio. */
  function jumpscare() {
    el.jumpscare.hidden = false;
    el.jumpscare.classList.remove('flash'); void el.jumpscare.offsetWidth; el.jumpscare.classList.add('flash');
    shake(true);
    beep(70, 320, 'sawtooth'); setTimeout(function(){ beep(48, 260, 'sawtooth'); }, 60); noiseBurst(1);
    setTimeout(function () { el.jumpscare.hidden = true; el.jumpscare.classList.remove('flash'); }, 560);
  }

  /* ==============================================================
     [7] AUDIO — pure WebAudio, no external files
     ============================================================== */
  var audio = { ctx: null, on: false };
  function ensureAudio() {
    if (!audio.ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) audio.ctx = new AC(); }
    if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  }
  function beep(freq, ms, type) {
    if (!audio.on || !audio.ctx) return;
    var o = audio.ctx.createOscillator(), g = audio.ctx.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.09, audio.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.ctx.currentTime + ms / 1000);
    o.connect(g); g.connect(audio.ctx.destination);
    o.start(); o.stop(audio.ctx.currentTime + ms / 1000);
  }
  function noiseBurst(intensity) {
    if (!audio.on || !audio.ctx || intensity <= 0) return;
    var len = Math.floor(audio.ctx.sampleRate * 0.18);
    var buf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * intensity;
    var src = audio.ctx.createBufferSource(), g = audio.ctx.createGain();
    g.gain.value = 0.14; src.buffer = buf; src.connect(g); g.connect(audio.ctx.destination); src.start();
  }
  el.btnSound.addEventListener('click', function () {
    audio.on = !audio.on;
    if (audio.on) ensureAudio();
    el.btnSound.textContent = audio.on ? '🔊 Sound: On' : '🔇 Sound: Off';
    el.btnSound.setAttribute('aria-pressed', String(audio.on));
  });

  /* ---- Dynamic heartbeat (Section D) --------------------------------
     A low "lub-dub" whose tempo rises with the mission AND with the live
     static level, so the pulse races as the Entity closes in. Self-scheduling:
     it only sounds while a mission is running, unpaused and sound is on. */
  var heart = { timer: null };
  function heartThump(vol) {
    if (!audio.on || !audio.ctx) return;
    var t = audio.ctx.currentTime;
    var o = audio.ctx.createOscillator(), g = audio.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(64, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.16);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.20);
    o.connect(g); g.connect(audio.ctx.destination);
    o.start(t); o.stop(t + 0.22);
  }
  function heartbeatTick() {
    if (audio.on && state && state.running && !state.paused && !state.over) {
      var m = mission();
      // tempo: mission base + up to +70 bpm as static climbs to 100%
      var bpm = m.heartBpm + Math.min(70, state.staticLevel * 0.7);
      var interval = 60000 / bpm;
      heartThump(0.18);
      setTimeout(function () { heartThump(0.12); }, Math.min(230, interval * 0.26));  // the "dub"
      scheduleHeart(interval);
    } else {
      scheduleHeart(700);   // idle: check back soon, silent
    }
  }
  function scheduleHeart(ms) { clearTimeout(heart.timer); heart.timer = setTimeout(heartbeatTick, ms); }
  function startHeartbeat() { scheduleHeart(400); }

  /* ==============================================================
     [8] LIFECYCLE
     ============================================================== */
  var pendingTransition = null;   // timer id for the between-mission glitch screen

  /* Begin a fresh 3-mission run from Mission 1 with a full battery. */
  function startRun() {
    if (pendingTransition) { clearTimeout(pendingTransition); pendingTransition = null; }
    el.log.innerHTML = '';
    hideTransition();
    startMission(0, CONFIG.BATTERY_START, 0);
    showView('game');
    ensureAudio(); beep(660, 90);
    addLog('[SYSTEM] Operation "Dead Signal" — ' + TOTAL_SECTORS + ' sectors. Recover every page.');
  }

  /* Section C — [RETRY SECTOR]: instantly restart the CURRENT mission with the
     battery you entered it with and the pages you had banked before it. Keeps
     the player in flow — a death costs the sector, not the whole run. Fires in
     well under a second (a brief glitch flash, no 2s transition). */
  function retrySector() {
    if (!state) return;
    var idx = state.missionIndex;
    var battery = state.entryBattery;   // charge at the time this sector began
    var total = state.totalPages;       // pages banked before this sector
    el.overlay.hidden = true; el.overlay.className = 'overlay';
    // quick retry cue
    flashMonitor(); beep(300, 120); noiseBurst(0.4);
    startMission(idx, battery, total);
    showView('game');
    addLog('[RETRY] ↻ Sector ' + (idx + 1) + ' restarted.');
  }

  /* Sub-second red flash used by the retry cue. */
  function flashMonitor() {
    shake(false);
    el.monitor.style.transition = 'none';
    el.monitor.style.boxShadow = '0 0 40px rgba(255,51,51,.6), inset 0 0 60px rgba(255,51,51,.4)';
    setTimeout(function () { el.monitor.style.transition = ''; el.monitor.style.boxShadow = ''; }, 180);
  }

  /* Build and start a single mission (fresh map + environment). */
  function startMission(missionIndex, carryBattery, totalSoFar) {
    var m = MISSIONS[missionIndex];
    newMissionKeepingTotals(missionIndex, carryBattery, totalSoFar || 0);
    buildGrid();
    el.overlay.hidden = true; el.overlay.className = 'overlay';
    el.jumpscare.hidden = true;

    state.running = true; state.paused = false;
    el.btnPause.disabled = false; el.btnPause.textContent = '⏸ Pause';
    setPadsEnabled(true);

    changeEnvironment(missionIndex + 1);      // stageLevel 1..5 → scene + ambient
    updateMissionTag();
    renderGrid(); renderHUD();
    setStatus('[SECTOR ' + (missionIndex + 1) + '] 📡 ' + m.name + ' — recover ' + m.pages + ' page' + (m.pages > 1 ? 's' : '') + '.', null);
    setRadar('NO CONTACT', null);
    addLog('[SECTOR ' + (missionIndex + 1) + '/' + TOTAL_SECTORS + '] ' + m.name + ' · target ' + m.pages + ' pages.');
    beep(560 + missionIndex * 120, 90);
  }

  /* A mission's page target has been met. */
  function completeMission() {
    state.running = false;
    setPadsEnabled(false);
    var carry = clamp(state.battery + CONFIG.MISSION_RECHARGE, 0, 100);  // checkpoint recharge
    var total = state.totalPages + state.pages;
    var nextIndex = state.missionIndex + 1;

    if (nextIndex >= MISSIONS.length) {
      // Whole operation cleared → run victory
      state.totalPages = total;
      return endRun(true, 'ALL SECTORS CLEARED');
    }
    // Seamless 2s glitch transition, then auto-start the next mission (no reload)
    addLog('[SECTOR ' + (state.missionIndex + 1) + '/' + TOTAL_SECTORS + '] ✓ Cleared. Recharge +' + CONFIG.MISSION_RECHARGE + '%.');
    beep(880, 140); setTimeout(function () { beep(1040, 180); }, 150);
    showTransition(nextIndex, function () {
      startMission(nextIndex, carry, total);
    });
  }

  function togglePause(force) {
    if (!state || !state.running || state.over) return;
    state.paused = (typeof force === 'boolean') ? force : !state.paused;
    el.btnPause.textContent = state.paused ? '▶ Resume' : '⏸ Pause';
    setPadsEnabled(!state.paused);
    if (state.paused) setStatus('[PAUSED] ⏸ Watch suspended. Press P to resume.', 'warn');
    else setStatus('[OK] 📡 Watch resumed.', null);
  }
  function setPadsEnabled(on) { Array.prototype.forEach.call(el.pads, function (p) { p.disabled = !on; }); }

  /* Updates the mission chip in the monitor tag. */
  function updateMissionTag() {
    var t = document.getElementById('tag-mission');
    if (t) t.textContent = 'S' + (state.missionIndex + 1) + '/' + TOTAL_SECTORS;
  }

  /* ==============================================================
     [8b] SEAMLESS SECTOR TRANSITION (1.5s glitch overlay)
     ============================================================== */
  function showTransition(nextIndex, done) {
    var next = MISSIONS[nextIndex];
    var title = '[SECTOR ' + (state.missionIndex + 1) + '/' + TOTAL_SECTORS + ' CLEARED]';
    el.trTitle.textContent = title;
    el.trTitle.setAttribute('data-text', title);   // feeds the RGB-split glitch layers
    el.trNext.textContent = 'ENTERING HIGHER THREAT ZONE ▸ ' + next.name;
    el.transition.hidden = false;
    el.transition.classList.add('is-on');
    noiseBurst(0.8); beep(120, 260, 'sawtooth'); setTimeout(function(){ beep(90, 200, 'sawtooth'); }, 120);
    // hold the glitch ~1.5s, then hand off to the next sector
    pendingTransition = setTimeout(function () {
      hideTransition();
      pendingTransition = null;
      if (typeof done === 'function') done();
    }, 1500);
  }
  function hideTransition() {
    el.transition.hidden = true;
    el.transition.classList.remove('is-on');
  }

  function togglePause(force) {
    if (!state || !state.running || state.over) return;
    state.paused = (typeof force === 'boolean') ? force : !state.paused;
    el.btnPause.textContent = state.paused ? '▶ Resume' : '⏸ Pause';
    setPadsEnabled(!state.paused);
    if (state.paused) setStatus('[PAUSED] ⏸ Watch suspended. Press P to resume.', 'warn');
    else setStatus('[OK] 📡 Watch resumed.', null);
  }
  function setPadsEnabled(on) { Array.prototype.forEach.call(el.pads, function (p) { p.disabled = !on; }); }

  /* ==============================================================
     [9] PLAYER MOVEMENT — the heart of the core loop
     ============================================================== */
  var DIRS = {
    up:    { dx: 0,  dy: -1, name: 'north' },
    down:  { dx: 0,  dy:  1, name: 'south' },
    left:  { dx: -1, dy:  0, name: 'west' },
    right: { dx: 1,  dy:  0, name: 'east' }
  };

  function move(dirKey) {
    if (!state || !state.running || state.paused || state.over) return;
    var d = DIRS[dirKey]; if (!d) return;

    var nx = state.player.x + d.dx, ny = state.player.y + d.dy;

    // 9.1 — A move blocked at the edge does NOT count as a step:
    //       it costs no battery and the Entity does NOT move.
    if (!inBounds(nx, ny)) {
      setStatus('[BLOCKED] 🚧 Edge of the scan area to the ' + d.name + '. (does not count as a step)', 'warn');
      beep(120, 70, 'triangle');
      return;
    }

    var m = mission();

    // 9.2 — valid step (battery drain scales per mission)
    state.player.x = nx; state.player.y = ny;
    state.moves++;
    state.battery = clamp(state.battery - m.batteryDrainMove, 0, 100);

    // 9.3 — the flashlight reveals the surroundings
    revealAround(nx, ny);

    // 9.4 — contents of the stepped-on cell
    var cell = state.cells[ny][nx];
    if (cell.type === 'page') {
      cell.type = 'empty'; state.pages++;
      addLog('[COLLECT] 📄 Page ' + state.pages + ' of ' + m.pages + ' this sector.');
      beep(880, 120);
    } else if (cell.type === 'battery') {
      cell.type = 'empty';
      state.battery = clamp(state.battery + CONFIG.BATTERY_PICKUP, 0, 100);
      addLog('[COLLECT] 🔋 Battery pack: +' + CONFIG.BATTERY_PICKUP + '% charge.');
      beep(520, 120);
    }

    // 9.5 — MISSION CLEARED when this sector's page target is met (before the Entity reacts)
    if (state.pages >= state.pagesTarget) { renderGrid(); renderHUD(); return completeMission(); }

    // 9.6 — the Entity reacts by pursuing
    var caught = moveEntity();

    // 9.7 — proximity → static + alert
    resolveProximity(caught);

    // 9.7b — Sector static bursts (mid/late sectors): random interference spikes
    if (m.staticBurst > 0 && Math.random() * 100 < m.staticBurst) {
      state.staticLevel = clamp(state.staticLevel + 5, 0, 100);
      shake(false); noiseBurst(0.55); beep(90, 90, 'sawtooth');
      addLog('[INTERFERENCE] 〜 Static burst +5%.', 'warn');
    }

    renderGrid(); renderHUD();

    // 9.8 — loss conditions
    if (state.staticLevel >= 100) return endRun(false, 'SIGNAL CONSUMED BY STATIC');
    if (state.battery <= 0)       return endRun(false, 'BATTERY DEPLETED');
  }

  /* Entity AI: deterministic pursuit.
     Returns true if it reached the player (contact) this turn. */
  function moveEntity() {
    var m = mission();
    // Section C — the Entity grows more aggressive with each sector already
    // cleared this run: its double-step cap rises and it loses the trail less.
    var cleared = state.missionIndex;                        // 0,1,2 sectors behind you
    var doubleMax = Math.min(0.72, m.doubleStepMax + cleared * CONFIG.AGGRO_DOUBLE);
    var missChance = Math.max(0.08, m.entityMiss - cleared * CONFIG.AGGRO_MISS);

    // 9a — Escalation: the double-step chance grows with pages collected (aggro-scaled cap).
    var doubleChance = Math.min(doubleMax, state.pages * m.doubleStepPerPage + cleared * 0.05);
    var steps = 1 + (Math.random() < doubleChance ? 1 : 0);

    var caught = false;
    for (var s = 0; s < steps; s++) {
      // 9b — Fairness: sometimes it loses the trail and doesn't move this step.
      if (Math.random() < missChance) continue;

      stepEntityToward();

      if (state.entity.x === state.player.x && state.entity.y === state.player.y) {
        caught = true;
        break; // reached you: no point continuing the double step
      }
    }
    return caught;
  }

  /* One Entity step toward the player (orthogonal, greedy). */
  function stepEntityToward() {
    var e = state.entity, p = state.player;
    var dx = p.x - e.x, dy = p.y - e.y;

    // Pick the axis with the larger difference; tie → random.
    var horizontalFirst;
    if (Math.abs(dx) > Math.abs(dy)) horizontalFirst = true;
    else if (Math.abs(dy) > Math.abs(dx)) horizontalFirst = false;
    else horizontalFirst = (Math.random() < 0.5);

    var stepX = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
    var stepY = dy === 0 ? 0 : (dy > 0 ? 1 : -1);

    if (horizontalFirst && stepX !== 0)      e.x += stepX;
    else if (!horizontalFirst && stepY !== 0) e.y += stepY;
    else if (stepX !== 0)                     e.x += stepX;
    else if (stepY !== 0)                     e.y += stepY;
  }

  /* Distance to the Entity → static + message (with bearing and effects). */
  function resolveProximity(caught) {
    var m = mission();
    var p = state.player, e = state.entity;
    var dist = chebyshev(p.x, p.y, e.x, e.y);
    var b = bearingTo(p.x, p.y, e.x, e.y);
    var arrow = bearingArrow(b);

    if (caught || dist === 0) {
      state.staticLevel += m.staticSameCell;
      setStatus('[CONTACT] ⚠️ IT REACHED YOU! Static +' + m.staticSameCell + '%', 'danger');
      addLog('[CONTACT] ⚠️ The Entity reached your cell.', 'danger');
      setRadar('✖ CONTACT', 'danger');
      jumpscare();   // JUMPSCARE TILE TRIGGER: Entity occupies the player's tile
    } else if (dist === 1) {
      state.staticLevel += m.staticAdjacent;
      setStatus('[ALERT] ⚠️ It is 1 cell to the ' + b + ' ' + arrow + ' — flee the opposite way! Static +' + m.staticAdjacent + '%', 'danger');
      addLog('[ALERT] ⚠️ Entity 1 cell to the ' + b + ' ' + arrow, 'danger');
      setRadar(arrow + ' ' + b, 'danger');
      shake(false); noiseBurst(0.5); beep(140, 130, 'sawtooth');
    } else if (dist === 2) {
      state.staticLevel += m.staticNear;   // negative: slight relief
      setStatus('[WARNING] 〜 Unstable signal to the ' + b + ' ' + arrow + ' — 2 cells. Static ' + m.staticNear + '%', 'warn');
      setRadar(arrow + ' ' + b, 'warn');
      noiseBurst(0.2);
    } else {
      state.staticLevel -= m.staticDecay;
      setStatus('[OK] ✓ Clear signal. ' + state.pages + ' of ' + m.pages + ' pages · Battery ' + Math.round(state.battery) + '%', null);
      setRadar('NO CONTACT', null);
    }

    // --- BLINK (retreat into the shadows) ---
    // Count glued turns; on reaching you or passing the limit, it vanishes and returns far away.
    if (dist <= 1) state.stalkTurns++; else state.stalkTurns = 0;
    if (caught || dist === 0 || state.stalkTurns >= m.stalkLimit) {
      // It always blinks back to a fair distance; late-sector pressure comes from
      // its much lower miss-chance (it moves toward you nearly every turn), not
      // from spawning on top of you — that only created an unwinnable static spiral.
      relocateEntity(3);
      state.stalkTurns = 0;
      addLog('[SIGNAL] 📡 It slipped into the shadows... and reappeared in another sector.', 'warn');
      if (!caught) setRadar('RETREAT', 'warn');
    }

    state.staticLevel = clamp(state.staticLevel, 0, 100);
  }

  /* Teleport the Entity to a cell far from the player (the "blink"). */
  function relocateEntity(minDist) {
    var spots = [];
    for (var y = 0; y < CONFIG.GRID; y++)
      for (var x = 0; x < CONFIG.GRID; x++)
        if (chebyshev(x, y, state.player.x, state.player.y) >= minDist) spots.push({ x: x, y: y });
    if (!spots.length) return relocateEntity(minDist - 1); // fallback for player in the center
    var pick = spots[(Math.random() * spots.length) | 0];
    state.entity.x = pick.x; state.entity.y = pick.y;
  }

  /* ==============================================================
     [10] END OF MATCH
     ============================================================== */
  /* Ends the whole run (win = all 3 sectors cleared; lose = died in a sector).
     On a loss, the death sector is remembered so [RETRY SECTOR] (Section C)
     can restart just that mission. */
  function endRun(won, reason) {
    if (pendingTransition) { clearTimeout(pendingTransition); pendingTransition = null; }
    hideTransition();
    state.over = true; state.running = false; state.runOver = true;
    setPadsEnabled(false); el.btnPause.disabled = true;
    el.jumpscare.hidden = true;

    renderGrid(); renderHUD();

    var totalCollected = state.totalPages + (won ? 0 : state.pages);
    el.overlay.hidden = false;
    el.overlay.className = 'overlay ' + (won ? 'is-win' : 'is-lose');
    el.ovTitle.textContent = won ? '✓ ALL SECTORS CLEARED' : '✖ SIGNAL LOST';
    el.ovDesc.textContent  = (won ? '[VICTORY] ' : '[GAME OVER · SECTOR ' + (state.missionIndex + 1) + '] ') + reason;
    el.ovStats.textContent = won
      ? 'Operation complete · 8/8 pages · Final battery: ' + Math.round(state.battery) + '%'
      : 'Reached Sector ' + (state.missionIndex + 1) + '/' + TOTAL_SECTORS + ' · Pages this sector: ' + state.pages + '/' + state.pagesTarget + ' · Battery: ' + Math.round(state.battery) + '%';

    setStatus((won ? '[VICTORY] ✓ ' : '[GAME OVER] ✖ ') + reason, won ? null : 'danger');
    addLog((won ? '[VICTORY] ✓ ' : '[GAME OVER] ✖ ') + reason, won ? null : 'danger');

    // Retry Sector only makes sense after a loss; hide it on a full-run win.
    el.btnRetry.hidden = won;

    if (won) { beep(660, 120); setTimeout(function(){ beep(880, 200); }, 130); setTimeout(function(){ beep(1100, 260); }, 300); }
    else     { noiseBurst(1); beep(70, 500, 'sawtooth'); }

    // Focus the primary action (Retry Sector on loss, Restart Run on win) so
    // Enter/Space triggers it — keyboard players stay in flow.
    (won ? el.btnRestart : el.btnRetry).focus();
  }

  /* ==============================================================
     [11] INPUT (keyboard + touch)
     ============================================================== */
  Array.prototype.forEach.call(el.pads, function (pad) {
    pad.addEventListener('click', function () { move(pad.dataset.dir); });
  });

  var KEYMAP = {
    ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right',
    w:'up', a:'left', s:'down', d:'right', W:'up', A:'left', S:'down', D:'right'
  };
  document.addEventListener('keydown', function (ev) {
    if (el.views.game.hidden) return;   // shortcuts only apply in the game tab
    var dir = KEYMAP[ev.key];
    if (dir) { ev.preventDefault(); flashPad(dir); move(dir); return; }
    if (ev.key === 'p' || ev.key === 'P' || ev.key === 'Escape') { ev.preventDefault(); togglePause(); }
    // R: while a game is over on a LOSS, retry the current sector; otherwise restart the whole run.
    if (ev.key === 'r' || ev.key === 'R') {
      ev.preventDefault();
      if (state && state.over && !el.btnRetry.hidden) retrySector();
      else startRun();
    }
  });
  function flashPad(dir) {
    var pad = document.querySelector('.pad[data-dir="' + dir + '"]'); if (!pad) return;
    pad.classList.add('is-pressed');
    setTimeout(function () { pad.classList.remove('is-pressed'); }, 110);
  }

  el.btnStart.addEventListener('click', startRun);
  el.btnGameStart.addEventListener('click', startRun);
  el.btnRestart.addEventListener('click', startRun);
  el.btnRetry.addEventListener('click', retrySector);   // Section C: restart just the current sector
  el.btnPause.addEventListener('click', function () { togglePause(); });
  el.btnToHelp.addEventListener('click', function () { showView('help'); });
  el.btnHelpPlay.addEventListener('click', startRun);
  el.btnOvHome.addEventListener('click', function () { el.overlay.hidden = true; showView('home'); });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state && state.running && !state.paused) togglePause(true);
  });

  /* ==============================================================
     [12] BOOT — dark grid on first load
     ============================================================== */
  newMission(0, CONFIG.BATTERY_START);   // build a Mission-1 state just for the idle preview
  state.running = false;
  buildGrid();
  changeEnvironment(1);   // paint the Sector 1 scene so the monitor isn't blank on load
  updateMissionTag();
  renderGrid();
  renderHUD();
  // Wire the shared Entity silhouette into the CSS (grid marker) and the jumpscare figure
  document.documentElement.style.setProperty('--slender-img', 'url("' + SLENDER_URI + '")');
  var faceEl = document.querySelector('#jumpscare .face');
  if (faceEl) faceEl.innerHTML = SLENDER_SVG;

  startHeartbeat();   // self-scheduling; only sounds while a mission runs and audio is on
  showView('home');
  addLog('[SYSTEM] Surveillance unit 04 on standby.');

})();
