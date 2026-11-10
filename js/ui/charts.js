// Small dependency-free SVG charts: a single-series line chart and a bar chart.
// One series, one axis; touch or hover shows the exact value for a point.

import { h, svg, clear } from '../lib/dom.js';

function niceTicks(min, max, count = 4) {
  if (min === max) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo, hi, ticks };
}

const compact = (v) => (Math.abs(v) >= 10000 ? `${Math.round(v / 100) / 10}K` : String(Math.round(v * 10) / 10));

function mount(draw) {
  const wrap = h('div', { class: 'chart' });
  const paint = () => { const w = wrap.clientWidth; if (w > 0) draw(wrap, w); };
  requestAnimationFrame(paint);
  if (typeof ResizeObserver !== 'undefined') {
    let last = 0;
    const ro = new ResizeObserver(() => { const w = wrap.clientWidth; if (w && Math.abs(w - last) > 2) { last = w; paint(); } });
    ro.observe(wrap);
  }
  return wrap;
}

/**
 * lineChart({ points: [{ x: Date|ISO, y: number, note }], formatValue, label })
 * Points with a null y are skipped.
 */
export function lineChart({ points, formatValue = (v) => String(v), label = 'Chart', height = 200 }) {
  const data = points.filter((p) => p.y != null && Number.isFinite(p.y)).map((p) => ({ ...p, t: new Date(p.x).getTime() }));
  if (!data.length) return h('div', { class: 'chart chart-empty' }, 'No data in this range yet.');

  return mount((wrap, width) => {
    clear(wrap);
    const m = { top: 18, right: 14, bottom: 26, left: 40 };
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
    const ys = data.map((d) => d.y);
    const { lo, hi, ticks } = niceTicks(Math.min(...ys), Math.max(...ys));
    const t0 = data[0].t, t1 = data[data.length - 1].t;
    const X = (t) => m.left + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw);
    const Y = (v) => m.top + ih - ((v - lo) / (hi - lo)) * ih;

    const root = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label });
    for (const tk of ticks) {
      root.append(
        svg('line', { x1: m.left, x2: width - m.right, y1: Y(tk), y2: Y(tk), class: 'grid' }),
        svg('text', { x: m.left - 8, y: Y(tk) + 4, class: 'axis', 'text-anchor': 'end' }, compact(tk)));
    }
    const fmtX = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    root.append(svg('text', { x: m.left, y: height - 6, class: 'axis', 'text-anchor': 'start' }, fmtX(t0)));
    if (t1 !== t0) root.append(svg('text', { x: width - m.right, y: height - 6, class: 'axis', 'text-anchor': 'end' }, fmtX(t1)));

    if (data.length > 1) {
      const d = data.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
      root.append(svg('path', { d, class: 'line' }));
    }
    const showDots = data.length <= 40;
    data.forEach((p, i) => {
      if (showDots || i === data.length - 1) root.append(svg('circle', { cx: X(p.t), cy: Y(p.y), r: 4, class: 'dot' }));
    });
    // direct label on the latest point only
    const lastP = data[data.length - 1];
    const lx = X(lastP.t), ly = Y(lastP.y);
    root.append(svg('text', { x: Math.min(lx, width - m.right), y: ly - 10 < 12 ? ly + 18 : ly - 10, class: 'value', 'text-anchor': data.length > 1 ? 'end' : 'middle' }, formatValue(lastP.y)));

    const cross = svg('line', { y1: m.top, y2: m.top + ih, class: 'cross', visibility: 'hidden' });
    const focus = svg('circle', { r: 6, class: 'dot dot-focus', visibility: 'hidden' });
    root.append(cross, focus);

    const tip = h('div', { class: 'chart-tip', hidden: true });
    const show = (clientX) => {
      const rect = root.getBoundingClientRect();
      const x = clientX - rect.left;
      let best = data[0];
      for (const p of data) if (Math.abs(X(p.t) - x) < Math.abs(X(best.t) - x)) best = p;
      const bx = X(best.t), by = Y(best.y);
      cross.setAttribute('x1', bx); cross.setAttribute('x2', bx); cross.setAttribute('visibility', 'visible');
      focus.setAttribute('cx', bx); focus.setAttribute('cy', by); focus.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.replaceChildren(
        h('strong', null, formatValue(best.y)),
        h('span', null, new Date(best.t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })),
        ...(best.note ? [h('span', null, best.note)] : []));
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.max(4, Math.min(width - tw - 4, bx - tw / 2))}px`;
      tip.style.top = `${Math.max(0, by - tip.offsetHeight - 14)}px`;
    };
    const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); focus.setAttribute('visibility', 'hidden'); };
    root.addEventListener('pointermove', (e) => show(e.clientX));
    root.addEventListener('pointerdown', (e) => show(e.clientX));
    root.addEventListener('pointerleave', hide);
    wrap.append(root, tip);
  });
}

/**
 * barChart({ bars: [{ label, value, tip }], height })
 * Zero-based. Every `labelEvery`-th bar gets an x label.
 */
export function barChart({ bars, label = 'Chart', height = 150, highlightLast = false, formatValue = (v) => String(v) }) {
  if (!bars.length) return h('div', { class: 'chart chart-empty' }, 'No data in this range yet.');
  return mount((wrap, width) => {
    clear(wrap);
    const m = { top: 18, right: 6, bottom: 24, left: 26 };
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;
    const max = Math.max(1, ...bars.map((b) => b.value));
    const { hi, ticks } = niceTicks(0, max, Math.min(4, max));
    const top = Math.max(hi, 1);
    const slot = iw / bars.length;
    const bw = Math.max(2, Math.min(24, slot - 2));
    const Y = (v) => m.top + ih - (v / top) * ih;
    const root = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label });
    for (const tk of ticks.filter((t) => Number.isInteger(t))) {
      root.append(
        svg('line', { x1: m.left, x2: width - m.right, y1: Y(tk), y2: Y(tk), class: 'grid' }),
        svg('text', { x: m.left - 8, y: Y(tk) + 4, class: 'axis', 'text-anchor': 'end' }, compact(tk)));
    }
    const every = Math.max(1, Math.ceil(bars.length / Math.max(2, Math.floor(iw / 52))));
    const tip = h('div', { class: 'chart-tip', hidden: true });
    bars.forEach((b, i) => {
      const cx = m.left + slot * i + slot / 2;
      const y = Y(b.value), hgt = m.top + ih - y;
      if (b.value > 0) {
        const r = Math.min(4, bw / 2, hgt);
        const x = cx - bw / 2, base = m.top + ih;
        root.append(svg('path', { class: `bar ${highlightLast && i === bars.length - 1 ? 'bar-now' : ''}`, d: `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${base} Z` }));
      } else {
        root.append(svg('line', { x1: cx - bw / 2, x2: cx + bw / 2, y1: m.top + ih, y2: m.top + ih, class: 'bar-zero' }));
      }
      if (i % every === 0 || i === bars.length - 1) {
        if (i === bars.length - 1 || (bars.length - 1 - i) >= every) root.append(svg('text', { x: cx, y: height - 6, class: 'axis', 'text-anchor': 'middle' }, b.label));
      }
      const hit = svg('rect', { x: m.left + slot * i, y: m.top, width: slot, height: ih, class: 'hit' });
      const show = () => {
        tip.hidden = false;
        tip.replaceChildren(h('strong', null, formatValue(b.value)), h('span', null, b.tip || b.label));
        const tw = tip.offsetWidth;
        tip.style.left = `${Math.max(4, Math.min(width - tw - 4, cx - tw / 2))}px`;
        tip.style.top = `${Math.max(0, y - tip.offsetHeight - 8)}px`;
      };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', () => { tip.hidden = true; });
      root.append(hit);
    });
    wrap.append(root, tip);
  });
}
