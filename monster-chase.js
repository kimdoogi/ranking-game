(() => {
  const T = window.T;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let muted = false;
  try { muted = localStorage.getItem('minigame_muted') === '1'; } catch (e) {}
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, DPR = 1;

  let TILT = 0.52;
  const SD_TIME = 36;
  const COLLAPSE_TIME = 56;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    TILT = W < H ? 0.86 : 0.52;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  // A fixed arena keeps rotation and screen size out of the survival simulation.
  function remapWorld() { if (arena.R0) frameArena(true); }
  function frameArena(snap = false) {
    const r = reduceMotion ? arena.R0 : Math.max(arena.R, arena.R0 * 0.4);
    cam.tx = arena.cx; cam.ty = arena.cy;
    cam.tz = Math.max(0.2, Math.min(1.8, (W - 36) / (2 * (r + 32)), (H - 220) / (r * 2 * TILT + 110)));
    if (snap) { cam.x = cam.tx; cam.y = cam.ty; cam.zoom = cam.tz; }
  }
  window.addEventListener('resize', () => { resize(); remapWorld(); });
  resize();

  let randomSeed = 1;
  function random() {
    randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0;
    return randomSeed / 4294967296;
  }
  const fxRand = (a, b) => a + Math.random() * (b - a);
  function rand(a, b) { return a + random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }
  function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 6.2832; while (d < -Math.PI) d += 6.2832; return d; }

  // ---------- Audio (master gain + per-type voice limits) ----------
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
    const duck = now < duckUntil ? 0.6 : 1;
    fn(duck);
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
  let state = 'menu';
  let players = [], particles = [], floaters = [], confetti = [], ghosts = [], pillars = [];
  let monster = null;
  let eliminationOrder = [];
  let arena = { cx: 0, cy: 0, R: 0, R0: 0, scale: 1 };
  let cdT = 0, cdIdx = -1;
  let playerCount = 12;
  let winner = null;

  let gameT = 0, spin = 0;
  let suddenDeath = false, sdPillarT = 0, firstEatDone = false;
  let faceOffDone = false, finalSlowmoDone = false, prevAliveN = 99;
  let eatEvents = [];               // gameT of eat events (rolling windows)
  let lastEatT = 0;
  let blackoutT = 0, blackoutUsed = false;
  let snack = null, snacksLeft = 3, nextSnackT = 9;
  let snackCombo = 0, lastSnackIndex = -1;
  let snackUiReady = false;

  const SNACKS = [
    { emoji: '🍔', name: T.snack1, reaction: T.snack1r, color: '#ffd23f', effect: 'belly' },
    { emoji: '🍕', name: T.snack2, reaction: T.snack2r, color: '#3fd0ff', effect: 'dizzy' },
    { emoji: '🌶️', name: T.snack3, reaction: T.snack3r, color: '#ff4d6d', effect: 'spicy' },
    { emoji: '🍗', name: T.snack4, reaction: T.snack4r, color: '#ff8a3d', effect: 'belly' },
    { emoji: '🍩', name: T.snack5, reaction: T.snack5r, color: '#ff2d95', effect: 'sugar' },
  ];

  let trauma = 0, lastEatShake = -9;
  let freezeT = 0;
  let slowmo = { ts: 1, t: 0 }, timeScale = 1;
  let flashT = 0, lastFlash = 0;
  let banner = null, lastBannerT = 0;
  let hbT = 0;
  let runnerGlow = 12;
  let nameTags = [];
  let cam = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tz: 1 };

  function groundY(y) { return arena.cy + (y - arena.cy) * TILT; }
  function viewY() { return W < H && H < 650 ? H * 0.44 : H * 0.5; }
  const aliveEl = document.getElementById('aliveCount');

  function addTrauma(a) {
    if (reduceMotion) return;
    if (timeScale < 0.999 || cam.zoom > 1.001) return;
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
    if (!force && now - lastBannerT < 2000) return;
    lastBannerT = now;
    banner = { text, color, t: 0, dur };
  }
  function setSlowmo(ts, dur) { slowmo = { ts, t: dur }; trauma = 0; }
  function addFloater(x, y, text, color, big) {
    floaters.push({ x, y, text, color, life: 1, vy: -0.9, big: !!big });
    if (floaters.length > 8) floaters.shift();
  }
  function spawnParticles(x, y, color, n, spd) {
    for (let i = 0; i < n; i++) {
      const a = fxRand(0, 6.2832), sp = fxRand(0.5, spd);
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, r: fxRand(2, 5.5), color });
    }
    if (particles.length > 150) particles.splice(0, particles.length - 150);
  }
  function burstConfetti() {
    const colors = ['#ffd23f', '#ff4d6d', '#25d366', '#7b5bff', '#3fd0ff', '#ff8a3d'];
    for (let i = 0; i < 160; i++) {
      confetti.push({
        x: fxRand(0, W), y: fxRand(-H * 0.4, 0),
        vx: fxRand(-2, 2), vy: fxRand(2, 6),
        r: fxRand(4, 9), rot: fxRand(0, 6.28), vr: fxRand(-0.3, 0.3),
        color: colors[i % colors.length],
      });
    }
  }

  // ---------- Setup ----------
  function setupGame(n) {
    randomSeed = Math.floor(Math.random() * 4294967296);
    players = []; particles = []; floaters = []; confetti = []; ghosts = []; pillars = [];
    eliminationOrder = []; winner = null; trauma = 0; spin = 0;
    gameT = 0; suddenDeath = false; sdPillarT = 0; firstEatDone = false;
    faceOffDone = false; finalSlowmoDone = false; prevAliveN = 99;
    eatEvents = []; lastEatT = 0; blackoutT = 0; blackoutUsed = false;
    snack = null; snacksLeft = 3; nextSnackT = 9;
    accumulator = 0;
    document.getElementById('chaseLog').replaceChildren();
    snackCombo = 0; lastSnackIndex = -1;
    freezeT = 0; slowmo = { ts: 1, t: 0 }; timeScale = 1;
    flashT = 0; banner = null; hbT = 0; lastEatShake = -9;

    const cx = 0, cy = 0, R = 340;
    arena = { cx, cy, R, R0: R, scale: clamp(R / 340, 0.55, 1.2) };
    cam = { x: cx, y: cy, zoom: 1, tx: cx, ty: cy, tz: 1 };
    frameArena(true);

    // Four cover points are the same on every screen.
    const nP = 4;
    for (let i = 0; i < nP; i++) {
      const a = (Math.PI / 4) + i * (6.2832 / nP) + rand(-0.26, 0.26);
      pillars.push({
        x: cx + Math.cos(a) * R * 0.5, y: cy + Math.sin(a) * R * 0.5,
        r: R * 0.07, cracks: 0, alive: true, crumbleT: 0,
      });
    }

    const r = Math.max(12, Math.min(22, R / (n * 0.46)));
    const seen = Object.create(null);
    for (let i = 0; i < n; i++) {
      const name = (window.__names && window.__names[i]) || String(i + 1);
      seen[name] = (seen[name] || 0) + 1;
      const ang = (i / n) * 6.2832 + rand(-0.15, 0.15);
      const rad = R * rand(0.55, 0.8);
      const hue = (i * (360 / n) + rand(-8, 8)) % 360;
      players.push({
        id: i, name, dup: seen[name],
        isNum: !(window.__names && window.__names[i]),
        color: `hsl(${hue}, 85%, 62%)`,
        x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad,
        vx: 0, vy: 0, z: 0, vz: 0,
        r, alive: true,
        phase: rand(0, 6.28), squash: 0, lookX: 0, lookY: 1,
        wanderA: rand(0, 6.2832),
        // personality
        spd: rand(0.92, 1.08), courage: rand(0.75, 1.25),
        clumsy: rand(0.5, 2), dashSkill: rand(0.8, 1.2),
        // states
        dashT: 0, dashCd: 0, consecSaves: 0, trail: [],
        tripT: 0, tripRoll: 0, veerT: 0, veerRoll: 0, veerDir: 1,
      });
    }

    monster = {
      x: cx, y: cy, r: R * 0.065, baseR: R * 0.065,
      h: rand(0, 6.2832),          // heading
      state: 'idle', msT: 0,       // state timer
      lock: -1, lockT: 0, lockPrev: -1, lockRepeat: 0, coverT: 0,
      whiffsOnLock: 0, consecWhiffLocks: 0,
      eats: 0, hunger: 0, digestT: 1.5,
      dizzyT: 0, tantrumT: 0, lureT: 0, lureX: 0, lureY: 0,
      mouthPh: 0, belly: 0, minLockDist: 1e9,
      lungeAte: 0,
    };
    aliveEl._v = -1;
    document.getElementById('aliveCount').textContent = n;
  }

  function eatSnack(M) {
    const eaten = snack;
    if (!eaten) return;
    snack = null;
    snackCombo++;
    M.lureT = 0;
    M.belly = 1;
    M.state = 'gulp';
    M.msT = 0.9;
    if (eaten.effect === 'dizzy') M.dizzyT = 1.3;
    if (eaten.effect === 'spicy') M.tantrumT = 1.1;
    if (eaten.effect === 'sugar') M.msT = 0.45;
    addFloater(M.x, groundY(M.y) - M.r * 1.8, eaten.reaction, eaten.color, true);
    spawnParticles(M.x, groundY(M.y), eaten.color, 28, 6);
    showBanner(snackCombo >= 2 ? T.snackCombo(snackCombo) + '!' : `${eaten.emoji} ${T.snackGone}`, eaten.color, 1.4, true);
    sfx('snack', 150, d => {
      beep(220 + snackCombo * 70, 0.08, 'triangle', 0.16 * d, 420 + snackCombo * 80);
      setTimeout(() => beep(120, 0.18, 'square', 0.12 * d, 70), 100);
    });
    if (snackCombo >= 2) { fireFlash(); addTrauma(Math.min(0.45, 0.16 * snackCombo)); }
    updateSnackUi();
  }

  // ---------- Eat / eliminate ----------
  function eatRunner(p) {
    if (state !== 'playing') return;               // never eat past the decided win
    p.alive = false;
    if (monster.lock === p.id) dropLock(monster);  // a corpse lock would stall the match forever
    if (!eliminationOrder.includes(p)) eliminationOrder.push(p);
    const log = document.getElementById('chaseLog');
    const row = document.createElement('div');
    row.className = 'chaseOut'; row.style.borderColor = p.color;
    row.textContent = T.eliminated(players.length - eliminationOrder.length + 1, dispName(p));
    log.prepend(row);
    while (log.children.length > 3) log.removeChild(log.lastChild);
    monster.eats++; monster.lungeAte++;
    monster.r = Math.min(monster.baseR * 1.8, monster.r * 1.05);
    monster.belly = 1;
    lastEatT = gameT;
    if (gameT - lastEatShake > 0.8) { addTrauma(0.25); lastEatShake = gameT; }
    if (freezeT <= 0) freezeT = 0.07;
    const gy = groundY(p.y);
    addFloater(p.x, gy - 40, T.nom, '#ff2d95', true);
    spawnParticles(p.x, gy, p.color, 14, 4);
    sfx('gulp', 90, d => beep(Math.min(500, 160 + monster.eats * 22), 0.12, 'triangle', 0.16 * d));
    if (monster.eats % 3 === 0) setTimeout(() => beep(150, 0.3, 'sawtooth', 0.14, Math.max(60, 80 - monster.belly * 20)), 350);
    // ghost gallery: soul floats to a rim seat
    ghosts.push({ color: p.color, x: p.x, y: gy - 20, t: 0, seat: ghosts.length });
    if (!firstEatDone) { firstEatDone = true; showBanner(T.firstNom, '#ff2d95'); }
    if (blackoutT > 0) showBanner(T.darkNom, '#ffd23f', 1.4, true);
    checkWin();
  }

  function checkWin() {
    const alive = players.filter(p => p.alive);
    if (alive.length <= 1 && state === 'playing') {
      state = 'over';
      winner = alive[0] || eliminationOrder[eliminationOrder.length - 1];
      if (winner && !eliminationOrder.includes(winner)) eliminationOrder.push(winner);
      frameArena();
      setTimeout(showWinner, 1400);
      burstConfetti(); fanfare(); addTrauma(0.6);
    }
  }

  // ---------- Update ----------
  function update(dt, fm) {
    gameT += dt;
    spin += dt * 0.4;
    const sc = arena.scale;
    const aliveList = players.filter(p => p.alive);
    const aliveN = aliveList.length;

    // sudden death
    if (!suddenDeath && gameT >= SD_TIME && state === 'playing') {
      suddenDeath = true; sdPillarT = 2.2;
      showBanner(T.suddenDeath, '#ff3b4d', 1.5, true);
      addTrauma(0.5);
      [0, 140, 280].forEach((ms, i) => setTimeout(() => beep(300 + i * 90, 0.1, 'square', 0.16), ms));
    }
    if (suddenDeath) {
      if (sdPillarT > 0) {
        sdPillarT -= dt;
        if (sdPillarT <= 0) {
          showBanner(T.pillarFall, '#ff8a3d', 1.2, true);
          for (const pl of pillars) if (pl.alive) pl.crumbleT = rand(0.1, 1.2);
        }
      }
      // final duel or collapse: shrink harder so the orbit stalemate can't happen
      const duel = aliveN <= 2 || gameT >= COLLAPSE_TIME;
      const rate = arena.R0 * (gameT >= COLLAPSE_TIME ? 0.09 : duel ? 0.045 : 0.03);
      arena.R = Math.max(arena.R0 * (duel ? 0.35 : 0.5), arena.R - rate * dt);
    }
    // pillar crumble anim
    for (const pl of pillars) {
      if (pl.alive && pl.crumbleT > 0) {
        pl.crumbleT -= dt;
        if (pl.crumbleT <= 0) {
          pl.alive = false;
          spawnParticles(pl.x, groundY(pl.y), 'rgba(140,120,220,0.9)', 18, 5);
          addTrauma(0.35);
          sfx('crash', 200, d => beep(90, 0.25, 'sawtooth', 0.16 * d, 50));
        }
      }
    }

    // blackout window (no shake in the dark — eyes must stay put)
    if (blackoutT > 0) { blackoutT -= dt; trauma = 0; }

    // heartbeat
    if ((aliveN <= 2 || suddenDeath) && state === 'playing' && AC) {
      hbT -= dt;
      if (hbT <= 0) {
        hbT = lerp(0.9, 0.55, 1 - arena.R / arena.R0);
        beep(65, 0.09, 'sine', 0.4); setTimeout(() => beep(50, 0.11, 'sine', 0.35), 140);
        duckUntil = performance.now() + 260;
      }
    }

    // face-off + final slow-mo
    if (state === 'playing' && aliveN === 2 && prevAliveN > 2 && !faceOffDone) {
      faceOffDone = true;
      showBanner(T.finalTwo, '#ffd23f', 1.6, true);
      setSlowmo(0.15, 0.8);
      beep(392, 0.18, 'triangle', 0.18); setTimeout(() => beep(523, 0.3, 'triangle', 0.18), 160);
    }
    prevAliveN = aliveN;

    // Keep the whole chase in view while the shrinking arena naturally zooms in.
    frameArena();
    const ck = 1 - Math.pow(0.94, fm);
    cam.x += (cam.tx - cam.x) * ck; cam.y += (cam.ty - cam.y) * ck; cam.zoom += (cam.tz - cam.zoom) * ck;

    // ---------- monster AI ----------
    const M = monster;
    M.mouthPh += dt * (4 + (M.lastSpd || 0) * 1.5);   // chomping speeds up with movement
    if (M.belly > 0) M.belly = Math.max(0, M.belly - dt * 2.5);

    if (!snack && snacksLeft > 0 && gameT >= nextSnackT) throwSnack();

    // An automatic snack temporarily becomes the monster's highest-priority target.
    if (snack) {
      snack.t -= dt;
      snack.phase += dt * 6;
      if (snack.t <= 0) {
        addFloater(snack.x, groundY(snack.y) - 20, T.deliveryFail, '#b8b8d8', true);
        snack = null;
        M.lureT = 0;
        snackCombo = 0;
      } else if (M.state === 'idle' && M.dizzyT <= 0 && M.tantrumT <= 0) {
        if (M.lock >= 0) dropLock(M);
        M.lureT = Math.max(M.lureT, 0.25);
        M.lureX = snack.x; M.lureY = snack.y;
        if (Math.hypot(M.x - snack.x, M.y - snack.y) < M.r + 18 * sc) eatSnack(M);
      }
    }

    // Gluttony governor: N@8s → 2@38s, then the shrinking arena settles the duel.
    const N0 = players.length;
    const schedT = a => 8 + 30 * (N0 - a) / Math.max(1, N0 - 2);
    const aheadSec = state === 'playing' ? schedT(aliveN) - gameT : 0;   // >0 = eating too fast
    const behindSec = -aheadSec;
    M.hunger = clamp(behindSec / 8, 0, 1);   // 0..1 speed boost driver

    const enr = suddenDeath;
    const runnerBase = 2.2 * sc;
    let cruise = runnerBase * 0.93 * (1 + M.hunger * 0.45) * (enr ? 1.3 : 1)
      * (aliveN <= 2 ? 1.15 : 1) * (gameT >= COLLAPSE_TIME ? 1.6 : 1);
    if (gameT < 8) cruise *= 0.6;

    // state machine (msT pauses while dizzy/tantrum overlays play, so skid/gulp aren't consumed blind)
    if (M.dizzyT <= 0 && M.tantrumT <= 0) M.msT -= dt;
    const target = M.lock >= 0 ? players[M.lock] : null;

    if (M.dizzyT > 0) { M.dizzyT -= dt; }
    else if (M.tantrumT > 0) { M.tantrumT -= dt; M.h += dt * 12; if (M.tantrumT <= 0) sfx('growl', 300, d => beep(70, 0.25, 'sawtooth', 0.18 * d)); }
    else if (M.state === 'windup') {
      if (M.msT <= 0) {
        M.state = 'lunge'; M.msT = 0.3; M.lungeAte = 0; M.minLockDist = 1e9;
        // panic dash chance (the near-miss engine)
        if (target && target.alive && target.dashCd <= 0 && target.tripT <= 0 && target.consecSaves < 2) {
          let odds = gameT < 20 ? 0.55 : lerp(0.55, 0.30, (gameT - 20) / 25);
          if (suddenDeath) odds = 0.15;
          if (random() < odds) {
            const ang = Math.atan2(target.y - M.y, target.x - M.x) + (random() < 0.5 ? 1.7 : -1.7);
            target.dashT = 0.3; target.dashCd = 3 * target.dashSkill * rand(0.8, 1.2);
            target.vx = Math.cos(ang) * runnerBase * 2.2 * target.spd;
            target.vy = Math.sin(ang) * runnerBase * 2.2 * target.spd;
            target.consecSaves++;
            sfx('whoosh', 150, d => beep(600, 0.08, 'sine', 0.1 * d, 900));
          }
        }
        // once-per-match blackout: lights out as the jaws close
        if (!blackoutUsed && gameT > 25 && gameT < 40 && aliveN >= 6) {
          blackoutUsed = true; blackoutT = 0.6;
        }
      }
    } else if (M.state === 'lunge') {
      if (M.msT <= 0) {
        if (M.lungeAte === 0) {   // WHIFF
          M.state = 'skid'; M.msT = 0.6;
          M.whiffsOnLock++;
          spawnParticles(M.x, groundY(M.y), 'rgba(200,200,220,0.6)', 8, 3);
          sfx('clack', 90, d => { beep(95, 0.04, 'square', 0.14 * d); setTimeout(() => beep(85, 0.04, 'square', 0.12 * d), 60); });
          if (target && target.alive && M.minLockDist < M.r + target.r + 8 * sc) {
            addFloater(target.x, groundY(target.y) - 44, T.closeCall, '#3dff8a', true);
            if (freezeT <= 0) freezeT = 0.06;
          }
          // a dodged lunge usually breaks the monster's interest — an escape is a real escape,
          // not a stay of execution (50% on first whiff, always on second; final duel excluded)
          if (target && target.alive && aliveN > 2 && (M.whiffsOnLock >= 2 || random() < 0.5)) {
            addFloater(target.x, groundY(target.y) - 62, T.survived, '#3dff8a', true);
            M.lockPrev = target.id; M.lockRepeat = 2;   // next pick must be someone else
            dropLock(M);
          }
        } else {                  // ATE — digest
          M.state = 'gulp';
          let digest = aheadSec > 0 ? clamp(1.2 * aheadSec, 0.6, 3.5) : 0.6;
          if (gameT < 15) digest = Math.max(digest, 1.5);
          if (enr) digest = Math.max(0.3, digest * 0.4);
          M.msT = digest;
          if (M.lungeAte === 2) showBanner(T.doubleNom, '#ffd23f');
          else if (M.lungeAte >= 3) { showBanner(T.tripleNom, '#ffd23f', 1.4, true); fireFlash(); }
          M.whiffsOnLock = 0; M.consecWhiffLocks = 0;
          dropLock(M);
        }
      }
    } else if (M.state === 'skid' || M.state === 'gulp') {
      if (M.msT <= 0) M.state = 'idle';
    }

    // lock management (idle/cruise only)
    if (M.state === 'idle' && M.dizzyT <= 0 && M.tantrumT <= 0 && state === 'playing') {
      if (M.lock >= 0 && !(players[M.lock] && players[M.lock].alive)) dropLock(M);   // stale-lock sweep
      if (M.lureT > 0) M.lureT -= dt;
      if (M.lock < 0 && gameT > 4.5 && M.lureT <= 0 && aliveN > 0) {
        // weighted-random among 3 nearest
        const sorted = aliveList.slice().sort((a, b) =>
          ((a.x - M.x) ** 2 + (a.y - M.y) ** 2) - ((b.x - M.x) ** 2 + (b.y - M.y) ** 2)).slice(0, 3);
        const w = [3, 2, 1]; let tot = 0;
        const cand = sorted.filter(p => !(p.id === M.lockPrev && M.lockRepeat >= 2));
        const pool = cand.length ? cand : sorted;
        pool.forEach((p, i) => tot += w[i] || 1);
        let roll = random() * tot, pick = pool[0];
        pool.forEach((p, i) => { roll -= w[i] || 1; if (roll > 0 && pool[i + 1]) pick = pool[i + 1]; });
        if (pick) {
          M.lock = pick.id; M.lockT = 0; M.coverT = 0; M.whiffsOnLock = 0; M.minLockDist = 1e9;
          M.lockRepeat = (pick.id === M.lockPrev) ? M.lockRepeat + 1 : 1;
          M.lockPrev = pick.id;
          addFloater(pick.x, groundY(pick.y) - 46, '!', '#ff5050', true);
          sfx('lock', 300, d => { beep(330, 0.07, 'square', 0.1 * d); setTimeout(() => beep(440, 0.07, 'square', 0.1 * d), 80); });
        }
      }
      if (target && target.alive) {
        M.lockT += dt;
        const d = Math.hypot(target.x - M.x, target.y - M.y);
        // pillar LOS break
        let covered = false;
        for (const pl of pillars) {
          if (!pl.alive) continue;
          const t = clamp(((pl.x - M.x) * (target.x - M.x) + (pl.y - M.y) * (target.y - M.y)) / (d * d || 1), 0, 1);
          const px = M.x + (target.x - M.x) * t, py = M.y + (target.y - M.y) * t;
          if (Math.hypot(pl.x - px, pl.y - py) < pl.r * 0.9) { covered = true; break; }
        }
        M.coverT = covered ? M.coverT + dt : 0;
        // a closer snack crossing its path distracts the monster — targets keep rotating,
        // so being locked is a scare, not a death sentence (off in the final duel)
        if (aliveN > 2 && random() < dt * 1.5) {
          let closest = null, cd2 = 1e9;
          for (const q of aliveList) {
            if (q.id === M.lock) continue;
            const dq = Math.hypot(q.x - M.x, q.y - M.y);
            if (dq < cd2) { cd2 = dq; closest = q; }
          }
          if (closest && cd2 < d * 0.55) {
            M.lock = closest.id; M.lockT = 0; M.coverT = 0; M.whiffsOnLock = 0; M.minLockDist = 1e9;
            M.lockRepeat = 1; M.lockPrev = closest.id;
            addFloater(closest.x, groundY(closest.y) - 46, '!', '#ff5050', true);
            sfx('lock', 300, dk => beep(392, 0.07, 'square', 0.1 * dk));
          }
        }
        // NOTE: no distance-based lock drop — on a shrunken arena "R*1.1" is always
        // exceeded and the monster would drop every lock instantly (endless stalemate)
        if (M.coverT > 1.5) { dropLock(M); addFloater(M.x, groundY(M.y) - 50, '?', '#cfcff0', true); }
        else if (M.lockT > 4) {
          dropLock(M);
          M.consecWhiffLocks++;
          if (M.consecWhiffLocks >= 2) { M.tantrumT = 1; M.consecWhiffLocks = 0; sfx('growl', 300, d2 => beep(60, 0.4, 'sawtooth', 0.2 * d2)); }
        }
        // lunge trigger (only if the lock didn't just switch this frame — d is stale then)
        else if (gameT > 6 && M.lock === target.id && d < (M.r + target.r) * (2.6 + M.hunger * 1.2) && M.state === 'idle') {
          // eat-cadence guards (gap scales with headcount — a 30-runner match needs ~1.3s cadence)
          eatEvents = eatEvents.filter(t2 => gameT - t2 < 3);
          const minGap = Math.min(2.5, 0.9 * 30 / Math.max(1, N0 - 2)) * (enr ? 0.5 : 1);
          const cadenceOk = gameT - lastEatT > minGap && (gameT > 20 || eatEvents.length < 2);
          if (cadenceOk) {
            M.state = 'windup'; M.msT = enr ? 0.18 : 0.30;
            sfx('windup', 200, d2 => beep(180, 0.12, 'sawtooth', 0.12 * d2, 120));
          }
        }
      }
    }

    // monster movement
    let mSpd = 0;
    if (M.dizzyT > 0 || M.tantrumT > 0) mSpd = 0;
    else if (M.state === 'windup') mSpd = cruise * 0.1;
    else if (M.state === 'lunge') mSpd = cruise * 2.2;
    else if (M.state === 'skid') mSpd = cruise * 0.3;
    else if (M.state === 'gulp') mSpd = cruise * 0.35;
    else mSpd = cruise;

    let aimX = M.x + Math.cos(M.h), aimY = M.y + Math.sin(M.h);
    if (M.lureT > 0 && M.state === 'idle') { aimX = M.lureX; aimY = M.lureY; }
    else if (target && target.alive) {
      // intercept lead: after whiffs, when hungry, in the final duel, or at collapse
      const lead = (M.whiffsOnLock >= 2 || M.hunger > 0.5 || aliveN <= 2 || gameT >= COLLAPSE_TIME) ? 21 : 0;
      aimX = target.x + target.vx * lead; aimY = target.y + target.vy * lead;
    } else if (M.state === 'idle') {
      // wander toward arena center-ish
      if (random() < 0.01) M.h += rand(-1, 1);
      aimX = arena.cx + Math.cos(M.h) * 50; aimY = arena.cy + Math.sin(M.h) * 50;
    }
    M.lastSpd = mSpd;
    const wantA = Math.atan2(aimY - M.y, aimX - M.x);
    const spdRatio = mSpd / (cruise || 1);
    const maxTurn = (M.state === 'lunge' ? 0.8 : (3.2 - 0.8 * spdRatio) * (enr ? 1.15 : 1));
    M.h += clamp(angDiff(wantA, M.h), -maxTurn * dt, maxTurn * dt);
    M.x += Math.cos(M.h) * mSpd * fm;
    M.y += Math.sin(M.h) * mSpd * fm;

    // monster wall clamp
    {
      const dc = Math.hypot(M.x - arena.cx, M.y - arena.cy);
      const maxD = arena.R - M.r * 0.7;
      if (dc > maxD) {
        M.x = arena.cx + (M.x - arena.cx) / dc * maxD;
        M.y = arena.cy + (M.y - arena.cy) / dc * maxD;
        if (M.state === 'lunge') M.msT = Math.min(M.msT, 0.05);   // wall ends a lunge fast
      }
    }
    // pillar BONK (weak avoidance is intentional — comedy)
    for (const pl of pillars) {
      if (!pl.alive) continue;
      const d = Math.hypot(pl.x - M.x, pl.y - M.y), minD = pl.r + M.r * 0.6;
      if (d < minD) {
        M.x = pl.x + (M.x - pl.x) / (d || 1) * minD;
        M.y = pl.y + (M.y - pl.y) / (d || 1) * minD;
        if (M.state === 'lunge') {
          M.state = 'skid'; M.msT = 0.5; M.dizzyT = 0.8;
          if (M.lungeAte > 0) { M.whiffsOnLock = 0; M.consecWhiffLocks = 0; }   // it DID eat — mirror the gulp resets
          pl.cracks++;
          addFloater(pl.x, groundY(pl.y) - 60, T.bonk, '#ffd23f', true);
          addTrauma(0.3);
          spawnParticles(pl.x, groundY(pl.y) - 30, 'rgba(200,190,255,0.8)', 10, 4);
          sfx('bonk', 200, d2 => beep(70, 0.2, 'square', 0.18 * d2, 45));
          if (pl.cracks >= 3) pl.crumbleT = 0.15;
          if (enr) pl.crumbleT = 0.15;
        } else if (M.state === 'idle') {
          M.h += 0.4 * (angDiff(Math.atan2(M.y - pl.y, M.x - pl.x), M.h) > 0 ? 1 : -1);
        }
      }
    }

    // eat check during lunge (mouth arc ±55°, up to 3 per lunge)
    if (M.state === 'lunge' && M.lungeAte < 3) {
      for (const p of aliveList) {
        if (!p.alive) continue;
        const dx = p.x - M.x, dy = p.y - M.y, d = Math.hypot(dx, dy);
        if (p.id === M.lock) M.minLockDist = Math.min(M.minLockDist, d);
        if (d < M.r * 0.85 + p.r * 0.6) {
          const aOff = Math.abs(angDiff(Math.atan2(dy, dx), M.h));
          if (aOff < 0.96 && gameT >= 8) {   // pre-8s connects are forced whiffs
            if (M.lungeAte === 0) eatEvents.push(gameT);
            eatRunner(p);
            if (players.filter(q => q.alive).length === 1 && !finalSlowmoDone) {
              finalSlowmoDone = true;
              setSlowmo(0.3, 0.9);
              frameArena();
            }
            if (state !== 'playing') break;                 // win decided — stop the jaws
            if (M.lungeAte >= 3) break;
            if (gameT < 15 && M.lungeAte >= 2) break;       // early triple = quarter of the field, too cruel
          }
        }
      }
    }

    // ---------- runners ----------
    const panicR = arena.R * 0.45;
    for (const p of players) {
      if (!p.alive) continue;

      const dxm = p.x - M.x, dym = p.y - M.y;
      const dM = Math.hypot(dxm, dym) || 1;
      const fear = clamp(1 - dM / (panicR * p.courage), 0, 1);
      const isLocked = M.lock === p.id;
      const panicked = fear > 0.15 || isLocked;

      p.dashCd = Math.max(0, p.dashCd - dt);
      if (p.consecSaves > 0 && gameT - lastEatT > 5 && !isLocked) p.consecSaves = 0;

      // trip state falls through to the shared clamps below — a downed runner must
      // still respect the (shrinking) wall and pillars
      if (p.tripT > 0) {
        p.tripT -= dt;
        p.phase += dt * 20;   // kicking legs
        const fr = Math.pow(0.8, fm);
        p.vx *= fr; p.vy *= fr;
      } else if (p.dashT > 0) {
        p.dashT -= dt;
        p.trail.push({ x: p.x, y: p.y, life: 0.5 });
        if (p.trail.length > 4) p.trail.shift();
      } else {
        // steering blend
        let sx2 = 0, sy2 = 0;
        // flee
        const wF = 0.3 + fear * fear * 3;
        sx2 += (dxm / dM) * wF; sy2 += (dym / dM) * wF;
        // wall tangent
        const dc = Math.hypot(p.x - arena.cx, p.y - arena.cy);
        if (dc > arena.R * 0.78) {
          const nx = (p.x - arena.cx) / (dc || 1), ny = (p.y - arena.cy) / (dc || 1);
          const tsgn = ((-ny) * dxm + nx * dym) > 0 ? 1 : -1;   // tangent that increases monster distance
          sx2 += (-ny * tsgn) * 1.5 - nx * 0.6;
          sy2 += (nx * tsgn) * 1.5 - ny * 0.6;
        }
        // pillar repulsion
        for (const pl of pillars) {
          if (!pl.alive) continue;
          const dxp = p.x - pl.x, dyp = p.y - pl.y, dp = Math.hypot(dxp, dyp) || 1;
          if (dp < pl.r + p.r * 3) { sx2 += (dxp / dp) * 1.2; sy2 += (dyp / dp) * 1.2; }
        }
        // separation (nearest only)
        let nn = null, nd = 1e9;
        for (const q of aliveList) {
          if (q === p) continue;
          const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
          if (d2 < nd) { nd = d2; nn = q; }
        }
        if (nn && nd < (p.r * 2.4) ** 2) {
          const d2 = Math.sqrt(nd) || 1;
          sx2 += (p.x - nn.x) / d2 * 0.5; sy2 += (p.y - nn.y) / d2 * 0.5;
        }
        // wander
        p.wanderA += rand(-0.5, 0.5) * dt * 4;
        sx2 += Math.cos(p.wanderA) * 0.4; sy2 += Math.sin(p.wanderA) * 0.4;

        // fatigue veer (wrong-way panic comedy)
        if (isLocked) {
          p.veerRoll += dt;
          if (p.veerRoll > 0.9) {
            p.veerRoll = 0;
            const odds = lerp(0.12, 0.22, gameT / 30);
            if (random() < odds) { p.veerT = 0.25; p.veerDir = random() < 0.5 ? 1 : -1; addFloater(p.x, groundY(p.y) - 40, '!?', '#ffb03d'); }
          }
        }
        let ang = Math.atan2(sy2, sx2);
        if (p.veerT > 0) { p.veerT -= dt; ang += 2.1 * p.veerDir; }

        const base = 2.2 * sc * p.spd;
        let spd = base * (0.5 + 0.5 * fear + (isLocked ? 0.3 : 0));
        if (suddenDeath && Math.hypot(p.x - arena.cx, p.y - arena.cy) > arena.R * 0.85) spd *= 0.6;
        const want = { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd };
        const k = 1 - Math.pow(0.86, fm);
        p.vx += (want.x - p.vx) * k;
        p.vy += (want.y - p.vy) * k;

        // trip roll while panicked
        if (panicked) {
          p.tripRoll += dt;
          if (p.tripRoll > 0.8) {
            p.tripRoll = 0;
            const trippingNow = players.filter(q => q.alive && q.tripT > 0).length;
            let odds = 0.10 * p.clumsy;
            if (aliveN <= 4) odds *= 0.5;
            if (aliveN === 2 && M.state !== 'lunge') odds = 0;
            if (trippingNow < 2 && random() < odds) {
              p.tripT = 0.5;
              addFloater(p.x, groundY(p.y) - 36, T.oops, '#ffb03d', true);
              spawnParticles(p.x, groundY(p.y), 'rgba(180,170,160,0.7)', 6, 2);
            }
          }
        } else p.tripRoll = 0;
      }

      p.x += p.vx * fm; p.y += p.vy * fm;

      // wall clamp (tangential slide — rim never kills, only the monster does)
      {
        const dc2 = Math.hypot(p.x - arena.cx, p.y - arena.cy);
        const maxD = arena.R - p.r * 0.9;
        if (dc2 > maxD) {
          const nx = (p.x - arena.cx) / dc2, ny = (p.y - arena.cy) / dc2;
          p.x = arena.cx + nx * maxD; p.y = arena.cy + ny * maxD;
          const vn = p.vx * nx + p.vy * ny;
          if (vn > 0) { p.vx -= nx * vn; p.vy -= ny * vn; }
        }
      }
      // pillar clamp
      for (const pl of pillars) {
        if (!pl.alive) continue;
        const d = Math.hypot(p.x - pl.x, p.y - pl.y), minD = pl.r + p.r * 0.6;
        if (d < minD) {
          p.x = pl.x + (p.x - pl.x) / (d || 1) * minD;
          p.y = pl.y + (p.y - pl.y) / (d || 1) * minD;
        }
      }

      // z hop physics
      if (p.z > 0 || p.vz !== 0) {
        p.vz -= 1500 * dt; p.z += p.vz * dt;
        if (p.z <= 0) { p.z = 0; p.vz = 0; }
      }

      const spdNow = Math.hypot(p.vx, p.vy);
      p.phase += dt * (3 + spdNow * 2.6);
      // eyes: track the monster in fear range, else movement
      if (dM < arena.R * 0.7) { p.lookX = -dxm / dM; p.lookY = -dym / dM; }
      else if (spdNow > 0.3) { p.lookX = p.vx / spdNow; p.lookY = p.vy / spdNow; }
      p.squash *= Math.pow(0.85, fm);

      // trail decay
      for (let i = p.trail.length - 1; i >= 0; i--) {
        p.trail[i].life -= dt * 2;
        if (p.trail[i].life <= 0) p.trail.splice(i, 1);
      }
      // sweat drops when locked
      if (isLocked && random() < dt * 2) {
        particles.push({ x: p.x + rand(-6, 6), y: groundY(p.y) - 30 * (p.r / 12), vx: rand(-0.5, 0.5), vy: -1.2, life: 0.8, r: 2.5, color: 'rgba(120,200,255,0.9)' });
      }
    }

    // anti-stall ladder
    if (state === 'playing' && gameT - lastEatT > 10 && gameT > 18 && aliveN > 2) {
      lastEatT = gameT - 5;   // re-arm
      const target2 = pillars.find(pl => pl.alive && pl.crumbleT <= 0);
      if (target2) target2.crumbleT = 0.3;
    }

    // particles / floaters / confetti / ghosts
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * fm; p.y += p.vy * fm;
      const dr = Math.pow(0.92, fm); p.vx *= dr; p.vy *= dr;
      p.life -= dt * 2.2;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i]; f.y += f.vy * fm; f.life -= dt * 1.3;
      if (f.life <= 0) floaters.splice(i, 1);
    }
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.x += c.vx * fm; c.y += c.vy * fm; c.vy += 0.12 * fm; c.rot += c.vr * fm;
      if (c.y > H + 20) confetti.splice(i, 1);
    }
    updateGhosts(dt, fm);

    trauma *= Math.pow(0.9, fm);
    const remaining = players.filter(p => p.alive).length;
    if (aliveEl._v !== remaining) { aliveEl._v = remaining; aliveEl.textContent = remaining; }
    window.__st = { t: Math.round(gameT * 10) / 10, aliveNF: remaining, state, sd: suddenDeath, eats: monster.eats, lock: monster.lock };
  }

  function dropLock(M) { M.lock = -1; M.lockT = 0; M.coverT = 0; }

  function updateGhosts(dt, fm) {
    const k = 1 - Math.pow(0.96, fm);   // dt-scaled — same convention as the camera lerp
    ghosts.forEach((g, i) => {
      g.t += dt;
      const n = Math.max(1, ghosts.length);
      const a = Math.PI + 0.35 + (i / Math.max(1, n - 1 || 1)) * (Math.PI - 0.7);
      const tx = arena.cx + Math.cos(a) * (arena.R0 + 26);
      const ty = groundY(arena.cy + Math.sin(a) * (arena.R0 + 26)) - 14;
      g.x += (tx - g.x) * k; g.y += (ty - g.y) * k;
    });
  }

  // ---------- Drawing ----------
  function drawRunner(p) {
    const s = p.r / 12;
    const gy = groundY(p.y);
    const spd = Math.hypot(p.vx, p.vy);
    const runAmt = Math.min(1, spd * 0.32 + 0.15);
    const bob = p.tripT > 0 ? 0 : Math.abs(Math.sin(p.phase)) * 2.2 * s * runAmt;
    const sx = p.x, sy = gy - p.z - bob;
    const isLocked = monster && monster.lock === p.id;

    // dash afterimages
    for (const t of p.trail) {
      ctx.globalAlpha = t.life * 0.5;
      ctx.beginPath(); ctx.arc(t.x, groundY(t.y) - 14 * s, p.r * 0.5, 0, 7);
      ctx.fillStyle = p.color; ctx.fill();
    }
    ctx.globalAlpha = 1;

    // lock-on reticle
    if (isLocked) {
      ctx.globalAlpha = 0.25 + 0.15 * Math.sin(gameT * 8);
      ctx.beginPath(); ctx.ellipse(sx, gy, p.r * 1.7, p.r * 0.6, 0, 0, 7);
      ctx.strokeStyle = '#ff3b4d'; ctx.lineWidth = 3; ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // shadow
    ctx.globalAlpha = 0.3 / (1 + Math.max(0, p.z) * 0.012);
    ctx.beginPath(); ctx.ellipse(sx, gy, p.r * 0.95, p.r * 0.32, 0, 0, 7);
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(sx, sy);
    if (p.tripT > 0) { ctx.rotate(0.2); ctx.scale(1.25, 0.45); }   // face-plant squash
    else {
      ctx.rotate(clamp(p.vx * 0.05, -0.3, 0.3));
      ctx.scale(1 + p.squash * 0.5, 1 - p.squash * 0.5);
    }

    const hipY = -8.5 * s, neckY = -16 * s, headR = 7.6 * s;
    const headY = neckY - headR * 0.75;
    const flail = p.phase;
    const panic = isLocked || p.dashT > 0;
    const swing = Math.sin(flail) * (panic ? 1.1 : 0.95 * runAmt);
    const raise = panic ? 1.8 : 0;

    ctx.strokeStyle = p.color;
    ctx.lineWidth = Math.max(3, 4.2 * s);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = p.color; ctx.shadowBlur = runnerGlow;

    const legL = 8.5 * s, armL = 7.5 * s, shY = neckY + 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(0, hipY); ctx.lineTo(Math.sin(swing) * legL, hipY + Math.cos(swing * 0.8) * legL);
    ctx.moveTo(0, hipY); ctx.lineTo(-Math.sin(swing) * legL, hipY + Math.cos(swing * 0.8) * legL);
    ctx.moveTo(0, hipY); ctx.lineTo(0, neckY);
    const aL = 0.55 - swing * 0.9 + raise;
    const aR = -0.55 + swing * 0.9 - raise;
    ctx.moveTo(0, shY); ctx.lineTo(Math.sin(aL) * armL, shY + Math.cos(aL) * armL);
    ctx.moveTo(0, shY); ctx.lineTo(Math.sin(aR) * armL, shY + Math.cos(aR) * armL);
    ctx.stroke();

    ctx.beginPath(); ctx.arc(0, headY, headR, 0, 7);
    ctx.fillStyle = p.color; ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(-headR * 0.3, headY - headR * 0.3, headR * 0.32, 0, 7);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill();

    const eyeS = isLocked ? 1.3 : 1;
    const ex = p.lookX * headR * 0.3, ey = p.lookY * headR * 0.22;
    for (const m of [-1, 1]) {
      ctx.beginPath(); ctx.arc(m * headR * 0.42, headY - headR * 0.05, headR * 0.30 * eyeS, 0, 7);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(m * headR * 0.42 + ex, headY - headR * 0.05 + ey, headR * 0.15, 0, 7);
      ctx.fillStyle = '#222'; ctx.fill();
    }
    ctx.restore();

    if (players.filter(q => q.alive).length > 8 && !isLocked) return;
    ctx.font = `900 ${Math.max(12 / cam.zoom, 8.5 * s)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = dispName(p), half = ctx.measureText(label).width / 2;
    const labelX = clamp(sx, cam.x + (10 - W / 2) / cam.zoom + half, cam.x + (W / 2 - 10) / cam.zoom - half);
    const lineHeight = 22 / cam.zoom;
    let labelY = sy - 30 * s;
    for (let n = 0; n < 8 && nameTags.some(tag => Math.abs(tag.x - labelX) < tag.half + half + 6 / cam.zoom && Math.abs(tag.y - labelY) < lineHeight); n++) labelY -= lineHeight;
    nameTags.push({ x: labelX, y: labelY, half });
    if (labelY !== sy - 30 * s) {
      ctx.strokeStyle = p.color; ctx.lineWidth = 1 / cam.zoom;
      ctx.beginPath(); ctx.moveTo(sx, sy - 26 * s); ctx.lineTo(labelX, labelY); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillText(label, labelX + 1, labelY + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, labelX, labelY);
  }

  function drawMonster() {
    const M = monster;
    if (!M) return;
    const gy = groundY(M.y);
    const enr = suddenDeath;
    const wob = 1 + M.belly * 0.15 + Math.sin(M.mouthPh * 2) * 0.02;
    const mr = M.r * wob;
    const col = enr ? `rgba(255,${40 + 20 * Math.sin(gameT * 7.5)},70,1)` : '#ff2d95';

    // shadow
    ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.ellipse(M.x, gy, mr * 1.05, mr * 0.4, 0, 0, 7);
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(M.x, gy - mr * 0.55);

    // stubby scurrying legs
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(4, mr * 0.16); ctx.lineCap = 'round';
    const lph = M.mouthPh * 3;
    ctx.beginPath();   // feet must clear the body disc (radius mr) or they're invisible
    ctx.moveTo(-mr * 0.4, mr * 0.55); ctx.lineTo(-mr * 0.42 + Math.sin(lph) * mr * 0.22, mr * 1.14);
    ctx.moveTo(mr * 0.4, mr * 0.55); ctx.lineTo(mr * 0.42 - Math.sin(lph) * mr * 0.22, mr * 1.14);
    ctx.stroke();

    // body with pac-man wedge mouth facing heading
    let mouth = 0.12 + Math.abs(Math.sin(M.mouthPh * 2.2)) * 0.45;
    if (M.state === 'windup') mouth = 0.9;
    else if (M.state === 'lunge') mouth = 1.0;
    else if (M.state === 'gulp') mouth = 0.05;
    ctx.shadowColor = col; ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, mr, M.h + mouth, M.h - mouth + 6.2832);
    ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.shadowBlur = 0;
    // inner mouth
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, mr * 0.86, M.h + mouth * 0.9, M.h + mouth * 0.2, true);   // anticlockwise: short jaw wedge, not the whole body
    ctx.closePath();
    ctx.fillStyle = 'rgba(60,0,30,0.9)'; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, mr * 0.86, M.h - mouth * 0.2, M.h - mouth * 0.9, true);
    ctx.closePath();
    ctx.fillStyle = 'rgba(60,0,30,0.9)'; ctx.fill();

    // eyes (big, tracking)
    const tgt = M.lock >= 0 ? players[M.lock] : null;
    let lx = Math.cos(M.h), ly = Math.sin(M.h);
    if (tgt && tgt.alive) { const d = Math.hypot(tgt.x - M.x, tgt.y - M.y) || 1; lx = (tgt.x - M.x) / d; ly = (tgt.y - M.y) / d; }
    const eR = mr * 0.24;
    for (const m of [-1, 1]) {
      const ex0 = m * mr * 0.34 * Math.cos(M.h + Math.PI / 2), ey0 = -mr * 0.62 + m * mr * 0.1 * Math.sin(M.h + Math.PI / 2);
      ctx.beginPath(); ctx.arc(ex0, ey0, eR, 0, 7);
      ctx.fillStyle = '#fff'; ctx.fill();
      if (M.dizzyT > 0) {
        // cross eyes
        ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ex0 - eR * 0.5, ey0 - eR * 0.5); ctx.lineTo(ex0 + eR * 0.5, ey0 + eR * 0.5);
        ctx.moveTo(ex0 + eR * 0.5, ey0 - eR * 0.5); ctx.lineTo(ex0 - eR * 0.5, ey0 + eR * 0.5);
        ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(ex0 + lx * eR * 0.45, ey0 + ly * eR * 0.3, eR * 0.5, 0, 7);
        ctx.fillStyle = '#1a0210'; ctx.fill();
      }
      if (enr) {   // angry brows
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ex0 - eR * m, ey0 - eR * 1.3); ctx.lineTo(ex0 + eR * 0.6 * m, ey0 - eR * 0.7);
        ctx.stroke();
      }
    }

    // dizzy stars
    if (M.dizzyT > 0) {
      for (let i = 0; i < 3; i++) {
        const a = gameT * 6 + i * 2.09;
        ctx.font = `${Math.max(10, mr * 0.3)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('✦', Math.cos(a) * mr * 0.8, -mr * 1.1 + Math.sin(a) * mr * 0.2);
      }
    }
    // tantrum steam
    if (M.tantrumT > 0 && fxRand(0, 1) < 0.4) {
      particles.push({ x: M.x + fxRand(-mr, mr) * 0.5, y: gy - mr * 1.4, vx: fxRand(-0.3, 0.3), vy: -1.5, life: 0.7, r: fxRand(3, 6), color: 'rgba(220,220,220,0.6)' });
    }
    // hunger drool
    if (M.hunger > 0.5 && fxRand(0, 1) < 0.15) {
      particles.push({ x: M.x + Math.cos(M.h) * mr * 0.8, y: gy - mr * 0.3, vx: 0, vy: 0.8, life: 0.6, r: 2.5, color: 'rgba(180,240,255,0.8)' });
    }
    ctx.restore();
  }

  function drawSnack(s) {
    const gy = groundY(s.y);
    const pulse = reduceMotion ? 1 : 1 + Math.sin(s.phase) * 0.08;
    ctx.save();
    ctx.translate(s.x, gy - 13 * arena.scale);
    ctx.scale(pulse, pulse);
    ctx.globalAlpha = 0.32;
    ctx.beginPath(); ctx.ellipse(0, 15 * arena.scale, 20 * arena.scale, 7 * arena.scale, 0, 0, 7);
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(0, 0, 22 * arena.scale, 0, 7);
    ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fill();
    ctx.strokeStyle = s.color; ctx.lineWidth = 3; ctx.stroke();
    ctx.font = `${Math.max(22, 34 * arena.scale)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s.emoji, 0, 0);
    ctx.font = `900 ${Math.max(10, 11 * arena.scale)}px sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(s.name, 0, -31 * arena.scale);
    ctx.restore();
  }

  function drawPillar(pl) {
    const gy = groundY(pl.y);
    const hgt = arena.R0 * 0.22;
    const sink = pl.crumbleT > 0 ? clamp(1 - pl.crumbleT / 1.2, 0, 0.5) * hgt : 0;
    const top = gy - hgt + sink;
    ctx.save();
    // column
    const grad = ctx.createLinearGradient(pl.x - pl.r, 0, pl.x + pl.r, 0);
    grad.addColorStop(0, 'rgba(70,58,130,.95)');
    grad.addColorStop(0.5, 'rgba(110,92,190,.95)');
    grad.addColorStop(1, 'rgba(52,42,100,.95)');
    ctx.fillStyle = grad;
    ctx.fillRect(pl.x - pl.r, top, pl.r * 2, gy - top);
    // base + top ellipses
    ctx.beginPath(); ctx.ellipse(pl.x, gy, pl.r, pl.r * 0.36, 0, 0, 7);
    ctx.fillStyle = 'rgba(40,32,80,.95)'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(pl.x, top, pl.r, pl.r * 0.36, 0, 0, 7);
    ctx.fillStyle = 'rgba(140,120,220,.95)'; ctx.fill();
    ctx.strokeStyle = 'rgba(190,170,255,.7)'; ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(140,110,255,.8)'; ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // cracks
    if (pl.cracks > 0) {
      ctx.strokeStyle = 'rgba(20,10,40,.8)'; ctx.lineWidth = 2;
      for (let i = 0; i < pl.cracks; i++) {
        const cy0 = top + (gy - top) * (0.25 + i * 0.25);
        ctx.beginPath();
        ctx.moveTo(pl.x - pl.r * 0.6, cy0);
        ctx.lineTo(pl.x - pl.r * 0.1, cy0 + 6);
        ctx.lineTo(pl.x + pl.r * 0.3, cy0 - 4);
        ctx.lineTo(pl.x + pl.r * 0.7, cy0 + 5);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawGhost(g) {
    const s = 7;
    const bobY = Math.sin(g.t * 3 + g.seat) * 3;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.translate(g.x, g.y + bobY);
    ctx.beginPath();
    ctx.arc(0, 0, s, Math.PI, 0);
    ctx.lineTo(s, s * 0.9);
    for (let i = 0; i < 3; i++) ctx.quadraticCurveTo(s - (i * 2 + 1) * s / 3, s * 1.25, s - (i + 1) * 2 * s / 3, s * 0.9);
    ctx.closePath();
    ctx.fillStyle = g.color; ctx.fill();
    // X eyes (skirt scallops all dip below the hem — control y 1.25s)
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
    for (const m of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(m * 3 - 2, -3); ctx.lineTo(m * 3 + 2, 1);
      ctx.moveTo(m * 3 + 2, -3); ctx.lineTo(m * 3 - 2, 1);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------- Render ----------
  function render() {
    nameTags = [];
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)*0.7);
    bg.addColorStop(0, '#141230'); bg.addColorStop(1, '#07070f');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W * 0.5, viewY());
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
    const shakePx = trauma * trauma * 14;
    if (shakePx > 0.3 && timeScale > 0.999 && cam.zoom < 1.001) {
      ctx.translate(Math.sin(gameT * 71) * shakePx / cam.zoom, Math.cos(gameT * 83) * shakePx / cam.zoom);
    }

    const { cx, cy, R } = arena;
    const RT = R * TILT;
    const wallH = Math.max(18, R * 0.14);
    runnerGlow = players.filter(p => p.alive).length > 15 ? 0 : 12;   // glow is O(n)-expensive at 30 runners

    if (R > 0) {
      const wg = ctx.createLinearGradient(0, cy, 0, cy + RT + wallH);
      wg.addColorStop(0, 'rgba(64,54,118,.95)');
      wg.addColorStop(1, 'rgba(16,12,36,.95)');
      ctx.beginPath();
      ctx.ellipse(cx, cy, R, RT, 0, 0, Math.PI, false);
      ctx.ellipse(cx, cy + wallH, R, RT, 0, Math.PI, 0, true);
      ctx.closePath();
      ctx.fillStyle = wg; ctx.fill();

      const g = ctx.createRadialGradient(cx, cy - RT * 0.25, R * 0.1, cx, cy, R);
      g.addColorStop(0, 'rgba(86,74,150,.85)');
      g.addColorStop(0.7, 'rgba(52,44,100,.85)');
      g.addColorStop(1, 'rgba(38,32,78,.9)');
      ctx.beginPath(); ctx.ellipse(cx, cy, R, RT, 0, 0, 7);
      ctx.fillStyle = g; ctx.fill();

      ctx.save();
      ctx.beginPath(); ctx.ellipse(cx, cy, R, RT, 0, 0, 7);
      if (suddenDeath) {
        const a = 0.6 + 0.3 * Math.sin(gameT * Math.PI * 2 * 1.2);
        ctx.strokeStyle = `rgba(255,50,70,${a})`;
        ctx.shadowColor = 'rgba(255,40,60,.8)';
      } else {
        ctx.strokeStyle = 'rgba(255,210,63,.9)';
        ctx.shadowColor = 'rgba(255,180,60,.8)';
      }
      ctx.lineWidth = 4; ctx.shadowBlur = 22;
      ctx.stroke();
      const r2 = Math.max(0, R - 14);
      ctx.beginPath(); ctx.ellipse(cx, cy, r2, r2 * TILT, 0, 0, 7);
      ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 2; ctx.shadowBlur = 0;
      ctx.setLineDash([14, 18]); ctx.lineDashOffset = -spin * 40; ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // ghosts (rim gallery) — after the floor so souls stay visible while flying to their seats
    for (const g of ghosts) drawGhost(g);

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life + 0.5, 0, 7);
      ctx.fillStyle = p.color; ctx.fill();
    }
    ctx.globalAlpha = 1;

    // depth-sorted entities: pillars + runners + monster
    const ents = [];
    for (const pl of pillars) if (pl.alive) ents.push({ y: pl.y, k: 'p', o: pl });
    for (const p of players) if (p.alive) ents.push({ y: p.y, k: 'r', o: p });
    if (snack) ents.push({ y: snack.y, k: 's', o: snack });
    if (monster) ents.push({ y: monster.y, k: 'm', o: monster });
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) {
      if (e.k === 'p') drawPillar(e.o);
      else if (e.k === 'r') drawRunner(e.o);
      else if (e.k === 's') drawSnack(e.o);
      else drawMonster();
    }

    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.font = `900 ${f.big ? 30 : 22}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillText(f.text, f.x + 2, f.y + 2);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    ctx.restore();   // end camera

    // blackout: dark screen, only eyes + grin glow (a DIM, photosensitivity-safe)
    if (blackoutT > 0) {
      const a = clamp(blackoutT / 0.6, 0, 1);
      const ba = Math.min(1, a * 3);          // eyes/grin fade with the same ramp as the dark
      ctx.fillStyle = `rgba(2,2,8,${0.9 * ba})`;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalAlpha = ba;
      const proj = (wx, wy) => ({ x: (wx - cam.x) * cam.zoom + W * 0.5, y: (wy - cam.y) * cam.zoom + viewY() });
      for (const p of players) {
        if (!p.alive) continue;
        const s = p.r / 12;
        const hp = proj(p.x, groundY(p.y) - p.z - 21.7 * s);
        for (const m of [-1, 1]) {
          ctx.beginPath(); ctx.arc(hp.x + m * 3.2 * s * cam.zoom, hp.y, 2.3 * s * cam.zoom, 0, 7);
          ctx.fillStyle = '#fff'; ctx.fill();
        }
      }
      if (monster) {
        const M = monster;
        const mp = proj(M.x, groundY(M.y) - M.r * 0.55);
        ctx.save();
        ctx.translate(mp.x, mp.y);
        ctx.strokeStyle = '#ff2d95'; ctx.lineWidth = 3;
        ctx.shadowColor = '#ff2d95'; ctx.shadowBlur = 16;
        const mr = M.r * cam.zoom;
        ctx.beginPath();   // glowing grin
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, mr, M.h + 0.8, M.h - 0.8 + 6.2832);
        ctx.closePath(); ctx.stroke();
        for (const m of [-1, 1]) {
          const ex0 = m * mr * 0.34 * Math.cos(M.h + Math.PI / 2), ey0 = -mr * 0.62;
          ctx.beginPath(); ctx.arc(ex0, ey0, mr * 0.2, 0, 7);
          ctx.fillStyle = '#fff'; ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();   // end blackout alpha
    }

    // confetti (screen space)
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
    if (banner) {
      const bt = banner.t, d = banner.dur;
      const pop = reduceMotion ? 1 : bt < 0.25 ? 1.12 - 0.48 * bt : 1;
      const alpha = bt > d - 0.3 ? (d - bt) / 0.3 : 1;
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.translate(W / 2, H * 0.30);
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

  // ---------- Countdown ----------
  const CD_SEQ = ['3', '2', '1', 'GO!'];
  function tickCountdown(dt) {
    cdT += dt;
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
        state = 'playing';
        showBanner(T.monsterWoke, '#ff2d95', 1.4, true);
        addTrauma(0.5);
        beep(60, 0.5, 'sawtooth', 0.2, 40);
      }
    }
  }

  // ---------- Loop (RAF + Worker, hidden-tab safe) ----------
  const STEP = 1 / 60;
  let accumulator = 0;
  let last = performance.now();
  let lastSizeCheck = 0;
  function step() {
    const now = performance.now();
    if (snackUiReady) updateSnackUi();
    let realDt = (now - last) / 1000;
    if (realDt < STEP * 0.9) return;
    last = now;
    if (realDt > 0.05) realDt = 0.05;

    // embedded panes don't always fire 'resize' — poll for viewport drift
    if (now - lastSizeCheck > 500) {
      lastSizeCheck = now;
      if (window.innerWidth !== W || window.innerHeight !== H) { resize(); remapWorld(); }
    }

    if (freezeT > 0) { freezeT -= realDt; render(); return; }
    if (flashT > 0) flashT -= realDt;
    if (banner) { banner.t += realDt; if (banner.t > banner.dur) banner = null; }

    if (slowmo.t > 0) { slowmo.t -= realDt; timeScale = slowmo.ts; }
    else timeScale += (1 - timeScale) * Math.min(1, realDt * 2.5);
    const dt = realDt * timeScale;
    const fm = dt * 60;

    if (state === 'countdown') tickCountdown(realDt);
    else if (state === 'playing') {
      accumulator += dt;
      while (accumulator >= STEP && state === 'playing') {
        update(STEP, 1); accumulator -= STEP;
      }
    }
    else if (state === 'over') {
      // keep the scene alive: monster mouth idles, winner flees happily, effects decay
      if (monster) { monster.mouthPh += dt * 4; if (monster.belly > 0) monster.belly = Math.max(0, monster.belly - dt * 2.5); }
      if (winner && winner.alive) {
        winner.phase += dt * 10;
        winner.vz -= 1500 * dt; winner.z += winner.vz * dt;
        if (winner.z <= 0) { winner.z = 0; winner.vz = 340; }
      }
      const ck = 1 - Math.pow(0.94, fm);
      cam.x += (cam.tx - cam.x) * ck; cam.y += (cam.ty - cam.y) * ck; cam.zoom += (cam.tz - cam.zoom) * ck;
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i]; c.x += c.vx * fm; c.y += c.vy * fm; c.vy += 0.12 * fm; c.rot += c.vr * fm;
        if (c.y > H + 20) confetti.splice(i, 1);
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]; p.x += p.vx * fm; p.y += p.vy * fm;
        const dr = Math.pow(0.92, fm); p.vx *= dr; p.vy *= dr; p.life -= dt * 2;
        if (p.life <= 0) particles.splice(i, 1);
      }
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i]; f.y += f.vy * fm; f.life -= dt * 1.3;
        if (f.life <= 0) floaters.splice(i, 1);
      }
      updateGhosts(dt, fm);
      trauma *= Math.pow(0.9, fm);
    }
    render();
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

  // ---------- Winner screen ----------
  function showWinner() {
    const ws = document.getElementById('winScreen');
    document.getElementById('winName').textContent = winner ? dispName(winner) : '-';
    const list = document.getElementById('rankList');
    list.innerHTML = '';
    const ranked = [];
    for (let i = eliminationOrder.length - 1; i >= 0; i--) ranked.push(eliminationOrder[i]);
    const medals = ['🥇', '🥈', '🥉'];
    const cls = ['gold', 'silver', 'bronze'];
    ranked.forEach((p, idx) => {
      const li = document.createElement('li');
      li.className = 'rankItem' + (idx < 3 ? ' ' + cls[idx] : '');
      li.innerHTML =
        `<span class="rankNo">${idx < 3 ? medals[idx] : (idx + 1)}</span>` +
        `<span class="dot" style="background:${p.color}"></span>` +
        `<span class="rankName">${esc(dispName(p))}</span>`;
      list.appendChild(li);
    });
    ws.classList.remove('hidden');
    document.getElementById('chaseFeed').hidden = true;
  }

  // ---------- UI ----------
  // ---------- Roster: type "name * 4", the add button queues that many ----------
  const MAXN = 30, MIN_START = 2;
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
  try {
    const v = localStorage.getItem('minigame_roster');
    if (v) entries = JSON.parse(v) || [];
    else { const old = localStorage.getItem('minigame_names'); if (old) old.split('\n').forEach(l => addEntry(l)); }
  } catch (e) { entries = []; }
  renderRoster();

  const dispName = p => (p.isNum ? T.numName(p.name) : p.name) + (p.dup > 1 ? `(${p.dup})` : '');
  const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function begin() {
    resize();
    if (!W || !H) { setTimeout(begin, 120); return; }   // pane not laid out yet — a 0-size arena is unrecoverable
    window.__names = expandRoster();
    if (window.__names.length < MIN_START) return;
    playerCount = window.__names.length;
    initAudio();
    if (AC && AC.state === 'suspended') AC.resume();
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('winScreen').classList.add('hidden');
    setupGame(playerCount);
    document.getElementById('hud').hidden = false;
    document.getElementById('chaseFeed').hidden = false;
    nameInput.blur();
    cdT = 0; cdIdx = -1;
    state = 'countdown';
  }
  document.getElementById('startBtn').onclick = begin;
  document.getElementById('againBtn').onclick = begin;

  document.getElementById('demoBtn').onclick = () => {
    entries = [{ name: T.botName, count: 12 }]; renderRoster(); begin();
  };

  // Delivery and chase commentary are observation-only; no input changes the match.
  const snackStatus = document.getElementById('snackStatus');
  const snackComboEl = document.getElementById('snackCombo');
  const chaseHeadline = document.getElementById('chaseHeadline');
  function updateSnackUi() {
    const label = snack ? `${snack.emoji} ${T.delivering}` : snacksLeft > 0
      ? T.autoSnack(Math.max(0, Math.ceil(nextSnackT - gameT))) : T.snackSoldOut;
    if (snackStatus.textContent !== label) snackStatus.textContent = label;
    snackComboEl.hidden = snackCombo < 2 || state !== 'playing';
    if (!snackComboEl.hidden) snackComboEl.textContent = T.snackCombo(snackCombo);
    const target = monster && players[monster.lock];
    const finalists = players.filter(p => p.alive);
    const headline = winner ? '🏆 ' + dispName(winner) : finalists.length === 2
      ? `${dispName(finalists[0])} VS ${dispName(finalists[1])}`
      : target?.alive ? T.chaseTarget(dispName(target)) : T.chaseReady;
    if (chaseHeadline.textContent !== headline) chaseHeadline.textContent = headline;
  }
  function throwSnack() {
    if (state !== 'playing' || snack || snacksLeft <= 0 || gameT < nextSnackT) return;
    nextSnackT = gameT + 11;
    snacksLeft--;
    let idx = Math.floor(random() * SNACKS.length);
    if (idx === lastSnackIndex) idx = (idx + 1) % SNACKS.length;
    lastSnackIndex = idx;
    const item = SNACKS[idx];
    const a = rand(0, 6.2832), rr = arena.R * rand(0.18, 0.26);
    let bx = monster.x + Math.cos(a) * rr, by = monster.y + Math.sin(a) * rr;
    const dc = Math.hypot(bx - arena.cx, by - arena.cy);
    if (dc > arena.R * 0.72) {
      bx = arena.cx + (bx - arena.cx) / dc * arena.R * 0.72;
      by = arena.cy + (by - arena.cy) / dc * arena.R * 0.72;
    }
    snack = { ...item, x: bx, y: by, t: 6, phase: 0 };
    spawnParticles(bx, groundY(by), item.color, 24, 6);
    addFloater(bx, groundY(by) - 40, `${item.emoji} ${T.delivered}`, item.color, true);
    showBanner(`${item.emoji} ${item.name}`, item.color, 1.3, true);
    addTrauma(0.15);
    sfx('delivery', 200, d => {
      beep(660, 0.08, 'triangle', 0.16 * d);
      setTimeout(() => beep(880, 0.12, 'triangle', 0.14 * d), 100);
    });
    // The landing shock nudges nearby runners too, shaking up the race a little.
    for (const p of players) {
      if (!p.alive || p.tripT > 0) continue;
      const dx = p.x - bx, dy = p.y - by, d = Math.hypot(dx, dy) || 1;
      if (d < arena.R * 0.32) {
        const f = 2.2 * arena.scale;
        p.vx += dx / d * f; p.vy += dy / d * f;
        p.vz = Math.max(p.vz, 140);
      }
    }
    // Queue the lure even during a lunge; the next idle beat must notice the delivery.
    if (monster) {
      dropLock(monster);
      monster.lureT = 6; monster.lureX = bx; monster.lureY = by;
    }
    updateSnackUi();
  }
  snackUiReady = true;
  updateSnackUi();
})();
