// Rest timer between sets. Stored as an end time, so it stays correct if the
// screen locks or the page reloads. It can only alert while the app is on screen —
// a web app cannot vibrate or beep from a locked phone.

import { h, clear, icon, openSheet, toast } from '../lib/dom.js';
import { fmtCountdown } from '../lib/format.js';
import { store } from '../core/store.js';

const KEY = 'ironlog:rest';
export const REST_PRESETS = [60, 90, 120, 180];

let state = null; // { endsAt, total }
try { state = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { state = null; }

const save = () => { try { state ? localStorage.setItem(KEY, JSON.stringify(state)) : localStorage.removeItem(KEY); } catch { /* ignore */ } };

export const rest = {
  /** Start a countdown. `label` and `doneText` let the same bar time an AMRAP set. */
  start(seconds, { label = 'Rest', doneText = 'Rest is over — next set.' } = {}) {
    state = { endsAt: Date.now() + seconds * 1000, total: seconds, label, doneText };
    save(); drawBar();
  },
  stop() { state = null; save(); drawBar(); },
  add(seconds) {
    if (!state) return;
    state.endsAt += seconds * 1000; state.total += seconds;
    save(); drawBar();
  },
  remaining() { return state ? (state.endsAt - Date.now()) / 1000 : 0; },
  active() { return !!state; },
};

function alertDone(text) {
  try { if (navigator.vibrate) navigator.vibrate([180, 90, 180]); } catch { /* ignore */ }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      const ac = new Ctx();
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.5);
      o.start(); o.stop(ac.currentTime + 0.55);
      setTimeout(() => ac.close().catch(() => {}), 900);
    }
  } catch { /* sound is optional */ }
  toast(text || 'Rest is over — next set.', { kind: 'info', duration: 5000 });
}

function drawBar() {
  const bar = document.getElementById('rest-bar');
  if (!bar) return;
  clear(bar);
  bar.hidden = !state;
  if (!state) return;
  bar.append(
    h('div', { class: 'rest-track' }, h('div', { class: 'rest-fill', id: 'rest-fill' })),
    h('div', { class: 'rest-row' },
      h('span', { class: 'rest-label' }, icon('timer', 20), state.label || 'Rest'),
      h('span', { class: 'rest-time', id: 'rest-time', 'aria-live': 'off' }, fmtCountdown(rest.remaining())),
      h('button', { class: 'chip-btn', onClick: () => rest.add(15) }, '+15 s'),
      h('button', { class: 'chip-btn', onClick: () => rest.stop() }, 'Skip')));
  tickRest();
}

/** Called by the app ticker a few times a second. */
export function tickRest() {
  if (!state) return;
  const left = rest.remaining();
  if (left <= 0) {
    const late = -left;
    const text = state.doneText;
    state = null; save(); drawBar();
    if (late < 5 && document.visibilityState === 'visible') alertDone(text);
    return;
  }
  const t = document.getElementById('rest-time');
  const f = document.getElementById('rest-fill');
  if (t) t.textContent = fmtCountdown(left);
  if (f) f.style.width = `${Math.max(0, Math.min(100, (left / state.total) * 100))}%`;
}

export function initRestBar() { drawBar(); }

/** Sheet for starting a rest and choosing the default interval. */
export function openRestSheet() {
  openSheet({
    title: 'Rest timer',
    body: (close) => {
      const prefs = store.prefs;
      const auto = h('input', { type: 'checkbox', checked: prefs.restAuto, onChange: (e) => store.setPrefs({ restAuto: e.target.checked }) });
      return h('div', null,
        h('p', { class: 'sheet-text' }, 'Start a countdown now. The one you pick becomes your default.'),
        h('div', { class: 'preset-grid' }, REST_PRESETS.map((s) =>
          h('button', { class: `preset ${prefs.restSeconds === s ? 'on' : ''}`, onClick: () => { store.setPrefs({ restSeconds: s }); rest.start(s); close(); } },
            h('strong', null, s), h('span', null, 'seconds')))),
        h('label', { class: 'check-row' }, auto, h('span', null, 'Start automatically when I check off a set')),
        rest.active() && h('button', { class: 'btn btn-quiet btn-block', onClick: () => { rest.stop(); close(); } }, 'Stop current rest'));
    },
  });
}
