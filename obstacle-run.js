(() => {
  const T = window.T;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fx = new window.ObstacleRunFX(ctx, T, reduceMotion);
  let muted = false;
  try { muted = localStorage.getItem('minigame_muted') === '1'; } catch (e) {}
  let W = 0, H = 0, DPR = 1;
  let TILT = 0.82;
  let raceRandom = Math.random;
  const fxRand = (a, b) => a + Math.random() * (b - a);

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, playerCount > 150 ? 1.5 : 2);
    W = window.innerWidth; H = window.innerHeight;
    TILT = W < H ? 0.86 : 0.62;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  function remapWorld() {
    // Rotation changes the lens, never the course, speed or collision geometry.
    if (!race) return;
    cam.x = cam.tx = 0;
    cam.zoom = cam.tz = cameraFit();
  }
  window.addEventListener('resize', () => { resize(); remapWorld(); });

  function rand(a, b) { return a + raceRandom() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }

  // Names keep recognizable colors; abilities are freshly rolled each race.
  function nameHash(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Audio ----------
  let AC = null, master = null, duckUntil = 0;
  const lastSfx = {};
  function initAudio() {
    if (AC) return;
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain(); master.gain.value = muted ? 0 : 0.8;
      master.connect(AC.destination);
    } catch (e) {}
  }
  function beep(freq, dur = 0.06, type = 'sine', vol = 0.12, freq2 = 0) {
    if (!AC) return;
    const t = AC.currentTime;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freq2) o.frequency.linearRampToValueAtTime(freq2, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur);
  }
  function sfx(type, gapMs, fn) {
    const now = performance.now();
    if (lastSfx[type] && now - lastSfx[type] < gapMs) return;
    lastSfx[type] = now;
    fn(now < duckUntil ? 0.6 : 1);
  }
  function fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.22, 'triangle', 0.16), i * 120));
  }

  // ---------- Mute (one setting shared by every game in the arcade) ----------
  const muteBtn = document.getElementById('muteBtn');
  function applyMute() {
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    const label = muted ? T.unmute : T.mute;
    muteBtn.setAttribute('aria-label', label);
    muteBtn.title = label;
    if (master) master.gain.value = muted ? 0 : 0.8;
  }
  muteBtn.onclick = () => {
    muted = !muted;
    try { localStorage.setItem('minigame_muted', muted ? '1' : '0'); } catch (e) {}
    applyMute();
  };
  applyMute();

  // ---------- State ----------
  let state = 'menu';           // menu | countdown | racing | finale | over
  let players = [], particles = [], floaters = [], confetti = [], peels = [];
  let race = null;              // {course, sc, trackW, bands, grid}
  let cdT = 0, cdIdx = -1;
  let playerCount = 30;
  let winner = null, winnerGameT = 0;
  let gameT = 0;
  let finishedCount = 0, finishOrder = [];
  let leaderId = -1, leadSince = 0;
  let photoActive = false, photoDone = false, polaroid = null;
  let finalStretch = false;

  let trauma = 0, freezeT = 0;
  let slowmo = { ts: 1, t: 0 }, timeScale = 1, ffMode = false;
  let flashT = 0, lastFlash = 0;
  let banner = null, lastBannerT = 0;
  let cam = { x: 0, wy: 0, zoom: 1, tx: 0, twy: 0, tz: 1 };
  let shot = { type: 'follow', until: 0, prio: 0 };   // director
  const shotCd = {};
  let lastEventShot = 0;
  let wipeBuf = [];              // {t, bandId} for mass-wipeout detection
  let nextEvent = 0, turboT = 0, leaderChanges = 0, hudT = 0, photoPending = false;
  const EVENTS = [{ at: 8, type: 'banana' }, { at: 16, type: 'turbo' }, { at: 25, type: 'banana' }];
  const ITEMS = ['🚀', '🛡️', '🍌', '🌀'];
  let lastWipeSlowT = -9, pendingLead = -1, pendingLeadT = 0;
  let sortedUnfin = [];
  const NB9 = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let frameMs = 8, q = 0;        // adaptive quality
  let sprites = null;

  function addTrauma(a) {
    if (reduceMotion) return;
    if (timeScale < 0.999 || cam.zoom > 1.15) return;
    trauma = Math.min(1, trauma + a);
  }
  function fireFlash() {
    if (reduceMotion) return;
    const now = performance.now();
    if (now - lastFlash < 2000) return;
    lastFlash = now; flashT = 0.08;
  }
  function showBanner(text, color, dur = 1.2, force = false) {
    const now = performance.now();
    if (photoActive && !force) return;
    if (!force && now - lastBannerT < 2000) return;
    lastBannerT = now;
    banner = { text, color, t: 0, dur };
  }
  function setSlowmo(ts, dur) { slowmo = { ts, t: dur }; trauma = 0; }
  function addFloater(x, wy, text, color, big) {
    floaters.push({ x, wy, text, color, life: 1, big: !!big });
    if (floaters.length > 8) floaters.shift();
  }
  function spawnParticles(x, wy, color, n, spd) {
    const cap = q === 0 ? 250 : q === 1 ? 120 : 60;
    if (particles.length > cap) return;
    for (let i = 0; i < Math.min(n, 12); i++) {
      const a = fxRand(0, 6.2832), sp = fxRand(0.5, spd);
      particles.push({ x, wy, vx: Math.cos(a) * sp, vwy: Math.sin(a) * sp, life: 1, r: fxRand(2, 5), color });
    }
  }

  // ---------- Setup ----------
  const HUES = [0, 30, 55, 90, 140, 175, 205, 235, 265, 295, 325, 15];
  function buildSprites(sc) {
    // pre-rendered glow-baked mini runners (MID LOD) — zero shadowBlur at draw time
    sprites = HUES.map(h => {
      const c = document.createElement('canvas');
      const q2 = Math.min(window.devicePixelRatio || 1, 2) * 1.5;   // extra headroom for event-shot zoom
      const s = Math.ceil(26 * sc * q2);
      c._l = 26 * sc;
      c.width = s; c.height = s;
      const g = c.getContext('2d');
      const cx = s / 2, cy = s / 2, r = s * 0.30;
      const rg = g.createRadialGradient(cx, cy, r * 0.3, cx, cy, s * 0.5);
      rg.addColorStop(0, `hsla(${h}, 85%, 62%, .55)`);
      rg.addColorStop(1, `hsla(${h}, 85%, 62%, 0)`);
      g.fillStyle = rg; g.fillRect(0, 0, s, s);
      g.globalAlpha = 0.3;
      g.beginPath(); g.ellipse(cx, s * 0.9, s * 0.26, s * 0.08, 0, 0, 7);
      g.fillStyle = '#000'; g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = `hsl(${h}, 85%, 58%)`; g.lineWidth = Math.max(2, s * 0.13);
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(cx, cy - r * 0.2); g.lineTo(cx, cy + r * 0.9);
      g.moveTo(cx, cy + r * 0.5); g.lineTo(cx - r * 0.7, cy + r * 1.5);
      g.moveTo(cx, cy + r * 0.5); g.lineTo(cx + r * 0.7, cy + r * 1.5);
      g.stroke();
      g.beginPath(); g.arc(cx, cy - r * 0.55, r * 0.72, 0, 7);
      g.fillStyle = `hsl(${h}, 85%, 62%)`; g.fill();
      return c;
    });
  }

  function setupGame(n) {
    // Rendering quality cannot consume the simulation's random stream.
    raceRandom = mulberry32(Math.floor(Math.random() * 4294967296));
    players = []; particles = []; floaters = []; confetti = []; peels = [];
    finishedCount = 0; finishOrder = [];
    winner = null; winnerGameT = 0; gameT = 0; trauma = 0; freezeT = 0;
    slowmo = { ts: 1, t: 0 }; timeScale = 1; ffMode = false;
    flashT = 0; banner = null;
    leaderId = -1; leadSince = 0;
    photoActive = false; photoDone = false; polaroid = null; finalStretch = false;
    wipeBuf = []; nextEvent = 0; turboT = 0; leaderChanges = 0; hudT = 0; photoPending = false;
    accumulator = 0;
    lastWipeSlowT = -9; pendingLead = -1; pendingLeadT = 0; sortedUnfin = [];
    for (const k in shotCd) delete shotCd[k];
    shot = { type: 'follow', until: 0, prio: 0 };
    lastEventShot = 0;
    document.getElementById('ticker').innerHTML = '';
    document.getElementById('ffChip').style.display = 'none';
    document.getElementById('raceLeaders').replaceChildren();
    document.getElementById('raceSummary').textContent = '';

    const sc = 1, course = 4400, trackW = 420;
    buildSprites(sc);

    // obstacle bands (fractions of course) — all reskinned as PINBALL elements
    const PBCOL = ['#3fd0ff', '#ff4d6d', '#ffd23f', '#7b5bff', '#25d366', '#ff8a3d'];
    const pad = (x, y, r, ci) => ({ x, y, r: r * sc, col: PBCOL[ci % PBCOL.length], lit: -9 });
    const mkHammers = (fy, cnt, o) => { o = o || {}; return {   // swinging chrome pop-bumpers
      type: 'hammer', y: course * fy, h: (o.h || 60) * sc, id: 'h' + fy, boss: !!o.boss,
      arms: Array.from({ length: cnt }, (_, i) => ({
        px: -trackW / 2 + trackW * (i + 0.5) / cnt,
        period: o.fast ? rand(1.5, 1.9) : rand(2.2, 3.0), phase: (i / cnt) * 6.2832,
        len: trackW / cnt * (o.len || 0.52), headR: (o.headR || 30) * sc, lit: -9,
      })),
    }; };
    const bands = [
      // pop-bumper cluster
      { type: 'bumper', y: course * 0.08, h: 60 * sc, id: 'b1', pads: [
        pad(-trackW * 0.22, course * 0.08 - 24 * sc, 26, 0), pad(trackW * 0.22, course * 0.08 - 24 * sc, 26, 1),
        pad(0, course * 0.08, 30, 2),
        pad(-trackW * 0.13, course * 0.08 + 28 * sc, 24, 3), pad(trackW * 0.13, course * 0.08 + 28 * sc, 24, 4),
      ] },
      mkHammers(0.17, 2),
      { type: 'sweeper', y: course * 0.28, h: 70 * sc, id: 'sw', spd: rand(0.8, 1.0), lit: -9 },
      { type: 'convey', y: course * 0.38, h: 90 * sc, id: 'c1', vx: rand(-1, 1) < 0 ? -2 : 2, vy: 0 },
      // bumper field (was mud)
      { type: 'bumper', y: course * 0.50, h: 120 * sc, id: 'bf',
        pads: Array.from({ length: 12 }, (_, i) => pad(rand(-trackW * 0.42, trackW * 0.42), course * 0.50 + rand(-95, 95) * sc, rand(16, 24), i)) },
      mkHammers(0.60, 3),
      { type: 'convey', y: course * 0.70, h: 90 * sc, id: 'c2', vx: 0, vy: -0.55 },
      // kicker solenoids (was crusher) — launch runners up the table
      { type: 'crusher', y: course * 0.80, h: 60 * sc, id: 'cr',
        pistons: Array.from({ length: 5 }, (_, i) => ({ x: -trackW / 2 + trackW * (i + 0.5) / 5, r: 34 * sc, cycle: 1.8, phase: i * 0.3, lit: -9 })) },
      mkHammers(0.92, 3, { boss: true, fast: true, headR: 34, len: 0.62, h: 74 }),
    ];
    for (const [i, frac] of [0.21, 0.55, 0.84].entries()) {
      bands.push({ type: 'item', y: course * frac, h: 36, id: 'item' + i, index: i });
    }
    bands.sort((a, b) => a.y - b.y);
    race = { course, sc, trackW, bands };

    // Shuffle slots so entry order does not buy a place on the front row.
    const names = window.__names || [];
    const seen = Object.create(null);
    const cols = Math.min(n, 20, Math.max(6, Math.ceil(Math.sqrt(n * 1.4))));
    const slots = Array.from({ length: n }, (_, i) => i);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(raceRandom() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    for (let i = 0; i < n; i++) {
      const nm = names[i] || String(i + 1);
      const isNum = !names[i];
      seen[nm] = (seen[nm] || 0) + 1;
      const dispIdx = seen[nm];
      const seed = nameHash(nm);
      const rng = raceRandom;
      const hueIdx = (seed + dispIdx - 1) % HUES.length;
      const row = Math.floor(slots[i] / cols), col = slots[i] % cols;
      players.push({
        id: i, name: nm, isNum, dup: dispIdx,
        hue: HUES[hueIdx], color: `hsl(${HUES[hueIdx]}, 85%, 62%)`,
        spriteIdx: hueIdx,
        wx: -trackW / 2 + trackW * ((col + 0.5) / cols),
        wy: -(row + 1) * 26 * sc,
        vx: 0, vwy: 0,
        r: 10 * sc,
        // Fresh personality for each entry, including duplicate names.
        spd: 0.95 + rng() * 0.10,
        reflex: rng() * 0.25,
        courage: 0.75 + rng() * 0.5,
        clumsy: 0.5 + rng() * 1.5,
        recov: 0.8 + rng() * 0.4,
        burst1: 0.15 + rng() * 0.35, burst2: 0.65 + rng() * 0.30,
        burstT: 0, bursted1: false, bursted2: false,
        shieldT: 0, item: '', itemT: 0, itemGate: -1, hopT: 0, prevWy: 0,
        state: 'run', stateT: 0, invulnT: 0, draft: false,
        shx: 0, shy: 0, waitT: 0, spin: 0,
        nextBand: 0, gapX: 0, gapBand: -1,
        phase: rng() * 6.28, rot: 0,
        finished: false, finT: 0, rank: 0,
        started: false,
      });
    }
    document.getElementById('totCount').textContent = '/' + n;
    document.getElementById('finCount').textContent = '0';
    cam = { x: 0, wy: -(Math.ceil(n / cols) + 2) * 26 * sc, zoom: cameraFit(), tx: 0, twy: 0, tz: cameraFit() };
    race.gridBack = cam.wy;
  }

  const dispName = p => (p.isNum ? T.numName(p.name) : p.name) + (p.dup > 1 ? `(${p.dup})` : '');
  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Race update ----------
  function shieldHit(p) {
    if (p.shieldT <= 0) return false;
    p.shieldT = 0; p.invulnT = 0.6;
    addFloaterCap(p, T.shieldSave);
    spawnParticles(p.wx, p.wy, '#7eeaff', 12, 5);
    return true;
  }
  function giveItem(p) {
    const item = Math.floor(raceRandom() * ITEMS.length);
    p.item = ITEMS[item]; p.itemT = 2;
    if (item === 0) p.burstT = 3.2;
    else if (item === 1) p.shieldT = 6;
    else if (item === 2) {
      peels.push({ x: p.wx, wy: p.wy - 32, t: 0.35, life: 6, alive: true });
      p.burstT = Math.max(p.burstT, 0.8);
    } else {
      p.hopT = 0.65; p.invulnT = 0.7;
      p.shy += 13; p.state = 'run';
    }
    spawnParticles(p.wx, p.wy, item === 1 ? '#7eeaff' : '#ffe073', 8, 4);
    sfx('item', 180, d => beep(660, 0.12, 'triangle', 0.12 * d, 1100));
  }
  function updateEvents(dt) {
    turboT = Math.max(0, turboT - dt);
    if (state !== 'racing' || nextEvent >= EVENTS.length || gameT < EVENTS[nextEvent].at) return;
    const event = EVENTS[nextEvent++];
    if (event.type === 'turbo') {
      turboT = 4;
      showBanner(T.turboFever, '#7effb2', 1.6, true);
      sfx('turbo', 300, d => beep(220, 0.4, 'sawtooth', 0.12 * d, 660));
    } else bananaRain();
  }
  function knock(p, st, dur, vx0, vwy0) {
    if (p.invulnT > 0 || p.finished || p.state === st) return false;
    if (shieldHit(p)) return false;
    p.state = st; p.stateT = dur * p.recov;
    p.vx = vx0; p.vwy = vwy0;
    return true;
  }
  // pinball ricochet: fling outward from a bumper, keep rolling (no fall)
  function bounceOff(p, cx, cy, power, allowBack) {
    if (shieldHit(p)) return;
    const dx = p.wx - cx, dy = p.wy - cy, d = Math.hypot(dx, dy) || 0.001;
    p.state = 'bounce'; p.stateT = 0.3;
    p.vx = dx / d * power + (raceRandom() - 0.5) * power * 0.3;
    let vy = dy / d * power * 0.6;
    if (!allowBack && vy < 0) vy = -vy * 0.25;          // convert backward kick to mild forward
    p.vwy = vy + (allowBack ? 0 : power * 0.06);        // forward bias so bumpers don't stall the race
    p.spin = (raceRandom() < 0.5 ? -1 : 1) * rand(9, 15);
    p.rot = 0;
  }
  function recordWipe(bandId, p) {
    wipeBuf.push({ t: gameT, bandId });
    // mass wipeout: ≥5 victims from one obstacle within 0.6s
    const recent = wipeBuf.filter(w => w.bandId === bandId && gameT - w.t < 0.6);
    if (recent.length >= 5 && gameT > 10) {
      requestShot('wipeout', 80, p.wy, 1.8, 6);
      if (timeScale > 0.999 && !ffMode && gameT - lastWipeSlowT > 6) { lastWipeSlowT = gameT; setSlowmo(0.4, 0.7); }
    }
    if (wipeBuf.length > 40) wipeBuf.splice(0, 20);
  }
  function requestShot(type, prio, fwy, hold, cd) {
    const now = gameT;
    if (now < 10 && type !== 'final' && type !== 'photo') return;      // stampede is the shot
    if (shotCd[type] && now - shotCd[type] < cd) return;
    if (now - lastEventShot < 3 && prio <= shot.prio) return;
    if (prio < shot.prio && now < shot.until) return;
    shotCd[type] = now; lastEventShot = now;
    shot = { type, until: now + hold, prio, fwy };
  }

  function update(dt, fm) {
    gameT += dt;
    const R = race, sc = R.sc, course = R.course;
    const baseV = 130;
    updateEvents(dt);

    // ---- spatial buckets (separation + slipstream + hammer chains) ----
    const cell = 40 * sc;
    const buckets = {};
    for (const p of players) {
      if (p.finished) continue;
      const k = Math.floor(p.wx / cell) + ':' + Math.floor(p.wy / cell);
      (buckets[k] || (buckets[k] = [])).push(p);
    }

    let leadWy = -1e9, leadP = null, second = null;
    for (const p of players) {
      if (p.finished) continue;
      if (p.wy > leadWy) { second = leadP; leadWy = p.wy; leadP = p; }
      else if (!second || p.wy > second.wy) second = p;
    }

    // ---- runners ----
    for (const p of players) {
      if (p.finished) { p.wy += baseV * dt * 0.5; p.phase += dt * 6; continue; }
      p.prevWy = p.wy;
      p.invulnT = Math.max(0, p.invulnT - dt);
      if (p.burstT > 0) p.burstT -= dt;
      p.shieldT = Math.max(0, p.shieldT - dt);
      p.itemT = Math.max(0, p.itemT - dt);
      p.hopT = Math.max(0, p.hopT - dt);

      if (!p.started) {
        if (gameT >= p.reflex) p.started = true;
        else continue;
      }

      // knocked -> getting up -> run (a real recovery, not a ghost pass)
      if (p.state !== 'run') {
        p.stateT -= dt;
        if (p.state === 'bounce') {
          // ricochet: slide with spin, then keep running (pinball never stops rolling)
          p.wx += p.vx * fm; p.wy += p.vwy * fm;
          p.wx = clamp(p.wx, -R.trackW / 2 + p.r, R.trackW / 2 - p.r);
          p.vx *= Math.pow(0.9, fm); p.vwy *= Math.pow(0.9, fm);
          p.rot += (p.spin || 0) * dt;
          if (p.stateT <= 0) { p.state = 'run'; p.rot = 0; p.invulnT = 0.12; }
        } else if (p.state === 'getup') {
          // scrambling to feet: creep forward, slide any residual shove out
          p.wy += (baseV * 0.28 / 60) * fm;
          p.wx += p.shx * fm; p.shx *= Math.pow(0.82, fm);
          p.wx = clamp(p.wx, -R.trackW / 2 + p.r, R.trackW / 2 - p.r);
          if (p.stateT <= 0) { p.state = 'run'; p.rot = 0; p.invulnT = 0.3; p.waitT = 0; }
        } else {
          // sprawled: slide under residual momentum
          p.wx += p.vx * fm; p.wy += p.vwy * fm;
          p.vx *= Math.pow(0.9, fm); p.vwy *= Math.pow(0.9, fm);
          p.wx = clamp(p.wx, -R.trackW / 2 + p.r, R.trackW / 2 - p.r);
          p.rot += (p.state === 'tumble' ? 10 : p.state === 'slip' ? 14 : 0) * dt;
          // tumble projectiles bowl through neighbors (hammer bowling!)
          if (p.state === 'tumble' && Math.abs(p.vx) > 2 * sc) {
            const bx = Math.floor(p.wx / cell), by = Math.floor(p.wy / cell);
            for (const [ox, oy] of NB9) {
              const near = buckets[(bx + ox) + ':' + (by + oy)];
              if (!near) continue;
              for (const q2 of near) {
                if (q2 !== p && (q2.state === 'run' || q2.state === 'getup') && Math.abs(q2.wx - p.wx) < p.r * 2.2 && Math.abs(q2.wy - p.wy) < p.r * 2.2) {
                  if (knock(q2, 'tumble', 0.7, p.vx * 0.6, rand(-0.5, 0.5))) {
                    p.chain = (p.chain || 0) + 1;
                    if (p.chain >= 3) requestShot('bowling', 90, p.wy, 2.0, 8);
                  }
                }
              }
            }
          }
          if (p.stateT <= 0) { p.state = 'getup'; p.stateT = 0.42; p.rot = 0; p.chain = 0; p.vx = 0; p.vwy = 0; }
        }
      } else {
        // ---- RUN: 1D-dominant movement ----
        let v = baseV * p.spd;
        let zoneVx = 0;

        // burst charges (pre-rolled — deterministic drama)
        const prog = p.wy / course;
        if (!p.bursted1 && prog > p.burst1) { p.bursted1 = true; p.burstT = 2.5; }
        if (!p.bursted2 && prog > p.burst2) { p.bursted2 = true; p.burstT = 2.5; }
        if (p.burstT > 0) v *= 1.65;
        if (turboT > 0) v *= 1.35;
        if (p.draft) v *= 1.14;

        // band effects & collisions — PINBALL: a hit = a bright ricochet, not a fall
        for (const b of R.bands) {
          if (p.wy < b.y - b.h || p.wy > b.y + b.h) continue;
          if (b.type === 'convey') {                         // rollover lane
            if (b.vx) zoneVx = b.vx * sc;
            if (b.vy) v *= (1 + b.vy);
          } else if (b.type === 'bumper') {                  // pop bumpers / bumper field
            for (const pd of b.pads) {
              const py = pd.y != null ? pd.y : b.y;
              const rr = pd.r + p.r * 0.55;
              const ddx = p.wx - pd.x, ddy = p.wy - py;
              if (ddx * ddx + ddy * ddy < rr * rr) {
                const d = Math.hypot(ddx, ddy) || 0.001;
                p.wx = pd.x + ddx / d * rr; p.wy = py + ddy / d * rr;   // solid — never inside
                if (p.invulnT <= 0) {
                  bounceOff(p, pd.x, py, rand(9, 13) * sc, false);
                  pd.lit = gameT;
                  spawnParticles(pd.x, py, pd.col, 6, 4);
                  if (leadP === p) addTrauma(0.12);
                  sfx('ding', 55, dk => { beep(880, 0.05, 'triangle', 0.13 * dk); beep(1320, 0.06, 'triangle', 0.07 * dk); });
                }
                break;
              }
            }
          } else if (b.type === 'hammer') {                  // swinging chrome bumpers
            for (const a of b.arms) {
              const hx = a.px + Math.sin(gameT * 6.2832 / a.period + a.phase) * a.len;
              const rr = a.headR * 0.9 + p.r * 0.5;
              const ddx = p.wx - hx, ddy = p.wy - b.y;
              if (ddx * ddx + ddy * ddy < rr * rr) {
                const d = Math.hypot(ddx, ddy) || 0.001;
                p.wx = hx + ddx / d * rr; p.wy = b.y + ddy / d * rr;
                if (p.invulnT <= 0) {
                  bounceOff(p, hx, b.y, rand(b.boss ? 13 : 11, b.boss ? 18 : 14) * sc, b.boss);
                  a.lit = gameT;
                  spawnParticles(hx, b.y, '#fff', b.boss ? 10 : 7, 5);
                  if (leadP === p) addTrauma(b.boss ? 0.22 : 0.14);
                  sfx('ding', 55, dk => { beep(b.boss ? 660 : 780, 0.06, 'triangle', 0.14 * dk); beep(b.boss ? 990 : 1170, 0.06, 'triangle', 0.08 * dk); });
                  if (b.boss && leadP === p) freezeT = Math.max(freezeT, 0.05);
                }
                break;
              }
            }
          } else if (b.type === 'sweeper') {                 // flipper — WHACK forward
            const barY = b.y + Math.sin(gameT * b.spd * 2) * b.h * 0.6;
            if (Math.abs(p.wy - barY) < 10 * sc && p.invulnT <= 0 && !shieldHit(p)) {
              p.state = 'bounce'; p.stateT = 0.3;
              p.vwy = rand(9, 13) * sc; p.vx = rand(-3, 3) * sc;
              p.spin = (raceRandom() < 0.5 ? -1 : 1) * rand(9, 14); p.rot = 0; p.invulnT = 0.15;
              b.lit = gameT;
              spawnParticles(p.wx, barY, '#ffb03d', 6, 5);
              if (leadP === p) addTrauma(0.12);
              sfx('flip', 70, dk => beep(520, 0.06, 'square', 0.14 * dk, 900));
            }
          } else if (b.type === 'crusher') {                 // kicker solenoids — launch up the table
            for (const pi of b.pistons) {
              const ph = ((gameT + pi.phase) % pi.cycle) / pi.cycle;
              if (Math.abs(p.wx - pi.x) < pi.r && Math.abs(p.wy - b.y) < pi.r * 0.7 && ph > 0.42 && ph < 0.58 && p.invulnT <= 0 && !shieldHit(p)) {
                p.state = 'bounce'; p.stateT = 0.34;
                p.vwy = rand(12, 16) * sc; p.vx = rand(-2, 2) * sc;
                p.spin = (raceRandom() < 0.5 ? -1 : 1) * rand(10, 16); p.rot = 0; p.invulnT = 0.15;
                pi.lit = gameT;
                spawnParticles(pi.x, b.y, '#7b5bff', 8, 6);
                if (leadP === p) addTrauma(0.16);
                sfx('kick', 70, dk => beep(300, 0.08, 'square', 0.16 * dk, 700));
                break;
              }
            }
          }
        }

        // banana peels
        for (const pe of peels) {
          if (!pe.alive || pe.t > 0) continue;
          if (Math.abs(p.wy - pe.wy) < 14 * sc && Math.abs(p.wx - pe.x) < 14 * sc && p.invulnT <= 0) {
            pe.alive = false;
            if (knock(p, 'slip', 0.8, rand(-2, 2) * sc, rand(-2, 0) * sc)) {
              addFloaterCap(p, T.slip);
              spawnParticles(p.wx, p.wy, '#ffe066', 6, 3);
              recordWipe('banana', p);
              sfx('slip', 90, d => beep(500, 0.1, 'sine', 0.12 * d, 200));
            }
          }
        }

        // steering: lane target = published gap of the next band
        let bandIdx = -1;
        for (let bi = 0; bi < R.bands.length; bi++) if (R.bands[bi].y > p.wy) { bandIdx = bi; break; }
        if (bandIdx >= 0 && p.gapBand !== bandIdx) {
          p.gapBand = bandIdx;
          p.gapX = clamp(p.wx + rand(-70, 70) * sc * p.courage, -R.trackW / 2 + p.r * 2, R.trackW / 2 - p.r * 2);
        }
        const steer = clamp((p.gapX - p.wx) * 0.02, -1.4, 1.4) * sc;

        // separation + slipstream via buckets (≤3 checks)
        let sep = 0; p.draft = false;
        {
          const bx = Math.floor(p.wx / cell), by = Math.floor(p.wy / cell);
          let checks = 0;
          outer: for (const [ox, oy] of NB9) {
            const nb = buckets[(bx + ox) + ':' + (by + oy)];
            if (!nb) continue;
            for (const q2 of nb) {
              if (q2 === p) continue;
              if (++checks > 6) break outer;
              const dx = p.wx - q2.wx, dy = p.wy - q2.wy;
              if (Math.abs(dx) < p.r * 1.8 && Math.abs(dy) < p.r * 1.4) sep += (dx > 0 ? 1 : -1) * 0.5 * sc;
              if (dy < 0 && dy > -p.r * 3 && Math.abs(dx) < p.r * 1.2) p.draft = true;
            }
          }
        }

        p.wx += (steer + sep + zoneVx + p.shx) * fm;
        p.wx = clamp(p.wx, -R.trackW / 2 + p.r, R.trackW / 2 - p.r);
        p.wy += (v / 60 + p.shy) * fm;
        const shd = Math.pow(0.82, fm);
        p.shx *= shd; p.shy *= shd;
        p.phase += dt * (6 + (p.burstT > 0 ? 4 : 0));

        // burst flame trail
        if (p.burstT > 0 && fxRand(0, 1) < dt * 12 && q < 2 && particles.length < 250) {
          particles.push({ x: p.wx, wy: p.wy - p.r, vx: fxRand(-0.3, 0.3), vwy: -1.5, life: 0.5, r: fxRand(2, 4), color: '#ff8a3d' });
        }
      }
    }

    // ---- runner-vs-runner collisions: real shoving ----
    // dashers shoulder-charge, downed bodies become trip hazards, gaps become contests
    for (const a of players) {
      if (a.finished || !a.started) continue;
      const aRun = a.state === 'run' || a.state === 'stumble' || a.state === 'getup' || a.state === 'bounce';
      const bx = Math.floor(a.wx / cell), by = Math.floor(a.wy / cell);
      for (const [ox, oy] of NB9) {
        const nb = buckets[(bx + ox) + ':' + (by + oy)];
        if (!nb) continue;
        for (const b of nb) {
          if (b.id <= a.id || b.finished || !b.started) continue;
          const dx = b.wx - a.wx, dy = b.wy - a.wy;
          const minD = (a.r + b.r) * 0.9;
          if (Math.abs(dx) > minD || Math.abs(dy) > minD) continue;
          const d = Math.hypot(dx, dy) || 0.001;
          if (d >= minD) continue;
          const nx = dx / d, ny = dy / d, ov = minD - d;
          const bRun = b.state === 'run' || b.state === 'stumble' || b.state === 'getup' || b.state === 'bounce';
          // trampling a downed body → trip over it
          if (aRun && !bRun) {
            if (raceRandom() < dt * 4 && a.invulnT <= 0 && a.state === 'run') {
              knock(a, 'stumble', 0.3, -nx * 1.2 * sc, -0.4 * sc);
              addFloaterCap(a, T.oops);
            }
            continue;
          }
          if (!aRun && bRun) {
            if (raceRandom() < dt * 4 && b.invulnT <= 0 && b.state === 'run') {
              knock(b, 'stumble', 0.3, nx * 1.2 * sc, -0.4 * sc);
              addFloaterCap(b, T.oops);
            }
            continue;
          }
          if (!aRun && !bRun) continue;
          // positional separation (half each, y damped so the race stays a race)
          const push = ov * 0.5;
          a.wx -= nx * push; a.wy -= ny * push * 0.6;
          b.wx += nx * push; b.wy += ny * push * 0.6;
          a.wx = clamp(a.wx, -R.trackW / 2 + a.r, R.trackW / 2 - a.r);
          b.wx = clamp(b.wx, -R.trackW / 2 + b.r, R.trackW / 2 - b.r);
          // shove impulse — dashers hit like a shoulder charge
          const aF = a.burstT > 0 ? 2.0 : 1, bF = b.burstT > 0 ? 2.0 : 1;
          const j = clamp(ov * 0.12, 0.05, 0.9) * sc;
          a.shx -= nx * j * bF; a.shy -= ny * j * 0.5 * bF;
          b.shx += nx * j * aF; b.shy += ny * j * 0.5 * aF;
          if ((aF > 1 || bF > 1) && raceRandom() < 0.3) {
            const v2 = aF > 1 ? b : a;
            if (v2.invulnT <= 0 && v2.state === 'run') {
              knock(v2, 'stumble', 0.3, (aF > 1 ? 1 : -1) * nx * 2 * sc, 0);
              addFloaterCap(v2, T.thud);
              sfx('shove', 120, dk => beep(160, 0.05, 'square', 0.1 * dk));
            }
          } else if (ov > a.r * 0.5) {
            sfx('bump', 150, dk => beep(220, 0.03, 'sine', 0.05 * dk));
          }
        }
      }
    }

    // Crossings also count during a bounce, hop or slide. Interpolate the tape time.
    const crossers = [];
    for (const p of players) {
      if (p.finished) continue;
      for (const b of R.bands) {
        if (b.type === 'item' && b.index > p.itemGate && p.prevWy < b.y && p.wy >= b.y) {
          p.itemGate = b.index; giveItem(p);
        }
      }
      if (p.wy >= course) {
        p.finT = gameT - dt + dt * clamp((course - p.prevWy) / (p.wy - p.prevWy || 1), 0, 1);
        crossers.push(p);
      }
    }
    if (crossers.length) {
      crossers.sort((a, b) => a.finT - b.finT);
      for (const p of crossers) {
        p.finished = true; finishedCount++;
        finishOrder.push(p); p.rank = finishOrder.length;
        tickFinish(p);
        if (p.rank === 1) onWinner(p);
      }
    }

    // ---- leader tracking / director ----
    if (leadP && leadP.id !== leaderId) {
      // Hold briefly so body contact does not flicker the leader announcement.
      if (pendingLead !== leadP.id) { pendingLead = leadP.id; pendingLeadT = gameT; }
      else if (gameT - pendingLeadT > 0.65) {
        const deposedDur = gameT - leadSince;
        if (state === 'racing' && leaderId >= 0) leaderChanges++;
        if (state === 'racing' && deposedDur >= 2 && leadP.wy / course > 0.12) {
          requestShot('leadchg', 70, leadP.wy, 1.5, 8);
          showBanner(`${T.leadChange} ${dispName(leadP)}`, leadP.color);
        }
        leaderId = leadP.id; leadSince = pendingLeadT; pendingLead = -1;
      }
    } else pendingLead = -1;
    const prog1 = leadP ? leadP.wy / course : 0;
    if (!finalStretch && prog1 >= 0.88 && state === 'racing') {
      finalStretch = true;
      showBanner(T.finalStretch, '#3fd0ff', 1.4, true);
    }
    if (state === 'racing' && prog1 >= 0.90) requestShot('final', 100, course, 99, 99);
    // photo finish arm
    if (state === 'racing' && !photoDone && leadP && second && prog1 >= 0.97) {
      const gap = leadP.wy - second.wy;
      if (gap < 40 * sc && !photoActive) {
        photoActive = true;
        setSlowmo(0.25, 8);                     // realDt budget — covers ~2 game-seconds to the tape
        requestShot('photo', 120, course, 99, 99);
        showBanner(T.photoFinish, '#ffd23f', 1.6, true);
      }
    }
    // photo-finish disarm: the duel blew out — drop the fake suspense
    if (photoActive && state === 'racing' && leadP && second && (leadP.wy - second.wy) > 90 * sc) {
      photoActive = false;
      slowmo = { ts: 1, t: 0 };
      shot = { type: 'final', until: gameT + 99, prio: 100 };
    }

    // ---- camera (single shared rank sort per frame) ----
    sortedUnfin = players.filter(p2 => !p2.finished).sort((a, b) => b.wy - a.wy);
    updateCamera(fm);
    hudT -= dt;
    if (hudT <= 0) {
      hudT = 0.2;
      fx.updateHud(finishOrder.concat(sortedUnfin).slice(0, 3), gameT, course,
        turboT > 0 ? T.turboFever : (EVENTS[nextEvent] ? T.nextEvent(Math.max(0, Math.ceil(EVENTS[nextEvent].at - gameT))) : T.finalStretch), dispName);
    }

    // ---- effects ----
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      pt.x += pt.vx * fm; pt.wy += pt.vwy * fm;
      pt.life -= dt * 2.2;
      if (pt.life <= 0) particles.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i]; f.wy += 0.9 * fm; f.life -= dt * 1.3;
      if (f.life <= 0) floaters.splice(i, 1);
    }
    for (let i = peels.length - 1; i >= 0; i--) {
      const pe = peels[i];
      if (pe.t > 0) pe.t -= dt;
      pe.life -= dt;
      if (!pe.alive || pe.life <= 0) peels.splice(i, 1);
    }
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.x += c.vx * fm; c.y += c.vy * fm; c.vy += 0.12 * fm; c.rot += c.vr * fm;
      if (c.y > H + 20) confetti.splice(i, 1);
    }
    trauma *= Math.pow(0.9, fm);

    // ---- finale: fast-forward the tail, then whistle ----
    if (state === 'finale') {
      if (gameT - winnerGameT > 4 && !ffMode && timeScale > 0.9) {
        ffMode = true;
        document.getElementById('ffChip').style.display = 'block';
        slowmo = { ts: 3, t: 999 };
      }
      const allDone = finishedCount >= players.length;
      if (allDone || gameT - winnerGameT > 30) endRace();
    }

    document.getElementById('finCount').textContent = finishedCount;
    window.__st = { t: Math.round(gameT * 10) / 10, fin: finishedCount, total: players.length,
      lead: Math.round(prog1 * 100), state, q, fms: Math.round(frameMs * 10) / 10, leaderChanges, events: nextEvent };
  }

  function addFloaterCap(p, text) {
    if (floaters.length < 8) addFloater(p.wx, p.wy, text, '#ffb03d');
  }

  function tickFinish(p) {
    const tk = document.getElementById('ticker');
    const row = document.createElement('div');
    row.className = 'tickRow' + (p.rank <= 3 ? ' gold' : '');
    row.textContent = `${T.rankNo(p.rank)} ${dispName(p)}`;
    tk.prepend(row);
    while (tk.children.length > 3) tk.removeChild(tk.lastChild);
    if (p.rank <= 10 || p.rank % 25 === 0)
      sfx('ding', 90, d => beep(600 + Math.max(0, 10 - p.rank) * 40, 0.08, 'triangle', 0.1 * d));
  }

  function onWinner(p) {
    winner = p; winnerGameT = gameT;
    state = 'finale';
    if (photoActive) {
      freezeT = 0.25; fireFlash();
      photoPending = true;
      photoDone = true; photoActive = false;
      setSlowmo(1, 0.01);
    } else {
      fireFlash();
      showBanner(`${T.winner} ${dispName(p)} 🏆`, '#ffd23f', 2, true);
    }
    burstConfettiScreen();
    fanfare(); addTrauma(0.6);
  }
  function burstConfettiScreen() {
    const colors = ['#ffd23f', '#ff4d6d', '#25d366', '#7b5bff', '#3fd0ff', '#ff8a3d'];
    for (let i = 0; i < 150; i++) {
      confetti.push({
        x: fxRand(0, W), y: fxRand(-H * 0.4, 0),
        vx: fxRand(-2, 2), vy: fxRand(2, 6),
        r: fxRand(4, 9), rot: fxRand(0, 6.28), vr: fxRand(-0.3, 0.3),
        color: colors[i % colors.length],
      });
    }
  }
  function capturePolaroid() {
    try {
      const off = document.createElement('canvas');
      const pw = Math.min(W - 36, 440), ph = pw * 0.62;
      off.width = pw * DPR; off.height = ph * DPR;
      const og = off.getContext('2d');
      const finY = H * 0.44 + (cam.wy - race.course) * TILT * cam.zoom;   // the tape's actual screen y
      const cy0 = clamp(finY - ph * 0.55, 0, Math.max(0, H - ph));
      og.drawImage(canvas, (W / 2 - pw / 2) * DPR, cy0 * DPR, pw * DPR, ph * DPR, 0, 0, pw * DPR, ph * DPR);
      polaroid = { c: off, t0: performance.now(), pw, ph };
      sfx('snap', 200, d => beep(1200, 0.05, 'square', 0.14 * d));
    } catch (e) { polaroid = null; }
  }

  function endRace() {
    if (state === 'over') return;
    state = 'over';
    slowmo = { ts: 1, t: 0 }; timeScale = 1;
    document.getElementById('ffChip').style.display = 'none';
    beep(880, 0.4, 'triangle', 0.18);   // whistle
    // rank the unfinished by progress
    const rest = players.filter(p => !p.finished).sort((a, b) => b.wy - a.wy);
    for (const p of rest) { p.rank = finishOrder.length + 1; finishOrder.push(p); }
    fx.updateHud(finishOrder.slice(0, 3), gameT, race.course, T.winner, dispName);
    setTimeout(showResults, 900);
  }

  // ---------- Camera director ----------
  function cameraFit() {
    return race ? Math.max(0.25, Math.min(1.55, (W - 36) / (race.trackW * 1.14), (H - 130) / 220)) : 1;
  }
  function updateCamera(fm) {
    const fit = cameraFit(), course = race.course;
    if (gameT > shot.until && shot.prio < 100) shot = { type: 'follow', until: 0, prio: 0 };
    const front = sortedUnfin.slice(0, players.length <= 12 ? 5 : 8);
    const spread = front.length > 1 ? (front[0].wy - front[front.length - 1].wy) * TILT : 0;
    cam.tx = 0;
    cam.tz = Math.min(fit, Math.max(fit * 0.8, (H - 250) / Math.max(220, spread)));
    if (front.length) cam.twy = front.reduce((sum, p) => sum + p.wy, 0) / front.length + 70;
    if ((shot.type === 'final' || shot.type === 'photo') && !(state === 'finale' && gameT - winnerGameT > 2.5)) {
      cam.twy = course - 110;
      cam.tz = fit;
    } else if (shot.prio >= 70 && shot.prio < 100 && !reduceMotion) {
      cam.twy = shot.fwy + 65;
      cam.tz = fit;
    }
    const k = 1 - Math.pow(reduceMotion ? 0.96 : 0.92, fm);
    cam.wy += (cam.twy - cam.wy) * k;
    cam.x += (cam.tx - cam.x) * k;
    cam.zoom += (cam.tz - cam.zoom) * k;
  }

  // ---------- Render ----------
  function wldY(wy) { return (cam.wy - wy) * TILT; }     // world→camera-local (y grows downward on screen)
  function persp(sy) { return clamp(1 + sy / (H * 1.5), 0.72, 1.12); }  // nearer (lower) = bigger
  function prX(wx, sy) { return (wx - cam.x) * persp(sy); }           // converging-corridor projection

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);   // self-healing: a mid-frame exception can never compound
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)*0.7);
    bg.addColorStop(0, '#12102a'); bg.addColorStop(1, '#07070f');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (!race) return;
    const R = race, sc = R.sc;

    ctx.save();
    ctx.translate(W * 0.5, H * 0.44);
    ctx.scale(cam.zoom, cam.zoom);
    const shakePx = trauma * trauma * 14;
    if (shakePx > 0.3 && timeScale > 0.999) ctx.translate(Math.sin(gameT * 71) * shakePx / cam.zoom, Math.cos(gameT * 83) * shakePx / cam.zoom);

    const topWy = cam.wy + (H * 0.44 / cam.zoom) / TILT + 80;
    const botWy = cam.wy - (H * 0.56 / cam.zoom) / TILT - 80;

    // 2.5D corridor: perspective floor + depth rungs + converging neon rails
    const TL = -R.trackW / 2, TR = R.trackW / 2;
    const yT = wldY(topWy), yB = wldY(botWy);
    ctx.beginPath();
    ctx.moveTo(prX(TL - 8, yT), yT); ctx.lineTo(prX(TR + 8, yT), yT);
    ctx.lineTo(prX(TR + 8, yB), yB); ctx.lineTo(prX(TL - 8, yB), yB);
    ctx.closePath();
    ctx.fillStyle = turboT > 0 ? 'rgba(44,110,73,.34)' : 'rgba(36,59,79,.45)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let ry = Math.ceil(botWy / 150) * 150; ry < topWy; ry += 150) {
      const sy = wldY(ry);
      ctx.moveTo(prX(TL, sy), sy); ctx.lineTo(prX(TR, sy), sy);
    }
    ctx.stroke();
    ctx.strokeStyle = turboT > 0 ? '#b9ff66' : '#55c6d7'; ctx.lineWidth = 4;
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(prX(TL - 8, yT), yT); ctx.lineTo(prX(TL - 8, yB), yB);
    ctx.moveTo(prX(TR + 8, yT), yT); ctx.lineTo(prX(TR + 8, yB), yB);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // start & finish lines
    drawCheckerLine(0, sc);
    drawCheckerLine(R.course, sc, true);

    // bands in view
    for (const b of R.bands) {
      if (b.y + b.h < botWy || b.y - b.h > topWy) continue;
      drawBand(b, sc);
    }

    // peels
    for (const pe of peels) {
      if (pe.wy < botWy || pe.wy > topWy) continue;
      const y = wldY(pe.wy);
      const pfP = persp(y), X = prX(pe.x, y);
      if (pe.t > 0) {   // falling shadow telegraph
        ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.ellipse(X, y, 8 * sc * pfP, 3.5 * sc * pfP, 0, 0, 7);
        ctx.fillStyle = '#000'; ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.font = `${Math.max(10, 13 * sc * pfP)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🍌', X, y);
      }
    }

    // particles
    for (const pt of particles) {
      ctx.globalAlpha = Math.max(0, pt.life);
      const py2 = wldY(pt.wy);
      ctx.beginPath(); ctx.arc(prX(pt.x, py2), py2, pt.r * pt.life + 0.5, 0, 7);
      ctx.fillStyle = pt.color; ctx.fill();
    }
    ctx.globalAlpha = 1;

    // runners — painter order by wy (draw far/up first), LOD by count & quality
    const vis = [];
    for (const p of players) {
      if (p.finished && gameT - p.finT > 2.5) continue;
      if (p.wy < botWy || p.wy > topWy) continue;
      vis.push(p);
    }
    vis.sort((a, b) => b.wy - a.wy);
    const full = vis.length <= 30 && q === 0;
    // Emoji rasterization spikes on mobile at 300 entrants. Spend detail on the front.
    const effectBudget = q === 2 ? 6 : q === 1 ? 12 : 24;
    vis.forEach((p, i) => drawRunner(p, sc, full, i < effectBudget));
    if (vis.length) {
      const v0 = vis[0], sy0 = wldY(v0.wy);
      window.__r = { vis: vis.length, camWy: Math.round(cam.wy), zoom: Math.round(cam.zoom * 100) / 100,
        p0: { wy: Math.round(v0.wy), sy: Math.round(sy0), sx: Math.round(prX(v0.wx, sy0)) },
        topWy: Math.round(topWy), botWy: Math.round(botWy), sprW: sprites[0] && sprites[0]._l };
    } else window.__r = { vis: 0, camWy: Math.round(cam.wy), topWy: Math.round(topWy), botWy: Math.round(botWy) };

    // floaters (world space)
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, f.life);
      const fy = wldY(f.wy), FX = prX(f.x, fy);
      ctx.font = `900 ${f.big ? 26 : 18}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillText(f.text, FX + 2, fy + 2);
      ctx.fillStyle = f.color; ctx.fillText(f.text, FX, fy);
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    // ---- screen space ----
    fx.labels(finishOrder.concat(sortedUnfin).slice(0, 3), W, H,
      p => ({ x: W / 2 + prX(p.wx, wldY(p.wy)) * cam.zoom, y: H * 0.44 + wldY(p.wy) * cam.zoom }), dispName);
    drawMinimap();
    for (const c of confetti) {
      ctx.save();
      ctx.translate(c.x, c.y); ctx.rotate(c.rot);
      ctx.fillStyle = c.color;
      ctx.fillRect(-c.r / 2, -c.r / 2, c.r, c.r * 1.6);
      ctx.restore();
    }
    if (flashT > 0) {
      const a = 0.35 * (flashT / 0.08);
      const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*0.25, W/2, H/2, Math.max(W,H)*0.75);
      vg.addColorStop(0, 'rgba(255,210,63,0)');
      vg.addColorStop(1, `rgba(255,190,50,${a})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }
    if (polaroid) drawPolaroid();
    if (banner) {
      const bt = banner.t, d = banner.dur;
      const pop = reduceMotion ? 1 : bt < 0.25 ? 1.12 - 0.48 * bt : 1;
      const alpha = bt > d - 0.3 ? (d - bt) / 0.3 : 1;
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.translate(W / 2, H < 500 ? 120 : H * 0.23);
      ctx.scale(pop, pop);
      ctx.font = `900 ${Math.min(38, (W - 36) / Math.max(6, banner.text.length))}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(10,8,20,.85)';
      ctx.strokeText(banner.text, 0, 0);
      ctx.fillStyle = banner.color;
      ctx.shadowColor = banner.color; ctx.shadowBlur = 24;
      ctx.fillText(banner.text, 0, 0);
      ctx.restore();
    }
  }

  function drawCheckerLine(wy, sc, isFinish) {
    const R = race;
    const y = wldY(wy);
    const pf = persp(y);
    const seg = 16 * sc;
    for (let i = 0; i < Math.ceil(R.trackW / seg); i++) {
      ctx.fillStyle = i % 2 ? '#e8e8f4' : '#181828';
      ctx.fillRect(prX(-R.trackW / 2 + i * seg, y), y - 5 * sc * pf, seg * pf + 0.5, 10 * sc * pf);
    }
    if (isFinish) {
      ctx.font = `900 ${22 * sc * pf}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd23f';
      ctx.fillText('🏁 FINISH', prX(0, y), y - 22 * sc * pf);
    }
  }

  // glossy pop-bumper (screen-space)
  function drawBumperS(X, Y, R2, col, lit) {
    if (R2 <= 0.5) return;
    const litAmt = clamp(1 - (gameT - lit) / 0.25, 0, 1);
    ctx.globalAlpha = 0.22;
    ctx.beginPath(); ctx.ellipse(X, Y + R2 * 0.5, R2 * 0.9, R2 * 0.3, 0, 0, 7);
    ctx.fillStyle = '#000'; ctx.fill(); ctx.globalAlpha = 1;
    if (litAmt > 0) {
      ctx.globalAlpha = litAmt;
      ctx.beginPath(); ctx.arc(X, Y, R2 * (1 + (1 - litAmt) * 0.9), 0, 7);
      ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.beginPath(); ctx.arc(X, Y, R2 * 1.04, 0, 7);
    ctx.lineWidth = 3 + litAmt * 3; ctx.strokeStyle = col;
    ctx.shadowColor = col; ctx.shadowBlur = 12 + litAmt * 18; ctx.stroke(); ctx.shadowBlur = 0;
    const g = ctx.createRadialGradient(X - R2 * 0.3, Y - R2 * 0.35, R2 * 0.1, X, Y, R2);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, col); g.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.beginPath(); ctx.arc(X, Y, R2, 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); ctx.arc(X, Y, R2 * 0.55, 0, 7);
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.stroke();
  }

  function drawBand(b, sc) {
    const y = wldY(b.y);
    const R = race, TL = -R.trackW / 2, TR = R.trackW / 2;
    const pfB = persp(y);
    if (b.type === 'item') {
      fx.itemGate(b, R.trackW, prX, wldY, persp, gameT);
    } else if (b.type === 'bumper') {
      for (const pd of b.pads) {
        const py = pd.y != null ? pd.y : b.y, sy = wldY(py);
        drawBumperS(prX(pd.x, sy), sy, pd.r * persp(sy), pd.col, pd.lit);
      }
    } else if (b.type === 'hammer') {
      if (b.boss) {
        ctx.font = `900 ${15 * sc * pfB}px sans-serif`; ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd23f';
        ctx.fillText(T.finalGate, prX(0, y), y - b.h * 0.72);
      }
      const col = b.boss ? '#ff2d3d' : '#ff5d84';
      for (const a of b.arms) {
        const hx = a.px + Math.sin(gameT * 6.2832 / a.period + a.phase) * a.len;
        const X = prX(hx, y), PX = prX(a.px, y);
        ctx.strokeStyle = 'rgba(210,200,255,.5)'; ctx.lineWidth = 4 * sc * pfB; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(PX, y - a.len * 1.0 * pfB); ctx.lineTo(X, y - a.headR * pfB); ctx.stroke();
        drawBumperS(X, y, a.headR * pfB, col, a.lit);
      }
    } else if (b.type === 'sweeper') {
      const barY = wldY(b.y + Math.sin(gameT * b.spd * 2) * b.h * 0.6);
      const pfS = persp(barY);
      const litAmt = clamp(1 - (gameT - (b.lit || -9)) / 0.2, 0, 1);
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.ellipse(prX(0, barY), barY + 5 * sc * pfS, R.trackW * 0.5 * pfS, 5 * sc * pfS, 0, 0, 7);
      ctx.fillStyle = '#000'; ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineCap = 'round';
      ctx.strokeStyle = litAmt > 0.3 ? '#fff' : '#ffb03d'; ctx.lineWidth = 10 * sc * pfS;
      ctx.shadowColor = '#ffb03d'; ctx.shadowBlur = 12 + litAmt * 20;
      ctx.beginPath(); ctx.moveTo(prX(TL + 6, barY), barY); ctx.lineTo(prX(TR - 6, barY), barY); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 3 * sc * pfS;
      ctx.beginPath(); ctx.moveTo(prX(TL + 6, barY), barY - 2.5 * sc * pfS); ctx.lineTo(prX(TR - 6, barY), barY - 2.5 * sc * pfS); ctx.stroke();
    } else if (b.type === 'convey') {
      const y0 = wldY(b.y + b.h), y1 = wldY(b.y - b.h);
      ctx.beginPath();
      ctx.moveTo(prX(TL, y0), y0); ctx.lineTo(prX(TR, y0), y0);
      ctx.lineTo(prX(TR, y1), y1); ctx.lineTo(prX(TL, y1), y1);
      ctx.closePath();
      const cc = b.vy ? '255,77,109' : '63,208,255';
      ctx.fillStyle = `rgba(${cc},.14)`; ctx.fill();
      ctx.strokeStyle = `rgba(${cc},.75)`; ctx.lineWidth = 3;
      ctx.shadowColor = `rgba(${cc},.7)`; ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(prX(TL, y0), y0); ctx.lineTo(prX(TL, y1), y1);
      ctx.moveTo(prX(TR, y0), y0); ctx.lineTo(prX(TR, y1), y1);
      ctx.stroke(); ctx.shadowBlur = 0;
      // scrolling chevron arrows
      ctx.strokeStyle = `rgba(${cc},.8)`; ctx.lineWidth = 3 * sc;
      const scroll = (gameT * (b.vy ? -0.4 : 0.4)) % 1;
      for (let i = -1; i < 4; i++) {
        const t2 = (i + scroll) / 3;
        const ay = y0 + (y1 - y0) * t2;
        if (ay < Math.min(y0, y1) || ay > Math.max(y0, y1)) continue;
        const pfa = persp(ay), aw = 22 * sc * pfa, ah = 12 * sc * pfa;
        for (let s2 = -1; s2 <= 1; s2 += 2) {
          const ax = prX(s2 * R.trackW * 0.22, ay);
          ctx.beginPath();
          if (b.vx) { ctx.moveTo(ax - aw * Math.sign(b.vx), ay - ah); ctx.lineTo(ax, ay); ctx.lineTo(ax - aw * Math.sign(b.vx), ay + ah); }
          else { ctx.moveTo(ax - aw, ay + ah); ctx.lineTo(ax, ay - ah); ctx.lineTo(ax + aw, ay + ah); }
          ctx.stroke();
        }
      }
      ctx.font = `900 ${13 * sc * pfB}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillStyle = b.vy ? '#ff8aa0' : '#8adfff';
      ctx.fillText(b.vy ? T.reverseLane : T.pushLane, prX(0, y), y);
    } else if (b.type === 'crusher') {
      for (const pi of b.pistons) {
        const ph = ((gameT + pi.phase) % pi.cycle) / pi.cycle;
        const firing = ph > 0.42 && ph < 0.58;
        const litAmt = clamp(1 - (gameT - pi.lit) / 0.25, 0, 1);
        const X = prX(pi.x, y), R2 = pi.r * pfB;
        ctx.beginPath(); ctx.ellipse(X, y, R2, R2 * 0.42, 0, 0, 7);
        ctx.fillStyle = firing ? 'rgba(123,91,255,.5)' : 'rgba(123,91,255,.16)'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = '#7b5bff';
        ctx.shadowColor = '#7b5bff'; ctx.shadowBlur = firing ? 22 : 8; ctx.stroke(); ctx.shadowBlur = 0;
        ctx.fillStyle = firing ? '#fff' : 'rgba(210,200,255,.8)';
        ctx.beginPath(); ctx.moveTo(X, y - R2 * 0.55); ctx.lineTo(X - R2 * 0.4, y + R2 * 0.12); ctx.lineTo(X + R2 * 0.4, y + R2 * 0.12); ctx.closePath(); ctx.fill();
        if (litAmt > 0) {
          ctx.globalAlpha = litAmt;
          ctx.beginPath(); ctx.arc(X, y, R2 * (1 + (1 - litAmt) * 1.3), 0, 7);
          ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.globalAlpha = 1;
        }
      }
    }
  }

  function drawRunner(p, sc, full, detailed) {
    const ground = wldY(p.wy);
    const y = ground - (p.hopT > 0 ? Math.sin(p.hopT / 0.65 * Math.PI) * 60 : 0);
    const depth = persp(y);
    const x = prX(p.wx, y);
    // ground shadow (2.5D anchor)
    ctx.globalAlpha = 0.28;
    ctx.beginPath(); ctx.ellipse(x, ground + 2 * depth, 8 * sc * depth, 2.8 * sc * depth, 0, 0, 7);
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.globalAlpha = 1;
    fx.runner(p, x, y, depth * 1.25, gameT, detailed);

    if (!full) {
      // MID LOD: pre-rendered sprite (glow baked, zero canvas effects)
      const spr = sprites[p.spriteIdx];
      const s = spr._l * depth;
      ctx.save();
      ctx.translate(x, y);
      if (p.state === 'tumble' || p.state === 'slip' || p.state === 'bounce') ctx.rotate(p.rot);
      else if (p.state === 'flat' || p.state === 'mudface') ctx.scale(1.5, 0.3);
      else if (p.state === 'getup') { const gu = 1 - clamp(p.stateT / 0.42, 0, 1); ctx.translate(0, -3 * Math.sin(gu * Math.PI) * sc); ctx.scale(lerp(1.4, 1, gu), lerp(0.4, 1, gu)); }
      ctx.drawImage(spr, -s / 2, -s / 2, s, s);
      ctx.restore();
      if (p.burstT > 0) {
        ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.arc(x, y + p.r, 3 * sc, 0, 7);
        ctx.fillStyle = '#ff8a3d'; ctx.fill();
        ctx.globalAlpha = 1;
      }
      return;
    }

    // FULL LOD stickman (≤30 visible only)
    const s = (p.r / 10) * depth * 1.25;
    ctx.save();
    ctx.translate(x, y);
    if (p.state === 'tumble' || p.state === 'slip' || p.state === 'bounce') ctx.rotate(p.rot);
    else if (p.state === 'flat' || p.state === 'mudface') { ctx.scale(1.6, 0.2); }
    else if (p.state === 'getup') { const gu = 1 - clamp(p.stateT / 0.42, 0, 1); ctx.translate(0, -4 * Math.sin(gu * Math.PI) * s); ctx.scale(lerp(1.5, 1, gu), lerp(0.35, 1, gu)); ctx.rotate((1 - gu) * 0.3); }
    else if (p.state === 'stumble') ctx.rotate(Math.sin(gameT * 30) * 0.2);
    const hipY = -7 * s, neckY = -13 * s, headR = 6.2 * s;
    const headY = neckY - headR * 0.7;
    const swing = Math.sin(p.phase) * 0.9;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = Math.max(2.5, 3.6 * s);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, hipY); ctx.lineTo(Math.sin(swing) * 7 * s, hipY + Math.cos(swing * 0.8) * 7 * s);
    ctx.moveTo(0, hipY); ctx.lineTo(-Math.sin(swing) * 7 * s, hipY + Math.cos(swing * 0.8) * 7 * s);
    ctx.moveTo(0, hipY); ctx.lineTo(0, neckY);
    ctx.moveTo(0, neckY + s); ctx.lineTo(Math.sin(0.5 - swing) * 6 * s, neckY + s + Math.cos(0.5 - swing) * 6 * s);
    ctx.moveTo(0, neckY + s); ctx.lineTo(Math.sin(-0.5 + swing) * 6 * s, neckY + s + Math.cos(-0.5 + swing) * 6 * s);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, headY, headR, 0, 7);
    ctx.fillStyle = p.color; ctx.fill();
    for (const m of [-1, 1]) {
      ctx.beginPath(); ctx.arc(m * headR * 0.4, headY - headR * 0.1, headR * 0.26, 0, 7);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(m * headR * 0.4, headY - headR * 0.28, headR * 0.13, 0, 7);
      ctx.fillStyle = '#222'; ctx.fill();
    }
    ctx.restore();
    if (p.burstT > 0) {
      ctx.globalAlpha = 0.7;
      ctx.font = `${Math.max(9, 11 * s)}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText('🔥', x, y + 8 * s);
      ctx.globalAlpha = 1;
    }
  }

  function drawMinimap() {
    if (!race || state === 'menu') return;
    const R = race;
    if (W < 600 || H < 500) return; // The horizontal progress strip replaces it on phones.
    const mx = W - 26, mtop = 110, mh = H - 300;
    ctx.fillStyle = 'rgba(18,16,38,.7)';
    ctx.fillRect(mx - 6, mtop - 6, 24, mh + 12);
    // band markers
    for (const b of R.bands) {
      const yy = mtop + mh * (1 - b.y / R.course);
      ctx.fillStyle = b.type === 'mud' ? 'rgba(140,105,60,.8)' :
                      b.type === 'convey' ? 'rgba(63,208,255,.6)' : 'rgba(255,77,109,.7)';
      ctx.fillRect(mx - 4, yy - 2, 20, 4);
    }
    // finish
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(mx - 4, mtop - 2, 20, 3);
    // dots (every 2nd frame at q0/q1, 4th at q2)
    const step = q === 2 ? 2 : 1;
    for (let i = 0; i < players.length; i += step) {
      const p = players[i];
      if (p.finished) continue;
      const yy = mtop + mh * (1 - clamp(p.wy / R.course, 0, 1));
      const xx = mx + 6 + (p.wx / R.trackW) * 14;
      ctx.fillStyle = p.color;
      ctx.fillRect(xx, yy, 2, 2);
    }
    // top-3 medals
    const top3 = sortedUnfin.slice(0, 3);
    const medal = ['#ffd23f', '#c8d2e6', '#cd7f32'];
    top3.forEach((p, i) => {
      const yy = mtop + mh * (1 - clamp(p.wy / R.course, 0, 1));
      ctx.fillStyle = medal[i];
      ctx.fillRect(mx + 4 + (p.wx / R.trackW) * 14 - 1, yy - 1, 5, 5);
    });
  }

  function drawPolaroid() {
    const t = (performance.now() - polaroid.t0) / 1000;
    const { c, pw, ph } = polaroid;
    const scIn = t < 0.3 ? t / 0.3 : 1;
    ctx.save();
    ctx.translate(W / 2, H * 0.42);
    ctx.rotate(-0.06);
    ctx.scale(scIn, scIn);
    ctx.fillStyle = '#f4f2ec';
    ctx.fillRect(-pw / 2 - 12, -ph / 2 - 12, pw + 24, ph + 58);
    ctx.drawImage(c, -pw / 2, -ph / 2, pw, ph);
    ctx.font = '900 20px sans-serif'; ctx.textAlign = 'center';
    if (t < 1.2) {
      ctx.fillStyle = `rgba(60,50,40,${0.5 + 0.5 * Math.sin(t * 12)})`;
      ctx.fillText(T.reviewing, 0, ph / 2 + 30);
    } else {
      ctx.fillStyle = '#c22';
      ctx.fillText(`🏆 ${winner ? dispName(winner) : ''}`, 0, ph / 2 + 30);
    }
    ctx.restore();
    if (t > 3.2) polaroid = null;
  }

  // ---------- Countdown (scripted grid pan) ----------
  const CD_SEQ = ['3', '2', '1', 'GO!'];
  function tickCountdown(dt) {
    cdT += dt;
    // pan from the back of the grid to the start line
    if (race) {
      const gridBack = race.gridBack;
      cam.twy = lerp(gridBack, 0, cdT / 2.9);
      cam.tz = cameraFit() * 0.9;
      const k = 1 - Math.pow(0.94, dt * 60);
      cam.wy += (cam.twy - cam.wy) * k;
      cam.zoom += (cam.tz - cam.zoom) * k;
    }
    const idx = Math.floor(cdT / 0.72);
    if (idx !== cdIdx) {
      cdIdx = idx;
      const el = document.getElementById('countdown');
      if (idx < CD_SEQ.length) {
        el.style.display = 'flex';
        el.textContent = CD_SEQ[idx];
        el.style.color = idx === 3 ? '#25d366' : '#ffd23f';
        if (!reduceMotion) {
          el.animate(
            [{ transform: 'scale(1.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.3)', opacity: 0 }],
            { duration: 700, easing: 'ease-out' }
          );
        }
        beep(idx === 3 ? 660 : 440, 0.12, 'triangle', 0.14);
      } else {
        el.style.display = 'none';
        state = 'racing';
        cam.tz = cameraFit();
        showBanner(T.racersStart(players.length), '#3fd0ff', 1.4, true);
        addTrauma(0.5);
        beep(220, 0.5, 'sawtooth', 0.2, 440);   // klaxon
      }
    }
  }

  // ---------- Loop ----------
  const STEP = 1 / 60;
  let accumulator = 0;
  let last = performance.now();
  let lastSizeCheck = 0;
  function step() {
    const now = performance.now();
    let realDt = (now - last) / 1000;
    if (realDt < STEP * 0.9) return;
    last = now;
    if (realDt > 0.05) realDt = 0.05;

    if (now - lastSizeCheck > 500) {
      lastSizeCheck = now;
      if (window.innerWidth !== W || window.innerHeight !== H) { resize(); remapWorld(); }
    }

    if (freezeT > 0) { freezeT -= realDt; render(); return; }
    if (flashT > 0) flashT -= realDt;
    if (banner) { banner.t += realDt; if (banner.t > banner.dur) banner = null; }

    if (slowmo.t > 0) { slowmo.t -= realDt; timeScale = slowmo.ts; }
    else timeScale += ((ffMode ? 3 : 1) - timeScale) * Math.min(1, realDt * 2.5);
    const dt = realDt * timeScale;
    const fm = dt * 60;

    const t0 = performance.now();
    if (state === 'countdown') tickCountdown(realDt);
    else if (state === 'racing' || state === 'finale') {
      // Every device takes identical physics steps, including the x3 tail finish.
      accumulator += dt;
      while (accumulator >= STEP && (state === 'racing' || state === 'finale')) {
        update(STEP, 1);
        accumulator -= STEP;
      }
    }
    else if (state === 'over') {
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i]; c.x += c.vx * fm; c.y += c.vy * fm; c.vy += 0.12 * fm; c.rot += c.vr * fm;
        if (c.y > H + 20) confetti.splice(i, 1);
      }
      trauma *= Math.pow(0.9, fm);
    }
    render();
    if (photoPending) { photoPending = false; capturePolaroid(); }
    // adaptive quality ladder
    frameMs = frameMs * 0.95 + (performance.now() - t0) * 0.05;
    q = frameMs > 10 ? 2 : frameMs > 7 ? 1 : (players.length > 150 && state === 'countdown') ? 1 : 0;
  }
  render();
  (function raf() { step(); requestAnimationFrame(raf); })();
  try {
    const src = 'setInterval(function(){postMessage(0);},1000/70);';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = step;
  } catch (e) {
    setInterval(step, 1000 / 60);
  }

  // ---------- Results ----------
  function showResults() {
    const ws = document.getElementById('winScreen');
    document.getElementById('winName').textContent = winner ? dispName(winner) : '-';
    const list = document.getElementById('rankList');
    const gap = finishOrder[1]?.finished ? finishOrder[1].finT - finishOrder[0].finT : null;
    document.getElementById('raceSummary').textContent = T.raceRecap(leaderChanges) +
      (gap !== null ? ' · ' + T.finishGap(gap.toFixed(2)) : '');
    list.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    const cls = ['gold', 'silver', 'bronze'];
    finishOrder.forEach((p, idx) => {
      const li = document.createElement('li');
      li.className = 'rankItem' + (idx < 3 ? ' ' + cls[idx] : '');
      const tme = p.finished ? `<span class="rankTime">${p.finT.toFixed(2)}s</span>` : `<span class="rankTime">DNF</span>`;
      li.innerHTML =
        `<span class="rankNo">${idx < 3 ? medals[idx] : (idx + 1)}</span>` +
        `<span class="dot" style="background:${p.color}"></span>` +
        `<span class="rankName">${esc(dispName(p))}</span>` + tme;
      list.appendChild(li);
    });
    ws.classList.remove('hidden');
    document.getElementById('raceBoard').hidden = true;
  }

  // ---------- Roster: type "name * 4", the add button queues that many ----------
  const MAXN = 300, MIN_START = 2;
  const nameInput = document.getElementById('nameInput');
  const addBtn = document.getElementById('addBtn');
  const clearBtn = document.getElementById('clearBtn');
  const rosterList = document.getElementById('rosterList');
  const countVal = document.getElementById('countVal');
  const lobbyHint = document.getElementById('lobbyHint');
  const startBtn = document.getElementById('startBtn');
  let entries = [];   // [{ name, count }]

  const totalCount = () => entries.reduce((s, e) => s + e.count, 0);
  function expandRoster() {
    const out = [];
    for (const e of entries) for (let k = 0; k < e.count; k++) { if (out.length >= MAXN) return out; out.push(e.name); }
    return out;
  }
  // "name * 4" / "name x4" -> {name, 4}. No multiplier means a single entry.
  function parseEntry(text) {
    const line = (text || '').trim(); if (!line) return null;
    let name = line, count = 1;
    const m = line.match(/^(.+?)\s*[*xX×]\s*(\d+)\s*$/);
    if (m) { name = m[1].trim(); count = parseInt(m[2], 10) || 1; }
    name = name.slice(0, 8); if (!name) return null;
    return { name, count: Math.max(1, count) };
  }
  function addEntry(text) {
    const e = parseEntry(text); if (!e) return false;
    const room = MAXN - totalCount(); if (room <= 0) return false;
    e.count = Math.min(e.count, room);
    const ex = entries.find(x => x.name === e.name);
    if (ex) ex.count += e.count; else entries.push(e);
    renderRoster(); return true;
  }
  function renderRoster() {
    const total = totalCount();
    window.__names = expandRoster();
    playerCount = total;
    countVal.textContent = total;
    rosterList.innerHTML = '';
    if (entries.length === 0) {
      const em = document.createElement('div'); em.className = 'rosterEmpty';
      em.textContent = T.rosterEmpty; rosterList.appendChild(em);
    } else entries.forEach((e, i) => {
      const chip = document.createElement('span'); chip.className = 'chip';
      const lab = document.createElement('span'); lab.textContent = e.count > 1 ? `${e.name} ×${e.count}` : e.name;
      const x = document.createElement('button'); x.className = 'chipX'; x.type = 'button'; x.textContent = '✕';
      x.onclick = () => { entries.splice(i, 1); renderRoster(); };
      chip.appendChild(lab); chip.appendChild(x); rosterList.appendChild(chip);
    });
    const ok = total >= MIN_START;
    startBtn.disabled = !ok;
    startBtn.style.opacity = ok ? '' : '.4';
    startBtn.style.cursor = ok ? '' : 'not-allowed';
    lobbyHint.textContent = total === 0 ? T.hintEmpty
      : ok ? T.hintReady(total)
           : T.hintNeedMore(MIN_START);
    try { localStorage.setItem('minigame_roster', JSON.stringify(entries)); } catch (e) {}
  }
  addBtn.onclick = () => { if (addEntry(nameInput.value)) { nameInput.value = ''; nameInput.focus(); } };
  // keyCode 229 covers Safari, which reports isComposing=false while an IME is still composing.
  nameInput.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return;   // let the IME commit first
    ev.preventDefault();
    addBtn.onclick();
  });
  clearBtn.onclick = () => { entries = []; renderRoster(); };
  // quick-add: drop in N bots at once
  document.querySelectorAll('.preset').forEach(b => b.onclick = () => addEntry(T.botName + ' * ' + (+b.dataset.n)));
  try {
    const v = localStorage.getItem('minigame_roster');
    if (v) entries = JSON.parse(v) || [];
    else { const old = localStorage.getItem('minigame_names'); if (old) old.split('\n').forEach(l => addEntry(l)); }
  } catch (e) { entries = []; }
  renderRoster();

  function begin() {
    resize();
    if (!W || !H) { setTimeout(begin, 120); return; }
    window.__names = expandRoster();
    if (window.__names.length < MIN_START) return;
    playerCount = window.__names.length;
    resize();   // DPR cap depends on the final count
    initAudio();
    if (AC && AC.state === 'suspended') AC.resume();
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('winScreen').classList.add('hidden');
    setupGame(playerCount);
    document.getElementById('hud').hidden = false;
    document.getElementById('raceBoard').hidden = false;
    fx.updateHud(players.slice(0, 3), 0, race.course, T.autoRace, dispName);
    nameInput.blur();
    cdT = 0; cdIdx = -1;
    state = 'countdown';
  }
  document.getElementById('startBtn').onclick = begin;
  document.getElementById('againBtn').onclick = begin;
  document.getElementById('demoBtn').onclick = () => {
    entries = [{ name: T.botName, count: 12 }]; renderRoster(); begin();
  };

  // Automatic course hazard: announced rain lands across the pack, never a chosen name.
  function bananaRain() {
    const R = race;
    const ys = players.filter(p => !p.finished).map(p => p.wy).sort((a, b) => a - b);
    if (!ys.length || ys[ys.length - 1] > R.course * 0.92) return;
    const y0 = ys[Math.floor(ys.length * 0.05)], y1 = ys[Math.floor(ys.length * 0.95)];
    for (let i = 0; i < Math.min(45, 12 + Math.ceil(players.length / 8)); i++) {
      peels.push({ x: rand(-R.trackW / 2 + 20, R.trackW / 2 - 20), wy: rand(y0 + 30, y1 + 180), t: 1, life: 7, alive: true });
    }
    showBanner(T.bananaRainBanner, '#ffe066', 1.5, true);
    sfx('whistle', 300, d => beep(900, 0.3, 'sine', 0.14 * d, 600));
  }
})();
