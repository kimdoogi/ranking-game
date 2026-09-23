// Canvas-only spectacle for Claw Machine Escape. Nothing here reads or writes sim state:
// the game passes positions, strings and moods in, and every random draw uses the FX stream.
window.ClawEscapeFX = class {
  constructor(ctx, reduceMotion, rand) {
    this.ctx = ctx;
    this.reduceMotion = reduceMotion;
    this.rand = rand || (() => 0.5);
    this.events = [];      // timed shapes (rings, bursts, comic text)
    this.parts = [];       // particles (confetti, fluff, dust, coins, sparkles, tears)
    this.floaters = [];    // world-anchored text pops (max 8)
    this.clock = 0;
    this.cache = {};
  }

  clear() { this.events.length = 0; this.parts.length = 0; this.floaters.length = 0; }

  rnd(a, b) { return a + this.rand() * (b - a); }

  add(event) {
    this.events.push({ age: 0, ...event });
    if (this.events.length > 80) this.events.shift();
  }

  part(p) {
    this.parts.push(p);
    if (this.parts.length > 300) this.parts.shift();
  }

  // ---------- emitters ----------
  ring(x, y, r, color = '#fff', duration = 0.3) { this.add({ type: 'ring', x, y, r, color, duration }); }
  star(x, y, r, color = '#fff6c2', duration = 0.25) { this.add({ type: 'star', x, y, r, color, duration }); }
  burst(x, y, r, color = '#ffd23f') { this.add({ type: 'burst', x, y, r, color, duration: 0.55 }); }
  flash(x, y, w, h, color = '#ff3b5c', duration = 0.5) { this.add({ type: 'flash', x, y, w, h, color, duration }); }
  comic(x, y, text, color, size, duration = 0.7) { this.add({ type: 'comic', x, y, text, color, size, duration }); }

  float(x, y, text, color = '#fff', size = 20, big = false, oy = 0) {
    this.floaters.push({ x, y, text, color, size, big, oy, age: 0, life: big ? 1.3 : 1.0 });
    if (this.floaters.length > 8) this.floaters.shift();
  }

  confetti(x, y, n = 14, spread = 1) {
    const colors = ['#ffd23f', '#ff4d8d', '#3fd0ff', '#7dff9a', '#b58cff', '#ff9a3d'];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + this.rnd(-1.1, 1.1) * spread, sp = this.rnd(220, 480);
      this.part({ kind: 'confetti', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 900, drag: 1.6,
        life: this.rnd(0.9, 1.4), age: 0, size: this.rnd(5, 9), rot: this.rnd(0, 6.28), vr: this.rnd(-12, 12),
        color: colors[i % colors.length] });
    }
  }
  fluff(x, y, n = 6, color = '#fff') {
    for (let i = 0; i < n; i++) {
      const a = this.rnd(0, 6.28), sp = this.rnd(40, 120);
      this.part({ kind: 'fluff', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, g: -20, drag: 2.5,
        life: this.rnd(0.5, 0.8), age: 0, size: this.rnd(5, 10), color });
    }
  }
  dust(x, y, n = 4) {
    for (let i = 0; i < n; i++) {
      const s = i % 2 ? 1 : -1;
      this.part({ kind: 'dust', x: x + s * this.rnd(4, 14), y, vx: s * this.rnd(40, 90), vy: this.rnd(-40, -10), g: 0, drag: 3,
        life: this.rnd(0.4, 0.6), age: 0, size: this.rnd(8, 14), color: 'rgba(255,240,250,.8)' });
    }
  }
  coins(x, y, n = 24) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + this.rnd(-1.3, 1.3), sp = this.rnd(200, 520);
      this.part({ kind: 'coin', x: x + this.rnd(-60, 60), y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 1100, drag: 0.6,
        life: this.rnd(1.0, 1.6), age: 0, size: this.rnd(6, 9), rot: this.rnd(0, 6.28), vr: this.rnd(8, 16), color: '#ffd23f' });
    }
  }
  sparkle(x, y, color = '#ffe27a') {
    this.part({ kind: 'spark', x: x + this.rnd(-10, 10), y: y + this.rnd(-8, 8), vx: this.rnd(-30, 30), vy: this.rnd(10, 60), g: 0, drag: 1,
      life: this.rnd(0.35, 0.6), age: 0, size: this.rnd(3, 6), color });
  }
  tears(x, y, dir) {
    this.part({ kind: 'tear', x, y, vx: dir * this.rnd(60, 130), vy: this.rnd(-160, -90), g: 700, drag: 0.4,
      life: 0.7, age: 0, size: this.rnd(2.5, 4), color: '#8fd8ff' });
  }

  update(dt) {
    this.clock += dt;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      e.age += dt;
      if (e.age >= e.duration) this.events.splice(i, 1);
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) { this.parts.splice(i, 1); continue; }
      if (this.reduceMotion && (p.kind === 'confetti' || p.kind === 'tear' || p.kind === 'coin')) continue;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy = p.vy * d + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.rot !== undefined) p.rot += p.vr * dt;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      if (f.age >= f.life) this.floaters.splice(i, 1);
    }
  }

  // World-space particles and timed shapes.
  draw(c, zoom) {
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const p of this.parts) {
      const t = p.age / p.life, a = 1 - t;
      c.globalAlpha = Math.max(0, Math.min(1, a * 1.4));
      c.fillStyle = p.color;
      if (p.kind === 'confetti') {
        c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
        c.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6); c.restore();
      } else if (p.kind === 'coin') {
        const w = Math.max(0.5, Math.abs(Math.cos(p.rot)) * p.size);
        c.beginPath(); c.ellipse(p.x, p.y, w, p.size, 0, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#b8860b'; c.lineWidth = 1.5; c.stroke();
      } else if (p.kind === 'spark') {
        const s = p.size * (1 - t * 0.5);
        c.beginPath();
        c.moveTo(p.x, p.y - s); c.lineTo(p.x + s * 0.3, p.y - s * 0.3); c.lineTo(p.x + s, p.y);
        c.lineTo(p.x + s * 0.3, p.y + s * 0.3); c.lineTo(p.x, p.y + s); c.lineTo(p.x - s * 0.3, p.y + s * 0.3);
        c.lineTo(p.x - s, p.y); c.lineTo(p.x - s * 0.3, p.y - s * 0.3); c.closePath(); c.fill();
      } else {
        const grow = p.kind === 'dust' ? 1 + t * 1.2 : p.kind === 'fluff' ? 1 + t * 0.4 : 1;
        c.beginPath(); c.arc(p.x, p.y, Math.max(0.1, p.size * grow * (p.kind === 'tear' ? 1 : 0.6)), 0, Math.PI * 2); c.fill();
      }
    }
    for (const e of this.events) {
      const t = e.age / e.duration;
      c.globalAlpha = Math.max(0, 1 - t);
      if (e.type === 'ring') {
        c.strokeStyle = e.color; c.lineWidth = 3 * (1 - t) + 1;
        c.beginPath(); c.arc(e.x, e.y, Math.max(0.1, e.r * (this.reduceMotion ? 1 : 0.4 + t * 0.9)), 0, Math.PI * 2); c.stroke();
      } else if (e.type === 'star' && !this.reduceMotion) {
        c.fillStyle = e.color;
        const r = e.r * (0.6 + t * 0.8);
        c.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = i * Math.PI / 8, len = i % 2 ? r * 0.3 : r;
          c.lineTo(e.x + Math.cos(a) * len, e.y + Math.sin(a) * len);
        }
        c.closePath(); c.fill();
      } else if (e.type === 'burst') {
        c.fillStyle = e.color;
        const r = e.r * (this.reduceMotion ? 1 : 0.5 + Math.sqrt(t) * 1.1);
        c.beginPath();
        for (let i = 0; i < 20; i++) {
          const a = i * Math.PI / 10, len = i % 2 ? r * 0.45 : r;
          c.lineTo(e.x + Math.cos(a) * len, e.y + Math.sin(a) * len);
        }
        c.closePath(); c.fill();
        c.fillStyle = '#fffbe6'; c.beginPath(); c.arc(e.x, e.y, r * 0.35, 0, Math.PI * 2); c.fill();
      } else if (e.type === 'flash') {
        c.strokeStyle = e.color; c.lineWidth = 4; c.fillStyle = e.color;
        c.globalAlpha = this.reduceMotion ? 0.8 : Math.max(0, 1 - t) * (0.6 + 0.4 * Math.sin(e.age * 40));
        c.strokeRect(e.x - 3, e.y - 3, e.w + 6, e.h + 6);
        c.globalAlpha *= 0.35; c.fillRect(e.x, e.y, e.w, e.h);
      } else if (e.type === 'comic') {
        const pop = this.reduceMotion ? 1 : t < 0.18 ? 0.6 + t / 0.18 * 0.6 : 1.2 - Math.min(0.2, (t - 0.18));
        c.save(); c.translate(e.x, e.y - (this.reduceMotion ? 0 : t * 16)); c.scale(pop, pop); c.rotate(-0.12);
        c.font = `900 ${e.size / zoom}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = 5 / zoom; c.strokeStyle = '#2a0f2e'; c.strokeText(e.text, 0, 0);
        c.fillStyle = e.color; c.fillText(e.text, 0, 0);
        c.restore();
      }
    }
    c.restore();
  }

  // Floaters are drawn by the game in screen space (fixed pixel size).
  // ---------- drawing primitives ----------
  // A plush doll: one round body/head, species ears, a face that reads the mood, belly ribbon label.
  doll(c, x, y, r, o) {
    const h = o.hue, rm = this.reduceMotion;
    const fill = `hsl(${h},70%,74%)`, line = `hsl(${h},60%,45%)`, deep = `hsl(${h},55%,38%)`;
    c.save();
    c.translate(x, y);
    if (o.rot) c.rotate(o.rot);
    if (o.sq) c.scale(1 + o.sq, 1 - o.sq);
    if (o.alpha !== undefined) c.globalAlpha = o.alpha;
    c.lineJoin = 'round'; c.lineCap = 'round';
    const lw = Math.max(1.6, r * 0.065);
    c.lineWidth = lw; c.strokeStyle = line;
    const sp = o.species, mini = !!o.mini;

    // feet + arms: one darker path (no per-limb strokes)
    const up = o.arms || 0, fl = o.flail || 0;
    if (!mini) {
      c.fillStyle = sp === 4 ? '#ffb347' : line;
      c.beginPath();
      c.ellipse(-r * 0.42, r * 0.9, r * 0.27, r * 0.15, 0, 0, Math.PI * 2);
      c.moveTo(r * 0.69, r * 0.9);
      c.ellipse(r * 0.42, r * 0.9, r * 0.27, r * 0.15, 0, 0, Math.PI * 2);
      for (const s of [-1, 1]) {
        const ang = s * (0.35 + up * 2.2 + (s < 0 ? fl : -fl) * 0.6);
        const ax = s * r * (0.9 - up * 0.1), ay = r * (0.2 - up * 0.55);
        const ex = ax - Math.sin(ang) * r * 0.12, ey = ay + Math.cos(ang) * r * 0.12;
        c.moveTo(ex + r * 0.22, ey);
        c.ellipse(ex, ey, r * 0.2, r * 0.31, ang, 0, Math.PI * 2);
      }
      c.fill();
    }

    // body + ears share one fill and one outline (the ear seams read as plush stitching)
    c.fillStyle = fill;
    c.beginPath();
    if (sp === 0) {           // bear
      c.arc(-r * 0.62, -r * 0.7, r * 0.3, 0, Math.PI * 2); c.moveTo(r * 0.92, -r * 0.7); c.arc(r * 0.62, -r * 0.7, r * 0.3, 0, Math.PI * 2);
    } else if (sp === 1) {    // bunny
      c.ellipse(-r * 0.34, -r * 1.02, r * 0.17, r * 0.5, -0.18, 0, Math.PI * 2);
      c.moveTo(r * 0.51, -r * 1.02);
      c.ellipse(r * 0.34, -r * 1.02, r * 0.17, r * 0.5, 0.18, 0, Math.PI * 2);
    } else if (sp === 2 || sp === 6) {   // cat (pointy) / pig (floppy)
      const tip = sp === 2 ? 1.12 : 0.98;
      c.moveTo(-r * 0.82, -r * 0.42); c.lineTo(-r * 0.66, -r * tip); c.lineTo(-r * 0.2, -r * 0.9); c.closePath();
      c.moveTo(r * 0.82, -r * 0.42); c.lineTo(r * 0.66, -r * tip); c.lineTo(r * 0.2, -r * 0.9); c.closePath();
    } else if (sp === 3) {    // frog eye bumps
      c.arc(-r * 0.4, -r * 0.74, r * 0.32, 0, Math.PI * 2); c.moveTo(r * 0.72, -r * 0.74); c.arc(r * 0.4, -r * 0.74, r * 0.32, 0, Math.PI * 2);
    } else if (sp === 5) {    // chick tuft
      c.moveTo(0, -r * 0.92); c.quadraticCurveTo(-r * 0.2, -r * 1.35, r * 0.06, -r * 1.28);
      c.quadraticCurveTo(r * 0.04, -r * 1.1, 0, -r * 0.92);
      c.moveTo(r * 0.05, -r * 0.94); c.quadraticCurveTo(r * 0.36, -r * 1.3, r * 0.3, -r * 1.05); c.closePath();
    }
    c.moveTo(r, 0); c.arc(0, 0, r, 0, Math.PI * 2);
    // stroke first at double width, then fill: only the outer silhouette keeps an outline
    c.lineWidth = lw * 2; c.stroke(); c.lineWidth = lw;
    c.fill();
    if (sp === 1 && !mini) {
      c.fillStyle = '#ffb6cf';
      c.beginPath();
      c.ellipse(-r * 0.34, -r * 1.0, r * 0.08, r * 0.34, -0.18, 0, Math.PI * 2);
      c.moveTo(r * 0.42, -r * 1.0);
      c.ellipse(r * 0.34, -r * 1.0, r * 0.08, r * 0.34, 0.18, 0, Math.PI * 2);
      c.fill();
    }
    if (mini) {   // shelf dolls: eyes + grin only
      c.fillStyle = '#2b1830';
      const ey = sp === 3 ? -r * 0.74 : -r * 0.2, ex = sp === 3 ? r * 0.4 : r * 0.34;
      c.beginPath(); c.arc(-ex, ey, r * 0.12, 0, Math.PI * 2); c.moveTo(ex + r * 0.12, ey); c.arc(ex, ey, r * 0.12, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#2b1830'; c.lineWidth = Math.max(1, r * 0.08);
      c.beginPath(); c.arc(0, r * 0.08, r * 0.2, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
      c.restore();
      return;
    }

    // penguin belly / face patch
    if (sp === 4) {
      c.fillStyle = '#fffaf4';
      c.beginPath(); c.ellipse(0, r * 0.12, r * 0.66, r * 0.72, 0, 0, Math.PI * 2); c.fill();
    }
    // plush highlight
    c.fillStyle = 'rgba(255,255,255,.32)';
    c.beginPath(); c.ellipse(-r * 0.38, -r * 0.5, r * 0.26, r * 0.15, -0.5, 0, Math.PI * 2); c.fill();

    // belly ribbon (clipped to the body)
    const band = o.label ? Math.max(r * 0.42, (o.font || 10) * 1.22) : r * 0.3;
    const by = Math.min(r * 0.46, r - band * 0.62);
    c.save();
    c.beginPath(); c.arc(0, 0, r - lw * 0.5, 0, Math.PI * 2); c.clip();
    c.fillStyle = o.ribbon || line;
    c.fillRect(-r, by - band / 2, r * 2, band);
    c.restore();

    // face
    const frog = sp === 3;
    const ey = frog ? -r * 0.74 : -r * 0.2, ex = frog ? r * 0.4 : r * 0.34;
    const er = r * (frog ? 0.17 : 0.15), pr = r * 0.085;
    const lx = (o.look ? o.look.x : 0) * er * 0.35, ly = (o.look ? o.look.y : 0) * er * 0.35;
    const face = o.face || 'smile';
    const dark = '#2b1830';
    if (face === 'sparkle') {
      c.fillStyle = '#fff36b'; c.strokeStyle = '#b8860b'; c.lineWidth = Math.max(0.8, r * 0.025);
      for (const s of [-1, 1]) {
        const cx = s * ex, s1 = er * 1.5, s2 = er * 0.5;
        c.beginPath();
        c.moveTo(cx, ey - s1); c.lineTo(cx + s2, ey - s2); c.lineTo(cx + s1, ey); c.lineTo(cx + s2, ey + s2);
        c.lineTo(cx, ey + s1); c.lineTo(cx - s2, ey + s2); c.lineTo(cx - s1, ey); c.lineTo(cx - s2, ey - s2); c.closePath();
        c.fill(); c.stroke();
      }
    } else if (face === 'cry' || face === 'blink' || face === 'happy') {
      c.strokeStyle = dark; c.lineWidth = Math.max(1.2, r * 0.07);
      c.beginPath();
      for (const s of [-1, 1]) {
        if (face === 'blink') { c.moveTo(s * ex - er, ey); c.lineTo(s * ex + er, ey); }
        else if (face === 'happy') { c.moveTo(s * ex - er, ey + er * 0.3); c.quadraticCurveTo(s * ex, ey - er * 1.3, s * ex + er, ey + er * 0.3); }
        else { c.moveTo(s * ex - er, ey - er * 0.6); c.lineTo(s * ex + er * 0.2 * s, ey); c.lineTo(s * ex - er, ey + er * 0.6); }
      }
      c.stroke();
    } else {
      const big = face === 'teary' ? 1.3 : 1;
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(-ex, ey, er * big, 0, Math.PI * 2); c.moveTo(ex + er * big, ey); c.arc(ex, ey, er * big, 0, Math.PI * 2); c.fill();
      c.fillStyle = o.glow ? '#fff38a' : dark;
      c.beginPath(); c.arc(-ex + lx, ey + ly, pr * big, 0, Math.PI * 2); c.arc(ex + lx, ey + ly, pr * big, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(-ex + lx - pr * 0.35, ey + ly - pr * 0.4, pr * 0.35 * big, 0, Math.PI * 2);
      c.arc(ex + lx - pr * 0.35, ey + ly - pr * 0.4, pr * 0.35 * big, 0, Math.PI * 2); c.fill();
      if (face === 'teary') {
        c.strokeStyle = '#6cc8ff'; c.lineWidth = Math.max(1, r * 0.05);
        c.beginPath(); c.arc(-ex, ey, er * 1.3, 0.3, Math.PI - 0.3); c.moveTo(ex + er * 1.3 * Math.cos(0.3), ey + er * 1.3 * Math.sin(0.3));
        c.arc(ex, ey, er * 1.3, 0.3, Math.PI - 0.3); c.stroke();
      }
      if (face === 'sad') {
        c.strokeStyle = dark; c.lineWidth = Math.max(1, r * 0.045);
        c.beginPath();
        c.moveTo(-ex - er, ey - er * 1.5); c.lineTo(-ex + er * 0.8, ey - er * 2.1);
        c.moveTo(ex + er, ey - er * 1.5); c.lineTo(ex - er * 0.8, ey - er * 2.1); c.stroke();
      }
    }
    // blush
    c.fillStyle = 'rgba(255,110,150,.45)';
    c.beginPath(); c.ellipse(-r * 0.58, r * 0.02, r * 0.13, r * 0.08, 0, 0, Math.PI * 2);
    c.ellipse(r * 0.58, r * 0.02, r * 0.13, r * 0.08, 0, 0, Math.PI * 2); c.fill();

    // pig snout / penguin beak sit under the eyes
    let my = r * 0.06;
    if (sp === 6) {
      c.fillStyle = `hsl(${h},70%,82%)`; c.strokeStyle = line; c.lineWidth = Math.max(1, r * 0.04);
      c.beginPath(); c.ellipse(0, r * 0.02, r * 0.24, r * 0.16, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = deep;
      c.beginPath(); c.arc(-r * 0.08, r * 0.02, r * 0.04, 0, Math.PI * 2); c.arc(r * 0.08, r * 0.02, r * 0.04, 0, Math.PI * 2); c.fill();
      my = r * 0.21;
    } else if (sp === 4) {
      c.fillStyle = '#ffb347';
      c.beginPath(); c.moveTo(-r * 0.12, -r * 0.02); c.lineTo(r * 0.12, -r * 0.02); c.lineTo(0, r * 0.12); c.closePath(); c.fill();
      my = r * 0.17;
    }

    // mouth
    c.strokeStyle = dark; c.fillStyle = dark; c.lineWidth = Math.max(1.1, r * 0.055);
    const mw = r * 0.13;
    c.beginPath();
    if (face === 'smile') { c.arc(0, my - mw * 0.4, mw, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke(); }
    else if (face === 'flat') { c.moveTo(-mw, my); c.lineTo(mw, my); c.stroke(); }
    else if (face === 'wavy' || face === 'teary') {
      c.moveTo(-mw * 1.2, my);
      for (let i = 1; i <= 4; i++) c.lineTo(-mw * 1.2 + i * mw * 0.6, my + (i % 2 ? -mw * 0.35 : mw * 0.35));
      c.stroke();
    } else if (face === 'sad') { c.arc(0, my + mw * 0.9, mw, 1.2 * Math.PI, 1.8 * Math.PI); c.stroke(); }
    else if (face === 'o') { c.ellipse(0, my + mw * 0.2, mw * 0.55, mw * 0.75, 0, 0, Math.PI * 2); c.fill(); }
    else if (face === 'gulp') { c.ellipse(0, my, mw * 0.8, mw * 0.3, 0, 0, Math.PI * 2); c.fill(); }
    else if (face === 'cry') {
      c.ellipse(0, my + mw * 0.3, mw * 1.35, mw * 1.0, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ff7892'; c.beginPath(); c.ellipse(0, my + mw * 0.85, mw * 0.7, mw * 0.4, 0, 0, Math.PI * 2); c.fill();
    } else {   // happy / sparkle: open grin
      c.moveTo(-mw * 1.1, my - mw * 0.2); c.quadraticCurveTo(0, my + mw * 2, mw * 1.1, my - mw * 0.2); c.closePath(); c.fill();
      c.fillStyle = '#ff7892'; c.beginPath(); c.ellipse(0, my + mw * 0.6, mw * 0.5, mw * 0.3, 0, 0, Math.PI * 2); c.fill();
    }
    // tear streams (static strokes; particles add motion)
    if (face === 'cry') {
      c.strokeStyle = 'rgba(120,205,255,.9)'; c.lineWidth = Math.max(1.5, r * 0.09);
      c.beginPath(); c.moveTo(-ex, ey + er * 0.8); c.lineTo(-ex - r * 0.05, ey + r * 0.55);
      c.moveTo(ex, ey + er * 0.8); c.lineTo(ex + r * 0.05, ey + r * 0.55); c.stroke();
    }
    if (o.sweat) {
      c.fillStyle = '#9ee0ff'; c.strokeStyle = '#3aa0d8'; c.lineWidth = Math.max(0.8, r * 0.025);
      const sx = r * 0.72, sy = -r * 0.52 + (rm ? 0 : Math.sin(this.clock * 6) * r * 0.03);
      c.beginPath(); c.moveTo(sx, sy - r * 0.2);
      c.quadraticCurveTo(sx + r * 0.13, sy, sx, sy + r * 0.08); c.quadraticCurveTo(sx - r * 0.13, sy, sx, sy - r * 0.2);
      c.fill(); c.stroke();
    }

    // belly label (screen-px font passed in world units by the caller)
    if (o.label) {
      c.font = `900 ${o.font}px sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = o.stroke || 3; c.strokeStyle = 'rgba(30,10,30,.85)';
      c.strokeText(o.label, 0, by + o.font * 0.04, r * 1.8);
      c.fillStyle = '#fff';
      c.fillText(o.label, 0, by + o.font * 0.04, r * 1.8);
    }
    c.restore();
  }

  // Yellow rubber duck decoy ("dud").
  duck(c, x, y, r, o = {}) {
    c.save(); c.translate(x, y);
    if (o.rot) c.rotate(o.rot);
    if (o.sq) c.scale(1 + o.sq, 1 - o.sq);
    c.lineJoin = 'round';
    c.lineWidth = Math.max(1.5, r * 0.06); c.strokeStyle = '#c98a00'; c.fillStyle = '#ffd84a';
    c.beginPath(); c.ellipse(0, r * 0.25, r, r * 0.72, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(r * 0.85, r * 0.05); c.quadraticCurveTo(r * 1.25, -r * 0.2, r * 1.05, r * 0.3); c.fill(); c.stroke();
    c.beginPath(); c.arc(-r * 0.25, -r * 0.45, r * 0.52, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#ff8a1f'; c.strokeStyle = '#c75a00';
    c.beginPath(); c.ellipse(-r * 0.82, -r * 0.36, r * 0.3, r * 0.13, 0.15, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#2b1830';
    c.beginPath(); c.arc(-r * 0.4, -r * 0.55, r * 0.09, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(-r * 0.42, -r * 0.58, r * 0.035, 0, Math.PI * 2); c.fill();
    // "dud" sign on the chest
    c.fillStyle = '#fff'; c.strokeStyle = '#e0283f'; c.lineWidth = Math.max(1, r * 0.05);
    c.beginPath(); c.rect(-r * 0.05, r * 0.08, r * 0.62, r * 0.46); c.fill(); c.stroke();
    c.lineWidth = Math.max(1.2, r * 0.08);
    c.beginPath(); c.moveTo(r * 0.1, r * 0.17); c.lineTo(r * 0.42, r * 0.45); c.moveTo(r * 0.42, r * 0.17); c.lineTo(r * 0.1, r * 0.45); c.stroke();
    c.restore();
  }

  // The claw: rail carriage, cable, hub and three prongs.
  claw(c, o) {
    const { x, railY, hubY, r } = o;
    const gold = o.gold, rm = this.reduceMotion;
    const hx = x + (o.sway || 0);
    // cable
    c.strokeStyle = '#1d1a2a'; c.lineWidth = 3.2;
    c.beginPath(); c.moveTo(x, railY + 10);
    c.quadraticCurveTo(x + (o.sway || 0) * 0.2, (railY + hubY) / 2, hx, hubY - 12); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 1; c.stroke();
    // carriage
    const g1 = c.createLinearGradient(0, railY - 12, 0, railY + 12);
    g1.addColorStop(0, gold ? '#fff2a8' : '#e6ecf7'); g1.addColorStop(1, gold ? '#c98a12' : '#6d7894');
    c.fillStyle = g1; c.strokeStyle = '#1d1a2a'; c.lineWidth = 2;
    c.beginPath(); c.rect(x - 26, railY - 11, 52, 22); c.fill(); c.stroke();
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x - 20, railY + 4, 40, 4);
    c.fillStyle = o.led || '#3dff8a';
    c.beginPath(); c.arc(x + 15, railY - 2, 3.6, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 0.35; c.beginPath(); c.arc(x + 15, railY - 2, 7, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
    // prongs
    const open = 0.95, closed = o.holding ? 0.5 : 0.14;
    const a = open + (closed - open) * Math.max(0, Math.min(1, o.prong));
    const L1 = r * 0.62 + 8, L2 = r * 0.62 + 6;
    const metal = gold ? '#ffd23f' : '#c3cbe0', edge = gold ? '#8a5a00' : '#2c2f3f';
    const prong = (side, alpha) => {
      const px = hx + side * 11, py = hubY + 3;
      const kx = px + side * Math.sin(a) * L1, ky = py + Math.cos(a) * L1;
      const b = a - 1.35;
      const tx = kx + side * Math.sin(b) * L2, ty = ky + Math.cos(b) * L2;
      c.globalAlpha = alpha;
      c.beginPath(); c.moveTo(px, py); c.lineTo(kx, ky); c.lineTo(tx, ty);
      c.lineTo(tx - side * 5, ty - 3);
      c.strokeStyle = edge; c.lineWidth = 7; c.stroke();
      c.strokeStyle = metal; c.lineWidth = 3.6; c.stroke();
      c.globalAlpha = 1;
      return { tx, ty };
    };
    c.lineCap = 'round'; c.lineJoin = 'round';
    // back prong (thin, straight-ish)
    c.globalAlpha = 0.7;
    c.beginPath(); c.moveTo(hx, hubY + 3); c.lineTo(hx, hubY + 3 + (L1 + L2 * 0.6) * (0.75 + 0.25 * Math.cos(a)));
    c.strokeStyle = edge; c.lineWidth = 6; c.stroke(); c.strokeStyle = metal; c.lineWidth = 3; c.stroke();
    c.globalAlpha = 1;
    if (o.inner) o.inner();   // held dolls hang between the back prong and the front prongs
    const tl = prong(-1, 1), tr = prong(1, 1);
    // hub
    const g2 = c.createLinearGradient(hx - 18, 0, hx + 18, 0);
    g2.addColorStop(0, gold ? '#b37400' : '#59627a'); g2.addColorStop(0.45, gold ? '#fff0a0' : '#f1f4fb'); g2.addColorStop(1, gold ? '#b37400' : '#59627a');
    c.fillStyle = g2; c.strokeStyle = '#1d1a2a'; c.lineWidth = 2;
    c.beginPath(); c.rect(hx - 17, hubY - 14, 34, 18); c.fill(); c.stroke();
    c.beginPath(); c.arc(hx, hubY + 4, 7, 0, Math.PI); c.fill(); c.stroke();
    if (gold && !rm) {
      c.globalAlpha = 0.5 + 0.3 * Math.sin(this.clock * 12);
      c.fillStyle = '#fff6c2';
      c.beginPath(); c.arc(hx - 9, hubY - 8, 2.5, 0, Math.PI * 2); c.arc(hx + 10, hubY - 4, 2, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
    }
    return { tl, tr, hx };
  }

  // Cached back wall: pink→violet with a star wallpaper. Rebuilt per zoom/DPR bucket.
  backWall(c, x, y, w, h, scale) {
    const key = Math.round(scale * 4) / 4;
    let cv = this.cache.wall;
    if (!cv || cv._key !== key) {
      cv = null;
      try {
        cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * key)); cv.height = Math.max(1, Math.round(h * key));
        const g = cv.getContext('2d');
        g.setTransform(key, 0, 0, key, 0, 0);
        const bg = g.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#3b1d5e'); bg.addColorStop(0.55, '#6a2a78'); bg.addColorStop(1, '#b0427f');
        g.fillStyle = bg; g.fillRect(0, 0, w, h);
        // star wallpaper — a fixed lattice (no randomness needed)
        g.fillStyle = 'rgba(255,220,250,.12)';
        for (let yy = 18, row = 0; yy < h; yy += 44, row++) {
          for (let xx = (row % 2) * 22 + 12; xx < w; xx += 44) {
            const s = 5 + ((xx * 7 + yy * 3) % 4);
            g.beginPath();
            for (let i = 0; i < 10; i++) {
              const ang = -Math.PI / 2 + i * Math.PI / 5, len = i % 2 ? s * 0.45 : s;
              g.lineTo(xx + Math.cos(ang) * len, yy + Math.sin(ang) * len);
            }
            g.closePath(); g.fill();
          }
        }
        // soft top glow
        const tg = g.createRadialGradient(w * 0.6, 0, 10, w * 0.6, 0, h * 0.7);
        tg.addColorStop(0, 'rgba(255,200,255,.28)'); tg.addColorStop(1, 'rgba(255,200,255,0)');
        g.fillStyle = tg; g.fillRect(0, 0, w, h);
        cv._key = key;
      } catch (e) { cv = null; }
      this.cache.wall = cv;
    }
    if (cv) c.drawImage(cv, x, y, w, h);
    else { c.fillStyle = '#5a2470'; c.fillRect(x, y, w, h); }
  }

  // Dot-mask pattern for the LED marquee (built once).
  dotMask(c) {
    if (this.cache.dots === undefined) {
      this.cache.dots = null;
      try {
        const cv = document.createElement('canvas');
        cv.width = 4; cv.height = 4;
        const g = cv.getContext('2d');
        g.fillStyle = 'rgba(0,0,0,.32)'; g.fillRect(0, 0, 4, 4);
        g.clearRect(1, 1, 2, 2);
        this.cache.dots = c.createPattern(cv, 'repeat') || null;
      } catch (e) { this.cache.dots = null; }
    }
    return this.cache.dots;
  }

  // Results portrait / share card: the crying loser holding a tray of paper cups.
  loserDoll(c, x, y, s, t, d) {
    c.save();
    this.loserDollInner(c, x, y, s, t, d);
    c.restore();
  }
  loserDollInner(c, x, y, s, t, d) {
    const rm = this.reduceMotion || d.still;
    const bob = rm ? 0 : Math.sin(t * 5) * s * 0.03;
    // spotlight
    const sg = c.createRadialGradient(x, y + s * 0.9, s * 0.1, x, y + s * 0.9, s * 1.8);
    sg.addColorStop(0, 'rgba(255,236,200,.35)'); sg.addColorStop(1, 'rgba(255,236,200,0)');
    c.fillStyle = sg; c.beginPath(); c.ellipse(x, y + s * 0.95, s * 1.8, s * 0.5, 0, 0, Math.PI * 2); c.fill();
    this.doll(c, x, y + bob, s, { hue: d.hue, species: d.species, face: 'cry', arms: 0.35, sq: rm ? 0 : Math.sin(t * 10) * 0.015 });
    // tray + cups held low in front of the belly (never over the face)
    const ty = y + s * 0.62 + bob, tw = s * 2.0;
    const n = Math.max(1, d.cups || 1), shown = Math.min(7, n);
    const cw = Math.min(s * 0.24, (tw * 0.9) / shown), ch = cw * 1.15;
    // little arms holding the tray
    c.fillStyle = `hsl(${d.hue},70%,74%)`; c.strokeStyle = `hsl(${d.hue},60%,45%)`; c.lineWidth = Math.max(1.5, s * 0.05);
    c.beginPath(); c.ellipse(x - tw * 0.46, ty - s * 0.04, s * 0.17, s * 0.12, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(x + tw * 0.46, ty - s * 0.04, s * 0.17, s * 0.12, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    for (let i = 0; i < shown; i++) {
      const cx = x - (shown - 1) * cw * 0.5 + i * cw, cy = ty - s * 0.02;
      c.fillStyle = '#fffaf0'; c.strokeStyle = '#6b4128'; c.lineWidth = Math.max(1, s * 0.018);
      c.beginPath(); c.moveTo(cx - cw * 0.42, cy - ch); c.lineTo(cx + cw * 0.42, cy - ch);
      c.lineTo(cx + cw * 0.32, cy); c.lineTo(cx - cw * 0.32, cy); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#c2410c'; c.fillRect(cx - cw * 0.37, cy - ch * 0.62, cw * 0.72, ch * 0.24);
      c.fillStyle = '#3b2417'; c.fillRect(cx - cw * 0.46, cy - ch - cw * 0.12, cw * 0.92, cw * 0.14);
      if (!rm) {   // steam
        c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = Math.max(1, s * 0.02);
        const ph = t * 2 + i;
        c.beginPath(); c.moveTo(cx, cy - ch - cw * 0.2);
        c.quadraticCurveTo(cx + Math.sin(ph) * cw * 0.3, cy - ch - cw * 0.55, cx, cy - ch - cw * 0.9); c.stroke();
      }
    }
    c.fillStyle = '#8b5a3c'; c.strokeStyle = '#3b2417'; c.lineWidth = Math.max(1.5, s * 0.03);
    c.beginPath(); c.ellipse(x, ty + s * 0.02, tw / 2, s * 0.09, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    if (n > shown) {
      c.font = `900 ${Math.max(10, s * 0.2)}px sans-serif`; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.lineWidth = Math.max(2, s * 0.04); c.strokeStyle = '#3b2417'; c.fillStyle = '#ffe9c7';
      c.strokeText('+' + (n - shown), x + tw / 2 + s * 0.06, ty); c.fillText('+' + (n - shown), x + tw / 2 + s * 0.06, ty);
    }
    // animated tear fountains
    if (!rm) {
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const ph = (t * 1.6 + k / 3 + (side > 0 ? 0.5 : 0)) % 1;
          const px = x + side * (s * 0.34 + ph * s * 0.7), py = y - s * 0.2 + bob - Math.sin(ph * Math.PI) * s * 0.35 + ph * s * 0.3;
          c.globalAlpha = 1 - ph; c.fillStyle = '#8fd8ff';
          c.beginPath(); c.arc(px, py, Math.max(1, s * 0.05 * (1 - ph * 0.5)), 0, Math.PI * 2); c.fill();
        }
      }
      c.globalAlpha = 1;
    }
  }
};
