// Run with node check-push-royale.cjs. No browser or packages required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGame({ width = 1280, height = 720, reduced = false, seed = 1,
  source = fs.readFileSync(path.join(__dirname, 'push-royale.js'), 'utf8') } = {}) {
  let now = 0;
  const timers = [], elements = new Map();
  const math = Object.create(Math);
  math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const paint = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'measureText') return text => ({ width: String(text).length * 9 });
      return (...args) => {
        for (const a of args) if (typeof a === 'number') assert.ok(Number.isFinite(a), `${key}: non-finite coordinate`);
        if (key === 'arc' || key === 'ellipse') assert.ok(args[2] >= 0, `${key}: negative radius`);
        if (String(key).includes('Gradient')) return { addColorStop() {} };
      };
    },
  });
  function element() {
    return {
      children: [], style: { setProperty() {} }, classList: { add() {}, remove() {} }, value: '',
      listeners: {},
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, fn) { this.listeners[name] = fn; }, focus() {}, blur() {},
      append(...items) { for (const item of items) { item.parent = this; this.children.push(item); } },
      appendChild(item) { this.append(item); },
      prepend(item) { item.parent = this; this.children.unshift(item); },
      replaceChildren() { this.children = []; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter(e => e !== this); },
      get lastElementChild() { return this.children.at(-1); },
      set innerHTML(value) { this.children = []; },
      getContext() { return paint; },
      getBoundingClientRect() { return { width: 420, height: 330 }; },
      toBlob(callback) { callback(null); }, animate() {},
    };
  }
  const sandbox = {
    Math: math, console,
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element },
    window: { innerWidth: width, innerHeight: height, devicePixelRatio: 1,
      matchMedia: () => ({ matches: reduced }), listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    performance: { now: () => now }, requestAnimationFrame() {},
    setTimeout(fn, ms) { timers.push({ fn, at: now + ms }); }, clearTimeout() {}, setInterval() {},
    URL: { createObjectURL() {} }, Blob: class {}, Worker: class {},
  };
  vm.createContext(sandbox);
  const html = fs.readFileSync(path.join(__dirname, 'push-royale.html'), 'utf8');
  vm.runInContext(html.match(/window\.T = \{[\s\S]*?\n\};/)[0], sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'push-royale-fx.js'), 'utf8'), sandbox);
  // Keep test access out of the shipped game: expose the real closure only in this VM.
  const hook = `
    globalThis.game = { setupGame, startSwing, batHit, resolveSwings, update, step, render, showWinner,
      batReach, swHit, swDur, drawStickman, updateBlasts, frameArena, viewport, groundY,
      resize(w, h) { window.innerWidth = w; window.innerHeight = h; window.listeners.resize(); },
      get camera() { return cam; }, get blasts() { return blasts; },
      get wind() { return typeof SP_WIND === 'undefined' ? SW_WIND : SP_WIND; },
      get types() { return typeof SPECIALS === 'undefined' ? [] : SPECIALS; },
      get players() { return players; }, get arena() { return arena; },
      get state() { return state; }, set state(s) { state = s; },
      get time() { return gameT; }, set time(t) { gameT = t; }, get uses() { return spUses; },
      get winner() { return winner; }, get ranked() { return eliminationOrder; },
      get fx() { return typeof fx === 'undefined' ? null : fx; },
      get trauma() { return trauma; }
    };
  `;
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, hook + '\n})();'), sandbox);
  const game = sandbox.game;
  game.advance = (dt = 1 / 60) => {
    now += dt * 1000;
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].at <= now) timers.splice(i, 1)[0].fn();
    }
  };
  return { game, elements, math, window: sandbox.window };
}

function runMatch(options, count = 12) {
  const { game, elements } = loadGame(options);
  game.setupGame(count); game.state = 'playing';
  for (let i = 0; i < 6000 && game.state === 'playing'; i++) {
    if (options.rotate && i === 600) game.resize(844, 390);
    if (options.rotate && i === 900) game.resize(390, 700);
    game.advance(); game.step();
  }
  assert.equal(game.state, 'over', `match did not finish: ${count} players at ${options.width || 1280}px`);
  assert.equal(new Set(game.ranked.map(p => p.id)).size, count, 'each player receives exactly one rank');
  assert.ok(game.winner, 'the match must produce a winner');
  assert.equal(elements.get('eliminationFeed').children.length, Math.min(3, count - 1), 'the live feed keeps only the latest eliminations');
  assert.equal(elements.get('eliminationFeed').children[0].children[0].textContent, '2위', 'the last elimination is the runner-up, not the winner');
  game.showWinner(); game.render();
  return { seconds: game.time, specials: game.uses, ranks: Array.from(game.ranked, p => p.id) };
}

function check() {
  const { game, math, elements } = loadGame();
  game.setupGame(6); game.state = 'playing';
  let [a, b] = game.players;
  for (let i = 0; i < 7; i++) game.batHit(a, b, 1, 0, 0);
  assert.ok(Math.abs(a.sp - 0.98) < 1e-9, 'seven hits nearly charge the gauge without making specials too frequent');
  game.batHit(a, b, 1, 0, 0);
  assert.equal(a.sp, 1, 'the gauge remains capped at full');
  assert.ok(Math.abs(b.sp - 0.52) < 1e-9, 'taking hits also charges a little faster');
  a.sp = 0; game.startSwing(a, false);
  assert.equal(a.sp, 0, 'empty swings do not charge the gauge');

  const selected = [];
  for (let i = 0; i < 4; i++) {
    math.random = () => (i + 0.5) / 4;
    game.startSwing(a, true); selected.push(a.special.id);
    assert.equal(a.sp, 0, 'every activation consumes the gauge');
    assert.equal(elements.get('specialFeed').children[0].children[1].children[1].textContent, a.special.name);
  }
  assert.equal(new Set(selected).size, 4, 'the same fighter can draw all four techniques on successive casts');
  assert.equal(elements.get('specialFeed').children.length, 3, 'the announcement feed is bounded');
  game.batHit(a, b, 1, 0, 0);
  assert.equal(a.sp, 0, 'specials cannot recharge themselves');

  for (const kind of selected) {
    game.setupGame(6); game.state = 'playing';
    a = game.players[0];
    a.x = game.arena.cx; a.y = game.arena.cy; a.aim = 0;
    a.special = game.types.find(s => s.id === kind); a.swingT = game.wind + a.special.hit * 0.95;
    const reach = game.batReach(a, a.special);
    // One forward, one behind, then a close chain with a fourth possible hop.
    const offsets = [[0.7, 0], [-0.9, 0], [1.1, 0.2], [1.3, 0.4], [1.45, 0.6]];
    game.players.slice(1).forEach((p, i) => { p.x = a.x + reach * offsets[i][0]; p.y = a.y + reach * offsets[i][1]; });
    game.resolveSwings();
    const hit = [...a.hitIds];
    assert.ok(hit.includes(1), `${kind} hits the forward target`);
    if (kind === 'dash') assert.ok(!hit.includes(2), 'a rocket rush cannot hit behind the attacker');
    if (kind === 'spin' || kind === 'quake') assert.ok(hit.includes(2), `${kind} hits around the attacker`);
    if (kind === 'bolt') { assert.equal(hit.length, 3); assert.ok(hit.includes(3), 'lightning chains beyond the first target'); }
    game.resolveSwings();
    assert.deepEqual([...a.hitIds], hit, `${kind} hits each target once per cast`);
    for (const t of [0.05, game.wind + 0.02, game.wind + a.special.hit + 0.05]) {
      a.swingT = t; game.render();
    }
  }

  game.setupGame(2); [a, b] = game.players;
  a.special = game.types[3]; a.x = game.arena.cx; a.y = game.arena.cy;
  b.x = a.x + game.batReach(a, a.special) * 0.85; b.y = a.y;
  a.swingT = game.wind + 0.001; game.resolveSwings();
  assert.equal(a.hitIds.length, 0, 'the quake must travel outward before hitting a distant target');
  a.knockT = 0.2; a.swingT = game.wind + a.special.hit * 0.99; game.resolveSwings();
  assert.equal(a.hitIds.length, 0, 'being launched interrupts every technique');

  game.setupGame(2); [a, b] = game.players;
  a.x = game.arena.cx; a.y = game.arena.cy; a.vx = a.vy = 0; a.aim = 0;
  b.x = a.x + game.arena.R * 0.7; b.y = a.y;
  a.special = game.types.find(s => s.id === 'dash'); a.swingT = game.wind - 0.001;
  game.update(1 / 60, 1);
  assert.ok(a.vx > 2 * game.arena.scale && a.x > game.arena.cx, 'rocket rush moves the attacker at the end of its windup');

  game.fx.impact(10, 20, 0, '#fff', 20); game.fx.bolt(0, 0, 20, 20, '#fff');
  game.fx.update(1);
  assert.equal(game.fx.events.length, 0, 'visual effects expire');
  game.setupGame(12);
  assert.equal(elements.get('specialFeed').children.length, 0, 'replay clears the previous draw announcements');

  const reduced = loadGame({ reduced: true }).game;
  reduced.setupGame(2); reduced.state = 'playing';
  reduced.startSwing(reduced.players[0], true); reduced.render();
  assert.equal(reduced.trauma, 0, 'reduced motion suppresses shake');
  const phone = loadGame({ width: 390, height: 844 }).game;
  phone.setupGame(30);
  for (const skill of phone.types) assert.ok(phone.batReach(phone.players[0], skill) <= phone.arena.R * 0.36, 'special reach stays bounded on phones');

  // Stage events are automatic, telegraphed and hit each fighter once per wave.
  game.setupGame(6); game.state = 'playing'; game.time = 7;
  game.updateBlasts(0);
  const blast = game.blasts[0];
  assert.equal(game.blasts.length, 1, 'the stage creates its first event without user input');
  [a, b] = game.players;
  a.x = blast.x + blast.radius * 0.25; a.y = blast.y; a.vx = a.vy = 0;
  b.x = blast.x + blast.radius * 1.5; b.y = blast.y; b.vx = b.vy = 0;
  game.updateBlasts(blast.delay - 0.01);
  assert.equal(a.vx, 0, 'warning circles do not knock anyone back');
  game.updateBlasts(0.15);
  assert.ok(a.vx > 0, 'a detonation launches a nearby fighter away from its center');
  assert.equal(b.vx, 0, 'fighters beyond the blast are unaffected');
  const launchSpeed = a.vx;
  game.updateBlasts(0.05);
  assert.equal(a.vx, launchSpeed, 'one wave cannot hit the same fighter twice');
  game.updateBlasts(1);
  assert.equal(game.blasts.length, 0, 'stage events expire');
  game.time = 14; game.updateBlasts(0); game.updateBlasts(3);
  game.time = 21; game.updateBlasts(0);
  assert.ok(game.blasts[0].pulse, 'every third event is a central shockwave');
  assert.equal(game.blasts[0].x, game.arena.cx);
  game.setupGame(6);
  assert.equal(game.blasts.length, 0, 'replay clears all warnings and waves');
  assert.equal(elements.get('eliminationFeed').children.length, 0, 'replay clears the battle feed');

  const controls = loadGame();
  assert.deepEqual(Object.keys(controls.elements.get('game').listeners), [], 'the arena has no pointer or touch controls');
  assert.ok(!controls.window.listeners.keydown, 'keyboard input cannot affect a draw');
  for (const suffix of ['', '-en', '-zh', '-ja']) {
    const html = fs.readFileSync(path.join(__dirname, `push-royale${suffix}.html`), 'utf8');
    assert.ok(!html.includes('id="shakeBtn"'), 'every language removes the intervention button');
  }

  // Resizing changes the view, never positions, momentum, hit reach or arena shrink.
  phone.state = 'playing';
  for (let i = 0; i < 120; i++) { phone.advance(); phone.step(); }
  const snapshot = JSON.stringify({ arena: phone.arena, players: phone.players });
  phone.resize(844, 390);
  assert.equal(JSON.stringify({ arena: phone.arena, players: phone.players }), snapshot);
  phone.resize(390, 700);
  assert.equal(JSON.stringify({ arena: phone.arena, players: phone.players }), snapshot);
  const initialZoom = phone.camera.zoom;
  phone.arena.R *= 0.5;
  phone.players.forEach(p => { p.x *= 0.3; p.y *= 0.3; p.z = 0; });
  phone.frameArena(true);
  assert.ok(phone.camera.zoom > initialZoom * 1.3, 'the camera gets closer as the arena shrinks');
  for (const [w, h] of [[320, 568], [390, 844], [844, 390], [1280, 720]]) {
    phone.resize(w, h);
    const v = phone.viewport(), camera = phone.camera;
    for (const p of phone.players.filter(p => p.alive && !p.falling)) {
      const x = v.x + (p.x - camera.x) * camera.zoom;
      const y = v.y + (phone.groundY(p.y) - p.z - p.r * 4 - camera.y) * camera.zoom;
      assert.ok(x >= 0 && x <= w && y >= 0 && y < h, 'standing fighters and names fit after rotation');
    }
    phone.render();
  }
  reduced.frameArena(true);
  const quietZoom = reduced.camera.zoom;
  reduced.arena.R *= 0.4; reduced.frameArena(true);
  assert.equal(reduced.camera.zoom, quietZoom, 'reduced motion keeps the camera steady');

  const results = [];
  for (const width of [390, 1280]) for (const count of [2, 12, 30]) {
    for (let seed = 1; seed <= 3; seed++) results.push(runMatch({ width, height: width === 390 ? 844 : 720, seed }, count));
  }
  assert.deepEqual(results.slice(0, 9), results.slice(9), 'the same random seed gives identical rankings and match timing on phone and desktop');
  assert.deepEqual(runMatch({ width: 390, height: 844, seed: 2, rotate: true }, 12), results[4], 'rotating during a match cannot change the draw');
  console.log(`Push Royale: gauge, 4 techniques, automatic hazards, no intervention, responsive camera, replay and ${results.length + 1} complete matches passed.`);
}

if (require.main === module) check();
module.exports = { loadGame, runMatch };
