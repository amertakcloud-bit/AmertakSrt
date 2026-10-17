// Interactive waveform: Zoom, Click/Drag seek, Cue regions, Playhead
export class Waveform {
  constructor(canvas, scroller, { onSeek, onRegionClick } = {}) {
    this.c = canvas;
    this.scroller = scroller;
    this.ctx = canvas.getContext('2d');
    this.onSeek = onSeek;
    this.onRegionClick = onRegionClick;
    this.peaks = null; // ខ្ពស់បំផុតក្នុងមួយ 10ms
    this.duration = 0;
    this.cues = [];
    this.activeId = null;
    this.time = 0;
    this.pps = 60; // pixels per second
    this.dragging = false;

    const seekFrom = (e) => {
      const r = this.c.getBoundingClientRect();
      const t = Math.min(this.duration, Math.max(0, ((e.clientX - r.left) / r.width) * this.duration));
      this.onSeek?.(t);
    };
    this.c.addEventListener('pointerdown', (e) => {
      if (!this.duration) return;
      this.dragging = true;
      this.c.setPointerCapture(e.pointerId);
      seekFrom(e);
    });
    this.c.addEventListener('pointermove', (e) => this.dragging && seekFrom(e));
    this.c.addEventListener('pointerup', () => { this.dragging = false; });
    new ResizeObserver(() => this.resize()).observe(this.scroller);
  }

  setBuffer(buffer) {
    this.duration = buffer.duration;
    const ch = buffer.getChannelData(0);
    const per = Math.max(1, Math.floor(buffer.sampleRate / 100));
    const n = Math.ceil(ch.length / per);
    const peaks = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = 0;
      const end = Math.min(ch.length, (i + 1) * per);
      for (let j = i * per; j < end; j += 2) { const v = Math.abs(ch[j]); if (v > m) m = v; }
      peaks[i] = m;
    }
    let max = 0;
    for (const p of peaks) if (p > max) max = p;
    const k = max > 0 ? 1 / max : 1;
    for (let i = 0; i < n; i++) peaks[i] *= k;
    this.peaks = peaks;
    this.fit();
  }

  setDuration(d) { this.duration = d; this.resize(); }
  fitPps() { return Math.max(4, (this.scroller.clientWidth - 2) / Math.max(this.duration, 0.1)); }
  fit() { this.pps = this.fitPps(); this.resize(); }
  zoom(f) {
    const center = this.scroller.scrollLeft + this.scroller.clientWidth / 2;
    const t = center / this.pps;
    this.pps = Math.min(600, Math.max(this.fitPps(), this.pps * f));
    this.resize();
    this.scroller.scrollLeft = t * this.pps - this.scroller.clientWidth / 2;
  }
  setCues(cues, activeId) { this.cues = cues; this.activeId = activeId; this.draw(); }
  setActive(id) { if (id !== this.activeId) { this.activeId = id; this.draw(); } }

  setTime(t, follow = true) {
    this.time = t;
    if (follow && this.duration) {
      const x = t * this.pps;
      const { scrollLeft, clientWidth } = this.scroller;
      if (x < scrollLeft || x > scrollLeft + clientWidth - 40) this.scroller.scrollLeft = Math.max(0, x - clientWidth * 0.25);
    }
    this.draw();
  }

  resize() {
    if (!this.scroller.clientWidth) return;
    const cssW = Math.max(this.scroller.clientWidth, Math.min(24000, Math.ceil(this.duration * this.pps)));
    const dpr = Math.min(window.devicePixelRatio || 1, cssW > 12000 ? 1 : 2);
    this.dpr = dpr;
    this.c.style.width = cssW + 'px';
    this.c.width = Math.floor(cssW * dpr);
    this.c.height = Math.floor(150 * dpr);
    this.draw();
  }

  draw() {
    const { ctx, c, dpr = 1 } = this;
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    if (!this.duration) return;
    const pxPerSec = (W / this.duration);

    // Cue regions
    for (const cue of this.cues) {
      const x = cue.start * pxPerSec, w = Math.max(1, (cue.end - cue.start) * pxPerSec);
      ctx.fillStyle = cue.id === this.activeId ? 'rgba(167,139,250,0.30)' : 'rgba(139,92,246,0.12)';
      ctx.fillRect(x, 0, w, H);
      ctx.fillStyle = cue.id === this.activeId ? '#c4b5fd' : 'rgba(167,139,250,0.55)';
      ctx.fillRect(x, 0, Math.max(1, dpr), H);
      ctx.fillRect(x + w - Math.max(1, dpr), 0, Math.max(1, dpr), H);
    }

    // Bars
    if (this.peaks) {
      const barW = 2 * dpr, gap = 1 * dpr, step = barW + gap;
      const mid = H / 2;
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, '#c084fc'); grad.addColorStop(0.5, '#8b5cf6'); grad.addColorStop(1, '#c084fc');
      ctx.fillStyle = grad;
      for (let x = 0; x < W; x += step) {
        const t0 = (x / W) * this.duration, t1 = ((x + step) / W) * this.duration;
        const a = Math.floor(t0 * 100), b = Math.max(a + 1, Math.ceil(t1 * 100));
        let m = 0;
        for (let i = a; i < b && i < this.peaks.length; i++) if (this.peaks[i] > m) m = this.peaks[i];
        const h = Math.max(2 * dpr, m * (H * 0.46));
        ctx.fillRect(x, mid - h, barW, h * 2);
      }
    } else {
      ctx.fillStyle = 'rgba(139,92,246,0.4)';
      ctx.fillRect(0, H / 2 - 1, W, 2);
    }

    // Time ticks
    ctx.fillStyle = 'rgba(200,190,240,0.55)';
    ctx.font = `${10 * dpr}px Inter, sans-serif`;
    const tickEvery = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * (this.pps) >= 70) || 600;
    for (let t = 0; t < this.duration; t += tickEvery) {
      const x = t * pxPerSec;
      ctx.fillRect(x, H - 8 * dpr, dpr, 8 * dpr);
      const m = Math.floor(t / 60), s = Math.floor(t % 60);
      ctx.fillText(`${m}:${String(s).padStart(2, '0')}${tickEvery < 1 ? '.' + Math.round((t % 1) * 10) : ''}`, x + 3 * dpr, H - 10 * dpr);
    }

    // Playhead
    const px = this.time * pxPerSec;
    ctx.fillStyle = '#fff';
    ctx.fillRect(px - dpr / 2, 0, Math.max(1.5, dpr * 1.5), H);
    ctx.beginPath();
    ctx.moveTo(px - 6 * dpr, 0); ctx.lineTo(px + 6 * dpr, 0); ctx.lineTo(px, 8 * dpr); ctx.closePath();
    ctx.fill();
  }
}
