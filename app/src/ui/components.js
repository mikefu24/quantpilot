// ============ iOS 风格 UI 组件 ============

/** html 模板工具(简易转义) */
export function h(strings, ...vals) {
  return strings.reduce((out, s, i) => out + s + (vals[i] ?? ''), '');
}
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** Toast */
let toastEl = null, toastTimer = null;
export function toast(msg, ms = 2400) {
  if (!toastEl) { toastEl = el('<div class="toast"></div>'); document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/** 底部 Sheet */
export function sheet(contentHtml, { onOpen } = {}) {
  const mask = el('<div class="sheet-mask"></div>');
  const box = el(`<div class="sheet"><div class="sheet-grab"></div>${contentHtml}</div>`);
  document.body.append(mask, box);
  requestAnimationFrame(() => { mask.classList.add('show'); box.classList.add('show'); });
  const close = () => {
    mask.classList.remove('show'); box.classList.remove('show');
    setTimeout(() => { mask.remove(); box.remove(); }, 350);
  };
  mask.addEventListener('click', close);
  onOpen?.(box, close);
  return { box, close };
}

/** 分段控件 */
export function segmented(items, onChange, activeIdx = 0) {
  const seg = el(`<div class="seg">${items.map((t, i) =>
    `<button class="${i === activeIdx ? 'on' : ''}" data-i="${i}">${esc(t)}</button>`).join('')}</div>`);
  seg.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    seg.querySelectorAll('button').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    onChange(+btn.dataset.i);
  });
  return seg;
}

/** SVG 迷你走势图 */
export function sparkline(values, { w = 90, h = 30, color } = {}) {
  const valid = values.filter(v => !isNaN(v));
  if (valid.length < 2) return '<svg class="spark" width="' + w + '" height="' + h + '"></svg>';
  const min = Math.min(...valid), max = Math.max(...valid);
  const rng = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1) * w).toFixed(1)},${(h - 2 - (v - min) / rng * (h - 4)).toFixed(1)}`).join(' ');
  const col = color || (valid[valid.length - 1] >= valid[0] ? '#FF453A' : '#30D158');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`;
}

/** 环形评分 */
export function scoreRing(score, max = 5, label = '综合评分', color = '#0A84FF') {
  const pct = Math.max(0, Math.min(1, score / max));
  const R = 52, C = 2 * Math.PI * R;
  return `<div class="score-ring">
    <svg width="120" height="120" viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="${R}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="9"/>
      <circle cx="60" cy="60" r="${R}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round"
        stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/>
    </svg>
    <div class="sv"><b>${score.toFixed(1)}</b><span>${esc(label)}</span></div>
  </div>`;
}

/** 简易 Markdown 渲染(LLM 报告用) */
export function mdToHtml(md) {
  let out = esc(md);
  out = out.replace(/^### (.*)$/gm, '<h4 style="margin:14px 0 6px">$1</h4>');
  out = out.replace(/^## (.*)$/gm, '<h3 style="margin:16px 0 8px">$1</h3>');
  out = out.replace(/^# (.*)$/gm, '<h3 style="margin:16px 0 8px">$1</h3>');
  out = out.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  out = out.replace(/^[-*] (.*)$/gm, '<div style="padding-left:14px;position:relative"><span style="position:absolute;left:2px">·</span>$1</div>');
  out = out.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
  return `<div style="font-size:13.5px;line-height:1.75;color:var(--text-2)">${out}</div>`;
}
