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
    STALK_LIMIT: 2             // turns at 1 cell (or less) before the blink
  };

  /* ==============================================================
     [2] STATE — single object describing the whole match
     ============================================================== */
  var state = null;

  function newGame() {
    var size = CONFIG.GRID;
    state = {
      size: size,
      cells: [],
      player: { x: 0, y: 0 },        // player starts in corner (0,0) = (1,1) in the UI
      entity: { x: size - 1, y: size - 1 }, // Entity in the opposite corner (4,4) = (5,5)
      battery: CONFIG.BATTERY_START,
      staticLevel: 0,
      pages: 0,
      moves: 0,
      stalkTurns: 0,                 // consecutive turns with the Entity at dist<=1
      running: false,
      paused: false,
      over: false
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

    // 2.3 — distribute pages and battery packs
    var i, spot;
    for (i = 0; i < CONFIG.TOTAL_PAGES; i++) { spot = free.pop(); state.cells[spot.y][spot.x].type = 'page'; }
    for (i = 0; i < CONFIG.TOTAL_BATTERIES; i++) { spot = free.pop(); state.cells[spot.y][spot.x].type = 'battery'; }

    // 2.4 — light up what's under the flashlight at the start
    revealAround(state.player.x, state.player.y);
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
        if (isEntity)            { glyph = '▓'; text = 'ENTITY'; aria = 'ENTITY PRESENT'; }
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
    el.valPages.textContent   = state.pages + ' / ' + CONFIG.TOTAL_PAGES;
    el.fillBattery.style.width = bat + '%';
    el.fillStatic.style.width  = sta + '%';
    el.fillPages.style.width   = (state.pages / CONFIG.TOTAL_PAGES * 100) + '%';
    el.pbBattery.setAttribute('aria-valuenow', bat);
    el.pbStatic.setAttribute('aria-valuenow', sta);
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
    shake(true);
    beep(70, 320, 'sawtooth'); noiseBurst(1);
    setTimeout(function () { el.jumpscare.hidden = true; }, 520);
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

  /* ==============================================================
     [8] LIFECYCLE
     ============================================================== */
  function startGame() {
    newGame();
    buildGrid();
    el.log.innerHTML = '';
    el.overlay.hidden = true; el.overlay.className = 'overlay';
    el.jumpscare.hidden = true;

    state.running = true; state.paused = false;
    el.btnPause.disabled = false; el.btnPause.textContent = '⏸ Pause';
    setPadsEnabled(true);

    renderGrid(); renderHUD();
    setStatus('[OK] 📡 Watch started. Recover the 8 pages. It is already coming.', null);
    setRadar('NO CONTACT', null);
    addLog('[SYSTEM] Unit 04 online. Entity detected in sector (5,5).');

    showView('game');
    ensureAudio(); beep(660, 90);
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

    // 9.2 — valid step
    state.player.x = nx; state.player.y = ny;
    state.moves++;
    state.battery = clamp(state.battery - CONFIG.BATTERY_DRAIN_MOVE, 0, 100);

    // 9.3 — the flashlight reveals the surroundings
    revealAround(nx, ny);

    // 9.4 — contents of the stepped-on cell
    var cell = state.cells[ny][nx];
    if (cell.type === 'page') {
      cell.type = 'empty'; state.pages++;
      addLog('[COLLECT] 📄 Page ' + state.pages + ' of ' + CONFIG.TOTAL_PAGES + ' recovered.');
      beep(880, 120);
    } else if (cell.type === 'battery') {
      cell.type = 'empty';
      state.battery = clamp(state.battery + CONFIG.BATTERY_PICKUP, 0, 100);
      addLog('[COLLECT] 🔋 Battery pack: +' + CONFIG.BATTERY_PICKUP + '% charge.');
      beep(520, 120);
    }

    // 9.5 — immediate VICTORY on completing 8 pages (before the Entity reacts)
    if (state.pages >= CONFIG.TOTAL_PAGES) { renderGrid(); renderHUD(); return endGame(true, 'ALL PAGES RECOVERED'); }

    // 9.6 — the Entity reacts by pursuing
    var caught = moveEntity();

    // 9.7 — proximity → static + alert
    resolveProximity(caught);

    renderGrid(); renderHUD();

    // 9.8 — loss conditions
    if (state.staticLevel >= 100) return endGame(false, 'SIGNAL CONSUMED BY STATIC');
    if (state.battery <= 0)       return endGame(false, 'BATTERY DEPLETED');
  }

  /* Entity AI: deterministic pursuit.
     Returns true if it reached the player (contact) this turn. */
  function moveEntity() {
    // 9a — Escalation: the double-step chance grows with pages collected.
    var doubleChance = Math.min(CONFIG.DOUBLE_STEP_MAX, state.pages * CONFIG.DOUBLE_STEP_PER_PAGE);
    var steps = 1 + (Math.random() < doubleChance ? 1 : 0);

    var caught = false;
    for (var s = 0; s < steps; s++) {
      // 9b — Fairness: sometimes it loses the trail and doesn't move this step.
      if (Math.random() < CONFIG.ENTITY_MISS) continue;

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
    var p = state.player, e = state.entity;
    var dist = chebyshev(p.x, p.y, e.x, e.y);
    var b = bearingTo(p.x, p.y, e.x, e.y);
    var arrow = bearingArrow(b);

    if (caught || dist === 0) {
      state.staticLevel += CONFIG.STATIC_SAME_CELL;
      setStatus('[CONTACT] ⚠️ IT REACHED YOU! Static +' + CONFIG.STATIC_SAME_CELL + '%', 'danger');
      addLog('[CONTACT] ⚠️ The Entity reached your cell.', 'danger');
      setRadar('✖ CONTACT', 'danger');
      jumpscare();
    } else if (dist === 1) {
      state.staticLevel += CONFIG.STATIC_ADJACENT;
      setStatus('[ALERT] ⚠️ It is 1 cell to the ' + b + ' ' + arrow + ' — flee the opposite way! Static +' + CONFIG.STATIC_ADJACENT + '%', 'danger');
      addLog('[ALERT] ⚠️ Entity 1 cell to the ' + b + ' ' + arrow, 'danger');
      setRadar(arrow + ' ' + b, 'danger');
      shake(false); noiseBurst(0.5); beep(140, 130, 'sawtooth');
    } else if (dist === 2) {
      state.staticLevel += CONFIG.STATIC_NEAR;   // STATIC_NEAR is negative: slight relief
      setStatus('[WARNING] 〜 Unstable signal to the ' + b + ' ' + arrow + ' — 2 cells. Static ' + CONFIG.STATIC_NEAR + '%', 'warn');
      setRadar(arrow + ' ' + b, 'warn');
      noiseBurst(0.2);
    } else {
      state.staticLevel -= CONFIG.STATIC_DECAY;
      setStatus('[OK] ✓ Clear signal. ' + state.pages + ' of ' + CONFIG.TOTAL_PAGES + ' pages · Battery ' + Math.round(state.battery) + '%', null);
      setRadar('NO CONTACT', null);
    }

    // --- BLINK (retreat into the shadows) ---
    // Count glued turns; on reaching you or passing the limit, it vanishes and returns far away.
    if (dist <= 1) state.stalkTurns++; else state.stalkTurns = 0;
    if (caught || dist === 0 || state.stalkTurns >= CONFIG.STALK_LIMIT) {
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
  function endGame(won, reason) {
    state.over = true; state.running = false;
    setPadsEnabled(false); el.btnPause.disabled = true;
    el.jumpscare.hidden = true;

    renderGrid(); renderHUD();

    el.overlay.hidden = false;
    el.overlay.className = 'overlay ' + (won ? 'is-win' : 'is-lose');
    el.ovTitle.textContent = won ? '✓ SIGNAL RECOVERED' : '✖ SIGNAL LOST';
    el.ovDesc.textContent  = (won ? '[VICTORY] ' : '[GAME OVER] ') + reason;
    el.ovStats.textContent = 'Pages: ' + state.pages + '/' + CONFIG.TOTAL_PAGES +
      ' · Moves: ' + state.moves + ' · Final battery: ' + Math.round(state.battery) + '%';

    setStatus((won ? '[VICTORY] ✓ ' : '[GAME OVER] ✖ ') + reason, won ? null : 'danger');
    addLog((won ? '[VICTORY] ✓ ' : '[GAME OVER] ✖ ') + reason, won ? null : 'danger');

    if (won) { beep(660, 120); setTimeout(function(){ beep(880, 200); }, 130); }
    else     { noiseBurst(1); beep(70, 500, 'sawtooth'); }

    el.btnRestart.focus();
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
    if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); startGame(); }
  });
  function flashPad(dir) {
    var pad = document.querySelector('.pad[data-dir="' + dir + '"]'); if (!pad) return;
    pad.classList.add('is-pressed');
    setTimeout(function () { pad.classList.remove('is-pressed'); }, 110);
  }

  el.btnStart.addEventListener('click', startGame);
  el.btnGameStart.addEventListener('click', startGame);
  el.btnRestart.addEventListener('click', startGame);
  el.btnPause.addEventListener('click', function () { togglePause(); });
  el.btnToHelp.addEventListener('click', function () { showView('help'); });
  el.btnHelpPlay.addEventListener('click', startGame);
  el.btnOvHome.addEventListener('click', function () { el.overlay.hidden = true; showView('home'); });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state && state.running && !state.paused) togglePause(true);
  });

  /* ==============================================================
     [12] BOOT — dark grid on first load
     ============================================================== */
  newGame();
  state.running = false;
  buildGrid();
  renderGrid();
  renderHUD();
  showView('home');
  addLog('[SYSTEM] Surveillance unit 04 on standby.');

})();
