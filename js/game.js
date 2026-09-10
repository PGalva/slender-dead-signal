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

    BATTERY_PICKUP: 20,        // recharge from one pack (%)
    MISSION_RECHARGE: 22,      // battery topped up at the start of each new sector

    // Section C — run-level aggression: per sector already cleared this run,
    // the Entity's double-step cap rises and its miss-chance falls.
    AGGRO_DOUBLE: 0.05,
    AGGRO_MISS: 0.02
  };

  /* ==============================================================
     [1b] PHASE 2 — MISSIONS
     The single 8-page run is split into 3 fast, continuous sectors.
     Each mission has its own environment, its own freshly-generated
     map (page/battery placement), and its own difficulty tuning that
     ramps threat, static and battery drain to keep the player in flow.
     ============================================================== */
  var MISSIONS = [
    { // Mission 1 — tutorial pace, low threat
      env: 'forest', name: 'THE DARK PINE FOREST', pages: 2, batteries: 2,
      entityMiss: 0.42, doubleStepPerPage: 0.03, doubleStepMax: 0.14,
      staticSameCell: 32, staticAdjacent: 6, staticNear: -9, staticDecay: 22,
      batteryDrainMove: 1.0, stalkLimit: 2, heartBpm: 58
    },
    { // Mission 2 — medium speed, the entity moves faster, fog tightens
      env: 'shack', name: 'THE ABANDONED SHACK', pages: 3, batteries: 3,
      entityMiss: 0.24, doubleStepPerPage: 0.05, doubleStepMax: 0.34,
      staticSameCell: 36, staticAdjacent: 8, staticNear: -7, staticDecay: 17,
      batteryDrainMove: 1.25, stalkLimit: 2, heartBpm: 78
    },
    { // Mission 3 — extreme speed, high static, fast battery drain
      env: 'monolith', name: 'THE FORGOTTEN MONOLITH', pages: 3, batteries: 3,
      entityMiss: 0.12, doubleStepPerPage: 0.07, doubleStepMax: 0.55,
      staticSameCell: 42, staticAdjacent: 10, staticNear: -5, staticDecay: 13,
      batteryDrainMove: 1.6, stalkLimit: 2, heartBpm: 98
    }
  ];

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
    // Mission 1 — dense pine forest, drifting mist
    forest:
      '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">' +
        '<defs>' +
          '<linearGradient id="fSky" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#0a1f18"/><stop offset="1" stop-color="#02100b"/></linearGradient>' +
          '<filter id="fBlur"><feGaussianBlur stdDeviation="2.2"/></filter>' +
        '</defs>' +
        '<rect width="100" height="100" fill="url(#fSky)"/>' +
        // layered pine silhouettes (back = lighter, front = darker)
        '<g fill="#06140e">' +
          '<polygon points="12,80 20,40 28,80"/><polygon points="30,84 40,34 50,84"/>' +
          '<polygon points="52,82 60,38 68,82"/><polygon points="74,84 84,42 94,84"/></g>' +
        '<g fill="#030b08">' +
          '<polygon points="0,92 12,50 24,92"/><polygon points="22,96 36,44 50,96"/>' +
          '<polygon points="48,94 64,48 80,94"/><polygon points="72,96 88,52 100,96"/></g>' +
        // trunks
        '<g stroke="#020806" stroke-width="1.4">' +
          '<line x1="20" y1="92" x2="20" y2="70"/><line x1="64" y1="94" x2="64" y2="72"/>' +
          '<line x1="88" y1="96" x2="88" y2="74"/></g>' +
        // drifting mist bands
        '<g class="drift" filter="url(#fBlur)" fill="#8fd6c0" opacity="0.10">' +
          '<ellipse cx="40" cy="70" rx="60" ry="7"/><ellipse cx="65" cy="84" rx="55" ry="9"/>' +
          '<ellipse cx="30" cy="90" rx="70" ry="8"/></g>' +
      '</svg>',

    // Mission 2 — abandoned shack interior, dark corridor
    shack:
      '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">' +
        '<defs>' +
          '<linearGradient id="sWall" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#20140a"/><stop offset="1" stop-color="#0a0704"/></linearGradient>' +
          '<radialGradient id="sDoor" cx="0.5" cy="0.5" r="0.6">' +
            '<stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#0a0704"/></radialGradient>' +
        '</defs>' +
        '<rect width="100" height="100" fill="url(#sWall)"/>' +
        // vertical rotting planks
        '<g stroke="#160d06" stroke-width="0.6">' +
          '<line x1="8" y1="0" x2="8" y2="100"/><line x1="20" y1="0" x2="20" y2="100"/>' +
          '<line x1="80" y1="0" x2="80" y2="100"/><line x1="92" y1="0" x2="92" y2="100"/></g>' +
        '<g fill="#2a1a0d" opacity="0.5">' +
          '<rect x="8" y="0" width="12" height="100"/><rect x="80" y="0" width="12" height="100"/></g>' +
        // floorboards
        '<g stroke="#1a1008" stroke-width="0.5">' +
          '<line x1="0" y1="82" x2="100" y2="82"/><line x1="0" y1="90" x2="100" y2="90"/></g>' +
        // dark doorway / corridor
        '<rect x="38" y="26" width="24" height="56" rx="1" fill="url(#sDoor)"/>' +
        '<rect x="38" y="26" width="24" height="56" rx="1" fill="none" stroke="#301d0e" stroke-width="1"/>' +
        // dust motes
        '<g fill="#d9c290" opacity="0.16">' +
          '<circle cx="30" cy="40" r="0.5"/><circle cx="70" cy="55" r="0.6"/><circle cx="50" cy="35" r="0.4"/>' +
          '<circle cx="60" cy="68" r="0.5"/><circle cx="35" cy="62" r="0.4"/></g>' +
      '</svg>',

    // Mission 3 — the forgotten monolith, carved runes, static
    monolith:
      '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">' +
        '<defs>' +
          '<linearGradient id="mSky" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="#140f22"/><stop offset="1" stop-color="#05040c"/></linearGradient>' +
          '<linearGradient id="mStone" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="#2a2740"/><stop offset="1" stop-color="#100e1c"/></linearGradient>' +
        '</defs>' +
        '<rect width="100" height="100" fill="url(#mSky)"/>' +
        // horizon ground
        '<rect x="0" y="78" width="100" height="22" fill="#0a0812"/>' +
        '<line x1="0" y1="78" x2="100" y2="78" stroke="#1c1830" stroke-width="0.8"/>' +
        // the standing stone
        '<path d="M42,80 L44,26 Q50,18 56,26 L58,80 Z" fill="url(#mStone)" stroke="#3a355a" stroke-width="0.8"/>' +
        // carved runes (amber glow)
        '<g stroke="#ffcc00" stroke-width="1" fill="none" opacity="0.85" filter="url(#fBlur2)">' +
          '<polygon points="50,36 47,42 53,42"/><line x1="50" y1="46" x2="50" y2="56"/>' +
          '<circle cx="50" cy="62" r="2.4"/><line x1="47" y1="68" x2="53" y2="72"/></g>' +
        '<defs><filter id="fBlur2"><feGaussianBlur stdDeviation="0.4"/></filter></defs>' +
        // faint side markers
        '<g fill="#151228"><rect x="14" y="66" width="6" height="12" rx="1"/><rect x="82" y="64" width="6" height="14" rx="1"/></g>' +
        // static specks
        '<g fill="#b8b0d8" opacity="0.14">' +
          '<circle cx="22" cy="30" r="0.5"/><circle cx="72" cy="24" r="0.5"/><circle cx="60" cy="46" r="0.4"/>' +
          '<circle cx="30" cy="52" r="0.4"/><circle cx="80" cy="50" r="0.5"/><circle cx="40" cy="20" r="0.4"/></g>' +
      '</svg>'
  };

  // Human-readable sector names shown in the monitor tag
  var ENV_NAMES = { forest: 'DARK PINE FOREST', shack: 'ABANDONED SHACK', monolith: 'FORGOTTEN MONOLITH' };
  var currentEnv = 'forest';

  /* THE ENTITY — a faceless, elongated silhouette: long limbs, reaching
     tendrils, no features. Drawn once as inline SVG and reused for both the
     grid marker (via a CSS background) and the full-screen jumpscare. */
  var SLENDER_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 150">' +
      // STATIC AURA — the red "signal form" from the concept art: jagged shards
      '<g stroke="#ff2f2f" stroke-width="1.5" fill="none" opacity="0.9" stroke-linecap="round">' +
        '<path d="M40 24 L40 3"/>' +
        '<path d="M40 26 L26 7"/><path d="M40 26 L55 5"/>' +
        '<path d="M30 41 L7 30"/><path d="M50 41 L73 28"/>' +
        '<path d="M23 54 L3 52"/><path d="M57 54 L77 52"/>' +
        '<path d="M28 68 L6 76"/><path d="M52 68 L74 74"/>' +
      '</g>' +
      // BODY — faceless, suited, elongated
      '<g fill="#f2f2f5">' +
        '<ellipse cx="40" cy="20" rx="8" ry="11.5"/>' +                     // head, no face
        '<path d="M31 30 Q40 25 49 30 L47 40 L40 45 L33 40 Z"/>' +          // shoulders / collar
        '<path d="M34 40 L40 45 L46 40 L50 94 Q40 102 30 94 Z"/>' +         // torso (suit)
        '<path d="M33 40 L18 120 L25 122 L37 50 Z"/>' +                     // very long left arm
        '<path d="M47 40 L62 120 L55 122 L43 50 Z"/>' +                     // very long right arm
        '<path d="M35 92 L31 148 L39 148 L41 94 Z"/>' +                     // left leg
        '<path d="M45 92 L49 148 L41 148 L39 94 Z"/>' +                     // right leg
      '</g>' +
      // SUIT DETAIL — lapels + tie
      '<g fill="#0b0b0e" opacity="0.6">' +
        '<path d="M40 45 L37 60 L40 82 L43 60 Z"/>' +                       // tie
        '<path d="M34 40 L40 46 L38 58 Z"/><path d="M46 40 L40 46 L42 58 Z"/>' +  // lapels
      '</g>' +
      // TENDRILS
      '<g stroke="#f2f2f5" stroke-width="1.3" fill="none" opacity="0.5">' +
        '<path d="M49 45 Q72 54 63 100"/>' +
        '<path d="M31 45 Q8 54 17 100"/>' +
      '</g>' +
    '</svg>';
  var SLENDER_URI = 'data:image/svg+xml,' + encodeURIComponent(SLENDER_SVG);

  /* changeEnvironment(scenarioType)
     Swaps the scene art, ambient tint/filters (via data-env) and the label.
     Called on mission transitions in Section B; here it also backs the
     temporary preview buttons. */
  function changeEnvironment(scenarioType) {
    if (!SCENES[scenarioType]) scenarioType = 'forest';
    currentEnv = scenarioType;
    var art = document.getElementById('scene-art');
    if (art) art.innerHTML = SCENES[scenarioType];
    document.documentElement.setAttribute('data-env', scenarioType);   // retunes --env-* tokens
    var lbl = document.getElementById('tag-env');
    if (lbl) lbl.textContent = ENV_NAMES[scenarioType] || scenarioType.toUpperCase();
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

        var glyph = '░', text = '', aria = 'unscanned';
        if (isEntity)            { glyph = '';  text = 'ENTITY'; aria = 'ENTITY PRESENT'; }  // silhouette drawn via CSS
        else if (isPlayer)       { glyph = '◉'; text = 'YOU';    aria = 'your position'; }
        else if (cell.scanned) {
          if (cell.type === 'page')        { glyph = '📄'; text = 'PAGE';    aria = 'journal page'; }
          else if (cell.type === 'battery'){ glyph = '🔋'; text = 'BATTERY'; aria = 'battery pack'; }
          else                             { glyph = '·';  text = 'CLEAR';   aria = 'empty'; }
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

  /* Jumpscare: full-screen flash for an instant. */
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
    addLog('[SYSTEM] Operation "Dead Signal" — 3 sectors. Recover every page.');
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

    changeEnvironment(m.env);                 // swap scene + ambient for this sector
    updateMissionTag();                       // "MISSION 1/3 · THE DARK PINE FOREST"
    renderGrid(); renderHUD();
    setStatus('[SECTOR ' + (missionIndex + 1) + '] 📡 ' + m.name + ' — recover ' + m.pages + ' page' + (m.pages > 1 ? 's' : '') + '.', null);
    setRadar('NO CONTACT', null);
    addLog('[SECTOR ' + (missionIndex + 1) + '/3] ' + m.name + ' · target ' + m.pages + ' pages.');
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
    addLog('[SECTOR ' + (state.missionIndex + 1) + '/3] ✓ Cleared. Recharge +' + CONFIG.MISSION_RECHARGE + '%.');
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
    if (t) t.textContent = 'M' + (state.missionIndex + 1) + '/3';
  }

  /* ==============================================================
     [8b] SEAMLESS MISSION TRANSITION (2s glitch overlay)
     ============================================================== */
  function showTransition(nextIndex, done) {
    var next = MISSIONS[nextIndex];
    var title = '[SECTOR ' + (state.missionIndex + 1) + '/3 COMPLETE]';
    el.trTitle.textContent = title;
    el.trTitle.setAttribute('data-text', title);   // feeds the RGB-split glitch layers
    el.trNext.textContent = 'PREPARE FOR NEXT SECTOR ▸ ' + next.name;
    el.transition.hidden = false;
    el.transition.classList.add('is-on');
    noiseBurst(0.7); beep(120, 300, 'sawtooth');
    // hold the glitch for ~2s, then hand off to the next mission
    pendingTransition = setTimeout(function () {
      hideTransition();
      pendingTransition = null;
      if (typeof done === 'function') done();
    }, 2000);
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
      jumpscare();
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
      : 'Reached Sector ' + (state.missionIndex + 1) + '/3 · Pages this sector: ' + state.pages + '/' + state.pagesTarget + ' · Battery: ' + Math.round(state.battery) + '%';

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
  changeEnvironment('forest');   // paint an initial scene so the monitor isn't blank on load
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
