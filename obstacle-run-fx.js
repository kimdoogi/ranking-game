// Spectator presentation only. This file never changes a runner or rolls an item.
window.ObstacleRunFX = class {
  constructor(ctx, text, reduced) {
    this.ctx = ctx; this.text = text; this.reduced = reduced;
    this.previous = [];
  }

  updateHud(leaders, time, course, event, name) {
    const board = document.getElementById('raceLeaders');
    if (!board.children.length) {
      this.previous = [];
      for (let i = 0; i < 3; i++) {
        const row = document.createElement('div');
        row.className = 'liveLeader';
        for (const cls of ['leaderRank', 'leaderName', 'leaderGap', 'leaderMeter']) {
          const el = document.createElement('span'); el.className = cls; row.appendChild(el);
        }
        board.appendChild(row);
      }
    }
    for (let i = 0; i < 3; i++) {
      const p = leaders[i], row = board.children[i];
      row.hidden = !p;
      if (!p) continue;
      const [rank, label, gap, meter] = row.children;
      const was = this.previous.indexOf(p.id);
      row.style.setProperty('--runner', p.color);
      row.classList.toggle('changed', was >= 0 && was !== i);
      rank.textContent = `${i + 1}${was > i ? ' ↑' : ''}`;
      label.textContent = name(p);
      gap.textContent = p.finished ? `🏁 ${p.finT.toFixed(2)}s` :
        `${p.shieldT > 0 ? '🛡️' : p.burstT > 0 ? '🚀' : '🏃'} ${i === 0 ? this.text.front : '+' + Math.max(0, (leaders[0].wy - p.wy) / course * 300).toFixed(1) + 'm'}`;
      meter.style.width = `${Math.max(0, Math.min(100, p.wy / course * 100))}%`;
    }
    this.previous = leaders.map(p => p.id);
    document.getElementById('raceClock').textContent = `${time.toFixed(1)}s`;
    document.getElementById('raceEvent').textContent = event;
    const progress = leaders.length ? Math.max(0, Math.min(1, leaders[0].wy / course)) : 0;
    document.getElementById('courseProgress').style.width = `${progress * 100}%`;
    document.getElementById('raceDistance').textContent = this.text.distanceLeft(Math.ceil(300 * (1 - progress)));
  }

  itemGate(b, trackW, projectX, worldY, perspective, time) {
    const g = this.ctx, y = worldY(b.y), depth = perspective(y);
    g.save();
    g.strokeStyle = '#b9ff66'; g.lineWidth = 3;
    g.fillStyle = 'rgba(185,255,102,.10)';
    g.fillRect(projectX(-trackW / 2, y), y - 10, trackW * depth, 20);
    g.beginPath(); g.moveTo(projectX(-trackW / 2, y), y); g.lineTo(projectX(trackW / 2, y), y); g.stroke();
    for (let i = 0; i < 4; i++) {
      const x = projectX(trackW * ((i + 0.5) / 4 - 0.5), y);
      const bob = this.reduced ? 0 : Math.sin(time * 4 + i) * 4;
      g.save(); g.translate(x, y - 24 + bob); g.rotate(Math.PI / 4);
      g.fillStyle = ['#b9ff66', '#7eeaff', '#ffae72', '#c4a4ff'][i];
      g.shadowColor = g.fillStyle; g.shadowBlur = 12;
      g.fillRect(-13, -13, 26, 26); g.restore();
      g.fillStyle = '#121b27'; g.font = '900 21px sans-serif'; g.textAlign = 'center';
      g.fillText('?', x, y - 17 + bob);
    }
    g.shadowBlur = 0; g.font = '900 15px sans-serif'; g.textAlign = 'center'; g.fillStyle = '#d9ffa6';
    g.fillText(this.text.itemGate, projectX(0, y), y + 26);
    g.restore();
  }

  runner(p, x, y, scale, time, detailed) {
    const g = this.ctx;
    g.save();
    if (!detailed) {
      if (p.shieldT > 0 || p.burstT > 0 || p.itemT > 0) {
        g.fillStyle = p.shieldT > 0 ? '#7eeaff' : p.burstT > 0 ? '#ffb35c' : '#b9ff66';
        g.fillRect(x - 2 * scale, y - 24 * scale, 4 * scale, 4 * scale);
      }
      g.restore(); return;
    }
    if (p.burstT > 0) {
      g.strokeStyle = '#ffb35c'; g.lineWidth = 3 * scale;
      for (let i = -1; i <= 1; i++) {
        const length = (this.reduced ? 24 : 24 + Math.sin(time * 25 + i) * 8) * scale;
        g.beginPath(); g.moveTo(x + i * 7 * scale, y + 5 * scale);
        g.lineTo(x + i * 10 * scale, y + length); g.stroke();
      }
    }
    if (p.shieldT > 0) {
      g.fillStyle = 'rgba(126,234,255,.12)'; g.strokeStyle = '#7eeaff'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(x, y - 13 * scale, 19 * scale, 26 * scale, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    if (p.itemT > 0) {
      g.font = `${22 * scale}px sans-serif`; g.textAlign = 'center';
      g.fillText(p.item, x, y - 44 * scale);
    }
    g.restore();
  }

  labels(runners, width, height, position, name) {
    const g = this.ctx, boxes = [], colors = ['#ffe073', '#cdddf2', '#ffb185'];
    g.save(); g.font = `800 ${width < 600 ? 12 : 14}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    runners.forEach((p, i) => {
      const at = position(p);
      if (at.y < 95 || at.y > height - 160) return;
      const label = `${i + 1} ${name(p)}`, w = Math.min(width - 24, g.measureText(label).width + 20);
      const x = Math.max(w / 2 + 8, Math.min(width - w / 2 - 8, at.x));
      let y = Math.max(106, at.y - 38);
      for (let n = 0; n < 6 && boxes.some(b => Math.abs(b.x - x) < (b.w + w) / 2 + 4 && Math.abs(b.y - y) < 24); n++) y += 25;
      boxes.push({ x, y, w });
      g.strokeStyle = colors[i]; g.lineWidth = 1;
      g.beginPath(); g.moveTo(at.x, at.y - 15); g.lineTo(x, y); g.stroke();
      g.fillStyle = '#101a29'; g.beginPath(); g.roundRect(x - w / 2, y - 11, w, 22, 7); g.fill(); g.stroke();
      g.fillStyle = colors[i]; g.fillText(label, x, y, w - 12);
    });
    g.restore();
  }
};
