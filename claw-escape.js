(() => {
  const T = window.T;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- Random streams ----------
  // The sim seed is drawn exactly once per match (first line of setupGame). Everything
  // cosmetic uses fxRand, which never touches Math.random, so the menu, the viewport and
  // the frame rate cannot shift who ends up last.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const fxRand = mulberry32(0xC1A3);
  let simRand = mulberry32(0x5EED);
  const fx = new window.ClawEscapeFX(ctx, reduceMotion, fxRand);

  let muted = false;
  try { muted = localStorage.getItem('minigame_muted') === '1'; } catch (e) {}
  let W = 0, H = 0, DPR = 1;

  // ---------- Fixed world (y down). Nothing here depends on the viewport. ----------
  const FLOOR = 600, CHUTE_X1 = 96, LIP_X0 = 96, LIP_X1 = 104, LIP_TOP = 520, LIP_X = 100;
  const SENSOR_Y = 560, PILE_X0 = 104, PILE_W = 256, RAIL_Y = 24, HOME_X = 48, HOME_Y = 60, GRAVITY = 1800;
  const C = {
    V_RAIL: 360, V_DROP: 520, V_LIFT: 360, V_CARRY: 330,
    GRAB: 0.34, RELEASE: 0.28, HOVER: 0.45, INTRO: 1.2,
    SP: { rush: 3.0, main: 1.7, last3: 1.35, final: 1.2 },
    ROUL: { rush: 0, main: 0.35, last3: 0.9, final: 1.1 },
    HOVERP: { rush: 0, main: 0.25, last3: 0.5, final: 0.8 },
    WAIT: { rush: 0.1, main: 0.25, last3: 0.4, final: 0.45 },
    BASEP: { rush: 0.9, main: 0.68 },
    LIPSHARE: { rush: 0.04, main: 0.15, last3: 0.3, final: 0.45 },
    FINAL_P_SMALL: [0.1, 0.35, 0.6, 1], FINAL_P: [0.3, 0.6, 0.8, 1], FINAL_P_BIG: [0.4, 0.7, 1],
    DUCK_P: 0.8, TEETER: [0.6, 1.1], TEETER_FINAL: [0.9, 1.4],
    TILT_FIRST: 7, TILT_GAP: 12, TILT_MAX: 2, TILT_WARN: 1.5, TILT_SHAKE: 0.7, TILT_SETTLE: 0.5,
    FLUKE_P: 0.35, FLUKE_IN: 0.55, JACKPOT_T: 1.5, DUCK_T: 1.0, SPREAD_T: 0.9, LASTCOIN: 1.8, LAST3_INTRO: 1.0,
    MISS_CAP: 3, FF: 1.8, LATE_CAP: 12, HARD_CAP: 110,
    // A miss shoves the doll underneath. Pocket slides are quiet; most hits
    // rip the support out so the column falls and that doll pops back on top.
    BUMP_LIP: 0.62, BUMP_IN: 0.5, BUMP_POCKET: 0.28, BUMP_CHUTE: 0.66,
  };
  const T3 = n => 4 + 0.7 * n;           // sim s by which the director wants 3 dolls left
  const DEADLINE = n => 38 + 0.6 * n;    // endgame deadline
  const STEP = 1 / 60, REVEAL_DUR = 5.2, COUNT_STEP = 0.72;
  const HANG = [0, 0.4, -0.4, 0.4];      // held-entity x offsets (× r) by chain index

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function approach(v, target, maxStep) { return Math.abs(target - v) <= maxStep ? target : v + Math.sign(target - v) * maxStep; }
  function U(a, b) { return a + simRand() * (b - a); }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(simRand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function fr(a, b) { return a + fxRand() * (b - a); }
  function hashName(s) { let h = 5381; for (const ch of String(s)) h = (Math.imul(h, 33) + ch.codePointAt(0)) | 0; return h >>> 0; }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', () => { resize(); frameCabinet(true); });
  resize();

  // ---------- Audio (one master gain, per-type limiter, fxRand noise) ----------
  let AC = null, master = null, noiseBuf = null, duckUntil = 0, hushUntil = 0;
  const lastSfx = Object.create(null);
  function initAudio() {
    if (AC) return;
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain(); master.gain.value = muted ? 0 : 0.8;
      master.connect(AC.destination);
      noiseBuf = AC.createBuffer(1, Math.floor(AC.sampleRate * 0.5), AC.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = fxRand() * 2 - 1;
    } catch (e) { AC = null; }
  }
  function beep(freq, dur = 0.06, type = 'sine', vol = 0.12, freq2 = 0, delay = 0) {
    if (!AC) return;
    const t = AC.currentTime + delay;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freq2) o.frequency.linearRampToValueAtTime(freq2, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur = 0.1, vol = 0.1, delay = 0) {
    if (!AC || !noiseBuf) return;
    const t = AC.currentTime + delay;
    const s = AC.createBufferSource(), g = AC.createGain();
    s.buffer = noiseBuf;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(g); g.connect(master);
    s.start(t, 0, Math.min(0.5, dur + 0.02));
  }
  function sfx(type, gapMs, fn) {
    if (!AC) return;
    const now = performance.now();
    if (now < hushUntil && type !== 'trombone') return;
    if (lastSfx[type] && now - lastSfx[type] < gapMs) return;
    lastSfx[type] = now;
    fn(now < duckUntil ? 0.6 : 1);
  }
  function setMasterLevel(k) { if (master) master.gain.value = muted ? 0 : 0.8 * k; }

  const muteBtn = document.getElementById('muteBtn');
  function applyMute() {
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    const label = muted ? T.unmute : T.mute;
    muteBtn.setAttribute('aria-label', label);
    muteBtn.title = label;
    setMasterLevel(1);
  }
  muteBtn.onclick = () => {
    muted = !muted;
    try { localStorage.setItem('minigame_muted', muted ? '1' : '0'); } catch (e) {}
    applyMute();
  };
  applyMute();

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const hudEl = $('hud'), aliveEl = $('aliveCount'), oddsEl = $('coffeeOdds'), stageEl = $('stageStatus');
  const cupEl = $('cupTab'), ffChip = $('ffChip'), matchFeed = $('matchFeed'), headlineEl = $('matchHeadline');
  const chipsEl = $('dangerChips'), feedEl = $('escapeFeed'), countdownEl = $('countdown');
  const winScreen = $('winScreen'), portrait = $('loserPortrait'), portraitCtx = portrait.getContext('2d');

  // ---------- Match state ----------
  let state = 'menu';            // menu | countdown | playing | reveal | over
  let N = 0, gameT = 0, realClock = 0;
  let K = 3, R_DOLL = 42, ROW_H = 72, MARGIN = 0, ROWS = 0;
  let slots = [], belowOf = [], aboveOf = [];
  let dolls = [], ducks = [], ents = [];
  let claw = null, dir = null;
  let escapeOrder = [], loser = null, escapes = 0, cupTab = 0;
  let cam = { x: 180, y: 300, zoom: 1, tx: 180, ty: 300, tz: 1 };
  let trauma = 0, revealT = 0, freezeT = 0, timeScale = 1, accumulator = 0;
  let evq = [];

  const dispName = d => (d.isNum ? T.numName(d.name) : d.name) + (d.dup > 1 ? '(' + d.dup + ')' : '');
  const shortName = d => Array.from(d.isNum ? T.numName(d.name) : d.name).slice(0, 3).join('') + (d.dup > 1 ? '(' + d.dup + ')' : '');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Slot lattice ----------
  function buildLattice(n) {
    K = clamp(Math.round(Math.sqrt(0.85 * n)), 3, 5);
    R_DOLL = Math.min(46, PILE_W / (2 * K));
    ROW_H = R_DOLL * Math.sqrt(3);
    MARGIN = (PILE_W - 2 * R_DOLL * K) / 2;
    ROWS = 2 * Math.ceil((n + 3) / (2 * K - 1)) + 3;
    slots = [];
    const idx = new Map();
    for (let row = 0; row < ROWS; row++) {
      for (let c = 0; c < (row % 2 ? K - 1 : K); c++) {
        idx.set(row * 16 + c, slots.length);
        slots.push({ row, c, x: PILE_X0 + MARGIN + R_DOLL + 2 * R_DOLL * c + (row % 2 ? R_DOLL : 0), y: FLOOR - R_DOLL - row * ROW_H, occ: null });
      }
    }
    const at = (row, c) => (c < 0 || row < 0 || !idx.has(row * 16 + c)) ? -1 : idx.get(row * 16 + c);
    belowOf = slots.map(S => {
      if (!S.row) return [];
      const o = S.row % 2 ? [at(S.row - 1, S.c), at(S.row - 1, S.c + 1)]
        : [S.c ? at(S.row - 1, S.c - 1) : -1, S.c <= K - 2 ? at(S.row - 1, S.c) : -1];
      return o.filter(v => v >= 0);
    });
    aboveOf = slots.map(S => (S.row % 2 ? [at(S.row + 1, S.c), at(S.row + 1, S.c + 1)]
      : [at(S.row + 1, S.c - 1), at(S.row + 1, S.c)]).filter(v => v >= 0));
  }
  function place(e, s) {
    if (e.slot >= 0 && slots[e.slot].occ === e) slots[e.slot].occ = null;
    e.slot = s;
    if (s >= 0) slots[s].occ = e;
  }
  const supported = s => belowOf[s].every(b => slots[b].occ);
  const inBox = () => ents.filter(e => e.state !== 'out' && e.slot >= 0);
  // Candidates are always listed in slot-index order, never by id or roster order.
  function exposed() {
    const out = [];
    for (let s = 0; s < slots.length; s++) {
      const e = slots[s].occ;
      if (e && e.state !== 'out' && aboveOf[s].every(a => !slots[a].occ)) out.push(e);
    }
    return out;
  }
  function landSlot(x) {
    let best = -1, bd = 1e9;
    for (let s = 0; s < slots.length; s++) {
      if (slots[s].occ || !supported(s)) continue;
      const d = Math.abs(slots[s].x - x) + 0.01 * slots[s].row;
      if (d < bd - 1e-9) { bd = d; best = s; }
    }
    return best;
  }
  function pileTopY() {
    let y = FLOOR;
    for (const e of ents) if (e.state !== 'out' && e.slot >= 0) y = Math.min(y, slots[e.slot].y);
    return y;
  }
  const remCount = () => { let n = 0; for (const d of dolls) if (d.state !== 'out') n++; return n; };
  const aliveDucks = () => ducks.filter(d => d.state !== 'out').length;
  function phaseOf(rem = remCount()) {
    if (rem <= 2) return 'final';
    if (rem === 3) return 'last3';
    return rem > (N >= 16 ? 5 : 6) ? 'rush' : 'main';
  }
  const expected = t => N - (N - 3) * clamp((t - 1.2) / (T3(N) - 1.2), 0, 1);

  // ---------- Sim tweens (kinematic, no solver) ----------
  function tweenTo(e, x1, y1, mode, then, dur, h = 0) {
    if (mode === 'fall' && !(y1 > e.y + 0.5)) mode = 'hop';
    if (mode === 'fall') dur = Math.sqrt(2 * (y1 - e.y) / GRAVITY);
    e.tw = { x0: e.x, y0: e.y, x1, y1, t: 0, dur: Math.max(STEP, dur || 0.3), mode, then, h };
  }
  function slotTween(e, mode = 'lerp', then = 'pile') {
    const S = slots[e.slot];
    const d = Math.abs(S.y - e.y) / ROW_H;
    if (mode === 'lerp') tweenTo(e, S.x, S.y, 'lerp', then, 0.18 * Math.max(1, d));
    else if (mode === 'hop') tweenTo(e, S.x, S.y, 'hop', then, 0.45, R_DOLL * 1.1);
    else tweenTo(e, S.x, S.y, 'fall', then);
  }
  // settle(): unsupported occupants drop into an empty below-slot (simRand picks between two).
  // mode 'fall' is the collapse after a miss: gravity, not a quiet lerp.
  function settle(mode) {
    let moved = true, guard = 0;
    while (moved && guard++ < 400) {
      moved = false;
      for (let s = 0; s < slots.length; s++) {
        const o = slots[s].occ;
        if (!o || supported(s)) continue;
        // A doll released this cycle keeps the slot landSlot just chose.
        if (mode === 'fall' && o.vulnerable === false) continue;
        const em = belowOf[s].filter(b => !slots[b].occ);
        if (!em.length) continue;
        const to = em.length > 1 ? em[Math.floor(simRand() * em.length)] : em[0];
        place(o, to);
        if (o.state === 'fall' && o.tw) slotTween(o, 'fall');
        else if (mode === 'fall') { o.state = 'fall'; o.armImpact = false; slotTween(o, 'fall', 'pile'); }
        else { o.state = 'pile'; slotTween(o, 'lerp'); }
        moved = true;
      }
    }
  }
  function sideIndex(s, dir) {
    const S = slots[s], c = S.c + (dir < 0 ? -1 : 1);
    if (c < 0) return -1;
    for (let i = 0; i < slots.length; i++) if (slots[i].row === S.row && slots[i].c === c) return i;
    return -1;
  }
  // Highest supported empty slot near x. A ripped doll should surface, not burrow.
  function landHigh(x) {
    let best = -1, bd = 1e9;
    for (let s = 0; s < slots.length; s++) {
      if (slots[s].occ || !supported(s)) continue;
      const d = Math.abs(slots[s].x - x) - 0.01 * slots[s].row;
      if (d < bd - 1e-9) { bd = d; best = s; }
    }
    return best;
  }
  // Slips are not knockable until a later tick has seen them at rest. The same
  // tick they land must not throw them into the chute.
  function knockable(o, landed) {
    return !!o && o !== landed && o.state === 'pile' && !o.tw && o.slot >= 0 && o.vulnerable !== false && o.restAt !== gameT;
  }
  function markRest(e) {
    if (e && e.state === 'pile' && !e.tw && e.slot >= 0) { e.vulnerable = true; e.restAt = gameT; }
  }
  function contactsOf(landed) {
    const out = [], s = landed.slot;
    if (s < 0) return out;
    for (const b of belowOf[s]) if (knockable(slots[b].occ, landed)) out.push(slots[b].occ);
    if (out.length) return out;
    for (const dir of [-1, 1]) {
      const n = sideIndex(s, dir);
      if (n >= 0 && knockable(slots[n].occ, landed)) out.push(slots[n].occ);
    }
    return out;
  }
  function pushDir(landed, victim, vx) {
    if (vx <= -1) return -1;
    if (vx >= 1) return 1;
    const vs = slots[victim.slot];
    if (vs.x < landed.x - 1) return -1;
    if (vs.x > landed.x + 1) return 1;
    return simRand() < C.BUMP_CHUTE ? -1 : 1;
  }
  // Doll exits already committed this cycle. A bump may add one more only while
  // three dolls would still remain, so LAST3 and the final grab are not skipped.
  function pendingDollExits() {
    let n = 0;
    for (const e of ents) {
      if (e.kind !== 'doll' || e.state === 'out') continue;
      if (e.state === 'held' && (e.plan === 'in' || e.plan === 'lipIn')) n++;
      else if (e.state === 'teeter' && e.teeterIn) n++;
      else if (e.state === 'fall' && e.tw && e.tw.then === 'chute') n++;
    }
    return n;
  }
  function sendToLip(e, into) {
    if (e.slot >= 0) place(e, -1);
    e.state = 'fall'; e.plan = 'bump'; e.tag = ''; e.armImpact = false; e.chain = 0;
    e.teeterDur = U(0.4, 0.75); e.teeterIn = !!into; e.teeterT = 0;
    tweenTo(e, LIP_X, LIP_TOP - R_DOLL, 'hop', 'teeter', 0.36, R_DOLL * 0.9);
  }
  function throwDoll(e, s) {
    place(e, s); e.armImpact = false; e.state = 'fall';
    if (slots[s].y < e.y - 0.5) { slotTween(e, 'hop', 'pile'); e.tw.dur = 0.38; e.tw.h = R_DOLL * 1.25; }
    else slotTween(e, 'fall', 'pile');
  }
  // Contact impulse on the lattice. The hit doll leaves its slot, everyone it
  // was holding falls, and the hit doll comes back on top or hangs on the lip.
  function pileImpact(landed, vx) {
    if (!landed || landed.state === 'out' || landed.slot < 0) return;
    const contacts = contactsOf(landed);
    if (!contacts.length) return;
    const victim = contacts.length === 1 ? contacts[0] : contacts[Math.floor(simRand() * contacts.length)];
    const dir = pushDir(landed, victim, vx);
    const pocket = sideIndex(victim.slot, dir);
    if (pocket >= 0 && !slots[pocket].occ && supported(pocket) && simRand() < C.BUMP_POCKET) {
      place(victim, pocket); victim.state = 'pile'; victim.armImpact = false;
      slotTween(victim, 'hop', 'pile'); victim.tw.dur = 0.28; victim.tw.h = R_DOLL * 0.55;
      settle('fall');
      emit('bump', victim, landed);
      return;
    }
    const fromX = slots[victim.slot].x;
    const onLip = dir < 0 && sideIndex(victim.slot, -1) < 0 && !ents.some(o => o.state === 'teeter');
    place(victim, -1);
    settle('fall');
    if (onLip && simRand() < C.BUMP_LIP) {
      const into = victim.kind === 'duck' || remCount() - pendingDollExits() - 1 >= 3;
      sendToLip(victim, into && simRand() < C.BUMP_IN);
    } else {
      let s = landHigh(fromX + dir * R_DOLL * 1.7);
      if (s < 0) s = landHigh(fromX);
      if (s < 0) sendToLip(victim, false);
      else throwDoll(victim, s);
    }
    emit('bump', victim, landed);
  }

  // ---------- Entities ----------
  function makeDoll(i, name, isNum, dup) {
    const hue = ((i * 360 / N + fr(-8, 8)) % 360 + 360) % 360;
    return { id: i, name, isNum, dup, hue, color: `hsl(${hue.toFixed(1)},78%,64%)`, species: hashName(name) % 7,
      kind: 'doll', slot: -1, state: 'pile', x: 0, y: 0, tw: null,
      chain: -1, plan: null, planF: 0, teeterT: 0, teeterDur: 0, teeterIn: false,
      escT: -1, rank: 0, tag: '', grabs: 0, slips: 0, lipBacks: 0 };
  }
  function makeDuck(j) {
    return { id: 'd' + j, kind: 'duck', slot: -1, state: 'pile', x: 0, y: 0, tw: null,
      chain: -1, plan: null, planF: 0, teeterT: 0, teeterDur: 0, teeterIn: false, tag: '' };
  }
  function newClaw() {
    return { state: 'idle', x: HOME_X, hubY: HOME_Y, carryY: HOME_Y, liftY: HOME_Y, prong: 0, t: 0,
      target: null, grabbed: [], hoverX: -1, hovered: false, golden: false, jackpot: false, attempt: 0,
      ph: 'rush', sp: 1, err: 0, roulDur: 0, dropY: HOME_Y, lift0: HOME_Y, x0: HOME_X, carryX: HOME_X,
      relN: 0, saved: 0, empty: false, lip: false, late: false, bumped: false };
  }
  function newDir() {
    return { missStreak: 0, finalAttempt: 0, tiltN: 0, nextTilt: C.TILT_FIRST, tiltWarnT0: -1,
      jackpotDone: N < 10, jackpotArmed: false, jackpotT0: -1,
      duckMainDone: N < 8 || N >= 16, duckFinalDone: N <= 3, duckT0: -1,
      last3Intro: false, finalIntro: false, coinDone: false, mainIntro: false, cycles: 0, closing: false,
      block: null, spreads: 0 };
  }
  function initialFill() {
    const all = ents.length, chosen = [];
    let need = all, row = 0;
    while (need > 0 && row < ROWS) {
      const rs = [];
      for (let s = 0; s < slots.length; s++) if (slots[s].row === row) rs.push(s);
      if (need >= rs.length) { chosen.push(...rs); need -= rs.length; }
      else {
        const sup = shuffle(rs.filter(s => belowOf[s].every(b => chosen.includes(b))));
        chosen.push(...sup.slice(0, need)); need = 0;
      }
      row++;
    }
    const perm = shuffle(ents.map((_, i) => i));
    chosen.forEach((s, k) => { const e = ents[perm[k]]; place(e, s); e.x = slots[s].x; e.y = slots[s].y; });
  }

  // ---------- Presentation event queue (drained in step(); update() stays pure sim) ----------
  function emit(type, a, b) { evq.push([type, a, b]); if (evq.length > 400) evq.shift(); }

  // ---------- Setup ----------
  function setupGame(n) {
    simRand = mulberry32(Math.floor(Math.random() * 4294967296));
    N = n; gameT = 0; realClock = 0; accumulator = 0;
    buildLattice(n);
    const names = window.__names || [];
    const seen = Object.create(null);
    dolls = [];
    for (let i = 0; i < n; i++) {
      const name = names[i] || String(i + 1);
      seen[name] = (seen[name] || 0) + 1;
      dolls.push(makeDoll(i, name, !names[i], seen[name]));
    }
    ducks = [];
    const decoys = n <= 3 ? 2 : n <= 5 ? 1 : 0;
    for (let j = 0; j < decoys; j++) ducks.push(makeDuck(j));
    ents = dolls.concat(ducks);
    initialFill();
    claw = newClaw(); dir = newDir();
    escapeOrder = []; loser = null; escapes = 0; cupTab = 0;
    trauma = 0; revealT = 0; freezeT = 0; timeScale = 1; evq = [];
    resetPresentation();
    frameCabinet(true);
  }

  // ---------- Director blocks (telegraphed events at IDLE boundaries) ----------
  function startBlock(kind, dur, extra) {
    dir.block = Object.assign({ kind, t: 0, dur }, extra || {});
    emit('block', dir.block);
  }
  function busy() {
    for (const e of ents) {
      if (e.state === 'out') continue;
      if (e.impactWait || e.tw || e.state === 'held' || e.state === 'fall' || e.state === 'teeter') return true;
    }
    return false;
  }
  function beginTilt() {
    dir.tiltN++; dir.tiltWarnT0 = gameT;
    startBlock('tiltWarn', C.TILT_WARN);
  }
  // mode 'main': anywhere on the pile; 'final': a random free floor slot.
  function dropDuck(mode = 'main') {
    let slot = -1;
    if (mode === 'final') {
      const free = [];
      for (let s = 0; s < slots.length; s++) if (slots[s].row === 0 && !slots[s].occ) free.push(s);
      if (!free.length) return false;
      slot = free[Math.floor(simRand() * free.length)];
    } else slot = landSlot(U(PILE_X0, PILE_X0 + PILE_W));
    if (slot < 0) return false;
    dir.duckT0 = gameT;
    startBlock('duck', C.DUCK_T, { slot, hx: slots[slot].x, dropped: false, duck: null });
    return true;
  }
  function doSpread(box) {
    const floor = [];
    for (let s = 0; s < slots.length; s++) if (slots[s].row === 0) floor.push(s);
    shuffle(floor);
    for (const e of box) place(e, -1);
    box.forEach((e, i) => { place(e, floor[i]); e.state = 'pile'; slotTween(e, 'hop'); e.tw.dur = 0.7; });
    dir.spreads++;
    startBlock('spread', C.SPREAD_T);
  }
  function tiltShake() {
    const box = inBox();
    let top = 0;
    for (const e of box) top = Math.max(top, slots[e.slot].row);
    const ex = exposed();
    const group = [];
    for (let s = 0; s < slots.length; s++) {
      const e = slots[s].occ;
      if (e && e.state !== 'out' && (slots[s].row >= top - 1 || ex.includes(e))) group.push(e);
    }
    const gs = shuffle(group.map(e => e.slot));
    for (const e of group) place(e, -1);
    group.forEach((e, i) => { place(e, gs[i]); e.state = 'pile'; slotTween(e, 'hop'); e.tw.dur = 0.55; e.tw.h = R_DOLL * 1.4; });
    dir.nextTilt = gameT + C.TILT_GAP;
  }
  function blockStep(dt) {
    const b = dir.block;
    b.t += dt;
    const end = () => { dir.block = null; emit('blockEnd', b); };
    switch (b.kind) {
      case 'tiltWarn':
        if (gameT >= dir.tiltWarnT0 + C.TILT_WARN) { tiltShake(); startBlock('tilt', C.TILT_SHAKE + C.TILT_SETTLE); }
        break;
      case 'tilt':
        if (b.t >= b.dur && !busy()) {
          dir.block = null;
          if (simRand() < C.FLUKE_P) {
            const lip = exposed().filter(e => e.kind === 'doll' && slots[e.slot].c === 0 && slots[e.slot].row % 2 === 0);
            if (lip.length) {
              const e = lip[Math.floor(simRand() * lip.length)];
              place(e, -1); settle();
              e.state = 'fall'; e.plan = 'fluke'; e.chain = 0;
              e.teeterDur = U(C.TEETER[0], C.TEETER[1]); e.teeterIn = simRand() < C.FLUKE_IN; e.teeterT = 0;
              tweenTo(e, LIP_X, LIP_TOP - R_DOLL, 'hop', 'teeter', 0.4, R_DOLL);
              startBlock('fluke', 0, { e });
              break;
            }
          }
          emit('blockEnd', b);
        }
        break;
      case 'duck':
        if (!b.dropped && gameT >= dir.duckT0 + C.DUCK_T) {
          b.dropped = true;
          const d = makeDuck(ducks.length);
          ducks.push(d); ents.push(d);
          d.x = slots[b.slot].x; d.y = -10;
          if (slots[b.slot].occ || !supported(b.slot)) b.slot = landSlot(d.x);
          place(d, b.slot); d.state = 'fall'; d.armImpact = true;
          slotTween(d, 'fall');
          b.duck = d;
          emit('duckSpawn', d);
        }
        if (b.dropped && !busy()) end();
        break;
      case 'spread': case 'fluke':
        if (b.t >= b.dur && !busy()) end();
        break;
      case 'jackpot':
        if (b.t >= b.dur) { dir.jackpotArmed = true; end(); }
        break;
      default:   // coin, last3, final intros
        if (b.t >= b.dur) end();
    }
  }

  // ---------- Claw state machine ----------
  function idleStep(dt) {
    const c = claw;
    if (dir.block) { blockStep(dt); return; }
    const rem = remCount(), ph = phaseOf(rem);
    if (c.t < C.WAIT[ph]) return;
    if (!dir.coinDone) { dir.coinDone = true; startBlock('coin', C.INTRO); return; }
    if (ph === 'last3' && !dir.last3Intro) { dir.last3Intro = true; dir.missStreak = 0; startBlock('last3', C.LAST3_INTRO); return; }
    if (ph === 'final' && !dir.finalIntro) { dir.finalIntro = true; dir.last3Intro = true; dir.missStreak = 0; startBlock('final', C.LASTCOIN); return; }
    if (ph === 'main' && !dir.mainIntro) { dir.mainIntro = true; emit('mainIntro'); }
    const box = inBox();
    if (box.length <= K && box.some(e => slots[e.slot].row > 0)) { doSpread(box); return; }
    if (!dir.duckMainDone && ph === 'main' && rem <= Math.max(4, Math.ceil(0.35 * N)) && aliveDucks() < 2) {
      dir.duckMainDone = true;
      if (dropDuck('main')) return;
    }
    if (!dir.duckFinalDone && ph === 'final') {
      dir.duckFinalDone = true;
      if (!aliveDucks() && dropDuck('final')) return;
    }
    if (rem >= 5 && dir.tiltN < C.TILT_MAX && gameT >= dir.nextTilt - C.TILT_WARN) { beginTilt(); return; }
    if (!dir.jackpotDone && rem >= 9 && (rem <= 0.6 * N || rem - expected(gameT) >= 3)) {
      dir.jackpotDone = true; dir.jackpotT0 = gameT;
      startBlock('jackpot', C.JACKPOT_T);
      return;
    }
    startRoulette(ph, rem);
  }

  function startRoulette(ph, rem) {
    const c = claw, r = R_DOLL;
    const late = (ph === 'rush' || ph === 'main') && gameT > T3(N) + C.LATE_CAP;
    const lateEnd = (ph === 'last3' || ph === 'final') && gameT > DEADLINE(N);
    const golden = lateEnd || dir.missStreak >= C.MISS_CAP || (ph === 'final' && dir.finalAttempt >= (N >= 10 ? 2 : 3)) || late;
    const jackpot = dir.jackpotArmed; dir.jackpotArmed = false;
    let cand = exposed();
    if (golden || jackpot) { const d = cand.filter(e => e.kind === 'doll'); if (d.length) cand = d; }
    if (!cand.length) { c.t = 0; return; }
    const target = cand[Math.floor(simRand() * cand.length)];
    Object.assign(c, { state: 'roulette', t: 0, target, ph, golden: golden || jackpot, jackpot, late,
      sp: C.SP[ph] * (late ? 1.3 : 1), err: rem - expected(gameT), grabbed: [], saved: 0, empty: false, bumped: false, lip: false,
      attempt: ph === 'final' ? dir.finalAttempt + 1 : 0, hoverX: -1, hovered: false });
    c.roulDur = c.golden && !jackpot ? Math.max(C.ROUL[ph], 0.6) : C.ROUL[ph];   // golden: 0.6 s sparkle build-up
    if (simRand() < C.HOVERP[ph]) {
      const opts = [target.x - 2 * r, target.x + 2 * r].filter(x => x >= PILE_X0 + r - 1 && x <= PILE_X0 + PILE_W - r + 1);
      if (opts.length) c.hoverX = opts.length > 1 ? opts[Math.floor(simRand() * 2)] : opts[0];
    }
    c.carryY = ph === 'rush' ? clamp(pileTopY() - 2.2 * r, HOME_Y, 440 - 2 * r) : HOME_Y;
    emit('roulette', cand, target);
  }

  function rollPlans() {
    const c = claw, tg = c.target, ph = c.ph, rem = remCount(), S = slots[tg.slot], r = R_DOLL;
    const grabbed = [tg];
    const isDoll = tg.kind === 'doll';
    if (isDoll && (c.jackpot || (!c.golden && (ph === 'rush' || ph === 'main')))) {
      const neigh = [];
      for (let s = 0; s < slots.length; s++) {
        const e = slots[s].occ;
        if (!e || e === tg || e.kind !== 'doll' || e.state === 'out') continue;
        if (Math.hypot(slots[s].x - S.x, slots[s].y - S.y) >= 2.05 * r) continue;
        if (!aboveOf[s].every(a => !slots[a].occ || slots[a].occ === tg)) continue;
        neigh.push(e);
      }
      shuffle(neigh);
      const cap = c.jackpot ? Math.min(3, rem - 6) : ph === 'rush' ? Math.min(4, rem - 5) : Math.min(2, rem - 3);
      const adj = 0.06 * c.err;
      const hs = c.jackpot ? [1, 1, 0] : ph === 'rush' ? [0.75 + adj, 0.45 + adj, 0.2 + adj] : [rem >= 5 ? 0.3 + adj : 0, 0, 0];
      for (let k = 0; k < 3; k++) {
        if (neigh[k] && grabbed.length < cap && simRand() < clamp(hs[k], 0, 0.9)) grabbed.push(neigh[k]);
        else break;
      }
    }
    let pS;
    if (c.golden) pS = 1;
    else if (!isDoll) pS = C.DUCK_P;
    else if (ph === 'final') {
      const arr = N <= 3 ? C.FINAL_P_SMALL : N >= 10 ? C.FINAL_P_BIG : C.FINAL_P;
      pS = arr[Math.min(dir.finalAttempt, arr.length - 1)];
    } else if (ph === 'last3') pS = N <= 5 ? 0.4 : N >= 16 ? 0.6 : 0.5;
    else pS = clamp(C.BASEP[ph] + clamp(0.07 * c.err, -0.15, 0.2), 0.35, 0.97);
    const warm = (ph === 'last3' || ph === 'final') && gameT > DEADLINE(N) - 8;
    if (warm && !c.golden && isDoll) pS = Math.min(1, pS + 0.25);
    if (ph === 'final') dir.finalAttempt++;
    dir.cycles++;

    const plans = grabbed.map((e, i) => {
      if (i === 0) {
        if (simRand() < pS) return simRand() < (c.golden ? 0 : C.LIPSHARE[ph]) ? 'lipIn' : 'in';
        const u = simRand();
        return u < 0.25 ? 'empty' : u < 0.55 ? 'slipLift' : u < 0.8 ? 'slipCarry' : 'lipBack';
      }
      return simRand() < pS * 0.85 ? 'in' : simRand() < 0.55 ? 'slipLift' : 'slipCarry';
    });
    if (plans[0] === 'empty') {
      c.empty = true; c.grabbed = []; tg.plan = 'empty';
      c.carryX = HOME_X;
      emit('empty', tg);
      return;
    }
    c.lip = plans[0] === 'lipIn' || plans[0] === 'lipBack';
    c.carryX = c.lip ? LIP_X : HOME_X;
    const tag = c.jackpot ? 'jackpot' : c.golden ? 'golden' : grabbed.length > 1 ? 'chain' : plans[0] === 'lipIn' ? 'lip' : '';
    const f130 = S.x - c.carryX > 1e-6 ? Math.max(0, (S.x - 130) / (S.x - c.carryX)) : 0;
    grabbed.forEach((e, i) => {
      e.plan = plans[i]; e.chain = i; e.tag = tag;
      place(e, -1); e.state = 'held'; e.tw = null;
      if (e.kind === 'doll') e.grabs++;
      if (e.plan === 'slipLift') e.planF = U(0.2, 0.8);
      else if (e.plan === 'slipCarry') e.planF = Math.min(U(0.15, 0.7), f130);
      else e.planF = 0;
      if (e.plan === 'lipIn' || e.plan === 'lipBack') {
        const tr = ph === 'final' ? C.TEETER_FINAL : C.TEETER;
        e.teeterDur = U(tr[0], tr[1]); e.teeterIn = e.plan === 'lipIn';
      }
    });
    c.grabbed = grabbed;
    emit('grab', grabbed);
  }

  // Same-tick slips share the pile from the start of the step. A taken slot is
  // skipped in favour of another x whose landSlot on that pile is still free,
  // so the second doll does not suddenly aim at a slot the first one revealed.
  let slipOcc = null, slipTaken = null;
  function beginSlipReleases() {
    slipOcc = slots.map(s => s.occ);
    slipTaken = new Set();
  }
  function landSlotOcc(x, occ) {
    let best = -1, bd = 1e9;
    for (let s = 0; s < slots.length; s++) {
      if (occ[s]) continue;
      if (slots[s].row && !belowOf[s].every(b => occ[b])) continue;
      const d = Math.abs(slots[s].x - x) + 0.01 * slots[s].row;
      if (d < bd - 1e-9) { bd = d; best = s; }
    }
    return best;
  }
  function claimSlipSlot(relX) {
    const step = Math.max(1, R_DOLL / 10);
    for (let dx = 0; dx <= R_DOLL + 30; dx += step) {
      const xs = dx ? [relX - dx, relX + dx] : [relX];
      for (const x of xs) {
        const s = landSlotOcc(x, slipOcc);
        if (s >= 0 && !slipTaken.has(s)) { slipTaken.add(s); return s; }
      }
    }
    const s = landSlot(relX);
    if (s >= 0) slipTaken.add(s);
    return s;
  }
  function releaseSlip(e) {
    const s = claimSlipSlot(e.x + (simRand() * 2 - 1) * R_DOLL);
    e.state = 'fall'; e.tag = '';
    e.armImpact = true; e.vulnerable = false;
    if (s >= 0) { place(e, s); slotTween(e, 'fall', 'pile'); }
    if (e.kind === 'doll') e.slips++;
    emit('slip', e);
  }
  function dropHeld(e) {
    e.state = 'fall';
    if (e.plan === 'lipIn' || e.plan === 'lipBack') tweenTo(e, LIP_X, LIP_TOP - R_DOLL, 'fall', 'teeter');
    else tweenTo(e, HOME_X - 8 + (e.chain % 2) * 16, SENSOR_Y + 40, 'fall', 'chute');
  }

  function clawStep(dt) {
    const c = claw, r = R_DOLL;
    c.t += dt;
    switch (c.state) {
      case 'idle': idleStep(dt); break;
      case 'roulette':
        if (c.t >= c.roulDur) { c.state = 'aim'; c.t = 0; emit('aim', c.target); }
        break;
      case 'aim': {
        const tx = c.hoverX >= 0 && !c.hovered ? c.hoverX : c.target.x;
        c.x = approach(c.x, tx, C.V_RAIL * c.sp * dt);
        c.hubY = approach(c.hubY, c.carryY, C.V_LIFT * c.sp * dt);
        if (c.x === tx && c.hubY === c.carryY) {
          if (c.hoverX >= 0 && !c.hovered) { c.state = 'hover'; c.t = 0; emit('hover'); }
          else { c.state = 'drop'; c.t = 0; c.dropY = slots[c.target.slot].y - r - 12; }
        }
        break;
      }
      case 'hover':
        if (c.t >= C.HOVER) { c.hovered = true; c.state = 'aim'; c.t = 0; }
        break;
      case 'drop':
        c.hubY = approach(c.hubY, c.dropY, C.V_DROP * c.sp * dt);
        if (c.hubY === c.dropY) { c.state = 'grab'; c.t = 0; }
        break;
      case 'grab': {
        const g = C.GRAB / Math.sqrt(c.sp);
        c.prong = Math.min(1, c.t / g);
        if (c.t >= g) {
          rollPlans();
          c.state = 'lift'; c.t = 0; c.lift0 = c.hubY;
          settle();
          let liftY = c.carryY;
          if (c.ph === 'rush' && c.grabbed.length) {
            const deep = 2 * r + 16 + (c.grabbed.length - 1) * 1.6 * r;
            liftY = Math.min(liftY, pileTopY() - deep - 0.2 * r, LIP_TOP - deep - 8);
          }
          c.liftY = Math.max(HOME_Y, Math.min(liftY, c.lift0));
          emit('lift');
        }
        break;
      }
      case 'lift': {
        if (c.empty && !c.bumped) { c.bumped = true; pileImpact(c.target, 0); }
        c.hubY = approach(c.hubY, c.liftY, C.V_LIFT * c.sp * dt);
        const f = c.lift0 - c.liftY > 1e-6 ? (c.lift0 - c.hubY) / (c.lift0 - c.liftY) : 1;
        beginSlipReleases();
        for (const e of c.grabbed) if (e.state === 'held' && e.plan === 'slipLift' && f >= e.planF) { positionHeld(e); releaseSlip(e); }
        if (c.hubY === c.liftY) { c.state = 'carry'; c.t = 0; c.x0 = c.x; }
        break;
      }
      case 'carry': {
        c.x = approach(c.x, c.carryX, C.V_CARRY * c.sp * dt);
        const f = Math.abs(c.x0 - c.carryX) > 1e-6 ? (c.x0 - c.x) / (c.x0 - c.carryX) : 1;
        beginSlipReleases();
        for (const e of c.grabbed) if (e.state === 'held' && e.plan === 'slipCarry' && f >= e.planF) { positionHeld(e); releaseSlip(e); }
        if (c.x === c.carryX) { c.state = 'release'; c.t = 0; c.relN = 0; emit('release'); }
        break;
      }
      case 'release': {
        const rd = C.RELEASE / Math.sqrt(c.sp);
        c.prong = Math.max(0, 1 - c.t / rd);
        while (c.relN < c.grabbed.length && c.t >= c.relN * 0.12) {
          const e = c.grabbed[c.relN++];
          if (e.state === 'held') dropHeld(e);
        }
        if (c.relN >= c.grabbed.length && c.t >= rd) { c.state = 'settle'; c.t = 0; }
        break;
      }
      case 'settle':
        if (!busy()) {
          const duck = c.target && c.target.kind === 'duck';
          dir.missStreak = c.saved ? 0 : duck ? dir.missStreak : dir.missStreak + 1;
          Object.assign(c, { state: 'idle', t: 0, target: null, grabbed: [], golden: false, jackpot: false, prong: 0, hoverX: -1 });
        }
        break;
    }
  }

  function positionHeld(e) {
    e.x = claw.x + HANG[Math.min(3, Math.max(0, e.chain))] * R_DOLL;
    e.y = claw.hubY + R_DOLL + 16 + Math.max(0, e.chain) * 1.6 * R_DOLL;
  }

  function advanceEntities(dt) {
    for (const e of ents) {
      if (e.state === 'out') continue;
      if (e.state === 'held') { positionHeld(e); continue; }
      if (e.state === 'teeter') {
        e.teeterT += dt;
        if (e.teeterT >= e.teeterDur) {
          if (e.teeterIn) {
            e.state = 'fall';
            if (e.plan === 'fluke') e.tag = 'fluke';
            else if (e.plan === 'bump') e.tag = 'bump';
            tweenTo(e, HOME_X - 10, SENSOR_Y + 40, 'fall', 'chute');
            emit(e.plan === 'bump' ? 'bumpIn' : 'lipIn', e);
          } else {
            const back = e.plan === 'bump';
            let s = landSlot(PILE_X0);
            if (s < 0) s = landHigh(PILE_X0);
            place(e, s); e.state = 'fall'; e.tag = '';
            if (!back) e.armImpact = true;
            if (s >= 0) { slotTween(e, 'hop', 'pile'); e.tw.dur = 0.5; }
            if (e.kind === 'doll' && e.plan === 'lipBack') e.lipBacks++;
            emit(back ? 'bumpBack' : 'lipBack', e);
          }
        }
        continue;
      }
      const w = e.tw;
      if (!w) continue;
      w.t += dt;
      const u = Math.min(1, w.t / w.dur);
      if (w.mode === 'fall') { e.x = w.x0 + (w.x1 - w.x0) * u; e.y = w.y0 + 0.5 * GRAVITY * (u * w.dur) * (u * w.dur); }
      else if (w.mode === 'hop') { e.x = lerp(w.x0, w.x1, u); e.y = lerp(w.y0, w.y1, u) - w.h * 4 * u * (1 - u); }
      else { const k = u * u; e.x = lerp(w.x0, w.x1, k); e.y = lerp(w.y0, w.y1, k); }
      if (u >= 1) {
        const vx = w.x1 - w.x0;
        e.x = w.x1; e.y = w.y1; e.tw = null;
        if (w.then === 'pile') {
          const was = e.state;
          e.state = 'pile';
          if (was === 'fall') {
            settle();
            // Impact waits a tick so the release slot is still the one landSlot chose.
            if (e.armImpact) { e.armImpact = false; e.impactVx = vx; e.impactWait = 2; }
            emit('land', e);
          }
          markRest(e);
        } else if (w.then === 'teeter') { e.state = 'teeter'; e.teeterT = 0; emit('teeter', e); }
        // 'chute': stays in 'fall' below the sensor; the crossing check picks it up this tick
      }
    }
  }

  // Dolls crossing the chute sensor this tick escape in order: deeper first, then chain
  // index, then a simRand tie-break. The last doll in the cabinet is bounced by the shutter.
  function processCrossings() {
    const cross = ents.filter(e => e.state === 'fall' && e.x < CHUTE_X1 && e.y >= SENSOR_Y);
    if (!cross.length) return;
    const key = new Map();
    if (cross.length > 1) for (const e of cross) key.set(e, simRand());
    cross.sort((a, b) => (b.y - a.y) || (a.chain - b.chain) || ((key.get(a) || 0) - (key.get(b) || 0)));
    for (const e of cross) {
      if (e.kind === 'duck') { e.state = 'out'; e.tw = null; place(e, -1); emit('duckOut', e); continue; }
      if (remCount() === 1) {
        const s = landSlot(PILE_X0);
        place(e, s); e.state = 'pile'; e.tag = '';
        if (s >= 0) { slotTween(e, 'hop', 'pile'); e.tw.dur = 0.6; }
        emit('bounce', e);
        continue;
      }
      escapeDoll(e);
    }
    if (remCount() === 1 && state === 'playing') endMatch();
  }
  function escapeDoll(e) {
    place(e, -1);
    e.state = 'out'; e.tw = null; e.escT = gameT; e.rank = ++escapes;
    cupTab++;
    escapeOrder.push(e);
    if (claw.state !== 'idle') claw.saved++;
    emit('escape', e);
  }
  function endMatch() {
    loser = dolls.find(d => d.state !== 'out');
    loser.rank = N;
    escapeOrder.push(loser);
    state = 'reveal'; revealT = 0; freezeT = 0.30;
    emit('shutter', loser);
  }
  // ⏱️ Closing time: never reached in practice (max ≈ 76 s), but guarantees termination.
  function closingTime() {
    dir.closing = true;
    const rest = [];
    for (let s = 0; s < slots.length; s++) { const e = slots[s].occ; if (e && e.kind === 'doll' && e.state !== 'out') rest.push(e); }
    for (const d of dolls) if (d.state !== 'out' && !rest.includes(d)) rest.push(d);
    shuffle(rest);
    for (let i = 0; i < rest.length - 1; i++) { rest[i].tag = 'closing'; escapeDoll(rest[i]); }
    const last = rest[rest.length - 1];
    if (last.state !== 'pile' || last.slot < 0) {
      place(last, -1);
      const s = landSlot(PILE_X0);
      place(last, s); last.state = 'pile'; last.tag = '';
      if (s >= 0) { slotTween(last, 'hop', 'pile'); last.tw.dur = 0.6; }
    }
    for (const e of ents) if (e.state === 'held') { e.state = 'out'; place(e, -1); }
    claw.grabbed = []; claw.state = 'idle'; claw.prong = 0;
    emit('closing');
    if (state === 'playing') endMatch();
  }

  function flushImpacts() {
    for (const e of ents) {
      if (e.impactWait !== 1) continue;
      e.impactWait = 0;
      if (e.state === 'out' || e.state === 'held' || e.slot < 0) continue;
      if (e.tw || e.state !== 'pile') { e.impactWait = 2; continue; }
      pileImpact(e, e.impactVx || 0);
    }
  }
  function update(dt) {
    gameT += dt;
    if (gameT > C.HARD_CAP && !dir.closing) { closingTime(); return; }
    for (const e of ents) if (e.impactWait === 2) e.impactWait = 1;
    clawStep(dt);
    advanceEntities(dt);
    processCrossings();
    // After the release slot has been chosen, so a miss can still knock the pile.
    flushImpacts();
  }

  // Pure function of sim state; the harness uses it to estimate real duration.
  function presentTs() {
    if (state !== 'playing' || !claw) return 1;
    const ph = phaseOf();
    if ((ph === 'last3' || ph === 'final') && ents.some(e => e.state === 'teeter')) return 0.5;
    if (ph === 'final' && (claw.state === 'lift' || claw.state === 'carry')) return 0.8;
    if (ph === 'rush' && !dir.block) return C.FF;
    return 1;
  }

  // ================================================================
  // Presentation
  // ================================================================
  let look = new Map();            // per-entity cosmetic state (never part of the sim objects)
  let banner = null, lastBannerT = -9;
  let headline = { text: '', until: 0 }, headlineShown = '';
  let marquee = { text: 'INSERT COIN', color: '#ffd23f', t: 9, reels: 0 };
  let spot = null;                 // roulette spotlight
  let blackout = null, blackoutDone = false;
  let dimT = 0;                    // LAST COIN house-lights dip
  let shakeT = 0, vibT = 0, doorT = 0, coinRoll = null, hatch = null, jackpotT = -1, goldBuildT = 0;
  let shelf = [];                  // {d, t}
  let taunts = [], tauntNext = 0;
  let hbT = 0, motorT = 0, fxClock = 0, bulbPhase = 0;
  let lastPhase = '', statusT = 0, chipSig = '', lastRem = -1, lastOdds = '', lastCup = -1;
  let victoryT = 0;
  let cdT = 0, cdIdx = -1;
  let lastTarget = null, pickShown = null;
  let bubbles = [];

  function L(e) {
    let v = look.get(e.id);
    if (!v) { v = { sadT: 0, happyT: 0, sq: 0, pour: 0, landT: 0, flip: 0 }; look.set(e.id, v); }
    return v;
  }
  function resetPresentation() {
    fx.clear();
    look = new Map();
    banner = null; lastBannerT = -9;
    headline = { text: '', until: 0 }; headlineShown = '';
    marquee = { text: 'INSERT COIN', color: '#ffd23f', t: 9, reels: 0 };
    spot = null; blackout = null; blackoutDone = false; dimT = 0;
    shakeT = 0; vibT = 0; doorT = 0; coinRoll = null; hatch = null; jackpotT = -1; goldBuildT = 0;
    shelf = []; taunts = []; tauntNext = 0; hbT = 0; motorT = 0; bulbPhase = 0;
    lastPhase = ''; statusT = 0; chipSig = ''; lastRem = -1; lastOdds = ''; lastCup = -1;
    victoryT = 0;
    lastTarget = null; pickShown = null; bubbles = [];
    // pour-in: rows drop in from the top during the countdown
    for (const e of ents) {
      const v = L(e);
      const S = e.slot >= 0 ? slots[e.slot] : null;
      v.pour = S ? S.row * 0.2 + S.c * 0.05 + fr(0, 0.12) : 0;
    }
    feedEl.replaceChildren(); chipsEl.replaceChildren(); chipsEl.hidden = true;
    cupEl.textContent = T.cups(0); cupEl.classList.remove('bump');
    aliveEl.textContent = N; oddsEl.textContent = ''; oddsEl.classList.remove('hot');
    headlineEl.textContent = T.watchHint;
    ffChip.hidden = true;
    winScreen.classList.add('hidden');
    setMasterLevel(1);
  }

  function showBanner(text, color, dur = 1.6, force = false) {
    if (!force && realClock - lastBannerT < 2) return;
    lastBannerT = realClock;
    banner = { text, color, t: 0, dur };
  }
  function say(text, hold = 2.5) { headline = { text, until: realClock + hold }; }
  function setMarquee(text, color = '#ffd23f') { if (marquee.text !== text) marquee = { text, color, t: 0, reels: 0 }; }
  function addTrauma(a) { if (!reduceMotion) trauma = Math.min(1, trauma + a); }
  const DOOR = { x: 48, y: 622 };

  // ---------- event → FX / audio / DOM ----------
  function handle(type, a, b) {
    const r = R_DOLL;
    switch (type) {
      case 'block': {
        const k = a.kind;
        if (k === 'coin') {
          setMarquee('INSERT COIN'); say(T.intro);
          coinRoll = { t: 0 };
          sfx('coin', 0, v => { beep(1320, 0.08, 'triangle', 0.12 * v, 1760, 0.75); beep(2400, 0.03, 'square', 0.05 * v, 0, 0.86); beep(2600, 0.03, 'square', 0.05 * v, 0, 0.94); });
        } else if (k === 'last3') {
          const names = dolls.filter(d => d.state !== 'out').sort((p, q) => p.slot - q.slot).map(dispName).join(' · ');
          setMarquee('LAST 3', '#ff6b8b'); showBanner(T.last3(names), '#ff6b8b', 1.8, true); say(T.last3(names), 3);
          sfx('sting', 0, v => { beep(392, 0.2, 'triangle', 0.15 * v); beep(311, 0.35, 'triangle', 0.15 * v, 0, 0.18); });
        } else if (k === 'final') {
          const two = dolls.filter(d => d.state !== 'out');
          setMarquee('LAST COIN', '#ff4d5e');
          if (two.length === 2) { showBanner(T.final(dispName(two[0]), dispName(two[1])), '#ffd23f', 2.0, true); say(T.final(dispName(two[0]), dispName(two[1])), 3); }
          dimT = 1.8; coinRoll = { t: 0 };
          fx.float(275, 646, T.lastCoin, '#ffd23f', 18, true);
          sfx('coin', 0, v => { beep(1320, 0.08, 'triangle', 0.12 * v, 1760, 0.75); beep(700, 0.05, 'square', 0.08 * v, 0, 0.9); });
        } else if (k === 'spread') {
          vibT = 0.9; say(T.spread);
          sfx('spread', 0, v => { noise(0.6, 0.06 * v); beep(60, 0.5, 'sawtooth', 0.05 * v, 45); });
        } else if (k === 'duck') {
          hatch = { x: a.hx, t: 0 }; say(T.duckDrop);
          sfx('hatch', 0, v => { for (let i = 0; i < 4; i++) beep(990, 0.06, 'square', 0.06 * v, 0, i * 0.25); });
        } else if (k === 'tiltWarn') {
          setMarquee('TILT!', '#ff3b4d'); showBanner(T.tilt, '#ff5a5a', 1.4, true); say(T.tilt);
          sfx('tilt', 0, v => { for (let i = 0; i < 3; i++) { beep(330, 0.16, 'square', 0.08 * v, 0, i * 0.5); beep(330, 0.16, 'square', 0.08 * v, 0, i * 0.5 + 0.25); } });
        } else if (k === 'tilt') {
          shakeT = 0.7; say(T.tiltGo);
          sfx('rattle', 0, v => { noise(0.6, 0.12 * v); beep(90, 0.5, 'sawtooth', 0.06 * v, 60); });
        } else if (k === 'jackpot') {
          jackpotT = 0; marquee = { text: '777', color: '#ffd23f', t: 0, reels: 1 };
          showBanner(T.jackpot, '#ffd23f', 1.6, true); say(T.jackpot);
          fx.coins(180, 20, reduceMotion ? 0 : 24);
          sfx('jackpot', 0, v => {
            for (let i = 0; i < 24; i++) beep(1000, 0.025, 'square', 0.035 * v, 0, i * 0.05);
            for (let i = 0; i < 12; i++) beep(1200 + fxRand() * 1400, 0.09, 'triangle', 0.06 * v, 0, 1.2 + i * 0.05);
          });
        }
        break;
      }
      case 'blockEnd':
        if (a.kind === 'coin' || a.kind === 'jackpot' || a.kind === 'tilt') setMarquee(phaseMarquee(), phaseColor());
        if (a.kind === 'duck') hatch = null;
        break;
      case 'mainIntro':
        setMarquee('MAIN', '#72f5ff');
        break;
      case 'duckSpawn':
        fx.float(a.x, 20, '🦆', '#ffd84a', 22, true);
        sfx('squeak', 0, v => { beep(1200, 0.08, 'sine', 0.1 * v, 1800); beep(1200, 0.08, 'sine', 0.1 * v, 1800, 0.12); });
        break;
      case 'roulette': {
        const cand = a, tg = b, dur = claw.roulDur;
        const hops = [];
        if (dur > 0.05 && !reduceMotion && cand.length > 1) {
          let tt = 0, gap = 0.07, prev = null;
          while (tt < dur - 0.12) {
            let e = cand[Math.floor(fxRand() * cand.length)];
            if (e === prev) e = cand[(cand.indexOf(e) + 1) % cand.length];
            hops.push({ e, at: tt }); prev = e; tt += gap; gap *= 1.18;
          }
        }
        hops.push({ e: tg, at: Math.max(0, dur - 0.1) });
        spot = { hops, t: 0, dur, target: tg, gold: claw.golden, idx: -1, final: claw.ph === 'final' };
        if (claw.golden && !claw.jackpot) {
          showBanner(T.golden, '#ffd23f', 1.4, true); say(T.golden); goldBuildT = 0.6;
          sfx('golden', 0, v => { [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.14, 'triangle', 0.11 * v, 0, i * 0.08)); beep(2600, 0.04, 'square', 0.04 * v, 0, 0.36); });
        }
        if (claw.ph === 'last3' && !blackoutDone && N >= 4) {
          blackoutDone = true; blackout = { t: 0 }; say(T.blackout);
          sfx('powerdown', 0, v => beep(200, 0.4, 'sawtooth', 0.09 * v, 40, 0.3));
        } else if (claw.ph !== 'rush' && !claw.golden) say(T.aim(dispNameE(tg)));
        break;
      }
      case 'aim':
        if (a && a.kind === 'doll' && pickShown !== a) {
          pickShown = a;
          if (claw.ph !== 'rush') fx.float(a.x + r * 0.9, a.y - r, T.fPick, '#fff36b', 17, false, -46);
        }
        break;
      case 'hover':
        fx.float(claw.x, claw.hubY + 26, '?', '#fff', 26, true);
        if (claw.ph === 'final' || claw.ph === 'last3') say(T.hover);
        sfx('hover', 0, v => { beep(500, 0.08, 'triangle', 0.08 * v); beep(560, 0.08, 'triangle', 0.08 * v, 0, 0.1); beep(500, 0.08, 'triangle', 0.08 * v, 0, 0.2); });
        break;
      case 'grab': {
        const list = a;
        fx.ring(claw.x, claw.hubY + r * 0.9, r * 1.3, '#fff');
        fx.star(claw.x - r * 0.6, claw.hubY + r * 1.2, 12); fx.star(claw.x + r * 0.6, claw.hubY + r * 1.2, 12);
        sfx('clack', 0, v => { beep(180, 0.06, 'square', 0.12 * v, 90); noise(0.03, 0.08 * v); });
        if (claw.ph === 'final') hushUntil = performance.now() + 400;
        for (const e of list) L(e).happyT = 9;
        if (list.length > 1) { fx.float(claw.x, claw.hubY - 10, T.chain(list.length), '#ffd23f', 20, true); say(T.chain(list.length)); }
        else if (claw.ph !== 'rush' && list[0].kind === 'doll') say(T.grab(dispName(list[0])));
        break;
      }
      case 'lift': {
        const dur = claw.sp ? Math.abs(claw.lift0 - claw.liftY) / (C.V_LIFT * claw.sp) : 0.3;
        if (claw.grabbed.length) sfx('lift', 0, v => beep(300, Math.max(0.1, dur), 'sine', 0.04 * v, 520));
        break;
      }
      case 'empty':
        fx.float(a.x, a.y - r, T.fWhiff, '#b8f3ff', 22, true);
        if (!reduceMotion) fx.fluff(claw.x, claw.hubY + r, 6, `hsl(${a.hue || 50},70%,86%)`);
        L(a).sadT = 1.2; say(T.empty);
        sfx('empty', 0, v => beep(600, 0.22, 'triangle', 0.1 * v, 350));
        break;
      case 'slip':
        fx.float(a.x, a.y - r * 1.2, '!!', '#ff6b6b', 26, true);
        L(a).sadT = 1.6; L(a).happyT = 0;
        if (a.kind === 'doll') say(T.slip(dispName(a)));
        sfx('slip', 80, v => beep(900, 0.18, 'sine', 0.1 * v, 300));
        break;
      case 'bump': {
        const who = a;
        fx.comic(who.x, who.y - r * 0.4, T.fThud, '#ffb020', 28);
        if (!reduceMotion) fx.dust(who.x, who.y + r * 0.7, 8);
        addTrauma(0.4); vibT = 0.4;
        L(who).sq = 0.42; L(who).jolt = 0.55; L(who).sadT = 1.5;
        if (b && b !== who) { L(b).sq = 0.28; L(b).jolt = 0.35; }
        if (who.kind === 'doll') say(T.bump(dispName(who)));
        sfx('bump', 60, v => { noise(0.14, 0.18 * v); beep(80, 0.18, 'triangle', 0.2 * v, 40); });
        break;
      }
      case 'bumpIn':
        fx.float(a.x, a.y - r * 1.3, T.fIn, '#ffb020', 26, true);
        if (a.kind === 'doll') say(T.bumpIn(dispName(a)));
        addTrauma(0.25);
        break;
      case 'bumpBack':
        L(a).sadT = 1.5; L(a).jolt = 0.4;
        if (a.kind === 'doll') say(T.bumpBack(dispName(a)));
        sfx('bumpBack', 80, v => beep(240, 0.16, 'square', 0.08 * v, 180));
        break;
      case 'land':
        if (a.plan === 'slipLift' || a.plan === 'slipCarry' || a.plan === 'lipBack' || a.plan === 'fluke') {
          fx.comic(a.x, a.y - r * 0.6, T.fThud, '#ffe066', 26);
          if (!reduceMotion) fx.dust(a.x, a.y + r * 0.8, 4);
          addTrauma(0.15); L(a).sq = 0.28;
          sfx('thud', 80, v => beep(120, 0.14, 'triangle', 0.16 * v, 60));
          a.plan = null;
        } else L(a).sq = 0.18;
        break;
      case 'teeter':
        if (a.kind === 'doll') say(T.teeter);
        duckUntil = performance.now() + 1500;
        sfx('teeterHold', 0, v => beep(880, Math.max(0.3, a.teeterDur / 0.6), 'sine', 0.03 * v));
        break;
      case 'lipIn':
        fx.float(a.x, a.y - r * 1.4, T.fIn, '#7dff9a', 26, true);
        if (a.kind === 'doll') say(a.plan === 'fluke' ? T.fluke(dispName(a)) : T.lipIn(dispName(a)));
        break;
      case 'lipBack':
        fx.flash(LIP_X0, LIP_TOP, LIP_X1 - LIP_X0, FLOOR - LIP_TOP);
        L(a).sadT = 1.8;
        if (a.kind === 'doll') { say(T.lipBack(dispName(a))); fx.float(a.x, a.y - r * 1.5, '😱', '#ff6b6b', 26, true); }
        sfx('buzz', 0, v => { beep(220, 0.12, 'square', 0.1 * v); beep(400, 0.25, 'sawtooth', 0.07 * v, 200, 0.1); });
        break;
      case 'escape': onEscape(a); break;
      case 'duckOut':
        fx.float(DOOR.x, DOOR.y - 40, '🦆 ✕', '#ffd84a', 22, true);
        doorT = 0.6; say(T.duck);
        shelfTaunt('ㅋㅋㅋ');
        sfx('kazoo', 0, v => { beep(300, 0.3, 'square', 0.05 * v); beep(303, 0.3, 'square', 0.05 * v); });
        break;
      case 'bounce':
        fx.flash(0, LIP_TOP, CHUTE_X1, 40, '#ff3b5c');
        fx.float(a.x, a.y - r, T.shutter, '#ff6b6b', 20, true);
        break;
      case 'closing':
        showBanner(T.closing, '#ffd23f', 1.8, true); say(T.closing);
        break;
      case 'shutter':
        break;
    }
  }
  const dispNameE = e => e.kind === 'doll' ? dispName(e) : '🦆';

  function onEscape(d) {
    const rem = remCount(), r = R_DOLL;
    doorT = 0.8;
    fx.burst(DOOR.x, DOOR.y - 4, 34, '#ffd23f');
    if (!reduceMotion) fx.confetti(DOOR.x, DOOR.y - 10, 14);
    fx.float(DOOR.x, DOOR.y - 46, T.fSaved, '#7dff9a', 20, true);
    shelf.push({ d, t: 0 });
    cupEl.textContent = T.cups(escapes);
    cupEl.classList.remove('bump'); void cupEl.offsetWidth; cupEl.classList.add('bump');
    if (rem <= 3 && rem >= 2) freezeT = Math.max(freezeT, 0.12);
    const tag = d.tag;
    say(tag === 'fluke' ? T.fluke(dispName(d)) : tag === 'lip' ? T.lipIn(dispName(d)) : T.escaped(dispName(d)));
    // feed row: newest first, the decisive escape reads N−1
    const row = document.createElement('div');
    row.className = 'escapeRow';
    row.style.setProperty('--c', d.color);
    const badge = document.createElement('span'); badge.className = 'rankBadge'; badge.textContent = T.place(d.rank);
    const nm = document.createElement('strong'); nm.textContent = dispName(d);
    const lab = document.createElement('span'); lab.textContent = tag ? tagLabel(tag) : T.fSaved;
    row.append(badge, nm, lab);
    feedEl.prepend(row);
    while (feedEl.children.length > 3) feedEl.lastElementChild.remove();
    const pitch = 1 + 0.25 * (1 - rem / Math.max(1, N));
    sfx('ding', 60, v => {
      beep(1318 * pitch, 0.12, 'triangle', 0.1 * v); beep(1760 * pitch, 0.16, 'triangle', 0.08 * v, 0, 0.06);
      [523, 659, 784].forEach((f, i) => beep(f * pitch * 2, 0.1, 'triangle', 0.06 * v, 0, 0.14 + i * 0.07));
    });
  }
  const tagLabel = t => ({ fluke: T.tagFluke, bump: T.tagBump, chain: T.tagChain, golden: T.tagGolden, jackpot: T.tagJackpot, lip: T.tagLip, closing: T.tagClosing }[t] || '');

  function phaseMarquee() {
    const ph = phaseOf();
    return ph === 'rush' ? 'RUSH!' : ph === 'main' ? 'MAIN' : ph === 'last3' ? 'LAST 3' : 'LAST COIN';
  }
  function phaseColor() {
    const ph = phaseOf();
    return ph === 'rush' ? '#ffd23f' : ph === 'main' ? '#72f5ff' : '#ff4d5e';
  }
  function shelfTaunt(text) {
    const out = escapeOrder.filter(d => d.state === 'out');
    if (!out.length || taunts.length >= 2) return;
    const d = out[Math.floor(fxRand() * out.length)];
    taunts.push({ d, text: `${dispName(d)}: ${text}`, t: 0 });
  }

  function drain() {
    if (!evq.length) return;
    const q = evq; evq = [];
    for (const [t, a, b] of q) handle(t, a, b);
  }

  // ---------- per-frame presentation (real time) ----------
  function present(realDt) {
    fxClock += realDt;
    const ft = realDt * timeScale;
    for (const v of look.values()) {
      if (v.sadT > 0) v.sadT -= ft;
      if (v.jolt > 0) v.jolt = Math.max(0, v.jolt - ft);
      if (v.sq > 0.001) v.sq *= Math.pow(0.82, realDt * 60); else v.sq = 0;
    }
    if (banner) { banner.t += realDt; if (banner.t > banner.dur) banner = null; }
    marquee.t += realDt;
    if (shakeT > 0) shakeT -= ft;
    if (vibT > 0) vibT -= ft;
    if (doorT > 0) doorT -= realDt;
    if (dimT > 0) dimT -= ft;
    if (goldBuildT > 0) goldBuildT -= ft;
    if (coinRoll) { coinRoll.t += ft; if (coinRoll.t > 1.1) coinRoll = null; }
    if (hatch) hatch.t += ft;
    if (jackpotT >= 0) { jackpotT += ft; if (jackpotT > 2.2) jackpotT = -1; }
    for (const s of shelf) s.t += realDt;
    for (let i = taunts.length - 1; i >= 0; i--) { taunts[i].t += realDt; if (taunts[i].t > 1.8) taunts.splice(i, 1); }
    trauma *= Math.pow(0.9, realDt * 60);
    if (trauma < 0.001) trauma = 0;
    if (!N || !claw) return;

    const rem = remCount(), ph = phaseOf(rem);
    if (state === 'playing') {
      if (ph !== lastPhase) {
        if (lastPhase && ph === 'main') { /* marquee set by mainIntro */ }
        if (lastPhase === '' && ph === 'rush') setMarquee('INSERT COIN');
        lastPhase = ph;
      }
      if (claw.state !== 'idle' && !dir.block && marquee.text === 'INSERT COIN') setMarquee(phaseMarquee(), phaseColor());
      // spotlight hops
      if (spot) {
        spot.t += ft;
        let idx = -1;
        for (let i = 0; i < spot.hops.length; i++) if (spot.t >= spot.hops[i].at) idx = i;
        if (idx !== spot.idx && idx >= 0) {
          spot.idx = idx;
          const drop = spot.final ? Math.pow(0.96, idx) : 1;
          if (spot.dur > 0.05) sfx('tick', 55, v => beep(900 * drop, 0.03, 'square', 0.05 * v));
        }
        if (claw.state === 'settle' || claw.state === 'idle') spot = null;
      }
      if (blackout) { blackout.t += realDt; if (blackout.t > 2.0 || (blackout.t > 0.6 && ['drop', 'grab', 'lift'].includes(claw.state))) {
        blackout = null; addTrauma(0.1); sfx('pop', 0, v => { noise(0.12, 0.12 * v); beep(80, 0.2, 'sine', 0.14 * v); }); } }
      // golden sparkle trail
      if (claw.golden && !reduceMotion && fxRand() < realDt * 30) fx.sparkle(claw.x, claw.hubY + R_DOLL * 0.5);
      // tears on held/slipped? teeter gets a heartbeat
      const teeter = ents.some(e => e.state === 'teeter');
      // heartbeat in LAST3 / FINAL
      if ((ph === 'last3' || ph === 'final' || teeter) && dir.coinDone) {
        hbT -= realDt;
        if (hbT <= 0) {
          const fast = ph === 'final' && (claw.state === 'lift' || claw.state === 'carry');
          hbT = 1 / (fast || teeter ? 1.6 : 1.1);
          sfx('hb', 200, v => { beep(55, 0.09, 'sine', 0.32 * v); beep(48, 0.11, 'sine', 0.28 * v, 0, 0.14); });
          duckUntil = performance.now() + 260;
        }
      }
      // motor hum while the claw moves
      const moving = ['aim', 'drop', 'lift', 'carry'].includes(claw.state);
      if (moving) {
        motorT -= realDt;
        if (motorT <= 0) { motorT = 0.12; const f = claw.state === 'drop' ? 55 : ph === 'rush' ? 90 : 70; sfx('motor', 110, v => beep(f, 0.13, 'sawtooth', 0.03 * v)); }
      }
      // taunts in the endgame
      if ((ph === 'last3' || ph === 'final') && escapes > 0) {
        tauntNext -= realDt;
        if (tauntNext <= 0) { tauntNext = 2.5; shelfTaunt(T.taunts[Math.floor(fxRand() * T.taunts.length)]); }
      }
      if (pickShown && claw.target !== pickShown && claw.state === 'idle') pickShown = null;
    }
    // camera
    frameCabinet(false, realDt);
    syncHud(rem, ph, realDt);
  }

  function syncHud(rem, ph, realDt = 1 / 60) {
    if (state === 'menu') return;
    if (rem !== lastRem) {
      lastRem = rem;
      aliveEl.textContent = rem;
    }
    const odds = state === 'playing' || state === 'countdown' ? T.odds(ph === 'final' ? 50 : Math.round(100 / Math.max(1, rem))) : '';
    if (odds !== lastOdds) {
      lastOdds = odds; oddsEl.textContent = odds;
      if (rem <= 3) oddsEl.classList.add('hot'); else oddsEl.classList.remove('hot');
    }
    statusT -= realDt;
    if (statusT <= 0) {
      statusT = 0.25;
      const label = state === 'reveal' || state === 'over' ? T.stageReveal
        : state === 'countdown' || !dir.coinDone || (dir.block && dir.block.kind === 'coin') ? T.stageInsert
          : ph === 'rush' ? T.stageRush : ph === 'main' ? T.stageMain : ph === 'last3' ? T.stageLast3 : T.stageFinal;
      const txt = `${label} · ${T.secs(Math.floor(gameT))}`;
      if (stageEl.textContent !== txt) stageEl.textContent = txt;
    }
    const ff = state === 'playing' && presentTs() === C.FF;
    if (ffChip.hidden === ff) ffChip.hidden = !ff;
    // headline: latest commentary for 2.5 s, then the phase default
    let text = headline.text && realClock < headline.until ? headline.text : '';
    if (!text) {
      const left = dolls.filter(d => d.state !== 'out').sort((p, q) => p.slot - q.slot);
      if (state === 'reveal' || state === 'over') text = loser ? T.loserBanner(dispName(loser)) : '';
      else if (ph === 'last3' && left.length === 3) text = T.last3(left.map(dispName).join(' · '));
      else if (ph === 'final' && left.length === 2) text = T.final(dispName(left[0]), dispName(left[1]));
      else text = T.watchHint;
    }
    if (text !== headlineShown) { headlineShown = text; headlineEl.textContent = text; }
    // danger chips: remaining dolls in slot order, target highlighted
    if (state === 'playing' || state === 'reveal') {
      const left = dolls.filter(d => d.state !== 'out');
      const show = left.length <= 12 && state === 'playing';
      const order = left.slice().sort((p, q) => (p.slot >= 0 ? p.slot : 999 + p.chain) - (q.slot >= 0 ? q.slot : 999 + q.chain));
      const tg = claw && claw.target && claw.state !== 'roulette' && claw.target.kind === 'doll' ? claw.target : null;
      const sig = show ? order.map(d => d.id + (d === tg ? '*' : '')).join(',') + (rem <= 3 ? 'h' : '') : '';
      if (sig !== chipSig) {
        chipSig = sig;
        chipsEl.replaceChildren();
        chipsEl.hidden = !show;
        if (show) for (const d of order) {
          const chip = document.createElement('span');
          chip.className = 'chip' + (d === tg ? ' target' : '') + (rem <= 3 ? ' hot' : '');
          chip.style.setProperty('--c', d.color);
          const dot = document.createElement('i');
          const nm = document.createElement('b'); nm.textContent = dispName(d);
          chip.append(dot, nm);
          chipsEl.appendChild(chip);
        }
      }
    }
  }

  // ---------- Camera ----------
  function viewport() {
    const port = W <= H;
    let top, bottom, left = 16, right = 16;
    if (port) { top = 112; bottom = 138; }
    else { top = H < 500 ? 56 : 80; bottom = H < 500 ? 12 : 24; right = Math.min(360, 0.4 * W) + 16; }
    const w = Math.max(100, W - left - right), h = Math.max(100, H - top - bottom);
    return { x: left + w / 2, y: top + h / 2, w, h, port };
  }
  function fullBox() {
    return W <= H ? { x0: -20, x1: 380, y0: -90, y1: 744 } : { x0: -20, x1: 528, y0: H < 500 ? -20 : -90, y1: 650 };
  }
  function grow(b, x0, y0, x1, y1) { b.x0 = Math.min(b.x0, x0); b.y0 = Math.min(b.y0, y0); b.x1 = Math.max(b.x1, x1); b.y1 = Math.max(b.y1, y1); }
  function camBox() {
    const full = fullBox();
    if (reduceMotion || !N || !claw || state === 'menu' || state === 'countdown') return full;
    const r = R_DOLL;
    if ((state === 'reveal' || state === 'over') && loser) {
      const b = { x0: loser.x - 3.2 * r, x1: loser.x + 3.2 * r, y0: loser.y - 3.2 * r, y1: loser.y + 3.2 * r };
      grow(b, 228, 590, 372, 720);
      // keep the shot inside the cabinet (+ shelf) instead of showing the empty room
      const shift = (lo, hi, a, bb) => { const w = hi - lo; if (w >= bb - a) return [lo, hi]; if (lo < a) return [a, a + w]; if (hi > bb) return [bb - w, bb]; return [lo, hi]; };
      [b.x0, b.x1] = shift(b.x0, b.x1, full.x0, full.x1);
      return b;
    }
    const left = dolls.filter(d => d.state !== 'out');
    const rem = left.length, ph = phaseOf(rem);
    const remBox = b => { for (const d of left) grow(b, d.x - r - 8, d.y - r - 46, d.x + r + 8, d.y + r + 8); return b; };
    if ((ph === 'last3' || ph === 'final') && ents.some(e => e.state === 'teeter')) return remBox({ x0: -20, x1: 220, y0: LIP_TOP - 180, y1: 640 });
    if (rem <= 6) {
      const b = { x0: full.x0, x1: full.x1, y0: Math.max(-20, pileTopY() - 3 * r - 60), y1: full.y1 };
      grow(b, full.x0, claw.hubY - 34, full.x1, full.y1);
      for (const e of ents) if (e.state === 'held' || e.state === 'fall') grow(b, full.x0, e.y - r - 40, full.x1, full.y1);
      return remBox(b);
    }
    return full;
  }
  function frameCabinet(snap = false, realDt = 1 / 60) {
    if (!W || !H) return;
    const v = viewport(), b = camBox();
    cam.tx = (b.x0 + b.x1) / 2; cam.ty = (b.y0 + b.y1) / 2;
    cam.tz = Math.min(v.w / (b.x1 - b.x0), v.h / (b.y1 - b.y0), v.port ? 1.35 : 1.8);
    if (snap || reduceMotion) { cam.x = cam.tx; cam.y = cam.ty; cam.zoom = cam.tz; return; }
    const k = 1 - Math.pow(0.9, realDt * 60);
    cam.x += (cam.tx - cam.x) * k; cam.y += (cam.ty - cam.y) * k; cam.zoom += (cam.tz - cam.zoom) * k;
  }

  // ---------- Render ----------
  let shakeX = 0, shakeY = 0;
  function toScreen(v, x, y) { return { x: v.x + shakeX + (x - cam.x) * cam.zoom, y: v.y + shakeY + (y - cam.y) * cam.zoom }; }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawRoom();
    if (!slots.length || !claw) return;
    const v = viewport(), z = cam.zoom;
    shakeX = 0; shakeY = 0;
    if (!reduceMotion) {
      const s = trauma * trauma * 10;
      if (s > 0.3) { shakeX += Math.sin(fxClock * 83) * s; shakeY += Math.cos(fxClock * 97) * s; }
      if (shakeT > 0) { shakeX += Math.sin(fxClock * 18 * Math.PI * 2) * 8 * z; shakeY += Math.cos(fxClock * 15 * Math.PI * 2) * 3 * z; }
    }
    ctx.save();
    ctx.translate(v.x + shakeX, v.y + shakeY);
    ctx.scale(z, z);
    ctx.translate(-cam.x, -cam.y);
    drawCabinetBack(z);
    drawSpotCone();
    drawEntities(z);
    drawLip();
    drawClaw(z);
    fx.draw(ctx, z);
    drawChuteFront();
    drawGlass();
    drawFrame(z);
    drawMarquee(z);
    drawBase(z);
    drawShelf(z);
    drawTicket(z);
    ctx.restore();
    drawTopScrim(v);
    drawDarkness(v);
    drawBubbles(v);
    drawFloaters(v);
    drawVignette();
    drawBanner();
    if (state === 'over') drawPortrait();
  }

  // Whatever the camera leaves above the viewport (a cropped marquee in focus shots) fades
  // into the room under the HUD pills instead of showing as a hard-cut sliver.
  function drawTopScrim(v) {
    const top = v.y - v.h / 2;
    if (top <= 8) return;
    const g = ctx.createLinearGradient(0, 0, 0, top);
    g.addColorStop(0, 'rgba(9,6,18,.92)'); g.addColorStop(0.55, 'rgba(9,6,18,.6)'); g.addColorStop(1, 'rgba(9,6,18,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, top);
  }

  function drawRoom() {
    const g = ctx.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.75);
    g.addColorStop(0, '#1b1030'); g.addColorStop(1, '#07060f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // bokeh dots (fixed pattern, gentle drift)
    ctx.fillStyle = 'rgba(255,120,200,.06)';
    for (let i = 0; i < 14; i++) {
      const bx = ((i * 0.618 + (reduceMotion ? 0 : fxClock * 0.004 * (i % 3 + 1))) % 1) * W;
      const by = ((i * 0.377) % 1) * H;
      ctx.beginPath(); ctx.arc(bx, by, 18 + (i % 4) * 10, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawCabinetBack(z) {
    const c = ctx;
    fx.backWall(c, 0, 0, 360, 600, z * DPR);
    // floor glow under the cabinet (room)
    // rail
    c.fillStyle = '#2a2140'; c.fillRect(0, RAIL_Y - 5, 360, 10);
    c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(0, RAIL_Y - 5, 360, 2);
    // ceiling hatch (duck drop)
    if (hatch) {
      const on = reduceMotion ? true : Math.floor(hatch.t * 8) % 2 === 0;
      c.fillStyle = on ? '#ffd84a' : '#7a5b12';
      c.fillRect(hatch.x - 22, 0, 44, 8);
      c.fillStyle = '#2a0f2e'; c.fillRect(hatch.x - 18, 2, 36, 4);
    }
    // TILT lamp
    const warn = dir && dir.block && (dir.block.kind === 'tiltWarn' || dir.block.kind === 'tilt');
    const lampOn = warn && (reduceMotion || Math.floor(fxClock * 4) % 2 === 0);
    c.fillStyle = '#2a1030'; c.fillRect(312, 58, 36, 6);
    c.fillStyle = lampOn ? '#ff2b3d' : '#5a1a28';
    c.beginPath(); c.arc(330, 50, 14, Math.PI, 0); c.lineTo(344, 58); c.lineTo(316, 58); c.closePath(); c.fill();
    if (lampOn) {
      c.globalAlpha = 0.28; c.beginPath(); c.arc(330, 50, 34, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 0.12; c.beginPath(); c.moveTo(330, 50); c.lineTo(180, 260); c.lineTo(300, 300); c.closePath(); c.fill();
      c.globalAlpha = 1;
    }
    c.font = '900 9px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = lampOn ? '#fff' : 'rgba(255,255,255,.45)'; c.fillText('TILT', 330, 51);
    // chute hole + sign
    const cg = c.createLinearGradient(0, LIP_TOP - 60, 0, FLOOR);
    cg.addColorStop(0, 'rgba(10,4,20,0)'); cg.addColorStop(0.45, 'rgba(10,4,20,.85)'); cg.addColorStop(1, '#05020a');
    c.fillStyle = cg; c.fillRect(0, LIP_TOP - 60, CHUTE_X1, FLOOR - LIP_TOP + 60);
    c.fillStyle = '#ffd23f'; c.font = '900 15px sans-serif';
    c.fillText('OUT ▼', HOME_X, LIP_TOP - 34);
    c.strokeStyle = 'rgba(255,210,63,.55)'; c.lineWidth = 2; c.setLineDash([6, 5]);
    c.beginPath(); c.moveTo(2, SENSOR_Y); c.lineTo(CHUTE_X1 - 2, SENSOR_Y); c.stroke(); c.setLineDash([]);
    // plush floor
    const vib = vibT > 0 && !reduceMotion ? Math.sin(fxClock * 90) * 1.5 : 0;
    c.fillStyle = '#ff9fcf';
    c.fillRect(LIP_X1, FLOOR - 10 + vib, 360 - LIP_X1, 10);
    c.fillStyle = '#ffc4e1';
    c.beginPath();
    for (let x = LIP_X1 + 6; x < 360; x += 12) { c.moveTo(x + 6, FLOOR - 10 + vib); c.arc(x, FLOOR - 10 + vib, 6, 0, Math.PI, true); }
    c.fill();
  }

  function drawSpotCone() {
    const s = spot;
    if (!s || claw.state === 'settle') return;
    let e = s.target;
    if (s.t < s.dur && s.idx >= 0 && !reduceMotion) e = s.hops[s.idx].e;
    if (!e || e.state === 'out') return;
    const c = ctx, r = R_DOLL, x = e.x, y = e.y;
    const gold = s.gold, col = gold ? '255,214,90' : '255,250,220';
    c.save();
    const g = c.createLinearGradient(0, 0, 0, y + r);
    g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},.32)`);
    c.fillStyle = g;
    c.beginPath(); c.moveTo(x - 10, 0); c.lineTo(x + 10, 0); c.lineTo(x + r * 1.35, y + r * 0.9); c.lineTo(x - r * 1.35, y + r * 0.9); c.closePath(); c.fill();
    c.fillStyle = `rgba(${col},.3)`;
    c.beginPath(); c.ellipse(x, y + r * 0.9, r * 1.35, r * 0.3, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  }

  // Weight on the dolls directly under a body that is still in the air.
  function crushOf(d) {
    if (d.state !== 'pile') return 0;
    let k = 0;
    for (const e of ents) {
      if (e === d || (e.state !== 'fall' && e.state !== 'held')) continue;
      const dx = e.x - d.x;
      if (dx > R_DOLL * 1.2 || dx < -R_DOLL * 1.2) continue;
      const gap = d.y - e.y;
      if (gap < R_DOLL * 0.15 || gap > R_DOLL * 2.6) continue;
      const t = 1 - gap / (R_DOLL * 2.6);
      if (t > k) k = t;
    }
    return k * (reduceMotion ? 0.08 : 0.24);
  }
  function dollOpts(d, z, rem, ph) {
    const v = L(d), r = R_DOLL;
    let face, arms = 0, sweat = false, rot = 0, flail = 0;
    const frac = rem / Math.max(1, N);
    face = ph === 'final' ? 'teary' : rem <= 3 ? 'wavy' : frac <= 0.5 ? 'flat' : 'smile';
    if (frac <= 0.5 && ph !== 'final' && rem > 3) sweat = true;
    const tg = claw.target === d && ['aim', 'hover', 'drop', 'grab'].includes(claw.state);
    const spotLanded = claw.target === d && claw.state === 'roulette' && spot && spot.t >= spot.dur - 0.1;
    if (d.state === 'held') { face = v.sadT > 0 ? 'sad' : 'happy'; arms = 0.75; rot = reduceMotion ? 0 : Math.sin(fxClock * 5 + d.chain) * 0.12; }
    else if (d.state === 'teeter') {
      const k = d.teeterDur > 0 ? d.teeterT / d.teeterDur : 0;
      const amp = reduceMotion ? 0.1 : 0.31;
      rot = Math.sin(d.teeterT * (8 + k * 22)) * amp;
      face = 'o'; arms = 0.6; flail = reduceMotion ? 0 : Math.sin(fxClock * 26) * 0.8;
    } else if (d.state === 'fall') { face = v.sadT > 0 ? 'sad' : 'o'; arms = 0.9; flail = reduceMotion ? 0 : Math.sin(fxClock * 30) * 0.6; }
    else if (tg || spotLanded) { face = 'sparkle'; arms = 1; }
    else if (v.sadT > 0) face = 'sad';
    if (claw.target && claw.target !== d && d.state === 'pile' && ['aim', 'hover', 'drop'].includes(claw.state) && claw.target.slot >= 0) {
      const S = slots[claw.target.slot];
      if (Math.hypot(d.x - S.x, d.y - S.y) < 2.2 * r) sweat = true;
    }
    if (dir.block && dir.block.kind === 'tiltWarn' && !reduceMotion) rot += Math.sin(fxClock * 30 + (typeof d.id === 'number' ? d.id : 3)) * 0.06;
    const crush = crushOf(d);
    if (crush > 0 || v.jolt > 0) sweat = true;
    if (v.jolt > 0 && !reduceMotion) rot += Math.sin(fxClock * 26 + (typeof d.id === 'number' ? d.id : 1)) * 0.22 * Math.min(1, v.jolt / 0.4);
    const hx = claw.x - d.x, hy = claw.hubY - d.y, hl = Math.hypot(hx, hy) || 1;
    const o = { hue: d.hue, species: d.species, face, arms, sweat, rot, flail, sq: Math.min(0.45, (v.sq || 0) + crush), look: { x: hx / hl, y: hy / hl } };
    return o;
  }

  function labelFont(z) { return Math.max(10, 0.46 * R_DOLL * z) / z; }

  function drawOneDoll(d, z, rem, ph, yOff = 0) {
    const r = R_DOLL;
    const o = dollOpts(d, z, rem, ph);
    let x = d.x, y = d.y + yOff;
    if (rem <= 3 && d.state === 'pile' && !reduceMotion && state === 'playing') x += Math.sin(fxClock * 14 * Math.PI * 2 + d.id) / z;
    if (d.state === 'teeter') {
      // pivot on the lip
      ctx.save(); ctx.translate(LIP_X, LIP_TOP); ctx.rotate(o.rot); ctx.translate(-LIP_X, -LIP_TOP); o.rot = 0;
    }
    if (state === 'reveal' || state === 'over') {
      if (d === loser) revealLook(o);
    }
    o.label = N <= 12 ? dispName(d) : shortName(d);
    o.font = labelFont(z); o.stroke = 3 / z;
    fx.doll(ctx, x, y, r, o);
    if (d.state === 'teeter') ctx.restore();
  }
  function revealLook(o) {
    const t = revealT;
    o.look = { x: 0, y: 0.3 }; o.arms = 0; o.sweat = false; o.rot = 0; o.flail = 0;
    if (t < 0.8) o.face = 'teary';
    else if (t < 2.0) {
      o.face = (t > 0.9 && t < 1.0) || (t > 1.3 && t < 1.4) ? 'blink' : 'teary';
      if (t > 1.9) { o.face = 'gulp'; o.sq = reduceMotion ? 0 : 0.08; }
    } else o.face = 'cry';
    if (state === 'over') o.face = 'cry';
  }

  function drawEntities(z) {
    const rem = remCount(), ph = phaseOf(rem);
    const pour = state === 'countdown' && !reduceMotion;
    const pile = [], air = [];
    for (let s = 0; s < slots.length; s++) { const e = slots[s].occ; if (e && e.state === 'pile') pile.push(e); }
    for (const e of ents) if (e.state === 'fall' || e.state === 'teeter' || (e.state === 'pile' && e.slot < 0)) air.push(e);
    const drawE = (e, yOff) => {
      if (e.kind === 'duck') fx.duck(ctx, e.x, e.y + yOff, R_DOLL * 0.85, { sq: L(e).sq });
      else drawOneDoll(e, z, rem, ph, yOff);
    };
    const pourOff = e => {
      if (!pour) return 0;
      const v = L(e), k = clamp((cdT - v.pour) / 0.45, 0, 1);
      if (k >= 1) { if (!v.landed) { v.landed = true; v.sq = 0.3; } return 0; }
      return -(1 - k * k) * 700;
    };
    // pour-in: dolls drop out of the cabinet ceiling, not through the marquee and the HUD
    if (pour) { ctx.save(); ctx.beginPath(); ctx.rect(-6, 0, 372, FLOOR + 8); ctx.clip(); }
    for (const e of pile) if (e.kind === 'doll') drawE(e, pourOff(e));
    for (const e of pile) if (e.kind === 'duck') drawE(e, pourOff(e));
    if (pour) ctx.restore();
    for (const e of air) drawE(e, 0);
    // teeter gauge over the lip
    for (const e of ents) if (e.state === 'teeter' && e.teeterDur > 0) {
      const k = clamp(e.teeterT / e.teeterDur, 0, 1);
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 7 / z;
      ctx.beginPath(); ctx.arc(LIP_X, LIP_TOP - R_DOLL * 2.6, 16, -Math.PI / 2, Math.PI * 1.5); ctx.stroke();
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 4 / z;
      ctx.beginPath(); ctx.arc(LIP_X, LIP_TOP - R_DOLL * 2.6, 16, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.stroke();
    }
  }

  function drawLip() {
    const c = ctx;
    c.fillStyle = 'rgba(180,230,255,.35)';
    c.fillRect(LIP_X0, LIP_TOP, LIP_X1 - LIP_X0, FLOOR - LIP_TOP);
    c.fillStyle = 'rgba(255,255,255,.85)';
    c.fillRect(LIP_X0, LIP_TOP, 2, FLOOR - LIP_TOP);
    c.fillRect(LIP_X0 - 1, LIP_TOP - 2, LIP_X1 - LIP_X0 + 2, 3);
    if (state === 'reveal' || state === 'over') {   // the shutter
      const k = reduceMotion ? 1 : clamp(revealT / 0.3, 0, 1);
      const w = CHUTE_X1 * k;
      const g = c.createLinearGradient(0, LIP_TOP - 6, 0, LIP_TOP + 14);
      g.addColorStop(0, '#d9dde8'); g.addColorStop(1, '#6f7690');
      c.fillStyle = g; c.fillRect(0, LIP_TOP - 6, w, 20);
      c.strokeStyle = '#2a2f40'; c.lineWidth = 2;
      for (let x = 10; x < w; x += 14) { c.beginPath(); c.moveTo(x, LIP_TOP - 4); c.lineTo(x, LIP_TOP + 12); c.stroke(); }
      c.strokeRect(0, LIP_TOP - 6, w, 20);
    }
  }

  function drawClaw(z) {
    const c = claw;
    const moving = ['aim', 'drop', 'lift', 'carry'].includes(c.state);
    let x = c.x;
    if (c.state === 'hover' && !reduceMotion) x += Math.sin(fxClock * 12 * Math.PI * 2) * 3;
    const sway = reduceMotion ? 0 : Math.sin(fxClock * 3) * (moving ? 4 : 1.5);
    const gold = c.golden || goldBuildT > 0 || (jackpotT >= 0);
    const led = gold ? '#ffd23f' : phaseOf() === 'final' ? '#ff3b4d' : '#3dff8a';
    // motor shimmer: speed lines behind the carriage
    if (moving && !reduceMotion && (c.state === 'aim' || c.state === 'carry')) {
      const dirx = c.state === 'carry' ? 1 : -Math.sign((c.target ? c.target.x : x) - x) || 1;
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2 / z;
      for (let i = 0; i < 3; i++) {
        const yy = RAIL_Y - 6 + i * 6, x0 = x + dirx * (30 + i * 4);
        ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 + dirx * (14 + 10 * Math.abs(Math.sin(fxClock * 20 + i))), yy); ctx.stroke();
      }
    }
    const held = ents.filter(e => e.state === 'held').sort((a, b) => b.chain - a.chain);
    const rem = remCount(), ph = phaseOf(rem);
    fx.claw(ctx, { x, railY: RAIL_Y, hubY: c.hubY, r: R_DOLL, prong: c.prong, gold, led, sway, holding: held.length > 0,
      inner: () => {
        // chain threads between hanging dolls
        if (held.length > 1) {
          ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2.5 / z; ctx.setLineDash([5 / z, 4 / z]);
          ctx.beginPath();
          const s = held.slice().sort((a, b) => a.chain - b.chain);
          for (let i = 1; i < s.length; i++) { ctx.moveTo(s[i - 1].x, s[i - 1].y + R_DOLL * 0.6); ctx.lineTo(s[i].x, s[i].y - R_DOLL * 0.7); }
          ctx.stroke(); ctx.setLineDash([]);
        }
        for (const e of held) {
          if (e.kind === 'duck') fx.duck(ctx, e.x, e.y, R_DOLL * 0.85, { rot: reduceMotion ? 0 : Math.sin(fxClock * 5) * 0.12 });
          else drawOneDoll(e, z, rem, ph, 0);
        }
      } });
  }

  function drawChuteFront() {
    const c = ctx;
    const g = c.createLinearGradient(0, SENSOR_Y - 26, 0, FLOOR);
    g.addColorStop(0, 'rgba(8,3,16,0)'); g.addColorStop(0.5, 'rgba(8,3,16,.9)'); g.addColorStop(1, '#05020a');
    c.fillStyle = g; c.fillRect(0, SENSOR_Y - 26, CHUTE_X1, FLOOR - SENSOR_Y + 26);
  }

  function drawGlass() {
    const c = ctx;
    const p = reduceMotion ? 0.3 : (fxClock / 6) % 1;
    const x = -120 + p * 600;
    c.save();
    c.beginPath(); c.rect(0, 0, 360, 600); c.clip();
    const g = c.createLinearGradient(x, 0, x + 90, 60);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.09)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 70, 0); c.lineTo(x - 200, 600); c.lineTo(x - 270, 600); c.closePath(); c.fill();
    c.restore();
  }

  // ~80 bulbs around the frame and marquee
  let BULBS = null;
  function bulbs() {
    if (BULBS) return BULBS;
    BULBS = [];
    for (let i = 0; i <= 20; i++) BULBS.push([-10 + i * 19, -92]);
    for (let i = 1; i <= 21; i++) BULBS.push([370, -92 + i * 35]);
    for (let i = 20; i >= 0; i--) BULBS.push([-10 + i * 19, 646]);
    for (let i = 21; i >= 1; i--) BULBS.push([-10, -92 + i * 35]);
    return BULBS;
  }
  function drawFrame(z) {
    const c = ctx;
    // side posts / ceiling
    c.fillStyle = '#1c0f2e';
    c.fillRect(-16, -14, 16, 654); c.fillRect(360, -14, 16, 654); c.fillRect(-16, -14, 392, 14);
    // neon lines
    const warn = dir && dir.block && dir.block.kind === 'tiltWarn' && (reduceMotion || Math.floor(fxClock * 4) % 2 === 0);
    c.lineWidth = 6; c.strokeStyle = warn ? 'rgba(255,40,60,.55)' : 'rgba(255,80,190,.35)'; c.strokeRect(-6, -6, 372, 612);
    c.lineWidth = 2.5; c.strokeStyle = warn ? '#ff2b3d' : '#ff7ad1'; c.strokeRect(-6, -6, 372, 612);
    c.lineWidth = 1.5; c.strokeStyle = 'rgba(114,245,255,.8)'; c.strokeRect(-12, -10, 384, 652);
    // bulbs
    const B = bulbs(), n = B.length;
    const rem = N ? remCount() : 1, ph = N ? phaseOf(rem) : 'rush';
    const rate = 2 + 6 * (1 - rem / Math.max(1, N));
    bulbPhase += reduceMotion ? 0 : rate / 60;
    const dark = state === 'reveal' || state === 'over';
    const jack = jackpotT >= 0;
    const on = [], off = [];
    for (let i = 0; i < n; i++) {
      const lit = reduceMotion ? i % 2 === 0 : (i + Math.floor(bulbPhase)) % 3 === 0;
      (lit && !dark ? on : off).push(i);
    }
    const colA = jack ? '#ffd23f' : ph === 'final' && state === 'playing' ? '#ff3b4d' : '#ff5fc8';
    const colB = jack ? '#fff1a8' : ph === 'final' && state === 'playing' ? '#ff8a6b' : '#62f0ff';
    c.fillStyle = 'rgba(60,40,70,.9)';
    c.beginPath(); for (const i of off) { c.moveTo(B[i][0] + 3.5, B[i][1]); c.arc(B[i][0], B[i][1], 3.5, 0, Math.PI * 2); } c.fill();
    for (const [col, par] of [[colA, 0], [colB, 1]]) {
      c.fillStyle = col;
      c.beginPath(); for (const i of on) if (i % 2 === par) { c.moveTo(B[i][0] + 4.5, B[i][1]); c.arc(B[i][0], B[i][1], 4.5, 0, Math.PI * 2); } c.fill();
      c.globalAlpha = 0.25;
      c.beginPath(); for (const i of on) if (i % 2 === par) { c.moveTo(B[i][0] + 9, B[i][1]); c.arc(B[i][0], B[i][1], 9, 0, Math.PI * 2); } c.fill();
      c.globalAlpha = 1;
    }
  }

  function drawMarquee(z) {
    const c = ctx;
    c.fillStyle = '#12081c'; c.strokeStyle = '#ff7ad1'; c.lineWidth = 3;
    roundRectPath(c, -16, -86, 392, 68, 12); c.fill(); c.stroke();
    c.save();
    roundRectPath(c, -8, -80, 376, 56, 8); c.clip();
    c.fillStyle = '#0b0412'; c.fillRect(-8, -80, 376, 56);
    let text = marquee.text, color = marquee.color;
    if (state === 'reveal' || state === 'over') { text = loser ? `☕ ${dispName(loser)}!` : text; color = '#ff4d5e'; }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (marquee.reels && jackpotT >= 0 && jackpotT < 1.2 && !reduceMotion) {
      // three spinning reels settling on 7-7-7
      c.font = '900 36px sans-serif';
      for (let i = 0; i < 3; i++) {
        const stop = 0.5 + i * 0.3, sp = jackpotT < stop;
        const glyph = sp ? String((Math.floor(fxClock * 30) + i * 3) % 9 + 1) : '7';
        c.fillStyle = sp ? '#fff' : '#ffd23f';
        c.fillText(glyph, 180 + (i - 1) * 60, -52 + (sp ? ((fxClock * 400) % 20) - 10 : 0));
      }
    } else {
      const k = reduceMotion ? 1 : clamp(marquee.t / 0.4, 0, 1);
      const ox = (1 - (1 - (1 - k) * (1 - k))) * 360;
      c.font = '900 34px sans-serif';
      const w = c.measureText(text).width;
      const scale = Math.min(1, 350 / Math.max(1, w));
      c.save(); c.translate(180 + ox, -52); c.scale(scale, 1);
      c.fillStyle = color; c.globalAlpha = 0.35; c.fillText(text, 0, 2); c.globalAlpha = 1;
      c.fillText(text, 0, 0);
      c.restore();
    }
    const pat = fx.dotMask(c);
    if (pat) { c.fillStyle = pat; c.fillRect(-8, -80, 376, 56); }
    c.restore();
  }

  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawBase(z) {
    const c = ctx;
    const g = c.createLinearGradient(0, 600, 0, 640);
    g.addColorStop(0, '#3a1850'); g.addColorStop(1, '#1d0b2b');
    c.fillStyle = g; c.fillRect(-16, 600, 392, 40);
    c.fillStyle = '#ff7ad1'; c.fillRect(-16, 600, 392, 3);
    // prize door flap
    const open = doorT > 0 ? Math.sin(Math.min(1, doorT / 0.8) * Math.PI) : 0;
    c.fillStyle = '#05020a'; c.fillRect(4, 606, 88, 30);
    c.save(); c.translate(4, 606); c.scale(1, 1 - open * 0.85);
    c.fillStyle = '#6b3a8c'; c.fillRect(0, 0, 88, 30);
    c.strokeStyle = '#ffd23f'; c.lineWidth = 2; c.strokeRect(1, 1, 86, 28);
    c.fillStyle = '#ffd23f'; c.font = '900 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('PRIZE ▼', 44, 15);
    c.restore();
    // coin slot
    c.fillStyle = '#26152f'; roundRectPath(c, 246, 604, 58, 30, 6); c.fill();
    c.strokeStyle = '#c9a0ff'; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = state === 'playing' && N && phaseOf() === 'final' ? '#ff4d5e' : '#ffd23f';
    c.fillRect(270, 609, 10, 12);
    c.fillStyle = '#e9d8ff'; c.font = '800 8px sans-serif';
    c.fillText('COIN', 275, 628);
    if (coinRoll) {
      const k = clamp(coinRoll.t / 0.8, 0, 1), x = lerp(360, 275, k), y = 612 - Math.abs(Math.sin(k * Math.PI * 3)) * 14 * (1 - k);
      if (coinRoll.t < 0.9) {
        c.fillStyle = '#ffd23f'; c.strokeStyle = '#b8860b'; c.lineWidth = 1.5;
        c.beginPath(); c.ellipse(x, y, k > 0.95 ? 2 : 7, 7, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      }
    }
  }

  function shelfLayout(n) {
    const port = W <= H;
    const rm = Math.max(12, 0.5 * R_DOLL);
    if (port) {
      const x0 = -10, x1 = 370, y0 = 656, y1 = 742;
      const names = n <= 12;
      const rows = n <= 6 ? 1 : n <= 12 ? 2 : 3;
      const cols = Math.max(1, Math.ceil(Math.max(n, 1) / rows));
      const cw = (x1 - x0) / Math.max(cols, names ? 6 : 10), ch = (y1 - y0) / rows;
      const rr = Math.min(rm, ch * (names ? 0.3 : 0.42), cw * 0.4);
      return { port, names, rr, pos: k => { const row = Math.floor(k / cols), col = k % cols;
        return { x: x0 + cw * (col + 0.5), y: y0 + ch * row + (names ? rr + 3 : ch / 2) }; }, cw, ch };
    }
    const x0 = 392, x1 = 528, y0 = 34, y1 = 636;
    const names = n <= 12;
    const cols = names ? 1 : 2, rows = Math.max(names ? 12 : 15, Math.ceil(n / cols));
    const cw = (x1 - x0) / cols, ch = (y1 - y0) / rows;
    const rr = Math.min(rm, ch * 0.42, names ? 18 : cw * 0.3);
    return { port, names, rr, pos: k => { const col = k % cols, row = Math.floor(k / cols);
      return { x: names ? x0 + rr + 8 : x0 + cw * (col + 0.5), y: y0 + ch * (row + 0.5) }; }, cw, ch };
  }
  function drawShelf(z) {
    const c = ctx;
    const port = W <= H;
    // shelf body
    if (port) {
      c.fillStyle = 'rgba(40,20,60,.85)'; roundRectPath(c, -16, 650, 392, 96, 12); c.fill();
      c.strokeStyle = 'rgba(125,255,154,.5)'; c.lineWidth = 2; c.stroke();
    } else {
      c.fillStyle = 'rgba(40,20,60,.85)'; roundRectPath(c, 388, -14, 144, 654, 12); c.fill();
      c.strokeStyle = 'rgba(125,255,154,.5)'; c.lineWidth = 2; c.stroke();
    }
    c.font = `900 ${Math.max(10, 12 * z) / z}px sans-serif`; c.textBaseline = 'middle';
    c.fillStyle = '#7dff9a';
    if (port) {
      c.textAlign = 'center';
      const tw = c.measureText('SAFE ✓').width + 14 / z, th = Math.max(10, 12 * z) / z + 6 / z;
      c.fillStyle = '#1d3a26'; roundRectPath(c, 360 - tw, 650 - th / 2, tw, th, th / 2); c.fill();
      c.fillStyle = '#7dff9a'; c.fillText('SAFE ✓', 360 - tw / 2, 650 + 0.5 / z);
    }
    else { c.textAlign = 'center'; c.fillText('SAFE ✓', 460, 12); }
    const n = shelf.length;
    if (!n) return;
    const lay = shelfLayout(n);
    const fnt = Math.max(10, 11 * z) / z;
    for (let k = 0; k < n; k++) {
      const s = shelf[k], d = s.d, p = lay.pos(k);
      let x = p.x, y = p.y, rot = 0;
      const fly = reduceMotion ? 1 : clamp(s.t / 0.7, 0, 1);
      if (fly < 1) {
        x = lerp(DOOR.x, p.x, fly); y = lerp(DOOR.y, p.y, fly) - Math.sin(fly * Math.PI) * 90; rot = fly * Math.PI * 2;
      }
      fx.doll(c, x, y + (reduceMotion ? 0 : Math.abs(Math.sin(fxClock * 5 + k)) * -2), lay.rr, { hue: d.hue, species: d.species, mini: true, rot });
      // rank badge
      const bx = x + lay.rr * 0.85, by = y - lay.rr * 0.85, br = Math.min(Math.max(7, 8 * z) / z, Math.max(lay.rr * 0.6, 6 / z));
      c.fillStyle = d.rank <= 3 ? ['#ffd23f', '#dfe6f3', '#e0a15a'][d.rank - 1] : '#2a1740';
      c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.fill();
      c.fillStyle = d.rank <= 3 ? '#2a1740' : '#fff';
      c.font = `900 ${br * 1.15}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(d.rank), bx, by + 0.5 / z);
      if (lay.names && fly >= 1) {
        c.font = `800 ${fnt}px sans-serif`;
        c.lineWidth = 3 / z; c.strokeStyle = 'rgba(20,8,30,.9)'; c.fillStyle = '#fff';
        if (lay.port) {
          c.textAlign = 'center';
          c.strokeText(dispName(d), x, y + lay.rr + fnt * 0.75, lay.cw - 4); c.fillText(dispName(d), x, y + lay.rr + fnt * 0.75, lay.cw - 4);
        } else {
          c.textAlign = 'left';
          c.strokeText(dispName(d), x + lay.rr + 10, y, 136 - lay.rr * 2 - 22); c.fillText(dispName(d), x + lay.rr + 10, y, 136 - lay.rr * 2 - 22);
        }
      }
    }
  }

  function drawTicket(z) {
    if ((state !== 'reveal' && state !== 'over') || !loser) return;
    const t = state === 'over' ? 9 : revealT;
    if (t < 3.0) return;
    const c = ctx;
    const lines = [T.cardCoupon, T.cardPays(N - 1), T.payer(dispName(loser))];
    const shown = reduceMotion ? 3 : clamp(Math.floor((t - 3.0) / 0.25) + 1, 0, 3);
    const lineH = Math.max(15, 17 * z) / z;
    const full = 10 + lineH * 4.2 + 8;   // the last row is left blank for the stamp
    const hgt = reduceMotion ? full : Math.min(full, 8 + shown * lineH + Math.max(0, t - 3.0 - (shown - 1) * 0.25) * 50);
    const x = 232, w = 138, y = 614;
    c.save();
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x + 3 / z, y + 3 / z, w, hgt);
    c.fillStyle = '#fff4e2'; c.fillRect(x, y, w, hgt);
    c.strokeStyle = '#c9a88f'; c.lineWidth = 1.2 / z; c.setLineDash([4 / z, 3 / z]);
    c.beginPath(); c.moveTo(x + 6, y + 10 + lineH); c.lineTo(x + w - 6, y + 10 + lineH); c.stroke(); c.setLineDash([]);
    c.beginPath(); c.rect(x, y, w, hgt); c.clip();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let i = 0; i < shown; i++) {
      c.fillStyle = i === 0 ? '#8a5a3b' : i === 2 ? '#d62f4b' : '#3b2417';
      c.font = `${i === 0 ? 900 : 800} ${lineH * 0.74}px sans-serif`;
      c.fillText(lines[i], x + w / 2, y + 6 + lineH * (i + 0.5) + (i ? 4 : 0), w - 12);
    }
    c.restore();
    if (t >= 4.6) {
      const k = reduceMotion ? 1 : clamp((t - 4.6) / 0.15, 0, 1);
      const s = 1.9 - 0.9 * k;
      c.save(); c.translate(x + w * 0.6, y + 10 + lineH * 3.75 + 4); c.rotate(-0.12); c.scale(s, s);
      c.globalAlpha = 0.88 * k;
      const fs = lineH * 0.7;
      c.font = `900 ${fs}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      const tw = c.measureText(T.stamp).width + 12 / z;
      c.fillStyle = 'rgba(214,47,75,.08)'; roundRectPath(c, -tw / 2, -fs * 0.75, tw, fs * 1.5, 4 / z); c.fill();
      c.strokeStyle = '#d62f4b'; c.lineWidth = 2.5 / z; c.stroke();
      c.fillStyle = '#d62f4b'; c.fillText(T.stamp, 0, 1 / z);
      c.restore();
    }
  }

  // Screen-space darkness: LAST COIN dip, blackout, reveal spotlight.
  function drawDarkness(v) {
    let a = 0, holes = [];
    const r = R_DOLL * cam.zoom;
    if (state === 'reveal' || state === 'over') {
      a = 0.72;
      if (loser) { const p = toScreen(v, loser.x, loser.y); holes.push([p.x, p.y, r * 2.4]); }
      const t = state === 'over' ? 9 : revealT;
      if (t >= 3.0) { const p = toScreen(v, 301, 656); holes.push([p.x, p.y, 100 * cam.zoom]); }
      holes.push([toScreen(v, 180, -52).x, toScreen(v, 180, -52).y, 150 * cam.zoom]);
    } else if (blackout) {
      const t = blackout.t;
      a = reduceMotion ? 0.5 : t < 0.4 ? (Math.floor(t * 10) % 2 ? 0.82 : 0.2) : 0.82;
    } else if (dimT > 0 && state === 'playing') {
      a = 0.55 * clamp(dimT / 0.4, 0, 1);
      for (const d of dolls) if (d.state !== 'out') { const p = toScreen(v, d.x, d.y); holes.push([p.x, p.y, r * 2]); }
    }
    if (a <= 0.01) return;
    const c = ctx;
    const layer = darkLayer();
    if (layer) {
      const g = layer.getContext('2d');
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, W, H);
      g.fillStyle = `rgba(4,2,10,${a})`; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'destination-out';
      for (const [x, y, rr] of holes) {
        const hg = g.createRadialGradient(x, y, rr * 0.55, x, y, rr);
        hg.addColorStop(0, 'rgba(0,0,0,1)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = hg; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
      }
      g.globalCompositeOperation = 'source-over';
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(layer, 0, 0); c.restore();
    } else { c.fillStyle = `rgba(4,2,10,${a * 0.8})`; c.fillRect(0, 0, W, H); }
    c.save();
    if (blackout) {   // only eyes and the claw LED glow
      c.fillStyle = '#fff7b0';
      c.beginPath();
      for (const d of ents) {
        if (d.state === 'out' || d.kind !== 'doll') continue;
        for (const s of [-1, 1]) { const p = toScreen(v, d.x + s * R_DOLL * 0.34, d.y - R_DOLL * 0.2); const er = Math.max(1.5, R_DOLL * 0.12 * cam.zoom); c.moveTo(p.x + er, p.y); c.arc(p.x, p.y, er, 0, Math.PI * 2); }
      }
      c.fill();
      const p = toScreen(v, claw.x + 15, RAIL_Y - 2);
      c.fillStyle = '#3dff8a'; c.shadowColor = '#3dff8a'; c.shadowBlur = 12;
      c.beginPath(); c.arc(p.x, p.y, 4, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  let darkCv = null;
  function darkLayer() {
    try {
      if (!darkCv) darkCv = document.createElement('canvas');
      const w = Math.max(1, Math.round(W * DPR)), h = Math.max(1, Math.round(H * DPR));
      if (darkCv.width !== w || darkCv.height !== h) { darkCv.width = w; darkCv.height = h; }
      return darkCv;
    } catch (e) { return null; }
  }
  function pill(c, x, y, w, h) { roundRectPath(c, x, y, w, h, h / 2); }

  // Full-name bubbles (fixed 12 px), decluttered upward, clamped in the viewport.
  function drawBubbles(v) {
    bubbles = [];
    if (!N || state === 'menu' || state === 'countdown' || blackout) return;
    const c = ctx, z = cam.zoom, r = R_DOLL;
    const rem = remCount();
    const list = [];
    const tg = claw.target && claw.target.kind === 'doll' && claw.state !== 'idle' && (claw.state !== 'roulette' || (spot && spot.t >= spot.dur - 0.1)) ? claw.target : null;
    if (state === 'playing') {
      if (tg && tg.state !== 'out') list.push(tg);
      for (const d of dolls) if ((d.state === 'held' || d.state === 'teeter') && !list.includes(d)) list.push(d);
      if (rem <= 6) {
        // With N ≤ 12 the belly ribbon already carries the full name; only add a bubble when it is squeezed.
        c.font = `900 ${Math.max(10, 0.46 * r * z)}px sans-serif`;
        for (const d of dolls) if (d.state !== 'out' && !list.includes(d) && (N > 12 || c.measureText(dispName(d)).width > 1.8 * r * z)) list.push(d);
      }
    } else if (loser) list.push(loser);
    c.save();
    c.font = '800 12px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const d of list) {
      const text = dispName(d);
      const p = toScreen(v, d.x, d.y);
      const w = Math.min(160, c.measureText(text).width + 14), h = 20;
      let bx = clamp(p.x - w / 2, 4, W - 4 - w);
      let by = p.y - r * z - (d.species === 1 ? 0.5 * r * z : 0.15 * r * z) - h - 8;
      let guard = 0;
      while (bubbles.some(o => bx < o.x + o.w + 3 && bx + w + 3 > o.x && by < o.y + o.h + 2 && by + h + 2 > o.y) && guard++ < 30) by -= 18;
      by = clamp(by, 4, H - 4 - h);
      bubbles.push({ x: bx, y: by, w, h, d });
      const hot = d === tg || d.state === 'held' || d.state === 'teeter' || d === loser;
      c.fillStyle = 'rgba(0,0,0,.28)'; pill(c, bx + 1, by + 2, w, h); c.fill();
      c.fillStyle = d === loser ? '#ffe1e5' : hot ? '#fff6b8' : '#fff';
      pill(c, bx, by, w, h); c.fill();
      c.strokeStyle = d.color; c.lineWidth = 2; c.stroke();
      const px = clamp(p.x, bx + 8, bx + w - 8);
      c.beginPath(); c.moveTo(px - 5, by + h - 1); c.lineTo(px + 5, by + h - 1); c.lineTo(clamp(p.x, px - 10, px + 10), by + h + 6); c.closePath();
      c.fillStyle = d === loser ? '#ffe1e5' : hot ? '#fff6b8' : '#fff'; c.fill();
      c.fillStyle = '#23122f';
      c.fillText(text, bx + w / 2, by + h / 2 + 0.5, w - 10);
    }
    // taunt bubbles on the shelf
    const lay = shelf.length ? shelfLayout(shelf.length) : null;
    for (const tb of taunts) {
      const k = shelf.findIndex(s => s.d === tb.d);
      if (k < 0 || !lay) continue;
      const pp = lay.pos(k), p = toScreen(v, pp.x, pp.y - lay.rr);
      c.font = '800 12px sans-serif';
      const w = Math.min(W - 16, c.measureText(tb.text).width + 16), h = 22;
      const pop = reduceMotion ? 1 : Math.min(1, tb.t / 0.15);
      const bx = clamp(p.x - w / 2, 6, W - 6 - w);
      let by = clamp(p.y - h - 6, 6, H - h - 6), guard = 0;
      // stay off the remaining dolls and name bubbles: slide down into the shelf instead
      const hit = () => bubbles.some(o => bx < o.x + o.w + 3 && bx + w + 3 > o.x && by < o.y + o.h + 2 && by + h + 2 > o.y) ||
        dolls.some(d => { if (d.state === 'out') return false; const q = toScreen(v, d.x, d.y), rr = r * z;
          return bx < q.x + rr && bx + w > q.x - rr && by < q.y + rr && by + h > q.y - rr; });
      while (hit() && guard++ < 12) by = Math.min(H - h - 6, by + h + 4);
      bubbles.push({ x: bx, y: by, w, h });
      c.globalAlpha = tb.t > 1.5 ? (1.8 - tb.t) / 0.3 : 1;
      c.save(); c.translate(bx + w / 2, by + h / 2); c.scale(pop, pop);
      c.fillStyle = '#7dff9a'; pill(c, -w / 2, -h / 2, w, h); c.fill();
      c.fillStyle = '#10301a'; c.fillText(tb.text, 0, 1, w - 10);
      c.restore(); c.globalAlpha = 1;
    }
    // coyote sign over the loser
    if ((state === 'reveal' && revealT >= 1.4) || state === 'over') {
      const p = toScreen(v, loser.x, loser.y);
      const k = reduceMotion || state === 'over' ? 1 : clamp((revealT - 1.4) / 0.2, 0, 1);
      c.font = '900 13px sans-serif';
      const w = c.measureText(T.loserSign).width + 18, h = 26;
      const bx = clamp(p.x + r * z * 0.6, 6, W - w - 6), by = clamp(p.y - r * z * 0.2 - h, 6, H - h - 6);
      c.save(); c.translate(bx + w / 2, by + h); c.scale(k, k); c.rotate(0.08);
      c.fillStyle = '#8b5a3c'; c.fillRect(-2, 0, 4, 18);
      c.fillStyle = '#fff4e2'; c.strokeStyle = '#8b5a3c'; c.lineWidth = 2;
      roundRectPath(c, -w / 2, -h, w, h, 5); c.fill(); c.stroke();
      c.fillStyle = '#3b2417'; c.fillText(T.loserSign, 0, -h / 2 + 1);
      c.restore();
    }
    c.restore();
  }

  function drawFloaters(v) {
    const c = ctx;
    c.save();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const f of fx.floaters) {
      const k = f.age / f.life;
      const p = toScreen(v, f.x, f.y);
      const pop = reduceMotion ? 1 : k < 0.12 ? 0.6 + k / 0.12 * 0.5 : 1.1 - Math.min(0.1, k);
      c.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      c.font = `900 ${f.size}px sans-serif`;
      const hw = Math.min(W / 2 - 6, (c.measureText(f.text).width / 2 + 6) * pop);
      c.save(); c.translate(clamp(p.x, hw + 4, W - hw - 4), clamp(p.y + (f.oy || 0) - (reduceMotion ? 0 : k * 34), 20, H - 20)); c.scale(pop, pop);
      c.lineWidth = 5; c.strokeStyle = 'rgba(20,6,30,.85)'; c.strokeText(f.text, 0, 0);
      c.fillStyle = f.color; c.fillText(f.text, 0, 0);
      c.restore();
    }
    c.restore();
  }

  function drawVignette() {
    if (state !== 'playing' || !N) return;
    const ph = phaseOf();
    if (ph !== 'last3' && ph !== 'final') return;
    const hz = ph === 'final' && (claw.state === 'lift' || claw.state === 'carry') ? 1.5 : 1.1;
    const a = reduceMotion ? 0.12 : 0.1 + 0.14 * Math.pow(Math.max(0, Math.sin(fxClock * Math.PI * hz)), 4);
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(255,30,60,0)'); g.addColorStop(1, `rgba(255,30,60,${a})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  function drawBanner() {
    if (!banner) return;
    const c = ctx, bt = banner.t, d = banner.dur;
    const pop = reduceMotion ? 1 : bt < 0.25 ? 1.25 - bt : 1;
    const alpha = bt > d - 0.3 ? (d - bt) / 0.3 : 1;
    c.save();
    c.globalAlpha = clamp(alpha, 0, 1);
    const v = viewport();
    const top = v.port ? 150 : H < 500 ? 78 : 110;
    c.translate(v.x, clamp(toScreen(v, 0, 96).y, top, Math.max(top, H * 0.42)));
    c.scale(pop, pop);
    c.font = `900 ${Math.min(30, W * 0.062)}px sans-serif`;
    const fit = Math.min(1, (Math.min(W, v.w + 32) - 24) / (c.measureText(banner.text).width * pop));
    c.scale(fit, fit);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 8; c.strokeStyle = 'rgba(10,6,20,.9)';
    c.strokeText(banner.text, 0, 0);
    c.fillStyle = banner.color; c.shadowColor = banner.color; c.shadowBlur = 20;
    c.fillText(banner.text, 0, 0);
    c.restore();
  }

  function drawPortrait() {
    if (!loser) return;
    const rect = portrait.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    if (!w || !h) return;
    if (portrait.width !== Math.round(w * DPR) || portrait.height !== Math.round(h * DPR)) {
      portrait.width = Math.round(w * DPR); portrait.height = Math.round(h * DPR);
    }
    const c = portraitCtx;
    c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, w, h);
    fx.loserDoll(c, w / 2, h * 0.52, Math.min(w * 0.2, h * 0.3), victoryT, { hue: loser.hue, species: loser.species, cups: N - 1 });
  }

  // ---------- Reveal (sequenced in step(); no timers) ----------
  function revealStep(realDt) {
    if (!loser) return;
    const t0 = revealT;
    revealT += realDt;
    const t = revealT;
    const hit = s => t0 < s && t >= s;
    if (t0 === 0) {
      say(T.shutter, 1.2); addTrauma(0.4);
      setMarquee(`☕ ${dispName(loser)}!`, '#ff4d5e');
      sfx('shutter', 0, v => { noise(0.2, 0.14 * v); beep(140, 0.2, 'square', 0.1 * v, 70); });
      fx.float(HOME_X, LIP_TOP - 40, T.shutter, '#ffffff', 18, true);
      const second = escapeOrder[N - 2];
      if (second) fx.float(DOOR.x, DOOR.y - 60, T.place(N - 1), '#7dff9a', 18, false);
    }
    if (hit(0.8)) { hushUntil = performance.now() + 1200; setMasterLevel(0.25); }
    if (hit(2.0)) {
      setMasterLevel(1); hushUntil = 0;
      showBanner(T.loserBanner(dispName(loser)), '#ff5a6e', 2.6, true);
      say(T.loserBanner(dispName(loser)), 9);
      taunts = [];
      shelfTaunt(T.taunts[Math.floor(fxRand() * T.taunts.length)]);
      shelfTaunt(T.taunts[Math.floor(fxRand() * T.taunts.length)]);
      sfx('trombone', 0, v => [392, 370, 349, 330].forEach((f, i) => beep(f, i === 3 ? 0.9 : 0.28, 'triangle', 0.12 * v, i === 3 ? f * 0.97 : 0, i * 0.3)));
    }
    if (t >= 2.0 && !reduceMotion && fxRand() < realDt * 14) {
      fx.tears(loser.x - R_DOLL * 0.34, loser.y - R_DOLL * 0.1, -1);
      fx.tears(loser.x + R_DOLL * 0.34, loser.y - R_DOLL * 0.1, 1);
    }
    for (let i = 0; i < 3; i++) if (hit(3.0 + i * 0.25)) sfx('printer' + i, 0, v => { for (let k = 0; k < 5; k++) noise(0.012, 0.05 * v, k * 0.045); });
    if (hit(4.6)) { addTrauma(0.25); sfx('stamp', 0, v => beep(90, 0.18, 'triangle', 0.2 * v, 50)); }
    if (t >= 2.0 && t < 5.2) {
      tauntNext -= realDt;
      if (tauntNext <= 0) { tauntNext = 1.2; shelfTaunt(T.taunts[Math.floor(fxRand() * T.taunts.length)]); }
    }
    // presentation-only: finish the loser's settle tween
    if (loser.tw) {
      const w = loser.tw; w.t += realDt; const u = Math.min(1, w.t / w.dur);
      loser.x = lerp(w.x0, w.x1, u); loser.y = lerp(w.y0, w.y1, u) - (w.mode === 'hop' ? w.h * 4 * u * (1 - u) : 0);
      if (u >= 1) loser.tw = null;
    }
    if (revealT >= REVEAL_DUR - 1e-6) { state = 'over'; showResult(); }
  }

  // ---------- Countdown ----------
  const CD_SEQ = ['3', '2', '1', 'GO!'];
  function tickCountdown(dt) {
    cdT += dt;
    const idx = Math.floor(cdT / COUNT_STEP);
    if (idx !== cdIdx) {
      cdIdx = idx;
      if (idx < CD_SEQ.length) {
        countdownEl.style.display = 'flex';
        countdownEl.textContent = CD_SEQ[idx];
        countdownEl.style.color = idx === 3 ? '#7dff9a' : '#ffd23f';
        if (!reduceMotion && countdownEl.animate) {
          countdownEl.animate(
            [{ transform: 'scale(1.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.3)', opacity: 0 }],
            { duration: 700, easing: 'ease-out' });
        }
        beep(idx === 3 ? 660 : 440, 0.12, 'triangle', 0.14);
      } else {
        countdownEl.style.display = 'none';
        state = 'playing';
      }
    }
    if (!reduceMotion) for (const e of ents) {
      const v = L(e);
      if (!v.thumped && cdT >= v.pour + 0.45) { v.thumped = true; sfx('pour', 50, vv => beep(160 + fxRand() * 80, 0.05, 'triangle', 0.05 * vv)); }
    }
  }

  // ---------- Loop (RAF + Worker; fixed 60 Hz sim) ----------
  let last = performance.now(), lastSizeCheck = 0;
  function step() {
    const now = performance.now();
    let realDt = (now - last) / 1000;
    if (realDt < STEP * 0.9) return;
    last = now;
    if (realDt > 0.05) realDt = 0.05;
    if (now - lastSizeCheck > 500) {
      lastSizeCheck = now;
      if (window.innerWidth !== W || window.innerHeight !== H) { resize(); frameCabinet(true); }
    }
    if (state === 'countdown' || state === 'playing' || state === 'reveal') realClock += realDt;
    fx.update(realDt * (freezeT > 0 ? 0.3 : timeScale));
    if (freezeT > 1e-4) {
      freezeT -= realDt;
      drain(); present(realDt);
      render();
      return;
    }
    timeScale += (presentTs() - timeScale) * Math.min(1, realDt * 4);
    const dt = realDt * timeScale;
    if (state === 'countdown') tickCountdown(realDt);
    else if (state === 'playing') {
      accumulator += dt;
      while (accumulator >= STEP - 1e-9 && state === 'playing') { update(STEP); accumulator -= STEP; }
    } else if (state === 'reveal') { drain(); revealStep(realDt); }
    else if (state === 'over') victoryT += realDt;
    drain();
    present(realDt);
    render();
  }

  // ---------- Results ----------
  function showResult() {
    if (!loser) return;
    victoryT = 0;
    $('winName').textContent = dispName(loser);
    $('loserSub').textContent = T.loserSub(N);
    $('loserStat').textContent = T.loserStat(loser.grabs, loser.slips, loser.lipBacks);
    portrait.setAttribute('aria-label', T.portraitAria(dispName(loser)));
    const list = $('rankList');
    list.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'], cls = ['gold', 'silver', 'bronze'];
    escapeOrder.forEach((d, i) => {
      const isLoser = i === escapeOrder.length - 1;
      const li = document.createElement('li');
      li.className = 'rankItem' + (isLoser ? ' loser' : i < 3 ? ' ' + cls[i] : '');
      li.style.setProperty('--i', String(reduceMotion ? 0 : Math.min(i * 0.06, 1.2)));
      const no = document.createElement('span'); no.className = 'rankNo'; no.textContent = isLoser ? '☕' : i < 3 ? medals[i] : String(i + 1);
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = d.color;
      const nm = document.createElement('span'); nm.className = 'rankName'; nm.textContent = dispName(d);
      const tg = document.createElement('span'); tg.className = 'rankTag'; tg.textContent = isLoser ? T.loserRow : tagLabel(d.tag);
      li.append(no, dot, nm, tg);
      list.appendChild(li);
    });
    const total = $('receiptTotal');
    total.innerHTML = '';
    const l1 = document.createElement('div'); l1.textContent = T.receiptTotal(N - 1);
    const l2 = document.createElement('div'); l2.className = 'payer'; l2.textContent = T.payer(dispName(loser));
    total.append(l1, l2);
    total.setAttribute('data-stamp', T.stamp);
    winScreen.classList.remove('hidden');
    list.scrollTop = list.scrollHeight || 0;
    buildShareCard(escapeOrder);
  }

  // ---------- Share card (1080×1350) ----------
  const SHARE_URL = T.shareUrl;
  const CARD_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  const shareBtn = $('shareBtn'), toastEl = $('toast');
  let shareFile = null, sharePending = null, shareCaption = '', shareBusy = false, toastT = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }
  function fitFont(c, text, maxW, maxSize, weight) {
    let s = maxSize;
    c.font = `${weight} ${s}px ${CARD_FONT}`;
    while (s > 22 && c.measureText(text).width > maxW) { s -= 4; c.font = `${weight} ${s}px ${CARD_FONT}`; }
    return s;
  }
  function drawResultCard(ranked) {
    const CW = 1080, CH = 1350, cx = CW / 2;
    const cv = document.createElement('canvas');
    cv.width = CW; cv.height = CH;
    const c = cv.getContext('2d');
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const bg = c.createRadialGradient(cx, 520, 80, cx, 620, 1100);
    bg.addColorStop(0, '#3b2417'); bg.addColorStop(1, '#140b07');
    c.fillStyle = bg; c.fillRect(0, 0, CW, CH);
    c.strokeStyle = 'rgba(255,122,184,.55)'; c.lineWidth = 14; c.strokeRect(22, 22, CW - 44, CH - 44);
    c.strokeStyle = 'rgba(255,122,184,.2)'; c.lineWidth = 34; c.strokeRect(22, 22, CW - 44, CH - 44);
    c.fillStyle = 'rgba(246,216,192,.07)';
    for (let y = 60; y < CH; y += 90) for (let x = ((y / 90) % 2) * 45 + 40; x < CW; x += 90) {
      c.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, l = i % 2 ? 5 : 11; c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); }
      c.closePath(); c.fill();
    }
    const lz = ranked[ranked.length - 1];
    c.fillStyle = '#f6d8c0'; c.font = `800 44px ${CARD_FONT}`; c.fillText(T.cardTitle, cx, 90);
    c.fillStyle = '#c9a88f'; c.font = `700 34px ${CARD_FONT}`; c.fillText(T.cardPlayers(ranked.length), cx, 150);
    // coupon panel with zigzag teeth
    const px0 = 84, px1 = 996, py0 = 214, py1 = 1010, tooth = 24;
    c.fillStyle = '#fff4e2';
    c.beginPath(); c.moveTo(px0, py0 + tooth);
    for (let x = px0; x < px1; x += tooth * 2) { c.lineTo(x + tooth, py0); c.lineTo(Math.min(px1, x + tooth * 2), py0 + tooth); }
    c.lineTo(px1, py1 - tooth);
    for (let x = px1; x > px0; x -= tooth * 2) { c.lineTo(x - tooth, py1); c.lineTo(Math.max(px0, x - tooth * 2), py1 - tooth); }
    c.closePath(); c.fill();
    c.strokeStyle = '#c9a88f'; c.lineWidth = 3; c.setLineDash([14, 12]);
    c.beginPath(); c.moveTo(px0 + 30, 380); c.lineTo(px1 - 30, 380); c.stroke(); c.setLineDash([]);
    c.fillStyle = '#8a5a3b'; c.font = `900 38px ${CARD_FONT}`;
    c.fillText(T.cardCoupon.split('').join(' '), cx, 290);
    c.fillStyle = '#6b4128'; c.font = `800 44px ${CARD_FONT}`; c.fillText(T.cardCoffee, cx, 350);
    const name = lz ? dispName(lz) : '-';
    c.fillStyle = '#d62f4b'; c.font = `900 ${fitFont(c, name, 760, 128, 900)}px ${CARD_FONT}`; c.fillText(name, cx, 460);
    if (lz) fx.loserDoll(c, cx, 668, 100, 1.0, { hue: lz.hue, species: lz.species, cups: ranked.length - 1, still: true });
    c.fillStyle = '#3b2417'; c.font = `900 44px ${CARD_FONT}`; c.fillText(T.cardPays(ranked.length - 1), cx, 830);
    const stat = lz ? T.loserStat(lz.grabs, lz.slips, lz.lipBacks) : '';
    c.fillStyle = '#8a5a3b'; c.font = `700 ${fitFont(c, stat, 800, 32, 700)}px ${CARD_FONT}`; c.fillText(stat, cx, 900);
    // stamp
    c.save(); c.translate(840, 470); c.rotate(-12 * Math.PI / 180);
    c.font = `900 40px ${CARD_FONT}`;
    const sw = c.measureText(T.stamp).width + 40;
    c.strokeStyle = 'rgba(214,47,75,.85)'; c.lineWidth = 6;
    roundRectPath(c, -sw / 2, -34, sw, 68, 12); c.stroke();
    c.fillStyle = 'rgba(214,47,75,.85)'; c.fillText(T.stamp, 0, 2);
    c.restore();
    const first = ranked.slice(0, Math.min(3, ranked.length - 1)).map(dispName).join(' · ');
    c.fillStyle = '#f6d8c0'; const ft = T.cardFirst(first);
    c.font = `800 ${fitFont(c, ft, 900, 36, 800)}px ${CARD_FONT}`; c.fillText(ft, cx, 1080);
    c.fillStyle = '#ff7ab8'; c.font = `800 34px ${CARD_FONT}`; c.fillText(T.cardCta, cx, 1222);
    c.fillStyle = '#c9a88f'; c.font = `800 38px ${CARD_FONT}`; c.fillText('kimdoogi.github.io/ranking-game', cx, 1282);
    return cv;
  }
  // Built as soon as the overlay opens so navigator.share() keeps the click's user activation.
  function buildShareCard(ranked) {
    shareFile = null;
    const lz = ranked.length ? dispName(ranked[ranked.length - 1]) : '-';
    const first = ranked.length > 1 ? dispName(ranked[0]) : '-';
    shareCaption = T.shareCaption(lz, ranked.length, first) + '\n' + T.gameName + ' ' + SHARE_URL;
    sharePending = new Promise(resolve => {
      try {
        drawResultCard(ranked).toBlob(b => {
          if (b) {
            try { shareFile = new File([b], 'claw-escape-result.png', { type: 'image/png' }); }
            catch (e) { shareFile = b; }
          }
          resolve(shareFile);
        }, 'image/png');
      } catch (e) { resolve(null); }
    });
  }
  shareBtn.onclick = async () => {
    if (shareBusy) return;
    shareBusy = true;
    shareBtn.disabled = true;
    try {
      if (!shareFile) toast(T.cardBuilding);
      const file = shareFile || await sharePending;
      if (!file) { toast(T.cardFailed); return; }
      if (navigator.share && navigator.canShare && file.name && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], text: shareCaption }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
      if (navigator.clipboard && window.ClipboardItem) {
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': file })]); toast(T.cardCopied); return; }
        catch (e) {}
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url; a.download = 'claw-escape-result.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast(T.cardSaved);
    } catch (e) {
      toast(T.shareFailed);
    } finally {
      shareBusy = false;
      shareBtn.disabled = false;
    }
  };

  // ---------- Lobby roster (push-royale conventions) ----------
  const MAXN = 30, MIN_START = 2;
  const nameInput = $('nameInput'), addBtn = $('addBtn'), clearBtn = $('clearBtn');
  const rosterList = $('rosterList'), countVal = $('countVal'), lobbyHint = $('lobbyHint');
  const startBtn = $('startBtn'), demoBtn = $('demoBtn');
  let entries = [], playerCount = 0;
  const totalCount = () => entries.reduce((s, e) => s + e.count, 0);
  function expandRoster() {
    const out = [];
    for (const e of entries) for (let k = 0; k < e.count; k++) { if (out.length >= MAXN) return out; out.push(e.name); }
    return out;
  }
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
    demoBtn.hidden = total > 0;
    startBtn.style.opacity = ok ? '' : '.4';
    startBtn.style.cursor = ok ? '' : 'not-allowed';
    lobbyHint.textContent = total === 0 ? T.hintEmpty : ok ? T.hintReady(total) : T.hintNeedMore(MIN_START);
    try { localStorage.setItem('minigame_roster', JSON.stringify(entries)); } catch (e) {}
  }
  addBtn.onclick = () => { if (addEntry(nameInput.value)) { nameInput.value = ''; nameInput.focus(); } };
  nameInput.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return;
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

  function begin() {
    resize();
    if (!W || !H) { setTimeout(begin, 120); return; }
    window.__names = expandRoster();
    if (window.__names.length < MIN_START) return;
    playerCount = window.__names.length;
    initAudio();
    if (AC && AC.state === 'suspended') AC.resume();
    nameInput.blur(); startBtn.blur();
    $('startScreen').classList.add('hidden');
    winScreen.classList.add('hidden');
    setupGame(playerCount);
    cdT = 0; cdIdx = -1;
    state = 'countdown';
    hudEl.hidden = false;
    matchFeed.hidden = false;
    stageEl.textContent = T.stageInsert;
  }
  startBtn.onclick = begin;
  $('againBtn').onclick = begin;
  demoBtn.onclick = () => {
    if (totalCount() > 0) return;
    entries = Array.from({ length: 12 }, (_, i) => ({ name: T.numName(i + 1), count: 1 }));
    renderRoster(); begin();
  };

  // ---------- Lobby backdrop: a decorative pile built from the FX stream only ----------
  function buildPreview() {
    N = 12;
    buildLattice(12);
    dolls = []; ducks = [];
    for (let i = 0; i < 12; i++) dolls.push(makeDoll(i, String(i + 1), true, 1));
    ents = dolls.slice();
    let k = 0;
    const order = Array.from({ length: 12 }, (_, i) => i).sort(() => fxRand() - 0.5);
    for (let s = 0; s < slots.length && k < 12; s++) {
      if (!supported(s)) continue;
      const e = dolls[order[k++]]; place(e, s); e.x = slots[s].x; e.y = slots[s].y;
    }
    claw = newClaw(); dir = newDir(); dir.coinDone = false;
    N = 12;
  }
  buildPreview();
  frameCabinet(true);
  render();
  (function raf() { step(); requestAnimationFrame(raf); })();
  try {
    const src = 'setInterval(function(){postMessage(0);},1000/70);';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = step;
  } catch (e) {
    setInterval(step, 1000 / 60);
  }
})();
