// node check-races.cjs — real game closures in a dependency-free VM.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');

function load(slug, { width = 1280, height = 720, seed = 1, reduced = false } = {}) {
  let now = 0;
  const elements = new Map(), timers = [];
  const math = Object.create(Math);
  math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const paint = new Proxy({}, { get(target, key) {
    if (key in target) return target[key];
    if (key === 'measureText') return text => ({ width: String(text).length * 8 });
    return (...args) => {
      for (const v of args) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${key}: non-finite coordinate`);
      if (key === 'arc' || key === 'ellipse') assert.ok(args[2] >= 0, `${key}: negative radius`);
      if (String(key).includes('Gradient')) return { addColorStop() {} };
    };
  } });
  const element = () => ({
    children: [], style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} }, value: '', listeners: {},
    setAttribute(name, value) { this[name] = value; }, getAttribute(name) { return this[name]; },
    addEventListener(name, fn) { this.listeners[name] = fn; }, focus() {}, blur() {}, animate() {},
    appendChild(item) { this.children.push(item); }, prepend(item) { this.children.unshift(item); },
    removeChild(item) { this.children.splice(this.children.indexOf(item), 1); },
    get lastChild() { return this.children.at(-1); }, replaceChildren() { this.children = []; },
    set innerHTML(value) { this.children = []; }, getContext() { return paint; },
  });
  const sandbox = {
    Math: math, console,
    window: { innerWidth: width, innerHeight: height, devicePixelRatio: 1,
      matchMedia: () => ({ matches: reduced }), listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } },
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement: element, querySelectorAll() { return []; }, addEventListener() { assert.fail('No gameplay keyboard listener is allowed'); } },
    localStorage: { getItem() { return null; }, setItem() {} }, performance: { now: () => now },
    requestAnimationFrame() {}, setInterval() {}, clearTimeout() {},
    setTimeout(fn, ms) { timers.push({ at: now + ms, fn }); },
    URL: { createObjectURL() {} }, Blob: class {}, Worker: class {},
  };
  vm.createContext(sandbox);
  vm.runInContext(read(slug + '.html').match(/window\.T = \{[\s\S]*?\n\};/)[0], sandbox);
  const race = slug === 'obstacle-run';
  if (race) vm.runInContext(read('obstacle-run-fx.js'), sandbox);
  const hook = `
    globalThis.game = { setupGame, update, step, render,
      result: ${race ? 'showResults' : 'showWinner'},
      ${race ? 'giveItem, bounceOff, shieldHit, bananaRain, updateEvents,' : 'throwSnack, eatSnack,'}
      resize(w, h) { window.innerWidth = w; window.innerHeight = h; window.listeners.resize(); },
      get players() { return players; }, get state() { return state; }, set state(v) { state = v; },
      get time() { return gameT; }, set time(v) { gameT = v; }, get winner() { return winner; },
      get ranked() { return ${race ? 'finishOrder' : 'eliminationOrder'}; },
      get world() { return ${race ? 'race' : 'arena'}; }, get camera() { return cam; },
      ${race ? 'get hazards() { return peels; }, get eventCount() { return nextEvent; }, get changes() { return leaderChanges; }, get photo() { return { done: photoDone, captured: !!polaroid }; }, set quality(v) { q = v; },' : 'get snack() { return snack; }, get monster() { return monster; }, get snacksLeft() { return snacksLeft; },'}
    };
  `;
  vm.runInContext(read(slug + '.js').replace(/\}\)\(\);\s*$/, hook + '\n})();'), sandbox);
  const game = sandbox.game;
  game.advance = dt => {
    now += dt * 1000;
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= now) timers.splice(i, 1)[0].fn();
  };
  return { game, elements, window: sandbox.window };
}

function run(slug, count, options = {}) {
  const { game: g, elements, window } = load(slug, options);
  window.__names = Array(count).fill('참가자');
  g.setupGame(count); g.state = slug === 'obstacle-run' ? 'racing' : 'playing';
  let frames = 0;
  while (g.state !== 'over' && frames++ < 7200) {
    if (options.rotate && frames === 450) g.resize(844, 390);
    if (options.rotate && frames === 900) g.resize(320, 568);
    if (options.quality !== undefined) g.quality = options.quality;
    const dt = 1 / 60;
    g.advance(dt); g.update(dt, 1);
    if (frames % 240 === 0) g.render();
  }
  assert.equal(g.state, 'over', `${slug} ${count} players must resolve`);
  assert.equal(g.ranked.length, count);
  assert.equal(new Set(g.ranked.map(p => p.id)).size, count, 'Exactly one ranking per entry');
  assert.ok(g.winner);
  g.result(); g.render();
  assert.equal(elements.get('rankList').children.length, count);
  if (slug === 'obstacle-run') {
    assert.ok(g.eventCount >= 2, 'Automatic rain and turbo both run');
    assert.ok(g.players.every(p => p.itemGate >= 0), 'Each runner reaches an item gate');
    const finishers = g.ranked.filter(p => p.finished);
    assert.equal(finishers.length, count, 'The field gets time to cross the tape before results');
    for (let i = 1; i < finishers.length; i++) assert.ok(finishers[i].finT >= finishers[i - 1].finT, 'Finish times match ranks');
    assert.equal(elements.get('ticker').children.length, Math.min(3, count));
    assert.equal(elements.get('raceDistance').textContent, '결승까지 0m', 'The finish flushes the spectator HUD');
    console.log(slug, count, 'time', g.time.toFixed(1), 'finished', finishers.length, 'lead changes', g.changes);
  } else {
    assert.equal(g.players.filter(p => p.alive).length, 1);
    assert.equal(elements.get('chaseLog').children.length, Math.min(3, count - 1));
    if (count > 2) assert.ok(g.snacksLeft < 3, 'Snacks arrive without any input');
    console.log(slug, count, 'time', g.time.toFixed(1), 'deliveries', 3 - g.snacksLeft);
  }
  return { ranks: Array.from(g.ranked, p => p.id), times: Array.from(g.ranked, p => p.finT), time: g.time };
}

// Every entry rolls fresh abilities and a shuffled grid. A duplicate name is not a twin.
{
  const { game: g, window } = load('obstacle-run'); window.__names = Array(12).fill('커피');
  g.setupGame(12);
  const before = g.players.map(p => [p.wx, p.wy, p.spd]);
  assert.equal(new Set(g.players.map(p => p.spd)).size, 12);
  g.setupGame(12); assert.notDeepEqual(g.players.map(p => [p.wx, p.wy, p.spd]), before);
  const items = new Set();
  for (let i = 0; i < 40; i++) { g.giveItem(g.players[0]); items.add(g.players[0].item); }
  assert.equal(items.size, 4);
  const p = g.players[0]; p.shieldT = 6; p.state = 'run';
  g.bounceOff(p, p.wx - 10, p.wy, 12, true);
  assert.equal(p.state, 'run'); assert.equal(p.shieldT, 0);
  g.setupGame(2); g.state = 'racing'; g.world.bands = [];
  for (const [i, p] of g.players.entries()) Object.assign(p, { wx: i ? 100 : -100, wy: g.world.course - 1, state: 'bounce', stateT: 1, vwy: i ? 4 : 2, vx: 0, started: true });
  g.advance(1 / 60); g.update(1 / 60, 1);
  assert.deepEqual(Array.from(g.ranked, p => p.id), [1, 0], 'Airborne crossing uses interpolated time, not array order');
  g.setupGame(2); g.state = 'racing'; g.time = 8; g.updateEvents(1 / 60);
  assert.ok(g.hazards.length > 0 && g.hazards.every(p => p.t > 0), 'Banana rain warns before landing');
  g.setupGame(2); assert.equal(g.hazards.length, 0); assert.equal(g.eventCount, 0);
}

// Once-per-gate rewards survive being knocked backward over the same gate.
{
  const { game: g } = load('obstacle-run'); g.setupGame(2); g.state = 'racing';
  const gate = g.world.bands.find(b => b.type === 'item'); g.world.bands = [gate];
  const p = g.players[0]; Object.assign(p, { wy: gate.y - 1, wx: -150, started: true, state: 'bounce', stateT: 1, vwy: 2, vx: 0 });
  g.update(1 / 60, 1); assert.equal(p.itemGate, 0);
  p.item = 'already awarded'; p.wy = gate.y - 1; p.state = 'bounce'; p.vwy = 2;
  g.update(1 / 60, 1); assert.equal(p.item, 'already awarded');
}

for (const [slug, counts] of [['obstacle-run', [2, 12, 300]], ['monster-chase', [2, 12, 30]]]) {
  for (const n of counts) {
    const desktop = run(slug, n, { seed: n });
    const mobile = run(slug, n, { seed: n, width: 390, height: 844, rotate: true, quality: 2, reduced: true });
    assert.deepEqual(mobile, desktop, `${slug}: device, rotation, quality and motion preference cannot change the result`);
  }
}
{
  const { game: g } = load('monster-chase'); g.setupGame(12); g.state = 'playing';
  g.monster.state = 'lunge'; g.monster.lock = 0;
  g.time = 9; g.throwSnack(); assert.ok(g.snack); assert.equal(g.snacksLeft, 2);
  assert.equal(g.monster.lock, -1); assert.ok(g.monster.lureT > 0, 'A delivery during a lunge queues the next distraction');
  g.throwSnack(); assert.equal(g.snacksLeft, 2, 'An active delivery cannot be duplicated');
  g.eatSnack(g.monster); assert.equal(g.snack, null);
  g.time = 10; g.throwSnack(); assert.equal(g.snacksLeft, 2, 'Delivery interval uses game time');
  g.time = 20; g.throwSnack(); assert.equal(g.snacksLeft, 1);
  g.setupGame(12); assert.equal(g.snack, null); assert.equal(g.snacksLeft, 3);
}
// Literal names, even Object prototype property names, remain valid entries.
for (const slug of ['obstacle-run', 'monster-chase']) {
  const { game: g, window } = load(slug); window.__names = ['toString', 'toString'];
  g.setupGame(2); assert.equal(g.players[1].dup, 2); g.render();
}
{
  const { game: g } = load('obstacle-run'); g.setupGame(2); g.state = 'racing'; g.world.bands = [];
  for (const [i, p] of g.players.entries()) Object.assign(p, { wx: i ? 80 : -80, wy: g.world.course - 70 - i * 3, spd: 1, started: true, bursted1: true, bursted2: true });
  for (let n = 0; n < 900 && !g.photo.captured; n++) { g.advance(1 / 60); g.step(); }
  assert.ok(g.photo.done && g.photo.captured, 'A close finish captures the rendered crossing, including the winner');
}
// Exercise the actual frame accumulator, with rendering, at 30 and 60 fps.
for (const slug of ['obstacle-run', 'monster-chase']) {
  const outcomes = [30, 60].map(fps => {
    const { game: g } = load(slug, { seed: 7 }); g.setupGame(2);
    g.state = slug === 'obstacle-run' ? 'racing' : 'playing';
    let frames = 0;
    while (g.state !== 'over' && frames++ < fps * 120) { g.advance(1 / fps); g.step(); }
    assert.equal(g.state, 'over');
    return Array.from(g.ranked, p => [p.id, p.finT]);
  });
  assert.deepEqual(outcomes[0], outcomes[1], `${slug}: frame rate must not change the result`);
}
console.log('Race and chase checks passed: automatic play, items, rankings, replay resets and viewport parity.');
