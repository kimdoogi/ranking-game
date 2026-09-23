// Run with node check-claw-escape.cjs [section numbers…]. No browser or packages required.
// Loads the real claw-escape.js closure in a VM with a small fake DOM, a paint proxy for every canvas,
// fake timers and a seeded, call-counted Math.random, then checks the spec §11 test plan.
// CLAW_VERBOSE=1 prints one timing line per section.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const STEP = 1 / 60;
const PAGES = ['', '-en', '-zh', '-ja'];
// Fixed world (spec §3.1). The harness only uses these to build probes; the game owns the real values.
const WORLD = { CHUTE_X1: 96, LIP_X: 100, LIP_TOP: 520, SENSOR_Y: 560, PILE_X0: 104, PILE_W: 256, FLOOR: 600, HOME_X: 48 };
// Memoised so one run tests one snapshot of the game even if the files change mid-run.
const files = new Map();
const read = file => {
  if (!files.has(file)) files.set(file, fs.readFileSync(path.join(__dirname, file), 'utf8'));
  return files.get(file);
};

// ---------------------------------------------------------------------------------------------
// Test hook (spec §11). Every name is typeof-guarded so a missing binding is reported by name
// instead of surfacing as a ReferenceError while the page loads.
const HOOK_FNS = ['setupGame', 'update', 'step', 'render', 'showResult', 'presentTs', 'settle', 'landSlot',
  'exposed', 'phaseOf', 'beginTilt', 'dropDuck', 'viewport', 'frameCabinet', 'buildShareCard'];
const HOOK_GETTERS = { realClock: 'realClock', dolls: 'dolls', ducks: 'ducks', slots: 'slots', claw: 'claw', dir: 'dir',
  ranked: 'escapeOrder', loser: 'loser', camera: 'cam', fx: 'fx', trauma: 'trauma', revealT: 'revealT', K: 'K', r: 'R_DOLL',
  // Diagnostics beyond the contract; undefined when the game names them differently.
  freezeT: 'freezeT', timeScale: 'timeScale', STEP: 'STEP' };
const guard = name => `(typeof ${name} === 'undefined' ? undefined : ${name})`;
const HOOK = `
  globalThis.game = {
    ${HOOK_FNS.map(f => `${f}: ${guard(f)}`).join(',\n    ')},
    resize(w, h) { window.innerWidth = w; window.innerHeight = h; window.listeners.resize({ type: 'resize' }); },
    get state() { return state; }, set state(s) { state = s; },
    get time() { return gameT; }, set time(t) { gameT = t; },
    ${Object.entries(HOOK_GETTERS).map(([k, v]) => `get ${k}() { return ${guard(v)}; }`).join(',\n    ')}
  };
`;

// ---------------------------------------------------------------------------------------------
// Paint proxy: every 2D context (main canvas, offscreen caches, portrait, share card).
function makePaint() {
  const bad = v => /NaN|undefined|\[object /.test(String(v));
  const CHECKED_PROPS = new Set(['fillStyle', 'strokeStyle', 'shadowColor', 'font', 'filter']);
  const gradient = () => ({
    addColorStop(o, c) {
      if (!(Number.isFinite(o) && o >= 0 && o <= 1)) assert.fail(`addColorStop(${o}): offset outside [0, 1] throws IndexSizeError in browsers`);
      if (bad(c)) assert.fail(`addColorStop: invalid colour "${c}"`);
    },
  });
  const methods = new Map();
  // Hot path (hundreds of calls per frame): one specialised closure per method name, and
  // messages are only built when a check fails.
  const finite = (key, args) => {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (typeof a === 'number' && !Number.isFinite(a)) assert.fail(`${String(key)}: non-finite argument in (${args.map(String).join(', ')})`);
    }
  };
  const RESULT = {
    createPattern: () => ({ setTransform() {} }),
    measureText: args => ({ width: String(args[0]).length * 9, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getImageData: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
    createImageData: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }),
    isPointInPath: () => false, isPointInStroke: () => false, getLineDash: () => [],
  };
  const CHECK = {
    arc: args => { if (!(args[2] >= 0)) assert.fail(`arc: negative radius ${args[2]}`); },
    ellipse: args => { if (!(args[2] >= 0 && args[3] >= 0)) assert.fail(`ellipse: negative radius ${args[2]}, ${args[3]}`); },
    arcTo: args => { if (!(args[4] >= 0)) assert.fail(`arcTo: negative radius ${args[4]}`); },
    roundRect: args => { for (const v of [].concat(args[4] ?? [])) if (typeof v === 'number' && !(v >= 0)) assert.fail(`roundRect: negative corner radius ${v}`); },
    createRadialGradient: args => { if (!(args[2] >= 0 && args[5] >= 0)) assert.fail(`createRadialGradient: negative radius (${args[2]}, ${args[5]})`); },
    fillText: args => { if (bad(args[0])) assert.fail(`fillText: draws a broken label "${args[0]}"`); },
    strokeText: args => { if (bad(args[0])) assert.fail(`strokeText: draws a broken label "${args[0]}"`); },
  };
  const method = key => {
    const check = CHECK[key], result = String(key).includes('Gradient') ? gradient : RESULT[key];
    if (!check && !result) return (...args) => { finite(key, args); };
    return (...args) => {
      finite(key, args);
      if (check) check(args);
      return result ? result(args) : undefined;
    };
  };
  return new Proxy({ canvas: { width: 1280, height: 720 } }, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === 'symbol') return undefined;
      if (!methods.has(key)) methods.set(key, method(key));
      return methods.get(key);
    },
    set(target, key, value) {
      if (typeof value === 'number') { if (!Number.isFinite(value)) assert.fail(`ctx.${String(key)} = ${value}: non-finite value is silently ignored by browsers`); }
      else if (typeof value === 'string' && CHECKED_PROPS.has(key) && bad(value)) assert.fail(`ctx.${key} = "${value}": invalid value is silently ignored by browsers`);
      target[key] = value; return true;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Mini DOM: parses the page body so ids, classes and the hidden attribute start as shipped.
function makeDom(pageHtml, paint) {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const ENT = { lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", nbsp: ' ', amp: '&' };
  const decode = s => s.replace(/&(lt|gt|quot|#39|#x27|nbsp|amp);/g, (_, e) => ENT[e]);
  const camel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const detach = node => {
    if (!node.parent) return;
    const i = node.parent.nodes.indexOf(node);
    if (i >= 0) node.parent.nodes.splice(i, 1);
    node.parent = null;
  };
  const textNode = s => ({ nodeType: 3, parent: null, _t: String(s),
    get textContent() { return this._t; }, set textContent(v) { this._t = String(v); }, remove() { detach(this); } });
  function adopt(parent, node, index = parent.nodes.length) {
    if (node == null) return node;
    if (typeof node !== 'object') node = textNode(node);
    if (node.nodeType === 11) {
      const kids = node.nodes.slice();
      kids.forEach(detach);
      kids.forEach((k, j) => adopt(parent, k, index + j));
      return node;
    }
    if (node.parent === parent && parent.nodes.indexOf(node) < index) index--;
    detach(node);
    node.parent = parent;
    parent.nodes.splice(Math.max(0, Math.min(index, parent.nodes.length)), 0, node);
    return node;
  }
  function parseInto(parent, html, index = parent.nodes.length) {
    const frag = makeElement('#fragment'), stack = [frag];
    const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/g;
    let m;
    while ((m = re.exec(html))) {
      const top = stack.at(-1);
      if (m[0].startsWith('<!--')) continue;
      if (m[1]) {
        for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === m[1].toUpperCase()) { stack.length = i; break; }
        continue;
      }
      if (m[2]) {
        const el = makeElement(m[2]);
        for (const a of m[3].matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
          el.setAttribute(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ''));
        }
        adopt(top, el);
        if (!m[4] && !VOID.has(m[2].toLowerCase())) stack.push(el);
        continue;
      }
      adopt(top, textNode(decode(m[5])));
    }
    adopt(parent, frag, index);
  }
  const compound = s => {
    const m = s.match(/^([a-zA-Z*][\w-]*)?((?:[#.][\w-]+)*)$/);
    if (!m) return null;
    return { tag: m[1] && m[1] !== '*' ? m[1].toUpperCase() : null, id: (m[2].match(/#([\w-]+)/) || [])[1],
      cls: [...m[2].matchAll(/\.([\w-]+)/g)].map(x => x[1]) };
  };
  const hit = (el, c) => el.nodeType === 1 && (!c.tag || el.tagName === c.tag) && (!c.id || el.id === c.id) && c.cls.every(k => el._cls.has(k));
  const matches = (el, selector) => String(selector).split(',').some(sel => {
    const parts = sel.trim().replace(/\s*>\s*/g, ' ').split(/\s+/).map(compound);
    if (!parts.length || parts.some(p => !p) || !hit(el, parts.at(-1))) return false;
    let i = parts.length - 2;
    for (let a = el.parent; i >= 0 && a; a = a.parent) if (hit(a, parts[i])) i--;
    return i < 0;
  });
  const descendants = root => {
    const out = [];
    const walk = n => { for (const k of n.nodes) if (k.nodeType === 1) { out.push(k); walk(k); } };
    walk(root);
    return out;
  };
  const serialize = n => n.nodeType === 3 ? n._t
    : `<${n.tagName.toLowerCase()}${n._cls.size ? ` class="${n.className}"` : ''}>${n.nodes.map(serialize).join('')}</${n.tagName.toLowerCase()}>`;

  function makeElement(tag = 'div') {
    const el = {
      nodeType: tag === '#fragment' ? 11 : 1, tagName: String(tag).toUpperCase(), nodes: [], parent: null,
      listeners: {}, attrs: {}, dataset: {}, id: '', value: '', hidden: false, disabled: false,
      style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return ''; } },
      width: 300, height: 150, scrollTop: 0, scrollLeft: 0, scrollHeight: 0, scrollWidth: 0,
      offsetWidth: 0, offsetHeight: 0, clientWidth: 0, clientHeight: 0, _cls: new Set(),
      get parentNode() { return this.parent; },
      get parentElement() { return this.parent && this.parent.nodeType === 1 ? this.parent : null; },
      get children() { return this.nodes.filter(n => n.nodeType === 1); },
      get childNodes() { return this.nodes; },
      get firstChild() { return this.nodes[0] || null; },
      get lastChild() { return this.nodes.at(-1) || null; },
      get firstElementChild() { return this.children[0] || null; },
      get lastElementChild() { return this.children.at(-1) || null; },
      get childElementCount() { return this.children.length; },
      get nextElementSibling() { const s = this.parent ? this.parent.children : []; return s[s.indexOf(this) + 1] || null; },
      get className() { return [...this._cls].join(' '); },
      set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      get textContent() { return this.nodes.map(n => n.textContent).join(''); },
      set textContent(v) { this.nodes.slice().forEach(detach); if (v != null && v !== '') adopt(this, textNode(v)); },
      get innerText() { return this.textContent; }, set innerText(v) { this.textContent = v; },
      get innerHTML() { return this.nodes.map(serialize).join(''); },
      set innerHTML(v) { this.nodes.slice().forEach(detach); parseInto(this, String(v)); },
      setAttribute(name, value) {
        name = String(name); value = String(value);
        if (name === 'class') this.className = value;
        else if (name === 'id') this.id = value;
        else if (name === 'hidden' || name === 'disabled') this[name] = true;
        else if (name === 'width' || name === 'height') this[name] = Number(value);
        else if (name === 'value') this.value = value;
        else if (name.startsWith('data-')) this.dataset[camel(name.slice(5))] = value;
        this.attrs[name] = value;
      },
      getAttribute(name) {
        if (name === 'class') return this._cls.size ? this.className : null;
        if (name === 'hidden') return this.hidden ? '' : null;
        if (name.startsWith('data-')) return this.dataset[camel(name.slice(5))] ?? null;
        return name in this.attrs ? this.attrs[name] : null;
      },
      hasAttribute(name) { return this.getAttribute(name) !== null; },
      removeAttribute(name) {
        if (name === 'hidden' || name === 'disabled') this[name] = false;
        if (name === 'class') this._cls = new Set();
        if (name.startsWith('data-')) delete this.dataset[camel(name.slice(5))];
        delete this.attrs[name];
      },
      toggleAttribute(name, force) {
        const on = force === undefined ? !this.hasAttribute(name) : !!force;
        if (on) this.setAttribute(name, ''); else this.removeAttribute(name);
        return on;
      },
      addEventListener(name, fn) { this.listeners[name] = fn; },
      removeEventListener(name) { delete this.listeners[name]; },
      dispatchEvent() { return true; },
      append(...items) { for (const it of items) adopt(this, it); },
      appendChild(it) { return adopt(this, it); },
      prepend(...items) { items.forEach((it, i) => adopt(this, it, i)); },
      insertBefore(it, ref) { return adopt(this, it, ref ? this.nodes.indexOf(ref) : this.nodes.length); },
      removeChild(it) { detach(it); return it; },
      replaceChildren(...items) { this.nodes.slice().forEach(detach); this.append(...items); },
      remove() { detach(this); },
      before(...items) { if (this.parent) items.forEach(it => adopt(this.parent, it, this.parent.nodes.indexOf(this))); },
      after(...items) { if (this.parent) items.reverse().forEach(it => adopt(this.parent, it, this.parent.nodes.indexOf(this) + 1)); },
      replaceWith(...items) { this.before(...items); this.remove(); },
      insertAdjacentHTML(pos, html) {
        if (pos === 'afterbegin') parseInto(this, html, 0);
        else if (pos === 'beforeend') parseInto(this, html);
        else if (this.parent) parseInto(this.parent, html, this.parent.nodes.indexOf(this) + (pos === 'afterend' ? 1 : 0));
      },
      insertAdjacentElement(pos, node) {
        if (pos === 'afterbegin') adopt(this, node, 0);
        else if (pos === 'beforeend') adopt(this, node);
        else if (this.parent) adopt(this.parent, node, this.parent.nodes.indexOf(this) + (pos === 'afterend' ? 1 : 0));
        return node;
      },
      querySelector(sel) { return descendants(this).find(e => matches(e, sel)) || null; },
      querySelectorAll(sel) { return descendants(this).filter(e => matches(e, sel)); },
      getElementsByClassName(c) { return descendants(this).filter(e => e._cls.has(c)); },
      getElementsByTagName(t) { return descendants(this).filter(e => t === '*' || e.tagName === t.toUpperCase()); },
      closest(sel) { for (let a = this; a && a.nodeType === 1; a = a.parent) if (matches(a, sel)) return a; return null; },
      matches(sel) { return matches(this, sel); },
      contains(n) { for (; n; n = n.parent) if (n === this) return true; return false; },
      getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 420, bottom: 330, width: 420, height: 330 }; },
      getContext() { return paint; },
      toBlob(callback) { callback(null); },
      toDataURL() { return 'data:image/png;base64,'; },
      animate() { return { finished: Promise.resolve(), cancel() {}, finish() {}, play() {}, pause() {}, onfinish: null }; },
      getAnimations() { return []; },
      focus() {}, blur() {}, select() {}, scrollTo() {}, scrollBy() {}, scrollIntoView() {},
      click() { const fn = this.onclick || this.listeners.click; if (fn) fn.call(this, { type: 'click', preventDefault() {}, target: this }); },
    };
    el.classList = {
      add: (...c) => c.forEach(k => el._cls.add(k)),
      remove: (...c) => c.forEach(k => el._cls.delete(k)),
      toggle: (k, force) => { const on = force === undefined ? !el._cls.has(k) : !!force; if (on) el._cls.add(k); else el._cls.delete(k); return on; },
      contains: k => el._cls.has(k),
      replace: (a, b) => { if (!el._cls.has(a)) return false; el._cls.delete(a); el._cls.add(b); return true; },
      get length() { return el._cls.size; },
      [Symbol.iterator]: () => el._cls.values(),
    };
    return el;
  }

  const root = makeElement('html'), head = makeElement('head'), body = makeElement('body');
  root.append(head, body);
  const bodyHtml = (pageHtml.match(/<body[^>]*>([\s\S]*)<\/body>/) || [, ''])[1]
    .replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
  parseInto(body, bodyHtml);
  return { root, head, body, makeElement, textNode: s => textNode(s), descendants };
}

// ---------------------------------------------------------------------------------------------
function loadGame({ width = 1280, height = 720, reduced = false, seed = 1, page = '',
  source = read('claw-escape.js') } = {}) {
  let now = 0, timerId = 0;
  const timers = [], calls = { random: 0 }, requested = new Set(), missing = new Set(), detached = new Map();
  let lcg = seed >>> 0;
  const math = Object.create(Math);
  math.random = () => { calls.random++; return (lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0) / 4294967296; };
  const paint = makePaint();
  const html = read(`claw-escape${page}.html`);
  const dom = makeDom(html, paint);
  const findId = id => dom.descendants(dom.root).find(e => e.id === id) || null;
  const elements = { get: id => findId(id) || detached.get(id), all: () => dom.descendants(dom.root) };
  const mq = q => ({ matches: /reduce/.test(q) ? reduced : /landscape/.test(q) ? window.innerWidth > window.innerHeight
    : /portrait/.test(q) ? window.innerWidth <= window.innerHeight : false,
  media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const navigator = { userAgent: 'node-check', language: 'ko-KR', languages: ['ko-KR'] };
  const setTimeout = (fn, ms = 0) => { const id = ++timerId; timers.push({ id, fn, at: now + (Number(ms) || 0) }); return id; };
  const clearTimeout = id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); };
  const window = {
    innerWidth: width, innerHeight: height, devicePixelRatio: 1, listeners: {}, matchMedia: mq, navigator,
    location: { href: `http://127.0.0.1/claw-escape${page}.html`, pathname: `/claw-escape${page}.html`, search: '', hash: '' },
    addEventListener(name, fn) { this.listeners[name] = fn; }, removeEventListener(name) { delete this.listeners[name]; },
    getComputedStyle: () => ({ getPropertyValue: () => '' }), scrollTo() {},
    setTimeout, clearTimeout, requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
  };
  const document = {
    documentElement: dom.root, head: dom.head, body: dom.body, hidden: false, visibilityState: 'visible', readyState: 'complete',
    getElementById(id) {
      requested.add(id);
      const el = findId(id);
      if (el) return el;
      missing.add(id);
      if (!detached.has(id)) { const d = dom.makeElement(id === 'game' || /Portrait$/.test(id) ? 'canvas' : 'div'); d.id = id; detached.set(id, d); }
      return detached.get(id);
    },
    createElement: tag => dom.makeElement(tag),
    createTextNode: s => dom.textNode(s),
    createDocumentFragment: () => dom.makeElement('#fragment'),
    querySelector: sel => dom.root.querySelector(sel),
    querySelectorAll: sel => dom.root.querySelectorAll(sel),
    addEventListener() { assert.fail('no gameplay keyboard listener: document.addEventListener must never be called (spec §9.1)'); },
  };
  const sandbox = {
    Math: math, console, window, document, navigator,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    performance: { now: () => now }, requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
    queueMicrotask: fn => Promise.resolve().then(fn), structuredClone: globalThis.structuredClone,
    getComputedStyle: window.getComputedStyle, matchMedia: mq,
    URL: { createObjectURL() { return 'blob:check'; }, revokeObjectURL() {} },
    Blob: class {}, File: class {}, Image: class {}, Worker: class {},
  };
  window.performance = sandbox.performance; window.localStorage = sandbox.localStorage;
  vm.createContext(sandbox);
  const tBlock = html.match(/window\.T = \{[\s\S]*?\n\};/);
  assert.ok(tBlock, `claw-escape${page}.html must carry a window.T = {…}; block`);
  vm.runInContext(tBlock[0], sandbox, { filename: `claw-escape${page}.html#T` });
  vm.runInContext(read('claw-escape-fx.js'), sandbox, { filename: 'claw-escape-fx.js' });
  assert.ok(/\}\)\(\);\s*$/.test(source), 'claw-escape.js must end with the IIFE close "})();" so the test hook can be injected');
  // Keep test access out of the shipped game: expose the real closure only in this VM.
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, HOOK + '\n})();'), sandbox, { filename: 'claw-escape.js' });
  const game = sandbox.game;
  assert.ok(game, 'the test hook did not run (claw-escape.js threw before its last line?)');
  for (const f of HOOK_FNS) assert.equal(typeof game[f], 'function', `hook contract (§11): claw-escape.js must define function ${f}()`);
  game.advance = (dt = STEP) => {
    now += dt * 1000;
    for (let guardN = 0; guardN < 1000; guardN++) {
      let k = -1;
      for (let i = 0; i < timers.length; i++) if (timers[i].at <= now && (k < 0 || timers[i].at < timers[k].at)) k = i;
      if (k < 0) break;
      timers.splice(k, 1)[0].fn();
    }
  };
  return { game, elements, window, document, math, calls, timers, T: window.T, html,
    requestedIds: requested, missingIds: missing, setSeed: s => { lcg = s >>> 0; }, now: () => now };
}

// ---------------------------------------------------------------------------------------------
// Helpers over the hook contract (entities, lattice, phases).
const entities = g => [...g.dolls, ...g.ducks];
const remOf = g => g.dolls.filter(d => d.state !== 'out').length;
const phaseFor = (N, rem) => rem === 2 ? 'final' : rem === 3 ? 'last3' : rem > (N >= 16 ? 5 : 6) ? 'rush' : 'main';
const tweening = e => !!(e.tw && !(e.tw.t >= e.tw.dur));
const occOf = (g, s) => {
  const o = s.occ;
  if (o == null || o === -1 || o === false) return null;
  return typeof o === 'object' ? o : entities(g).find(e => e.id === o) || null;
};
const slotOf = (g, e) => {
  const s = e.slot;
  if (s == null || s === -1 || s === false) return null;
  return typeof s === 'number' ? g.slots[s] : s;
};
const slotIndex = (g, s) => s == null || s === -1 ? -1 : typeof s === 'number' ? s : g.slots.indexOf(s);
const slotMap = g => g.slots.map(s => { const o = occOf(g, s); return o ? String(o.id) : ''; }).join('|');
const where = s => s ? `(${s.row},${s.c})` : '(no slot)';
const dispName = (T, d) => (d.isNum ? T.numName(d.name) : d.name) + (d.dup > 1 ? `(${d.dup})` : '');
const latticeCache = new WeakMap();
function lattice(g) {
  if (latticeCache.has(g.slots)) return latticeCache.get(g.slots);
  const at = new Map(g.slots.map(s => [s.row + ',' + s.c, s]));
  const get = (row, c) => at.get(row + ',' + c);
  const below = s => s.row === 0 ? []
    : (s.row % 2 ? [get(s.row - 1, s.c), get(s.row - 1, s.c + 1)] : [get(s.row - 1, s.c - 1), get(s.row - 1, s.c)]).filter(Boolean);
  const above = s => (s.row % 2 ? [get(s.row + 1, s.c), get(s.row + 1, s.c + 1)] : [get(s.row + 1, s.c - 1), get(s.row + 1, s.c)]).filter(Boolean);
  const L = { get, below, above };
  latticeCache.set(g.slots, L);
  return L;
}
const supported = (g, s) => s.row === 0 || lattice(g).below(s).every(b => occOf(g, b));
function expectedLandSlot(g, x) {
  let best = -1, bd = Infinity;
  g.slots.forEach((s, i) => {
    if (occOf(g, s) || !supported(g, s)) return;
    const d = Math.abs(s.x - x) + 0.01 * s.row;
    if (d < bd - 1e-9) { bd = d; best = i; }
  });
  return best;
}
function namesFor(n, variant = 0) {
  if (n === 12 && variant === 0) return Array(12).fill('커피');   // duplicates exercise the dup marker
  const pool = ['민수', '지영', '현우', '서연', '도윤', '하은', 'Alexander', '👨‍👩‍👧가족', '김두기', 'Zoë', '이', '박서준'];
  return Array.from({ length: n }, (_, i) => pool[i % pool.length] + (i >= pool.length ? String(1 + Math.floor(i / pool.length)) : ''));
}
function setup(L, n, names = namesFor(n)) {
  L.window.__names = names.slice(0, n);
  L.game.setupGame(n);
  L.game.state = 'playing';
}
const fmt = v => typeof v === 'number' ? (Math.round(v * 1000) / 1000).toString() : String(v);
function sameRun(a, b, message) {
  try { assert.deepEqual(a, b); } catch {
    let diff = '';
    if (a.gameT !== b.gameT) diff = `gameT ${fmt(a.gameT)} vs ${fmt(b.gameT)}`;
    else if (String(a.ranks) !== String(b.ranks)) diff = `ranks [${a.ranks}] vs [${b.ranks}]`;
    else diff = `escT [${a.escT.map(fmt)}] vs [${b.escT.map(fmt)}]`;
    assert.fail(`${message}: ${diff}`);
  }
}

// Plays the current match with the update-only loop (no step()/render()), optionally tracking pace and finals.
function playUpdateOnly(g, N, { pace = false, finals = false, each = null, label = '' } = {}) {
  let real = 0, prev = g.claw.state, updates = 0;
  const attempts = [];
  while (g.state === 'playing') {
    assert.ok(updates++ < 125 * 60, `${label || `${N} players`}: still playing after 125 s of sim time (time=${fmt(g.time)}, rem=${remOf(g)})`);
    if (pace) {
      const ts = g.presentTs();
      assert.ok(ts > 0 && Number.isFinite(ts), `presentTs() must be a positive number, got ${ts}`);
      real += STEP / ts;
    }
    g.update(STEP);
    if (finals) {
      const cs = g.claw.state;
      if (cs === 'grab' && prev !== 'grab' && remOf(g) === 2) {
        attempts.push({ golden: !!g.claw.golden, duck: !!(g.claw.target && g.claw.target.kind === 'duck'), t: g.time,
          noDollExposed: g.exposed().every(e => e.kind !== 'doll') });
      }
      prev = cs;
    }
    if (each) each(g);
  }
  return { sim: g.time, real: 2.9 + real + 0.3 + 5.2, attempts, updates };
}

// ---------------------------------------------------------------------------------------------
// §2 Full match through advance()+step() at real frame pacing.
function runMatch(options = {}, count = 12) {
  const { dt = STEP, rotate = false, names = namesFor(count), onFrame = null } = options;
  const L = loadGame(options);
  const { game: g, elements, T } = L;
  setup(L, count, names);
  const cap = Math.round(90 / dt);
  let frames = 0;
  while (g.state !== 'over' && frames < cap) {
    frames++;
    if (rotate && frames === 600) g.resize(844, 390);
    if (rotate && frames === 900) g.resize(320, 568);
    g.advance(dt); g.step();
    if (onFrame) onFrame(g, frames, L);
  }
  const seconds = frames * dt;
  const label = `${count} players, seed ${options.seed ?? 1}, ${options.width ?? 1280}×${options.height ?? 720}` +
    (options.reduced ? ', reduced motion' : '') + (dt !== STEP ? `, ${Math.round(1 / dt)} fps` : '') + (rotate ? ', rotated' : '');
  assert.equal(g.state, 'over', `${label}: match did not reach 'over' within 90 s of real frames (state=${g.state}, time=${fmt(g.time)}, rem=${remOf(g)})`);
  const ranked = g.ranked;
  assert.equal(ranked.length, count, `${label}: ranked must list all ${count} dolls, got ${ranked.length}`);
  assert.equal(new Set(ranked.map(d => d.id)).size, count, `${label}: every doll receives exactly one rank (unique ids)`);
  assert.ok(ranked.every(d => d.kind === 'doll'), `${label}: ducks never receive a rank`);
  assert.equal(g.loser, ranked[count - 1], `${label}: loser must be ranked[N−1]`);
  ranked.forEach((d, i) => assert.equal(d.rank, i + 1, `${label}: ${d.name} is ranked[${i}] but carries rank ${d.rank}`));
  for (let i = 1; i < count - 1; i++) {
    assert.ok(ranked[i].escT >= ranked[i - 1].escT, `${label}: escape times must be non-decreasing in rank order (#${i} at ${ranked[i - 1].escT}, #${i + 1} at ${ranked[i].escT})`);
  }
  const left = g.dolls.filter(d => d.state !== 'out');
  assert.equal(left.length, 1, `${label}: exactly one doll stays in the cabinet, found ${left.length}`);
  assert.equal(left[0], g.loser, `${label}: the doll left in the cabinet must be the loser`);
  const rankList = elements.get('rankList');
  assert.equal(rankList.children.length, count, `${label}: #rankList shows the full ranking 1..N (${rankList.children.length} rows)`);
  assert.ok(rankList.children.at(-1)._cls.has('loser'), `${label}: the last #rankList row needs class "loser" (got "${rankList.children.at(-1).className}")`);
  const receipt = elements.get('receiptTotal').textContent;
  assert.ok(receipt.includes(T.receiptTotal(count - 1)), `${label}: #receiptTotal must read "${T.receiptTotal(count - 1)}", got "${receipt}"`);
  const feed = elements.get('escapeFeed');
  assert.equal(feed.children.length, Math.min(3, count - 1), `${label}: #escapeFeed keeps the latest 3 rows, newest first`);
  const badge = feed.children[0].querySelector('.rankBadge') || feed.children[0].children[0] || feed.children[0];
  assert.equal(badge.textContent.trim(), T.place(count - 1), `${label}: the newest #escapeFeed row is the decisive escape ${T.place(count - 1)}`);
  const loserName = dispName(T, g.loser);
  for (const row of feed.children) {
    const strong = row.querySelector('strong');
    if (strong) assert.notEqual(strong.textContent, loserName, `${label}: the loser never appears in #escapeFeed`);
  }
  assert.ok(!elements.get('winScreen')._cls.has('hidden'), `${label}: #winScreen must be shown once the reveal ends`);
  assert.equal(elements.get('winName').textContent, loserName, `${label}: #winName shows the loser's display name`);
  // §11 asks for 18–80 s. The harness starts at 'playing' (no 2.9 s countdown), and at N=2 a doll picked on
  // final attempt 1 escapes with pS 0.10 (≈5% of matches, the "lucky first attempt" of §3.10). That path takes
  // ≈13.6–14.6 s from GO, so the floor is 12 s for 2 players. For N ≥ 3 the fastest of 400 seeds is ≥ 20.7 s.
  const floor = count === 2 ? 12 : 18;
  assert.ok(seconds >= floor && seconds <= 80, `${label}: match took ${fmt(seconds)} s of real frames, outside the ${floor}–80 s band`);
  assert.ok(g.time < 110, `${label}: sim time ${fmt(g.time)} reached the 110 s hard cap`);
  for (let i = 0; i < 20; i++) { g.advance(dt); g.step(); }   // loser portrait animates while 'over'
  g.buildShareCard(ranked); g.render();
  return {
    // Array.from builds main-realm arrays: VM arrays carry another Array.prototype and fail deepStrictEqual.
    parity: { ranks: Array.from(ranked, d => d.id), escT: Array.from(g.dolls, d => Math.round(d.escT * 1e9) / 1e9), gameT: g.time },
    seconds,
  };
}

// ---------------------------------------------------------------------------------------------
const R = { matches: 0, full: new Map(), chi2: {}, pace: {}, notes: [] };
const note = s => R.notes.push(s);

// §1 One draw.
function checkOneDraw() {
  const L = loadGame({ seed: 7, width: 390, height: 844 });
  const g = L.game;
  assert.equal(L.calls.random, 0, 'loading the page must not call Math.random (FX, bokeh and hues use fxRand)');
  for (let i = 0; i < 30; i++) { L.game.advance(); g.step(); g.render(); }
  g.resize(1280, 720); g.render(); g.resize(390, 844); g.render();
  assert.equal(L.calls.random, 0, 'rendering the menu at any viewport must not call Math.random');
  setup(L, 12);
  assert.equal(L.calls.random, 1, 'setupGame draws the sim seed with exactly one Math.random call');
  for (let i = 0; i < 600; i++) {
    g.advance(); g.step(); g.render();
    if (i === 300) g.resize(844, 390);
  }
  assert.equal(L.calls.random, 1, '600 frames of advance()+step()+render() must never call Math.random again (sim uses simRand, FX uses fxRand)');
  setup(L, 6);
  assert.equal(L.calls.random, 2, 'a replay draws exactly one new seed');
}

// §2 Full matches.
function checkFullMatches() {
  for (const [width, height] of [[1280, 720], [390, 844]]) {
    for (const count of [2, 12, 30]) for (let seed = 1; seed <= 3; seed++) {
      const out = runMatch({ width, height, seed }, count);
      R.full.set(`${count}/${seed}/${width}`, out.parity);
      R.matches++;
    }
  }
}

// §3 Parity.
function checkParity() {
  const get = (count, seed, width) => {
    const key = `${count}/${seed}/${width}`;
    if (!R.full.has(key)) { R.full.set(key, runMatch({ width, height: width === 390 ? 844 : 720, seed }, count).parity); R.matches++; }
    return R.full.get(key);
  };
  for (const count of [2, 12, 30]) for (let seed = 1; seed <= 3; seed++) {
    sameRun(get(count, seed, 390), get(count, seed, 1280), `${count} players seed ${seed}: phone 390×844 and desktop 1280×720 must give identical ranks, escape times and gameT`);
  }
  const phone = { width: 390, height: 844, seed: 2 };
  const base = get(12, 2, 390);
  const variants = [
    ['rotating to 844×390 at frame 600 and 320×568 at frame 900', { ...phone, rotate: true }],
    ['reduced motion', { ...phone, reduced: true }],
    ['30 fps (advance(1/30))', { ...phone, dt: 1 / 30 }],
    ['different player names (identity-blind sim)', { ...phone, names: namesFor(12, 1) }],
  ];
  for (const [what, opts] of variants) { sameRun(runMatch(opts, 12).parity, base, `12 players seed 2: ${what} must not change the draw`); R.matches++; }
  sameRun(runMatch({ width: 1280, height: 720, seed: 1, reduced: true, dt: 1 / 30 }, 30).parity, get(30, 1, 1280),
    '30 players seed 1: reduced motion at 30 fps must not change the draw'); R.matches++;
}

// §4 Resize purity.
function checkResizePurity() {
  const snapshot = value => {
    const seen = new Map();
    const walk = v => {
      if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
      if (typeof v === 'function') return '[fn]';
      if (v === null || typeof v !== 'object') return v;
      if (seen.has(v)) return '#ref' + seen.get(v);   // slot.occ ↔ doll.slot cycles
      seen.set(v, seen.size);
      if (Array.isArray(v)) return v.map(walk);
      const o = {};
      for (const k of Object.keys(v)) o[k] = walk(v[k]);
      return o;
    };
    return JSON.stringify(walk(value));
  };
  for (const count of [12, 30]) {
    const L = loadGame({ width: 390, height: 844, seed: 3 });
    const g = L.game;
    setup(L, count);
    for (let i = 0; i < 240; i++) { g.advance(); g.step(); }
    const sim = () => snapshot({ dolls: g.dolls, ducks: g.ducks, slots: g.slots, claw: g.claw, dir: g.dir, time: g.time });
    const before = sim();
    for (const [w, h] of [[844, 390], [390, 700], [1280, 720]]) {
      g.resize(w, h);
      assert.equal(sim(), before, `${count} players: resize(${w},${h}) changed dolls/ducks/slots/claw/dir (resize must only move the camera)`);
      g.frameCabinet(true); g.render();
      assert.equal(sim(), before, `${count} players: frameCabinet()+render() at ${w}×${h} changed sim state`);
    }
  }
}

// §5 Lattice invariants.
function latticeInvariants(g, label) {
  const owner = new Map();
  for (const e of entities(g)) {
    const s = slotOf(g, e);
    if (!s) continue;
    assert.ok(!owner.has(s), `${label}: ${owner.get(s)?.kind} ${owner.get(s)?.id} and ${e.kind} ${e.id} share slot ${where(s)}`);
    owner.set(s, e);
    assert.ok(e.state !== 'out' && e.state !== 'held', `${label}: ${e.kind} ${e.id} in state '${e.state}' still owns slot ${where(s)}`);
    assert.equal(occOf(g, s), e, `${label}: slot ${where(s)}.occ does not point back to ${e.kind} ${e.id}`);
  }
  for (const s of g.slots) {
    const o = occOf(g, s);
    if (o) assert.equal(slotOf(g, o), s, `${label}: slot ${where(s)} claims ${o.kind} ${o.id}, which sits at ${where(slotOf(g, o))}`);
  }
  for (const e of entities(g)) {
    if (e.state !== 'pile' || tweening(e)) continue;
    const s = slotOf(g, e);
    assert.ok(s, `${label}: ${e.kind} ${e.id} is in state 'pile' without a slot`);
    assert.ok(supported(g, s), `${label}: ${e.kind} ${e.id} rests unsupported at ${where(s)} with no tween`);
  }
  const rem = remOf(g), held = g.dolls.filter(d => d.state === 'held').length;
  assert.ok(held <= rem - 1, `${label}: ${held} player dolls held with only ${rem} left (claw may never take everyone)`);
  const { above } = lattice(g);
  const expected = g.slots.filter(s => occOf(g, s) && above(s).every(a => !occOf(g, a))).map(s => occOf(g, s));
  const got = g.exposed();
  const ids = list => list.map(e => String(e.id)).sort().join(',');
  assert.equal(ids(got), ids(expected), `${label}: exposed() must be exactly the slot occupants whose above-slots are empty`);
  const order = got.map(e => slotIndex(g, e.slot));
  assert.ok(order.every((v, i) => i === 0 || v > order[i - 1]), `${label}: exposed() must list candidates in slot-index order, got slots [${order}]`);
}
function checkLattice() {
  const L = loadGame({ seed: 11 });
  const g = L.game;
  for (const N of [2, 3, 4, 5, 6, 12, 14, 15, 23, 24, 30]) {
    setup(L, N, namesFor(N, 1));
    const K = Math.max(3, Math.min(5, Math.round(Math.sqrt(0.85 * N))));
    const r = Math.min(46, WORLD.PILE_W / (2 * K)), H = r * Math.sqrt(3), m = (WORLD.PILE_W - 2 * r * K) / 2;
    const ROWS = 2 * Math.ceil((N + 3) / (2 * K - 1)) + 3;
    assert.equal(g.K, K, `N=${N}: K must be clamp(round(sqrt(0.85·N)), 3, 5) = ${K}`);
    assert.ok(Math.abs(g.r - r) < 1e-9, `N=${N}: doll radius must be min(46, 256/(2K)) = ${r}, got ${g.r}`);
    let count = 0;
    for (let row = 0; row < ROWS; row++) count += row % 2 ? K - 1 : K;
    assert.equal(g.slots.length, count, `N=${N}: ${ROWS} alternating rows of K/K−1 slots = ${count} slots`);
    g.slots.forEach((s, i) => {
      assert.ok(Math.abs(s.x - (WORLD.PILE_X0 + m + r + 2 * r * s.c + (s.row % 2 ? r : 0))) < 1e-6 && Math.abs(s.y - (WORLD.FLOOR - r - s.row * H)) < 1e-6,
        `N=${N}: slot ${i} ${where(s)} sits at (${fmt(s.x)}, ${fmt(s.y)}), off the hex lattice`);
    });
    const decoys = N <= 3 ? 2 : N <= 5 ? 1 : 0;
    assert.equal(g.ducks.length, decoys, `N=${N}: ${decoys} decoy duck(s) at setup (§3.3)`);
    assert.equal(g.dolls.length, N, `N=${N}: one doll per player`);
    const occupiedRows = new Map();
    for (const e of entities(g)) {
      const s = slotOf(g, e);
      assert.ok(s && e.state === 'pile', `N=${N}: ${e.kind} ${e.id} must start in the pile with a slot`);
      assert.ok(Math.abs(e.x - s.x) < 1e-6 && Math.abs(e.y - s.y) < 1e-6, `N=${N}: ${e.kind} ${e.id} starts off its slot centre (pile is settled at t=0)`);
      occupiedRows.set(s.row, (occupiedRows.get(s.row) || 0) + 1);
    }
    const top = Math.max(...occupiedRows.keys());
    for (let row = 0; row < top; row++) {
      assert.equal(occupiedRows.get(row), row % 2 ? K - 1 : K, `N=${N}: initial fill takes whole rows bottom-up (row ${row} is not full)`);
    }
    latticeInvariants(g, `N=${N} setup`);
    for (let x = -10; x <= 380; x += 3.7) {
      assert.equal(slotIndex(g, g.landSlot(x)), expectedLandSlot(g, x), `N=${N}: landSlot(${fmt(x)}) must be the empty supported slot minimising |slot.x − x| + 0.01·row`);
    }
  }
  const runs = [[30, 1], [30, 2], [12, 3], [6, 4], [3, 5], [2, 6]];
  for (const [N, seed] of runs) {
    L.setSeed(seed); setup(L, N, namesFor(N, 1));
    playUpdateOnly(g, N, { each: gg => latticeInvariants(gg, `N=${N} seed ${seed} t=${fmt(gg.time)} claw=${gg.claw.state}`), label: `lattice N=${N}` });
    assert.equal(g.state, 'reveal', `N=${N} seed ${seed}: the update-only loop must end in 'reveal'`);
  }
}

// §6 Telegraphs: TILT (1.5 s warn), duck hatch (1.0 s), jackpot reels (1.5 s).
function checkTelegraphs() {
  const seen = { tilt: 0, duck: 0, jackpot: 0 };
  for (const seed of [1, 2, 3]) {
    const L = loadGame({ seed: 40 + seed });
    const g = L.game;
    setup(L, 12);
    g.time = 7;
    const changes = [], hops = [], prevTw = new Map();
    let map = slotMap(g), warnT = -1, jackT = -1, duckT = -1, ducks0 = g.ducks.length, duckArrive = -1, tiltN0 = g.dir.tiltN;
    let tiltNAt = -1;
    while (g.state === 'playing') {
      g.update(STEP);
      const t = g.time, m2 = slotMap(g);
      if (m2 !== map) { changes.push(t); map = m2; }
      for (const e of entities(g)) {
        const tw = e.tw, p = prevTw.get(e);
        if (tw && tw.mode === 'hop' && (!p || p.tw !== tw || tw.t < p.t || p.mode !== 'hop')) hops.push(t);
        prevTw.set(e, { tw, t: tw && tw.t, mode: tw && tw.mode });
      }
      if (warnT < 0 && g.dir.tiltWarnT0 >= 0) warnT = g.dir.tiltWarnT0;
      if (tiltNAt < 0 && g.dir.tiltN !== tiltN0) tiltNAt = t;
      // Telegraph start: dir.jackpotT0 / dir.duckT0 when the game records them, else the §3.3 dir flags.
      if (jackT < 0 && (typeof g.dir.jackpotT0 === 'number' ? g.dir.jackpotT0 >= 0 : (g.dir.jackpotDone === true || g.claw.jackpot === true))) jackT = t;
      if (duckT < 0 && (typeof g.dir.duckT0 === 'number' ? g.dir.duckT0 >= 0 : g.dir.duckMainDone === true)) duckT = t;
      if (duckArrive < 0 && duckT >= 0 && g.ducks.length > ducks0) duckArrive = t;
      assert.ok(t < 125, 'telegraph run did not finish');
    }
    const label = `12 players seed ${40 + seed}, time forced to 7`;
    const firstAfter = t0 => t0 < 0 ? NaN : changes.find(t => t >= t0 - 1e-9) - t0;
    note(`telegraph seed ${40 + seed}: TILT warn ${fmt(warnT)} → first hop +${fmt(hops.find(t => t >= warnT - 1e-9) - warnT)} s; ` +
      `jackpot ${fmt(jackT)} → grab +${fmt(firstAfter(jackT))} s; duck hatch ${fmt(duckT)} → pile change +${fmt(firstAfter(duckT))} s, duck added +${fmt(duckArrive - duckT)} s`);
    assert.ok(warnT >= 0, `${label}: the TILT warning must start (dir.tiltWarnT0 ≥ 0) once t ≥ nextTilt − 1.5 with rem ≥ 5`);
    const hop = hops.find(t => t >= warnT - 1e-9);
    assert.ok(hop !== undefined, `${label}: TILT warned at ${fmt(warnT)} but no doll ever started a 'hop' tween (tiltN changed at ${fmt(tiltNAt)})`);
    assert.ok(hop >= warnT + 1.5 - 1e-6, `${label}: TILT reshuffled the pile at t=${fmt(hop)}, only ${fmt(hop - warnT)} s after its warning (needs ≥ 1.5 s)`);
    assert.ok(hop <= warnT + 1.5 + 3 + 1e-6, `${label}: TILT must shake within 3 s after its 1.5 s warning (warned ${fmt(warnT)}, first hop ${fmt(hop)})`);
    seen.tilt++;
    if (jackT >= 0) {
      const eff = changes.find(t => t >= jackT - 1e-9);
      assert.ok(eff !== undefined, `${label}: jackpot telegraph at ${fmt(jackT)} never changed the pile`);
      assert.ok(eff >= jackT + 1.5 - 1e-6, `${label}: jackpot grabbed at t=${fmt(eff)}, only ${fmt(eff - jackT)} s after its reels started (needs ≥ 1.5 s)`);
      assert.ok(eff <= jackT + 1.5 + 3 + 1e-6, `${label}: jackpot must grab within 3 s after its 1.5 s telegraph (reels ${fmt(jackT)}, grab ${fmt(eff)})`);
      seen.jackpot++;
    }
    if (duckT >= 0) {
      const eff = changes.find(t => t >= duckT - 1e-9);
      assert.ok(duckArrive >= 0, `${label}: dir.duckMainDone set at ${fmt(duckT)} but no duck was added`);
      assert.ok(eff !== undefined && eff >= duckT + 1.0 - 1e-6, `${label}: the pile changed at t=${fmt(eff)}, only ${fmt(eff - duckT)} s after the duck hatch started blinking (needs ≥ 1.0 s)`);
      assert.ok(duckArrive >= duckT + 1.0 - 1e-6, `${label}: the duck appeared ${fmt(duckArrive - duckT)} s after the hatch started blinking (needs ≥ 1.0 s)`);
      assert.ok(eff <= duckT + 1.0 + 3 + 1e-6, `${label}: the duck must land within 3 s after the 1.0 s hatch blink`);
      seen.duck++;
    }
  }
  assert.ok(seen.jackpot > 0, 'no jackpot telegraph was observed at N=12 with time forced to 7 (err ≥ 3 should trigger it)');
  assert.ok(seen.duck > 0, 'no MAIN duck drop (§3.8 b) was observed in three N=12 matches');
}

// §7 Plans.
// Dolls the §3.6 hook rule could have rolled for this target (the game does not keep them on an empty grab).
function hookCandidates(g, N, target) {
  const ph = phaseFor(N, remOf(g));
  if (!target || target.kind !== 'doll' || (g.claw.golden && !g.claw.jackpot) || (ph !== 'rush' && ph !== 'main')) return 0;
  const S = slotOf(g, target), { above } = lattice(g);
  if (!S) return 0;
  return g.slots.filter(s => {
    const e = occOf(g, s);
    return e && e !== target && e.kind === 'doll' && Math.hypot(s.x - S.x, s.y - S.y) < 2.05 * g.r &&
      above(s).every(a => !occOf(g, a) || occOf(g, a) === target);
  }).length;
}
function checkPlans() {
  // (a) Pity rule: missStreak = 3 → golden, never a duck, target escapes, no hooks, no lip.
  const L = loadGame({ seed: 70 });
  const g = L.game;
  const cases = [...[1, 2, 3, 4, 5, 6].map(s => [4, s]), [3, 7], [12, 8], [30, 9]];
  for (const [N, seed] of cases) {
    L.setSeed(seed); setup(L, N, namesFor(N, 1));
    // Hold the streak at 3 through the IDLE intros (entering LAST3/FINAL legitimately resets it).
    let i = 0;
    while (g.state === 'playing' && g.claw.state !== 'grab' && i++ < 30 * 60) {
      if (g.claw.state === 'idle') g.dir.missStreak = 3;
      g.update(STEP);
    }
    const label = `pity rule, ${N} players seed ${seed}`;
    assert.equal(g.claw.state, 'grab', `${label}: the claw never reached GRAB`);
    const target = g.claw.target;
    assert.equal(g.claw.golden, true, `${label}: dir.missStreak = 3 must make the next cycle golden`);
    assert.equal(target.kind, 'doll', `${label}: a golden claw never targets a duck`);
    while (g.state === 'playing' && g.claw.state === 'grab') g.update(STEP);
    assert.ok(g.claw.grabbed.filter(e => e !== target).length === 0, `${label}: a golden claw takes no hooks`);
    assert.equal(target.plan, 'in', `${label}: golden plan must be a clean 'in' (pS = 1, no lip), got '${target.plan}'`);
    i = 0;
    while (g.state === 'playing' && target.state !== 'out' && i++ < 20 * 60) g.update(STEP);
    assert.equal(target.state, 'out', `${label}: the golden target must escape`);
    assert.ok(target.rank > 0, `${label}: the golden target receives a rank`);
  }

  // (b)(c)(d) Observed on natural matches: duck 'in', 'empty' grabs, slips.
  const stats = { duckIn: 0, empty: 0, emptyHooks: 0, slipLift: 0, slipCarry: 0 };
  const plan = [[2, 20], [3, 20], [30, 12], [12, 12]];
  for (const [N, matches] of plan) for (let m = 0; m < matches; m++) {
    L.setSeed(1000 + N * 97 + m); setup(L, N, namesFor(N, 1));
    let prev = g.claw.state, preGrab = null, cycle = null, hookCands = 0;
    const slips = [];
    while (g.state === 'playing') {
      const before = slotMap(g);
      for (const w of slips) if (w.e.state === 'held') {
        const xs = [w.e.x, g.claw.x], lo = Math.min(...xs) - g.r - 30, hi = Math.max(...xs) + g.r + 30;
        w.cands = new Set();
        for (let x = lo; x <= hi; x += g.r / 10) w.cands.add(slotIndex(g, g.landSlot(x)));
      }
      g.update(STEP);
      const cs = g.claw.state, label = `${N} players seed ${1000 + N * 97 + m} t=${fmt(g.time)}`;
      if (cs === 'grab' && prev !== 'grab') { preGrab = before; hookCands = hookCandidates(g, N, g.claw.target); }
      if (cs === 'lift' && prev !== 'lift' && g.claw.target) {
        const target = g.claw.target;
        cycle = { target, plan: target.plan, preGrab, miss: g.dir.missStreak, ranked: g.ranked.length, grabs: Array.from(g.dolls, d => d.grabs),
          hooks: hookCands };
        if (cycle.plan === 'empty') {
          assert.equal(slotMap(g), preGrab, `${label}: an 'empty' target plan must leave the target and every hook in its slot`);
          assert.ok(!entities(g).some(e => e.state === 'held'), `${label}: an 'empty' grab holds nothing`);
        }
        for (const e of g.claw.grabbed) {
          if (e.kind === 'doll' && (e.plan === 'slipLift' || e.plan === 'slipCarry') && e.state === 'held') slips.push({ e, plan: e.plan, slips0: e.slips, cands: null, released: false });
        }
      }
      if (cycle && prev === 'settle' && cs !== 'settle') {
        if (cycle.plan === 'empty') {
          const t = cycle.target;
          // The whiff itself picks nobody up. The pile underneath may still collapse once the claw lifts.
          assert.equal(t.state, 'pile', `${label}: after an empty grab the target is in the pile, not '${t.state}'`);
          assert.ok(slotOf(g, t), `${label}: after an empty grab the target still has a slot`);
          assert.notEqual(t.state, 'out', `${label}: an empty grab must not carry the target out`);
          assert.deepEqual(Array.from(g.dolls, d => d.grabs), cycle.grabs, `${label}: an empty grab must not count as a grab for anyone`);
          stats.empty++; if (cycle.hooks > 0) stats.emptyHooks++;
        }
        if (cycle.target.kind === 'duck' && cycle.plan === 'in') {
          assert.equal(g.ranked.length, cycle.ranked, `${label}: a duck 'in' pick must not change any rank`);
          assert.equal(g.dir.missStreak, cycle.miss, `${label}: a duck pick neither resets nor increases missStreak`);
          assert.equal(cycle.target.state, 'out', `${label}: the picked duck leaves through the chute`);
          assert.ok(!g.ranked.includes(cycle.target) && !cycle.target.rank, `${label}: a duck never gets a rank`);
          stats.duckIn++;
        }
        cycle = null;
      }
      for (let k = slips.length - 1; k >= 0; k--) {
        const w = slips[k], e = w.e;
        assert.notEqual(e.state, 'out', `${label}: doll ${e.id} with plan '${w.plan}' escaped`);
        if (!w.released && e.state !== 'held') {
          w.released = true;
          // The claw may finish LIFT/CARRY on the same tick it drops the doll, so check the state it was in.
          assert.equal(prev, w.plan === 'slipLift' ? 'lift' : 'carry', `${label}: '${w.plan}' must release during ${w.plan === 'slipLift' ? 'LIFT' : 'CARRY'}, released in '${prev}'`);
          // x ≥ 130 up to one carry step (330 u/s × sp 3 × late 1.3 at 60 Hz ≈ 21.5 u) of discrete overshoot.
          if (w.plan === 'slipCarry') assert.ok(g.claw.x >= 130 - 21.5, `${label}: slipCarry must release over the pile (claw x ≥ 130), got x=${fmt(g.claw.x)}`);
          const lx = slotOf(g, e) ? slotOf(g, e).x : e.x;
          assert.ok(lx >= WORLD.PILE_X0, `${label}: a slipped doll must land on the pile, headed for x=${fmt(lx)}`);
          const dest = slotOf(g, e);
          if (dest && w.cands) assert.ok(w.cands.has(slotIndex(g, dest)), `${label}: slip landing slot ${where(dest)} is not landSlot(x ± r) of the release point`);
          w.dest = dest;
        }
        if (w.released && e.state === 'pile' && !tweening(e)) {
          const s = slotOf(g, e);
          assert.ok(s && Math.abs(e.x - s.x) < 0.5 && Math.abs(e.y - s.y) < 0.5, `${label}: slipped doll ${e.id} must come to rest on its slot centre`);
          if (!w.dest && w.cands) assert.ok(w.cands.has(slotIndex(g, s)), `${label}: slip landed on ${where(s)}, not landSlot(x ± r) of the release point`);
          assert.equal(e.rank, 0, `${label}: a slipped doll keeps rank 0`);
          assert.equal(e.slips, w.slips0 + 1, `${label}: slips must increment once per slip`);
          stats[w.plan]++;
          slips.splice(k, 1);
        }
      }
      prev = cs;
    }
  }
  note(`plans observed: ${JSON.stringify(stats)}`);
  assert.ok(stats.duckIn > 0, 'no duck \'in\' pick was observed in 40 small matches');
  assert.ok(stats.empty > 0, 'no \'empty\' grab was observed');
  assert.ok(stats.slipLift > 0 && stats.slipCarry > 0, `both slip kinds must be observed (${stats.slipLift} slipLift, ${stats.slipCarry} slipCarry)`);
}

// §8 Final cap. Attempt k ≥ cap (4 for N<10, 3 for N≥10) is golden, and a golden claw on a doll ends the final.
// The spec's "always ends by the 4th attempt" does not follow from its own rules at N ≤ 3: with 2 dolls and
// 2 decoys (4 > K = 3, so no 탈탈 spread) a duck can cover both dolls, leaving only ducks exposed, and §3.5
// then lets the golden claw take a duck. Each such pick removes a duck, so the true bound is cap + forced picks.
function checkFinal(attempts, N, label) {
  const cap = N >= 10 ? 3 : 4;
  assert.ok(attempts.length >= 1, `${label}: the match must reach FINAL`);
  attempts.forEach((a, k) => {
    if (k + 1 >= cap) assert.ok(a.golden, `${label}: final attempt ${k + 1} must be golden (cap ${cap} for N${N >= 10 ? '≥' : '<'}10)`);
    if (a.golden && a.duck) assert.ok(a.noDollExposed, `${label}: golden attempt ${k + 1} took a duck while a doll was exposed (§3.5 drops ducks from golden candidates)`);
    if (a.golden && !a.duck) assert.equal(k, attempts.length - 1, `${label}: golden attempt ${k + 1} targeted a doll, yet the final went on`);
  });
  const forced = attempts.filter((a, k) => k + 1 >= cap && a.duck).length;
  assert.ok(attempts.length <= cap + forced, `${label}: the final took ${attempts.length} attempts; it must end by attempt ${cap}` + (forced ? ` + ${forced} forced duck pick(s)` : ''));
  return forced;
}
function checkFinalCap() {
  const L = loadGame({ seed: 80 });
  const g = L.game;
  const want = [[12, 3, 300], [4, 4, 600], [2, 4, 120], [3, 4, 120]];
  const lines = [];
  for (const [N, cap, budget] of want) {
    let reached = 0, played = 0, overruns = 0;
    for (let m = 0; m < budget && (reached < 2 || played < 40); m++) {
      L.setSeed(5000 + N * 131 + m); setup(L, N, namesFor(N, 1));
      const { attempts } = playUpdateOnly(g, N, { finals: true, label: `final cap N=${N}` });
      played++;
      const label = `${N} players seed ${5000 + N * 131 + m}`;
      overruns += checkFinal(attempts, N, label) ? 1 : 0;
      if (attempts.length >= cap) reached++;
    }
    lines.push(`N=${N}: ${reached}/${played} finals reached attempt ${cap}` + (overruns ? `, ${overruns} ran past it on forced duck picks` : ''));
    assert.ok(reached > 0, `N=${N}: no final reached attempt ${cap} in ${played} matches, so the cap was never exercised`);
  }
  note('final cap: ' + lines.join('; '));
}

// §9 Shutter guard.
function checkShutter() {
  for (const seed of [1, 2]) {
    const L = loadGame({ seed: 90 + seed });
    const g = L.game;
    setup(L, 2, ['민수', '지영']);
    for (let i = 0; i < 90; i++) g.update(STEP);
    const [a, b] = g.dolls;
    const label = `shutter guard seed ${90 + seed}`;
    assert.equal(g.state, 'playing', `${label}: the match ended before the probe`);
    for (const [e, y] of [[a, WORLD.SENSOR_Y - 0.05], [b, WORLD.SENSOR_Y - 0.1]]) {
      const s = slotOf(g, e);
      if (s) s.occ = null;
      e.slot = typeof e.slot === 'number' ? -1 : null;
      e.state = 'fall'; e.x = 48; e.y = y;
      e.tw = { x0: 48, y0: y, x1: 48, y1: WORLD.FLOOR + 40, t: 0, dur: 0.25, mode: 'fall' };
    }
    const [deep, shallow] = [a, b];
    g.update(STEP);
    const out = g.dolls.filter(d => d.state === 'out');
    assert.equal(out.length, 1, `${label}: exactly one of two dolls crossing the sensor on the same tick may escape, got ${out.length}`);
    assert.equal(out[0], deep, `${label}: the deeper doll (larger y) crosses first`);
    assert.equal(g.state, 'reveal', `${label}: rem → 1 must start the reveal on that tick`);
    assert.equal(g.loser, shallow, `${label}: the bounced doll is the loser`);
    assert.equal(shallow.rank, 2, `${label}: the loser's rank is N`);
    const s = slotOf(g, shallow);
    const back = shallow.state === 'pile' || (shallow.tw && shallow.tw.x1 >= WORLD.PILE_X0 && shallow.tw.y1 < WORLD.SENSOR_Y);
    assert.ok(back && (s ? s.x >= WORLD.PILE_X0 : true), `${label}: the second doll must be bounced back toward the pile (state '${shallow.state}')`);
  }
}

// §10 Hard cap.
function checkHardCap() {
  const L = loadGame({ seed: 100 });
  const g = L.game;
  for (const [N, seed] of [[12, 1], [30, 2], [3, 3]]) {
    L.setSeed(seed); setup(L, N, namesFor(N, 1));
    for (let i = 0; i < 12 * 60 && g.state === 'playing' && remOf(g) > 3; i++) g.update(STEP);
    for (let i = 0; i < 20 * 60 && g.state === 'playing' && !g.dolls.some(d => d.state === 'held'); i++) g.update(STEP);
    const label = `hard cap, ${N} players seed ${seed}`;
    assert.equal(g.state, 'playing', `${label}: match ended before the probe`);
    const outBefore = new Set(g.dolls.filter(d => d.state === 'out'));
    g.time = 111; g.update(STEP);
    assert.equal(g.state, 'reveal', `${label}: time > 110 must fire 영업 종료 and start the reveal on the next update (state '${g.state}')`);
    assert.deepEqual(Array.from(g.dolls, d => d.rank).sort((x, y) => x - y), Array.from({ length: N }, (_, i) => i + 1), `${label}: all ranks 1..N must be assigned`);
    assert.equal(g.ranked.length, N, `${label}: ranked lists all ${N} dolls`);
    assert.equal(g.loser.rank, N, `${label}: the loser is rank N`);
    assert.equal(g.dolls.filter(d => d.state !== 'out').length, 1, `${label}: only the loser stays in the cabinet`);
    for (const d of g.dolls) if (!outBefore.has(d) && d !== g.loser) assert.equal(d.tag, 'closing', `${label}: doll ${d.id} escaped by closing time must be tagged 'closing', got '${d.tag}'`);
  }
}

// §11 Reveal is sequenced in step().
function checkReveal() {
  const L = loadGame({ seed: 110 });
  const g = L.game, ws = L.elements.get('winScreen');
  assert.ok(ws._cls.has('hidden'), '#winScreen starts hidden');
  setup(L, 3);
  let frames = 0;
  while (g.state === 'playing' && frames++ < 90 * 60) { g.advance(); g.step(); }
  assert.equal(g.state, 'reveal', 'a match must end in the reveal state');
  assert.ok(ws._cls.has('hidden'), 'on entering reveal #winScreen is still hidden');
  const pending = L.timers.filter(t => t.fn === g.showResult || /showResult/.test(String(t.fn)));
  assert.equal(pending.length, 0, 'no setTimeout may schedule showResult (the reveal is sequenced in step())');
  let f = 0;
  while (g.state === 'reveal' && f < 7 * 60) { g.advance(); g.step(); f++; }
  assert.equal(g.state, 'over', 'the reveal must reach over');
  assert.ok(f >= Math.floor(5.2 * 60) - 2, `the reveal ended after ${fmt(f / 60)} s, before REVEAL_DUR = 5.2 s`);
  assert.ok(f <= Math.ceil(5.5 * 60) + 2, `the reveal took ${fmt(f / 60)} s, longer than 5.2 s + the 0.3 s hit-stop`);
  assert.ok(!ws._cls.has('hidden'), 'reaching over shows #winScreen');

  const M = loadGame({ seed: 111 });
  const h = M.game, ws2 = M.elements.get('winScreen');
  setup(M, 3);
  frames = 0;
  while (h.state === 'playing' && frames++ < 90 * 60) { h.advance(); h.step(); }
  for (let i = 0; i < 60; i++) { h.advance(); h.step(); }
  assert.equal(h.state, 'reveal', 'one second into the reveal the state is still reveal');
  assert.ok(h.revealT > 0.3, `revealT must advance in step() (${h.revealT})`);
  M.window.__names = namesFor(3); h.setupGame(3);
  assert.equal(h.revealT, 0, 'setupGame mid-reveal resets revealT to 0');
  assert.notEqual(h.state, 'over', 'setupGame mid-reveal must not jump to over');
  assert.ok(ws2._cls.has('hidden'), 'setupGame mid-reveal shows no overlay');
  h.state = 'playing';
  for (let i = 0; i < 6 * 60; i++) { h.advance(); h.step(); }
  assert.ok(ws2._cls.has('hidden'), 'no stale reveal beat may open the overlay after a replay');
  assert.equal(h.state, 'playing', 'the replayed match keeps playing');
}

// §12 Replay reset.
function checkReplay() {
  const L = loadGame({ seed: 120 });
  const g = L.game, T = L.T;
  setup(L, 12);
  let frames = 0;
  while (g.state === 'playing' && remOf(g) > 7 && frames++ < 60 * 60) { g.advance(); g.step(); }
  assert.ok(g.ranked.length >= 5 && L.elements.get('escapeFeed').children.length > 0, 'half a match should have produced escapes and feed rows');
  L.window.__names = namesFor(6, 1); g.setupGame(6);
  assert.equal(L.elements.get('escapeFeed').children.length, 0, 'replay clears #escapeFeed');
  assert.equal(L.elements.get('dangerChips').children.length, 0, 'replay clears #dangerChips');
  assert.ok(g.fx && Array.isArray(g.fx.events), 'fx.events must be an array (push-royale FX pattern)');
  assert.equal(g.fx.events.length, 0, 'replay clears every FX event');
  assert.equal(g.ranked.length, 0, 'replay clears the ranking');
  assert.equal(g.loser, null, 'replay clears the loser');
  assert.equal(g.claw.state, 'idle', 'replay parks the claw in idle');
  assert.equal(g.dir.tiltN, 0, 'replay resets the TILT count');
  assert.equal(g.ducks.length, 0, 'replay with 6 players has no decoy ducks');
  assert.equal(L.elements.get('cupTab').textContent, T.cups(0), `replay resets the cup tab to "${T.cups(0)}"`);
  assert.equal(g.trauma, 0, 'replay clears camera trauma');
  assert.equal(g.time, 0, 'replay resets gameT');
  assert.equal(g.revealT, 0, 'replay resets revealT');
  for (const d of g.dolls) {
    assert.ok(d.state === 'pile' && d.rank === 0 && d.grabs === 0 && d.slips === 0 && d.lipBacks === 0 && d.tag === '' && d.escT === -1,
      `replay resets doll ${d.id} (state ${d.state}, rank ${d.rank}, grabs ${d.grabs}, tag '${d.tag}', escT ${d.escT})`);
  }
  for (const [n, ducks] of [[2, 2], [3, 2], [4, 1], [5, 1], [6, 0], [30, 0]]) {
    L.window.__names = namesFor(n, 1); g.setupGame(n);
    assert.equal(g.ducks.length, ducks, `${n} players start with ${ducks} decoy duck(s)`);
  }
}

// §13 No intervention.
function keydownOwners(L) {
  return L.elements.all().concat([...L.missingIds].map(id => L.elements.get(id)))
    .filter(e => e && (e.listeners.keydown || e.listeners.keyup || e.listeners.keypress || typeof e.onkeydown === 'function' || typeof e.onkeyup === 'function'))
    .map(e => e.id || e.tagName);
}
function checkNoIntervention() {
  const L = loadGame();
  const canvas = L.elements.get('game');
  assert.deepEqual(Object.keys(canvas.listeners), [], 'the #game canvas has no pointer, touch or key listeners');
  for (const k of ['onclick', 'onpointerdown', 'onpointerup', 'onmousedown', 'ontouchstart', 'onkeydown', 'onwheel']) {
    assert.notEqual(typeof canvas[k], 'function', `the #game canvas must not set ${k}`);
  }
  assert.ok(!L.window.listeners.keydown, 'no window keydown listener: keyboard input cannot affect a draw');
  assert.deepEqual(Object.keys(L.window.listeners), ['resize'], 'window only listens to resize');
  for (const suffix of PAGES) {
    const html = read(`claw-escape${suffix}.html`);
    assert.ok(!html.includes('id="shakeBtn"'), `claw-escape${suffix}.html must not ship an intervention button`);
    assert.ok(!/\sonkey(down|up|press)=/i.test(html), `claw-escape${suffix}.html has an inline keyboard handler`);
    const P = loadGame({ page: suffix });
    assert.deepEqual(keydownOwners(P), ['nameInput'], `claw-escape${suffix}.html: #nameInput must be the only element with a keyboard handler`);
    assert.deepEqual([...P.missingIds], [], `claw-escape${suffix}.html: claw-escape.js looks up ids the page does not have: ${[...P.missingIds].join(', ')}`);
  }
}

// §14 Camera and readability.
function checkCamera() {
  const SIZES = [[320, 568], [390, 844], [844, 390], [1280, 720]];
  const L = loadGame({ width: 390, height: 844, seed: 140 });
  const g = L.game;
  setup(L, 30);
  g.frameCabinet(true); g.render();
  assert.ok(g.camera.zoom >= 0.65 && g.camera.zoom <= 0.75, `390×844 'full' zoom must be 0.65–0.75 (spec 0.71), got ${fmt(g.camera.zoom)}`);
  const onScreen = (w, h, when, withBubble) => {
    const v = g.viewport(), cam = g.camera, z = cam.zoom;
    for (const d of g.dolls.filter(d => d.state !== 'out')) {
      const x = v.x + (d.x - cam.x) * z, y = v.y + (d.y - cam.y) * z;
      assert.ok(x >= 0 && x <= w && y >= 0 && y <= h, `${when} at ${w}×${h}: doll ${d.id} is drawn off screen at (${fmt(x)}, ${fmt(y)})`);
      if (withBubble) {
        const by = v.y + (d.y - 1.1 * g.r - cam.y) * z - 18;
        assert.ok(by >= 0 && by <= h, `${when} at ${w}×${h}: doll ${d.id}'s name bubble is off screen (y=${fmt(by)})`);
      }
    }
  };
  for (const [w, h] of SIZES) { g.resize(w, h); g.frameCabinet(true); g.render(); onScreen(w, h, '30 players at the start', false); }
  g.resize(390, 844);
  while (g.state === 'playing' && remOf(g) > 6) g.update(STEP);
  assert.equal(g.state, 'playing', 'the match ended before rem ≤ 6');
  for (const [w, h] of SIZES) { g.resize(w, h); g.frameCabinet(true); g.render(); onScreen(w, h, `rem ${remOf(g)}`, true); }

  const Q = loadGame({ width: 390, height: 844, seed: 141, reduced: true });
  const q = Q.game;
  setup(Q, 30);
  q.frameCabinet(true);
  const z0 = q.camera.zoom, phases = new Set();
  let i = 0;
  while (q.state === 'playing') {
    q.update(STEP);
    const ph = phaseFor(30, remOf(q));
    if (!phases.has(ph) || i++ % 90 === 0 || q.dolls.some(d => d.state === 'teeter')) {
      phases.add(ph); q.frameCabinet(true);
      assert.equal(q.camera.zoom, z0, `reduced motion keeps one zoom in every phase (${ph} at t=${fmt(q.time)}: ${q.camera.zoom} vs ${z0})`);
    }
  }
  for (let f = 0; f < 6 * 60; f++) {
    Q.game.advance(); q.step();
    assert.equal(q.camera.zoom, z0, `reduced motion keeps one zoom through the reveal (${q.state}, zoom ${q.camera.zoom} vs ${z0})`);
  }
}

// §15 Fairness (permanent chi² test).
function checkFairness() {
  const L = loadGame({ seed: 2024 });
  const g = L.game;
  for (const [N, crit] of [[6, 20.52], [3, 13.82]]) {
    const counts = new Array(N).fill(0), c0 = L.calls.random;
    let overruns = 0;
    for (let m = 0; m < 600; m++) {
      setup(L, N, namesFor(N, 1));
      const { attempts } = playUpdateOnly(g, N, { finals: true, label: `fairness N=${N} match ${m}` });
      overruns += checkFinal(attempts, N, `fairness N=${N} match ${m}`) ? 1 : 0;
      counts[g.loser.id]++;
    }
    if (overruns) note(`fairness N=${N}: ${overruns}/600 finals ran past attempt 4 because only ducks were exposed`);
    assert.equal(L.calls.random - c0, 600, `fairness N=${N}: exactly one Math.random draw per match`);
    const E = 600 / N, chi2 = counts.reduce((a, c) => a + (c - E) ** 2 / E, 0);
    R.chi2[N] = chi2;
    note(`fairness N=${N}: losers by id [${counts}] chi²=${chi2.toFixed(2)}`);
    assert.ok(chi2 < crit, `fairness N=${N}: chi² ${chi2.toFixed(2)} ≥ ${crit} (df ${N - 1}, p = 0.999); loser counts by id [${counts}]`);
  }
}

// §16 Pace sweep.
function checkPace() {
  const L = loadGame({ seed: 160 });
  const g = L.game;
  const bands = { 2: [28, 42, 55], 12: [48, 64, 76], 30: [52, 66, 76] };
  const lines = [];
  for (const N of [2, 12, 30]) {
    const reals = [];
    for (let s = 1; s <= 40; s++) {
      L.setSeed(s); setup(L, N, namesFor(N, 1));
      reals.push(playUpdateOnly(g, N, { pace: true, label: `pace N=${N} seed ${s}` }).real);
    }
    reals.sort((a, b) => a - b);
    const median = (reals[19] + reals[20]) / 2, max = reals.at(-1), [lo, hi, cap] = bands[N];
    R.pace[N] = { median, max, min: reals[0] };
    lines.push(`N=${N} min ${reals[0].toFixed(1)} median ${median.toFixed(1)} max ${max.toFixed(1)} s`);
    assert.ok(median >= lo && median <= hi, `pace N=${N}: median real time ${median.toFixed(1)} s outside ${lo}–${hi} s (retune in claw-pace.cjs first)`);
    assert.ok(max <= cap, `pace N=${N}: slowest match ${max.toFixed(1)} s real exceeds ${cap} s`);
  }
  note('pace: ' + lines.join('; '));
}

// §17 i18n smoke.
function checkI18n() {
  const SAMPLE = { n: 11, s: 42, pct: 8, g: 3, lb: 1, name: '김두기(2)', names: '민수 · 지영 · 현우', a: '민수', b: '지영', loser: '김두기', first: '민수 · 지영 · 현우' };
  const params = fn => {
    const m = String(fn).match(/^\s*(?:function[^(]*)?\(?\s*([^()=]*?)\s*\)?\s*(?:=>|\{)/);
    return m && m[1] ? m[1].split(',').map(p => p.trim()).filter(Boolean) : [];
  };
  let koKeys = null;
  for (const suffix of PAGES) {
    const page = `claw-escape${suffix}.html`;
    const L = loadGame({ page: suffix, seed: 170 });
    const g = L.game, T = L.T;
    const keys = Object.keys(T).sort();
    if (!koKeys) koKeys = keys;
    else assert.deepEqual(keys, koKeys, `${page}: T must carry exactly the Korean key set`);
    setup(L, 2, ['민수', '지영']);
    let frames = 0;
    while (g.state !== 'over' && frames++ < 90 * 60) { g.advance(); g.step(); }
    assert.equal(g.state, 'over', `${page}: a 2-player match must reach over`);
    g.render(); g.buildShareCard(g.ranked);
    for (const [k, v] of Object.entries(T)) {
      if (typeof v === 'function') {
        const argSets = [params(v).map(p => SAMPLE[p] ?? 3)];
        if (k === 'loserStat') argSets.push([0, 0, 0]);
        for (const args of argSets) {
          const out = v(...args);
          assert.ok(typeof out === 'string' && out.trim() !== '' && !/undefined|NaN/.test(out), `${page}: T.${k}(${args.join(', ')}) must return a non-empty string, got ${JSON.stringify(out)}`);
        }
      } else if (Array.isArray(v)) {
        assert.ok(v.length > 0 && v.every(x => typeof x === 'string' && x.trim()), `${page}: T.${k} must be a non-empty list of strings`);
      } else {
        assert.ok(typeof v === 'string' && v.trim(), `${page}: T.${k} must be a non-empty string`);
      }
    }
    assert.deepEqual([...L.missingIds], [], `${page}: claw-escape.js looks up ids the page does not have: ${[...L.missingIds].join(', ')}`);
    R.matches++;
  }
}

// ---------------------------------------------------------------------------------------------
const SECTIONS = [
  [1, 'one Math.random draw per match', checkOneDraw],
  [2, 'full matches: 2/12/30 players × 3 seeds × desktop/phone', checkFullMatches],
  [3, 'parity: device, rotation, reduced motion, 30 fps, names', checkParity],
  [4, 'resize purity', checkResizePurity],
  [5, 'lattice invariants', checkLattice],
  [6, 'telegraphs: TILT, duck hatch, jackpot', checkTelegraphs],
  [7, 'plans: pity golden, duck pick, empty grab, slips', checkPlans],
  [8, 'final cap', checkFinalCap],
  [9, 'shutter guard', checkShutter],
  [10, 'hard cap', checkHardCap],
  [11, 'reveal sequenced in step()', checkReveal],
  [12, 'replay reset', checkReplay],
  [13, 'no intervention', checkNoIntervention],
  [14, 'camera and readability', checkCamera],
  [15, 'fairness chi²', checkFairness],
  [16, 'pace sweep', checkPace],
  [17, 'i18n smoke', checkI18n],
];

function check(only = []) {
  const verbose = !!process.env.CLAW_VERBOSE;
  const failures = [];
  for (const [no, title, fn] of SECTIONS) {
    if (only.length && !only.includes(no)) continue;
    const t0 = Date.now();
    try {
      fn();
      if (verbose) console.log(`ok   §${no} ${title} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    } catch (err) {
      failures.push(no);
      const where = (String(err.stack || '').split('\n').find(l => /claw-escape(-fx)?\.js:\d+/.test(l)) || '').trim();
      console.error(`FAIL §${no} ${title}: ${err.message.split('\n')[0]}${where ? `\n       ${where}` : ''}`);
      if (verbose) console.error(err.stack);
    }
  }
  if (verbose) for (const n of R.notes) console.log('  · ' + n);
  if (failures.length) {
    console.error(`Claw Escape: ${failures.length} section(s) failed: §${failures.join(', §')}`);
    process.exitCode = 1;
    return false;
  }
  const chi = Object.keys(R.chi2).length ? Object.entries(R.chi2).map(([n, c]) => `${c.toFixed(1)} (N=${n})`).join(' / ') : 'n/a';
  if (!only.length) {
    console.log(`Claw Escape: lattice, plans, telegraphed events, no intervention, parity, replay, fairness chi2=${chi}, and ${R.matches} complete matches passed.`);
  } else {
    console.log(`Claw Escape: sections §${only.join(', §')} passed.`);
  }
  return true;
}

if (require.main === module) check(process.argv.slice(2).map(Number).filter(Boolean));
module.exports = { loadGame, runMatch };
