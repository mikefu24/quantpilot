// ============ 零依赖 Canvas K线图 ============
// 蜡烛 + 成交量 + MA5/20/60 + MACD 副图 + 十字光标
import { sma, macd, closes } from '../engine/indicators.js';

const UP = '#FF453A', DOWN = '#30D158', GRID = 'rgba(255,255,255,.06)', TXT = 'rgba(245,245,247,.45)';
const MA_COLORS = ['#FFD60A', '#0A84FF', '#BF5AF2'];

export function createKChart(container, opts = {}) {
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const state = { bars: [], view: 90, offset: 0, cross: null, markers: [] };

  function resize() {
    const dpr = devicePixelRatio || 1;
    const w = container.clientWidth || 320;
    const h = opts.height || 380;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.height = h + 'px';
    draw();
  }

  function draw() {
    const ctx2 = canvas.getContext('2d');
    const dpr = devicePixelRatio || 1;
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = canvas.width / dpr, H = canvas.height / dpr;
    ctx2.clearRect(0, 0, W, H);
    const bars = state.bars;
    if (!bars.length) { ctx2.fillStyle = TXT; ctx2.font = '13px sans-serif'; ctx2.fillText('加载中…', W / 2 - 24, H / 2); return; }

    const n = Math.min(state.view, bars.length);
    const end = bars.length - state.offset;
    const start = Math.max(0, end - n);
    const slice = bars.slice(start, end);

    const padR = 52, padT = 8;
    const mainH = H * 0.62, volH = H * 0.13, macdH = H * 0.17, gap = H * 0.02;
    const plotW = W - padR;
    const cw = plotW / slice.length;
    const bw = Math.max(1, cw * 0.66);

    let hi = -Infinity, lo = Infinity, vMax = 0;
    for (const b of slice) { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); vMax = Math.max(vMax, b.v); }
    const pad = (hi - lo) * 0.06 || 1;
    hi += pad; lo -= pad;
    const y = v => padT + (hi - v) / (hi - lo) * (mainH - padT);
    const x = i => i * cw + cw / 2;

    // 网格 + 价格轴
    ctx2.font = '10px "SF Mono", Menlo, monospace';
    for (let g = 0; g <= 4; g++) {
      const v = hi - (hi - lo) * g / 4;
      const yy = y(v);
      ctx2.strokeStyle = GRID; ctx2.beginPath(); ctx2.moveTo(0, yy); ctx2.lineTo(plotW, yy); ctx2.stroke();
      ctx2.fillStyle = TXT; ctx2.fillText(fmtPx(v), plotW + 5, yy + 3);
    }

    // 蜡烛
    for (let i = 0; i < slice.length; i++) {
      const b = slice[i];
      const up = b.c >= b.o;
      ctx2.strokeStyle = ctx2.fillStyle = up ? UP : DOWN;
      ctx2.beginPath(); ctx2.moveTo(x(i), y(b.h)); ctx2.lineTo(x(i), y(b.l)); ctx2.stroke();
      const top = y(Math.max(b.o, b.c)), bh = Math.max(1, Math.abs(y(b.o) - y(b.c)));
      up ? ctx2.strokeRect(x(i) - bw / 2, top, bw, bh) : ctx2.fillRect(x(i) - bw / 2, top, bw, bh);
    }

    // MA 线
    const cl = closes(bars);
    [[5, 0], [20, 1], [60, 2]].forEach(([p, ci]) => {
      const ma = sma(cl, p);
      ctx2.strokeStyle = MA_COLORS[ci]; ctx2.lineWidth = 1; ctx2.beginPath();
      let started = false;
      for (let i = 0; i < slice.length; i++) {
        const v = ma[start + i];
        if (isNaN(v)) continue;
        started ? ctx2.lineTo(x(i), y(v)) : ctx2.moveTo(x(i), y(v));
        started = true;
      }
      ctx2.stroke();
    });

    // 买卖标记
    for (const m of state.markers) {
      if (m.i < start || m.i >= end) continue;
      const i = m.i - start;
      const b = slice[i];
      ctx2.fillStyle = m.side === 'BUY' ? '#0A84FF' : '#FF9F0A';
      ctx2.font = 'bold 11px sans-serif';
      const yy = m.side === 'BUY' ? y(b.l) + 14 : y(b.h) - 6;
      ctx2.fillText(m.side === 'BUY' ? 'B' : 'S', x(i) - 3, yy);
    }

    // 成交量
    const volY = mainH + gap;
    for (let i = 0; i < slice.length; i++) {
      const b = slice[i];
      ctx2.fillStyle = (b.c >= b.o ? UP : DOWN) + '99';
      const vh = vMax ? b.v / vMax * volH : 0;
      ctx2.fillRect(x(i) - bw / 2, volY + volH - vh, bw, vh);
    }

    // MACD 副图
    const m = macd(bars);
    const macdY = volY + volH + gap;
    let mHi = 0;
    for (let i = start; i < end; i++) mHi = Math.max(mHi, Math.abs(m.hist[i] || 0), Math.abs(m.dif[i] || 0), Math.abs(m.dea[i] || 0));
    mHi = mHi || 1;
    const my = v => macdY + macdH / 2 - (v / mHi) * (macdH / 2 - 4);
    ctx2.strokeStyle = GRID; ctx2.beginPath(); ctx2.moveTo(0, my(0)); ctx2.lineTo(plotW, my(0)); ctx2.stroke();
    for (let i = 0; i < slice.length; i++) {
      const h = m.hist[start + i] || 0;
      ctx2.fillStyle = h >= 0 ? UP + 'AA' : DOWN + 'AA';
      ctx2.fillRect(x(i) - bw / 2, Math.min(my(0), my(h)), bw, Math.abs(my(h) - my(0)) || 1);
    }
    [['dif', '#FFD60A'], ['dea', '#0A84FF']].forEach(([k2, col]) => {
      ctx2.strokeStyle = col; ctx2.lineWidth = 1; ctx2.beginPath();
      let st = false;
      for (let i = 0; i < slice.length; i++) {
        const v = m[k2][start + i];
        if (isNaN(v)) continue;
        st ? ctx2.lineTo(x(i), my(v)) : ctx2.moveTo(x(i), my(v));
        st = true;
      }
      ctx2.stroke();
    });

    // 日期轴
    ctx2.fillStyle = TXT;
    const step = Math.ceil(slice.length / 5);
    for (let i = 0; i < slice.length; i += step)
      ctx2.fillText(String(slice[i].t).slice(5), x(i) - 14, H - 3);

    // 十字光标
    if (state.cross) {
      const { cx } = state.cross;
      const i = Math.max(0, Math.min(slice.length - 1, Math.floor(cx / cw)));
      const b = slice[i];
      ctx2.strokeStyle = 'rgba(255,255,255,.35)'; ctx2.setLineDash([4, 4]);
      ctx2.beginPath(); ctx2.moveTo(x(i), 0); ctx2.lineTo(x(i), H - 14); ctx2.stroke();
      ctx2.setLineDash([]);
      // 信息浮层
      const info = `${b.t}  开${fmtPx(b.o)} 高${fmtPx(b.h)} 低${fmtPx(b.l)} 收${fmtPx(b.c)}  ${((b.c / b.o - 1) * 100).toFixed(2)}%`;
      ctx2.font = '11px "SF Mono", Menlo, monospace';
      const tw = ctx2.measureText(info).width + 16;
      ctx2.fillStyle = 'rgba(20,20,30,.92)';
      roundRect(ctx2, Math.min(Math.max(4, x(i) - tw / 2), W - tw - 4), 4, tw, 22, 6);
      ctx2.fillStyle = b.c >= b.o ? UP : DOWN;
      ctx2.fillText(info, Math.min(Math.max(12, x(i) - tw / 2 + 8), W - tw + 4), 19);
    }

    // MA 图例
    ctx2.font = '10px sans-serif';
    let lx = 6;
    [['MA5', 0], ['MA20', 1], ['MA60', 2]].forEach(([t, ci]) => {
      ctx2.fillStyle = MA_COLORS[ci]; ctx2.fillText(t, lx, padT + 10); lx += 34;
    });
  }

  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    state.cross = { cx: e.clientX - r.left };
    draw();
  });
  canvas.addEventListener('pointerleave', () => { state.cross = null; draw(); });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    state.view = Math.max(30, Math.min(state.bars.length, state.view + (e.deltaY > 0 ? 10 : -10)));
    draw();
  }, { passive: false });

  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  return {
    setBars(bars, markers = []) { state.bars = bars; state.markers = markers; state.offset = 0; draw(); },
    setView(n) { state.view = n; draw(); },
    destroy() { ro.disconnect(); canvas.remove(); },
  };
}

function fmtPx(v) { return v >= 1000 ? v.toFixed(0) : v >= 100 ? v.toFixed(1) : v.toFixed(2); }
function roundRect(ctx2, x, y, w, h, r) {
  ctx2.beginPath();
  ctx2.moveTo(x + r, y); ctx2.arcTo(x + w, y, x + w, y + h, r); ctx2.arcTo(x + w, y + h, x, y + h, r);
  ctx2.arcTo(x, y + h, x, y, r); ctx2.arcTo(x, y, x + w, y, r); ctx2.closePath(); ctx2.fill();
}
