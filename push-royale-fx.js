// Canvas-only spectacle. Combat timing and hit detection stay in push-royale.js.
window.PushRoyaleFX = class {
  constructor(ctx, reduceMotion) {
    this.ctx = ctx;
    this.reduceMotion = reduceMotion;
    this.events = [];
  }

  clear() { this.events.length = 0; }

  add(event) {
    this.events.push({ age: 0, ...event });
    if (this.events.length > 80) this.events.shift();
  }

  impact(x, y, angle, color, size) {
    this.add({ type: 'impact', x, y, angle, color, size, duration: 0.32 });
  }

  bolt(x, y, tx, ty, color) {
    this.add({ type: 'bolt', x, y, tx, ty, color, duration: 0.28 });
  }

  update(dt) {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      e.age += dt;
      if (e.age >= e.duration) this.events.splice(i, 1);
    }
  }

  draw() {
    const c = this.ctx;
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const e of this.events) {
      const t = e.age / e.duration;
      c.globalAlpha = (1 - t) * (this.reduceMotion ? 0.55 : 1);
      c.strokeStyle = e.color; c.fillStyle = e.color;
      c.shadowColor = e.color; c.shadowBlur = this.reduceMotion ? 0 : 12;
      if (e.type === 'bolt') {
        const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy) || 1;
        c.beginPath(); c.moveTo(e.x, e.y);
        for (let i = 1; i < 8; i++) {
          const bend = this.reduceMotion ? 0 : Math.sin(i * 13.7) * Math.min(15, d * 0.16);
          c.lineTo(e.x + dx * i / 8 - dy / d * bend, e.y + dy * i / 8 + dx / d * bend);
        }
        c.lineTo(e.tx, e.ty);
        c.lineWidth = 7; c.stroke();
        c.strokeStyle = '#e9ffff'; c.lineWidth = 2; c.stroke();
        continue;
      }

      c.save(); c.translate(e.x, e.y); c.rotate(e.angle);
      const r = e.size * (this.reduceMotion ? 0.65 : 0.5 + Math.sqrt(t) * 0.9);
      // An asymmetric comic burst makes the launch direction readable.
      c.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8;
        const len = r * (i % 2 ? 0.28 : (i % 4 ? 0.7 : 1));
        c.lineTo(Math.cos(a) * len * 1.35, Math.sin(a) * len);
      }
      c.closePath(); c.fill();
      c.fillStyle = '#fff7df'; c.scale(0.52, 0.52); c.fill();
      c.restore();

      if (!this.reduceMotion) {
        c.lineWidth = 2 * (1 - t) + 0.5;
        c.beginPath(); c.ellipse(e.x, e.y, r * 1.45, r, e.angle, 0, Math.PI * 2); c.stroke();
        for (let i = 0; i < 7; i++) {
          const a = e.angle + i * 2.4;
          const inner = r * (1.2 + t), outer = inner + e.size * (1 - t) * 0.5;
          c.beginPath();
          c.moveTo(e.x + Math.cos(a) * inner, e.y + Math.sin(a) * inner);
          c.lineTo(e.x + Math.cos(a) * outer, e.y + Math.sin(a) * outer); c.stroke();
        }
      }
    }
    c.restore();
  }

  floor(x, y, radius, tilt, suddenDeath) {
    const c = this.ctx;
    c.save(); c.translate(x, y); c.scale(1, tilt);
    c.beginPath(); c.arc(0, 0, radius, 0, Math.PI * 2); c.clip();
    c.strokeStyle = 'rgba(156,184,255,.12)'; c.lineWidth = 1;
    for (let i = -300; i <= 300; i += 60) {
      c.beginPath(); c.moveTo(i, -340); c.lineTo(i, 340);
      c.moveTo(-340, i); c.lineTo(340, i); c.stroke();
    }
    c.strokeStyle = suddenDeath ? 'rgba(255,107,107,.3)' : 'rgba(150,202,255,.22)';
    for (const k of [0.35, 0.7]) {
      c.beginPath(); c.arc(0, 0, radius * k, 0, Math.PI * 2); c.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      c.lineWidth = 5;
      c.beginPath(); c.arc(0, 0, Math.max(1, radius - 7), a + 0.08, a + 0.28); c.stroke();
    }
    c.rotate(Math.PI / 4); c.lineWidth = 2;
    c.strokeRect(-12, -12, 24, 24);
    c.restore();
  }

  pulse(b, gy, tilt) {
    const c = this.ctx, warning = b.age < b.delay;
    const progress = Math.max(0, Math.min(1, (b.age - b.delay) / 0.38));
    const fade = Math.max(0, 1 - Math.max(0, b.age - b.delay - 0.28) / 0.42);
    const color = b.pulse ? '#72f5ff' : '#ff9062';
    c.save(); c.translate(b.x, gy); c.scale(1, tilt);
    c.fillStyle = color; c.strokeStyle = color;
    c.globalAlpha = warning ? 0.09 : 0.13 * fade;
    c.beginPath(); c.arc(0, 0, b.radius, 0, Math.PI * 2); c.fill();
    c.globalAlpha = warning ? 0.75 : fade;
    c.lineWidth = warning ? 2 : 4;
    if (warning) c.setLineDash([8, 7]);
    c.beginPath(); c.arc(0, 0, b.radius, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    if (warning) {
      c.lineWidth = 5;
      c.beginPath(); c.arc(0, 0, b.radius, -Math.PI / 2, -Math.PI / 2 + b.age / b.delay * Math.PI * 2); c.stroke();
    } else {
      c.shadowColor = color; c.shadowBlur = this.reduceMotion ? 0 : 16;
      c.strokeStyle = '#eaffff'; c.lineWidth = 3;
      c.beginPath(); c.arc(0, 0, b.radius * (this.reduceMotion ? 1 : progress), 0, Math.PI * 2); c.stroke();
      if (!this.reduceMotion) for (let i = 0; i < 10; i++) {
        const a = i * Math.PI / 5, r = b.radius * progress;
        c.strokeStyle = color; c.lineWidth = 2;
        c.beginPath(); c.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r); c.stroke();
      }
    }
    c.restore();
    if (warning) {
      c.save(); c.translate(b.x, gy - 15);
      c.fillStyle = '#111629'; c.strokeStyle = color; c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, 17, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = color; c.font = '900 22px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(b.pulse ? '◎' : '!', 0, 1); c.restore();
    }
  }

  trail(p, gy, tilt) {
    if (this.reduceMotion) return;
    const c = this.ctx, vx = p.vx, vy = p.vy * tilt;
    const speed = Math.hypot(vx, vy);
    if (speed < 1) return;
    c.save();
    c.translate(p.x, gy - p.z - p.r); c.rotate(Math.atan2(vy, vx));
    c.strokeStyle = p.color; c.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      c.globalAlpha = i === 0 ? 0.45 : 0.22;
      c.lineWidth = i === 0 ? p.r * 0.55 : 2;
      c.beginPath(); c.moveTo(-p.r, i * p.r * 0.6);
      c.lineTo(-p.r - Math.min(speed * (i === 0 ? 7 : 10), p.r * 5), i * p.r * 0.6); c.stroke();
    }
    c.restore();
  }

  special(p, gy, reach, wind, hit, tilt) {
    const c = this.ctx, skill = p.special, t = p.swingT;
    const charge = Math.min(1, t / wind);
    const progress = Math.max(0, Math.min(1, (t - wind) / hit));
    const fade = t < wind + hit ? 1 : Math.max(0, 1 - (t - wind - hit) / 0.20);
    c.save(); c.translate(p.x, gy - p.z * 0.25); c.scale(1, tilt);
    c.strokeStyle = skill.color; c.fillStyle = skill.color;
    c.shadowColor = skill.color; c.shadowBlur = this.reduceMotion ? 0 : 14;
    c.lineCap = 'round';

    if (this.reduceMotion) {
      c.globalAlpha = 0.45 * fade; c.lineWidth = 3;
      c.beginPath(); c.arc(0, 0, reach, 0, Math.PI * 2); c.stroke();
    } else if (t < wind) {
      c.globalAlpha = 0.08 + charge * 0.10;
      c.beginPath(); c.arc(0, 0, reach, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 0.45 + charge * 0.35; c.lineWidth = 2 + charge * 2;
      c.beginPath(); c.arc(0, 0, reach * (1.18 - charge * 0.18), 0, Math.PI * 2); c.stroke();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + charge * 1.3;
        c.beginPath();
        c.moveTo(Math.cos(a) * reach * (1.35 - charge * 0.4), Math.sin(a) * reach * (1.35 - charge * 0.4));
        c.lineTo(Math.cos(a) * reach * 0.68, Math.sin(a) * reach * 0.68); c.stroke();
      }
    } else if (skill.id === 'spin') {
      c.translate(0, -p.r * 1.1);
      for (let i = 0; i < 3; i++) {
        const a = progress * Math.PI * 3 * p.batSide + i * Math.PI * 2 / 3;
        c.globalAlpha = fade * (0.7 - i * 0.15); c.lineWidth = Math.max(3, p.r * (0.32 - i * 0.06));
        c.beginPath(); c.arc(0, i * p.r * 0.35, reach * (1 - i * 0.14), a, a + Math.PI * 1.2); c.stroke();
        c.strokeStyle = '#fff5c7'; c.lineWidth = 2; c.stroke(); c.strokeStyle = skill.color;
      }
    } else if (skill.id === 'dash') {
      c.rotate(p.aim); c.globalAlpha = fade * 0.6;
      c.beginPath(); c.moveTo(reach * 0.85, 0);
      c.lineTo(-reach * 1.35, -p.r * 0.7); c.lineTo(-reach * 0.85, 0);
      c.lineTo(-reach * 1.35, p.r * 0.7); c.closePath(); c.fill();
      c.strokeStyle = '#fff0da'; c.lineWidth = 3;
      for (let i = -1; i <= 1; i++) {
        c.beginPath(); c.moveTo(-p.r, i * p.r * 0.6);
        c.lineTo(-reach * (1.2 + Math.abs(i) * 0.2), i * p.r * 0.9); c.stroke();
      }
    } else if (skill.id === 'bolt') {
      c.globalAlpha = fade * 0.75; c.lineWidth = 3;
      c.beginPath();
      for (let i = 0; i <= 24; i++) {
        const a = i * Math.PI / 12, r = reach * (i % 2 ? 0.76 : 0.92);
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.stroke();
    } else if (skill.id === 'quake') {
      const r = reach * Math.max(0.12, progress);
      c.globalAlpha = fade * 0.18; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
      c.globalAlpha = fade * 0.85; c.lineWidth = 5 * (1 - progress) + 2;
      c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke();
      c.lineWidth = 2;
      for (let i = 0; i < 9; i++) {
        const a = i * Math.PI * 2 / 9;
        c.beginPath(); c.moveTo(Math.cos(a) * p.r, Math.sin(a) * p.r);
        c.lineTo(Math.cos(a + 0.14) * r * 0.62, Math.sin(a + 0.14) * r * 0.62);
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r); c.stroke();
        c.save(); c.translate(Math.cos(a) * r, Math.sin(a) * r - Math.sin(progress * Math.PI) * p.r);
        c.rotate(a + progress); c.fillRect(-3, -3, 6, 6); c.restore();
      }
    }
    c.restore();
  }

  victory(c, w, h, t, color) {
    const motion = this.reduceMotion ? 0 : t;
    c.save(); c.translate(w / 2, h * 0.53);
    const glow = c.createRadialGradient(0, 0, 5, 0, 0, h * 0.55);
    glow.addColorStop(0, color); glow.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = 0.25; c.fillStyle = glow; c.fillRect(-w / 2, -h, w, h * 2);
    c.fillStyle = '#ffd23f';
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6 + motion * 0.12;
      c.globalAlpha = 0.07 + (i % 3) * 0.025;
      c.beginPath(); c.moveTo(Math.cos(a) * 45, Math.sin(a) * 45);
      c.lineTo(Math.cos(a - 0.08) * h * 0.65, Math.sin(a - 0.08) * h * 0.65);
      c.lineTo(Math.cos(a + 0.08) * h * 0.65, Math.sin(a + 0.08) * h * 0.65); c.closePath(); c.fill();
    }
    c.strokeStyle = color; c.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      const p = (motion * 0.65 + i * 0.5) % 1;
      c.globalAlpha = (1 - p) * 0.35;
      c.beginPath(); c.ellipse(0, h * 0.31, 40 + p * w * 0.4, 8 + p * 22, 0, 0, Math.PI * 2); c.stroke();
    }
    for (let i = 0; i < 18; i++) {
      const a = i * 2.4, radius = h * (0.28 + (i % 4) * 0.055);
      const x = Math.cos(a + motion * 0.12) * radius;
      const y = Math.sin(a) * radius - Math.sin(motion * 2 + i) * 7;
      c.globalAlpha = 0.55; c.fillStyle = i % 2 ? color : '#ffd23f';
      c.save(); c.translate(x, y); c.rotate(a + motion);
      c.fillRect(-2, -5, 4, 10); c.fillRect(-5, -2, 10, 4); c.restore();
    }
    c.restore();
  }
};
