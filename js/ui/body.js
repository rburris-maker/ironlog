// Body: a front/back muscle map showing either how recovered each muscle is
// or how strong it is against published bodyweight standards.

import { h, svg, add, icon, segmented, openSheet, toast } from '../lib/dom.js';
import { fmtDate, fmtNum, fmtSet, fmtWeight, parseNum, plural } from '../lib/format.js';
import { store } from '../core/store.js';
import { convert, E1RM_MAX_REPS } from '../core/calc.js';
import { MUSCLES, muscleName } from '../core/exercises.js';
import { recoveryStatus, strengthRatings, nextLevel, tiredMuscles, LEVELS, LEVEL_PERCENTILES, BELOW_BEGINNER, STANDARDS_SOURCE, RECOVERY } from '../core/body.js';
import { refresh } from './app.js';

export const bodyView = { mode: 'recovery' };

const STATE = {
  worked: { label: 'Needs rest', cls: 'st-worked' },
  recovering: { label: 'Recovering', cls: 'st-recovering' },
  fresh: { label: 'Fresh', cls: 'st-fresh' },
};
const SORENESS = [
  { id: 'fresh', label: 'Fresh' },
  { id: 'sore', label: 'A bit sore' },
  { id: 'very', label: 'Very sore' },
];

export function currentRecovery() {
  const index = store.index();
  return recoveryStatus({ workouts: store.list('workout'), index, musclesFor: (id) => store.musclesFor(id), soreness: store.prefs.soreness });
}

function currentRatings() {
  return strengthRatings({ index: store.index(), bodyweightLog: store.prefs.bodyweightLog, table: store.prefs.standards });
}

/** A date for the middle of a sentence: "today", "yesterday", "Nov 7". */
const when = (iso) => { const t = fmtDate(iso, { weekday: false }); return /^(Today|Yesterday)$/.test(t) ? t.toLowerCase() : t; };

/** "ready in about 14 h" */
export function fmtReady(hours) {
  if (!(hours > 0)) return 'ready now';
  if (hours < 1) return 'ready within the hour';
  if (hours < 36) return `ready in about ${Math.round(hours)} h`;
  return `ready in about ${Math.round(hours / 24)} days`;
}

/** Muscles in a template or workout that still need rest, as names. Used by the start sheet. */
export function stillRecovering(exerciseIds, status) {
  return tiredMuscles(exerciseIds, status, (id) => store.musclesFor(id)).map(muscleName);
}

// ---------- the figure ----------
// Drawn from straight-edged plates on a 160 × 300 grid. Left-side shapes are mirrored.

const mirror = (pts) => pts.map(([x, y]) => [160 - x, y]);
const both = (pts) => [pts, mirror(pts)];
const points = (pts) => pts.map((p) => p.join(',')).join(' ');

const SILHOUETTE = [
  [[73, 37], [87, 37], [90, 50], [70, 50]],                                                     // neck
  [[52, 50], [108, 50], [113, 70], [104, 122], [107, 150], [53, 150], [56, 122], [47, 70]],     // torso
  ...both([[50, 52], [35, 60], [27, 100], [21, 150], [24, 170], [35, 170], [40, 150], [47, 104], [53, 72]]), // arms
  ...both([[53, 146], [80, 146], [79, 162], [75, 216], [73, 262], [76, 292], [56, 292], [56, 262], [51, 216], [49, 170]]), // legs
];

const SHOULDER = [[35, 59], [50, 52], [54, 58], [52, 72], [40, 79], [32, 71]];
const UPPER_ARM = [[32, 77], [42, 82], [45, 88], [42, 113], [30, 113], [28, 93]];
const FOREARM = [[28, 118], [42, 118], [38, 153], [25, 155], [23, 137]];
const LOWER_LEG = [[56, 226], [74, 226], [72, 268], [61, 274], [55, 248]];

const FRONT = {
  shoulders: both(SHOULDER),
  chest: both([[56, 56], [78, 55], [78, 80], [64, 85], [54, 77]]),
  biceps: both(UPPER_ARM),
  forearms: both(FOREARM),
  abs: [[[64, 89], [80, 84], [96, 89], [95, 129], [80, 139], [65, 129]]],
  quads: both([[55, 153], [78, 153], [76, 213], [58, 215], [51, 181]]),
  calves: both(LOWER_LEG),
};

const BACK = {
  shoulders: both(SHOULDER),
  back: [[[56, 54], [80, 50], [104, 54], [109, 75], [100, 105], [80, 113], [60, 105], [51, 75]]],
  lowerBack: [[[62, 109], [80, 117], [98, 109], [100, 131], [80, 137], [60, 131]]],
  triceps: both(UPPER_ARM),
  forearms: both(FOREARM),
  glutes: both([[56, 138], [79, 141], [79, 167], [60, 171], [52, 156]]),
  hamstrings: both([[54, 176], [78, 172], [76, 216], [58, 218], [51, 195]]),
  calves: both(LOWER_LEG),
};

function figure(regions, caption, describe, onPick) {
  const el = svg('svg', { viewBox: '0 0 160 300', class: 'figure', role: 'group', 'aria-label': `${caption} of the body` });
  el.append(svg('ellipse', { cx: 80, cy: 23, rx: 13, ry: 16, class: 'fig-base' }));
  for (const pts of SILHOUETTE) el.append(svg('polygon', { points: points(pts), class: 'fig-base' }));
  for (const [muscle, shapes] of Object.entries(regions)) {
    const d = describe(muscle);
    const g = svg('g', { class: `fig-m ${d.cls}`, role: 'button', tabindex: '0', 'aria-label': `${muscleName(muscle)}: ${d.text}`, 'data-muscle': muscle,
      onClick: () => onPick(muscle),
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(muscle); } } });
    for (const pts of shapes) g.append(svg('polygon', { points: points(pts) }));
    el.append(g);
  }
  return h('figure', { class: 'fig' }, el, h('figcaption', null, caption));
}

function bodyMap(describe, onPick) {
  return h('div', { class: 'body-map' }, figure(FRONT, 'Front', describe, onPick), figure(BACK, 'Back', describe, onPick));
}

const legend = (items) => h('ul', { class: 'legend', 'aria-label': 'Key' }, items.map(([cls, label]) => h('li', null, h('i', { class: `swatch ${cls}` }), label)));

const meter = (pct, cls) => h('span', { class: `meter ${cls}`, 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.max(0, Math.min(100, pct))}%` } }));

const levelClass = (m) => (m.score == null ? 'lv-none' : `lv-${m.levelIndex + 1}`);

// ---------- screen ----------

export function renderBody(el) {
  add(el, segmented([{ id: 'recovery', label: 'Recovery' }, { id: 'strength', label: 'Strength' }], bodyView.mode, (id) => { bodyView.mode = id; refresh(); }, { label: 'Body view', small: true }));
  if (bodyView.mode === 'strength') renderStrength(el);
  else renderRecovery(el);
}

function renderRecovery(el) {
  const status = currentRecovery();
  const by = new Map(status.map((s) => [s.muscle, s]));
  const count = (state) => status.filter((s) => s.state === state).length;
  const fact = (value, label, attrs = {}) => h('div', { class: 'fact', ...attrs }, h('div', { class: 'fact-value' }, value), h('div', { class: 'fact-label' }, label));
  const trained = status.some((s) => s.lastWorked || s.report);

  add(el,
    h('div', { class: 'facts' },
      fact(String(count('worked')), 'need rest', { 'data-count': 'worked' }),
      fact(String(count('recovering')), 'recovering', { 'data-count': 'recovering' }),
      fact(String(count('fresh')), 'fresh', { 'data-count': 'fresh' })),
    bodyMap((m) => { const s = by.get(m); return { cls: STATE[s.state].cls, text: STATE[s.state].label }; }, openMuscle),
    legend([['st-worked', 'Needs rest'], ['st-recovering', 'Recovering'], ['st-fresh', 'Fresh']]),
    !trained && h('p', { class: 'note' }, 'Nothing logged in the last 7 days, so every muscle is shown as fresh. Finish a workout and the muscles you trained light up here.'));

  const rows = [...status].sort((a, b) => b.raw - a.raw);
  add(el, h('section', { class: 'block' },
    h('h2', { class: 'block-title' }, 'Muscle by muscle'),
    h('div', { class: 'list' }, rows.map((s) =>
      h('button', { class: 'list-row', type: 'button', 'data-muscle-row': s.muscle, 'data-state': s.state, onClick: () => openMuscle(s.muscle) },
        h('span', { class: 'list-main' },
          h('span', { class: 'list-title' }, muscleName(s.muscle)),
          h('span', { class: 'list-meta' }, s.lastWorked ? `Last worked ${when(s.lastWorked)}${s.sets ? `, ${plural(s.sets, 'set')} this week` : ''}` : 'Not trained in the last 7 days'),
          meter(s.pct, STATE[s.state].cls)),
        h('span', { class: `state ${STATE[s.state].cls}` }, h('strong', null, STATE[s.state].label), s.state !== 'fresh' && h('small', null, fmtReady(s.readyInHours).replace('ready ', ''))))))),
  h('p', { class: 'hint' }, `This is an estimate from the sets you check off, not a measurement of your body. Each set loads the muscles that exercise works (assisting muscles count half, warm-ups count less, AMRAP sets count more) and the load fades by half every ${RECOVERY.halfLifeHours} hours. Tap a muscle to tell the app how it actually feels.`));
}

function renderStrength(el) {
  const prefs = store.prefs;
  const unit = prefs.unit;
  const ratings = currentRatings();
  const bw = store.bodyweight();

  if (!ratings.ready) {
    add(el, h('section', { class: 'block' },
      h('h2', { class: 'block-title' }, 'Set up strength ratings'),
      h('p', { class: 'note' }, 'Ratings compare your best lifts with published standards for your bodyweight, so the app needs two things.'),
      bodyForm({ submitLabel: 'Show my ratings' })));
    return;
  }

  const by = new Map(ratings.muscles.map((m) => [m.muscle, m]));
  const o = ratings.overall;
  const fact = (value, label, attrs = {}) => h('div', { class: 'fact', ...attrs }, h('div', { class: 'fact-value' }, value), h('div', { class: 'fact-label' }, label));

  if (o) {
    add(el,
      h('div', { class: 'overall', 'data-overall': String(o.score) },
        h('div', { class: 'state-line' }, h('strong', null, o.level), h('span', null, `overall — score ${o.score} of 100`)),
        meter(o.score, 'lv-meter')),
      h('div', { class: 'facts facts-2' },
        fact(muscleName(o.strongest.muscle), 'strongest'),
        fact(o.rated > 1 ? muscleName(o.weakest.muscle) : '—', 'furthest behind')));
  }

  add(el,
    bodyMap((m) => { const r = by.get(m); return { cls: levelClass(r), text: r.score == null ? 'not rated' : `${r.level}, score ${r.score}` }; }, openMuscle),
    legend([['lv-0', BELOW_BEGINNER], ...LEVELS.map((l, i) => [`lv-${i + 1}`, l]), ['lv-none', 'Not rated']]),
    !o && h('p', { class: 'note' }, `No rated lifts yet. Log bench press, squat, deadlift, overhead press, a row or a curl with sets of 1–${E1RM_MAX_REPS} reps and the muscles they train are rated here.`));

  const rows = [...ratings.muscles].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  add(el, h('section', { class: 'block' },
    h('h2', { class: 'block-title' }, 'Muscle by muscle'),
    h('div', { class: 'list' }, rows.map((m) => {
      const sub = m.score != null
        ? `${m.indirect ? 'Estimated from' : 'From'} ${store.exerciseName(m.from.exerciseId, m.from.name)}, ${fmtNum(m.from.ratio)}× bodyweight`
        : m.reason === 'no-standard' ? 'No bodyweight standard — recovery only' : 'No rated lift logged yet';
      return h('button', { class: 'list-row', type: 'button', 'data-muscle-row': m.muscle, 'data-level': m.score == null ? '' : m.level, onClick: () => openMuscle(m.muscle) },
        h('span', { class: 'list-main' },
          h('span', { class: 'list-title' }, muscleName(m.muscle)),
          h('span', { class: 'list-meta' }, sub),
          m.score != null && meter(m.score, 'lv-meter')),
        m.score != null
          ? h('span', { class: 'state' }, h('strong', null, m.level), h('small', null, `score ${m.score}`))
          : h('span', { class: 'state muted' }, h('small', null, 'Not rated')));
    }))));

  add(el,
    h('section', { class: 'block' },
      h('h2', { class: 'block-title' }, 'What the levels mean'),
      h('dl', { class: 'rec levels' }, LEVELS.map((l, i) => h('div', { class: 'rec-row' }, h('dt', null, h('i', { class: `swatch lv-${i + 1}` }), l), h('dd', null, h('span', null, `stronger than ${LEVEL_PERCENTILES[i]}% of lifters`), h('span', { class: 'muted' }, `score ${(i + 1) * 20}${i < LEVELS.length - 1 ? `–${(i + 2) * 20 - 1}` : ''}`))))),
      h('p', { class: 'hint' },
        `Each muscle takes the level of your best lift that trains it directly, from the last 6 months: estimated 1RM (Epley, sets of 1–${E1RM_MAX_REPS} reps) ÷ your bodyweight on the day, compared with the ${prefs.standards === 'female' ? 'women’s' : 'men’s'} bodyweight-ratio standards published by `,
        h('a', { href: STANDARDS_SOURCE.url, target: '_blank', rel: 'noopener' }, STANDARDS_SOURCE.name),
        '. Dumbbell lifts use the weight of one dumbbell. Forearms, abs and calves have no standard here and are tracked for recovery only.')),
    h('button', { class: 'btn btn-quiet btn-block', type: 'button', 'data-action': 'edit-body', onClick: () => editBody() },
      `Bodyweight ${fmtWeight(convert(bw.weight, bw.unit, unit), unit)} · ${prefs.standards === 'female' ? 'Women’s' : 'Men’s'} standards · Change`));
}

// ---------- bodyweight + standards form (also used from Profile) ----------

export function bodyForm({ submitLabel = 'Save', onDone = null } = {}) {
  const prefs = store.prefs;
  const unit = prefs.unit;
  const bw = store.bodyweight();
  let table = prefs.standards || '';
  const input = h('input', { class: 'field field-lg num-field', type: 'text', inputmode: 'decimal', name: 'bodyweight', autocomplete: 'off', placeholder: unit === 'kg' ? 'e.g. 80' : 'e.g. 180', 'aria-label': `Bodyweight in ${unit}`, value: bw ? fmtNum(convert(bw.weight, bw.unit, unit), 1) : '' });
  const status = h('p', { class: 'auth-note', role: 'status' });
  return h('form', { class: 'body-form', 'data-form': 'body', onSubmit: (e) => {
    e.preventDefault();
    const w = parseNum(input.value);
    const [lo, hi] = unit === 'kg' ? [25, 300] : [55, 660];
    if (!(w >= lo && w <= hi)) { status.textContent = `Enter your bodyweight in ${unit}.`; status.className = 'auth-note bad'; input.focus(); return; }
    if (!table) { status.textContent = 'Choose which standards to compare with.'; status.className = 'auth-note bad'; return; }
    const same = bw && Math.abs(convert(bw.weight, bw.unit, unit) - w) < 0.05;
    if (!same) store.setBodyweight(w, unit);
    if (table !== prefs.standards) store.setPrefs({ standards: table });
    if (onDone) onDone();
    else if (same && table === prefs.standards) refresh();
  } },
    h('label', { class: 'label' }, `Bodyweight (${unit})`, input),
    h('div', { class: 'label' }, 'Compare with',
      segmented([{ id: 'male', label: 'Men’s standards' }, { id: 'female', label: 'Women’s standards' }], table, (id) => { table = id; }, { label: 'Strength standards' })),
    h('p', { class: 'hint' }, 'The published tables are split into men’s and women’s. Update your bodyweight whenever it changes; ratings use what you weighed on the day of each lift.'),
    status,
    h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, submitLabel));
}

export function editBody() {
  openSheet({
    title: 'Bodyweight and standards',
    body: (close) => bodyForm({ onDone: () => { close(); toast('Saved'); } }),
  });
}

// ---------- one muscle ----------

export function openMuscle(muscle) {
  const unit = store.prefs.unit;
  const s = currentRecovery().find((x) => x.muscle === muscle);
  const r = currentRatings().muscles.find((x) => x.muscle === muscle);
  const def = MUSCLES.find((m) => m.id === muscle);
  const bw = store.bodyweight();
  const bwNow = bw ? convert(bw.weight, bw.unit, unit) : null;

  openSheet({
    title: def.detail ? `${def.name} (${def.detail})` : def.name,
    full: true,
    body: (close) => {
      const feel = (level) => { store.setSoreness(muscle, level); close(); toast(level ? `${def.name} marked ${SORENESS.find((x) => x.id === level).label.toLowerCase()}` : 'Check-in cleared'); };
      const recovery = h('section', { class: 'block' },
        h('h3', { class: 'block-title' }, 'Recovery'),
        h('div', { class: `state-line ${STATE[s.state].cls}`, 'data-sheet-state': s.state }, h('strong', null, STATE[s.state].label), h('span', null, s.state === 'fresh' ? 'ready to train' : fmtReady(s.readyInHours))),
        meter(s.pct, STATE[s.state].cls),
        h('p', { class: 'note' }, s.lastWorked
          ? `Last worked ${when(s.lastWorked)}. ${s.sets ? `${plural(s.sets, 'set')} aimed at it in the last 7 days.` : 'Only as an assisting muscle in the last 7 days.'}`
          : 'Not trained in the last 7 days.'),
        s.report && h('p', { class: 'note' }, `You marked it “${SORENESS.find((x) => x.id === s.report.level).label.toLowerCase()}” ${when(s.report.at)}; the estimate starts from there.`),
        h('p', { class: 'label' }, 'How does it feel right now?'),
        h('div', { class: 'btn-row feel' }, SORENESS.map((o) => h('button', { class: `btn btn-quiet ${s.report && s.report.level === o.id ? 'on' : ''}`, type: 'button', 'data-feel': o.id, onClick: () => feel(o.id) }, o.label))),
        s.report && h('button', { class: 'btn btn-text', type: 'button', onClick: () => feel(null) }, 'Clear my check-in'));

      let strength;
      if (r.score != null) {
        strength = h('section', { class: 'block' },
          h('h3', { class: 'block-title' }, 'Strength'),
          h('div', { class: 'state-line', 'data-sheet-level': r.level }, h('strong', null, r.level), h('span', null, `score ${r.score} of 100`)),
          meter(r.score, 'lv-meter'),
          r.indirect && h('p', { class: 'note' }, `Estimated from lifts where this muscle only assists. Log ${r.suggest.filter((x) => x.direct).map((x) => store.exerciseName(x.exerciseId)).join(' or ')} for a direct rating.`),
          h('div', { class: 'list' }, r.lifts.map((l) => {
            const nx = nextLevel(l, bwNow);
            return h('div', { class: 'list-row lift-row' },
              h('span', { class: 'list-main' },
                h('span', { class: 'list-title' }, store.exerciseName(l.exerciseId, l.name), l.rates[muscle] < 1 && h('span', { class: 'tag' }, 'Assists')),
                h('span', { class: 'list-meta' }, `${fmtWeight(Math.round(l.e1rm), unit)} est. 1RM${l.reps > 1 ? ` from ${fmtSet(l.weight, l.reps)}` : ''}, ${fmtNum(l.ratio)}× bodyweight`),
                h('span', { class: 'list-meta' }, `${fmtDate(l.date, { weekday: false, relative: false })}${l.stale ? ' — more than 6 months ago' : ''}${l.perDumbbell ? ' · per dumbbell' : ''}`),
                nx && h('span', { class: 'list-meta accent' }, `${nx.level} at ${fmtNum(nx.ratio)}×${nx.e1rm ? ` — about ${fmtWeight(Math.round(nx.e1rm), unit)}` : ''}`)),
              h('span', { class: 'state' }, h('strong', null, l.level), h('small', null, `score ${l.score}`)));
          })));
      } else {
        const names = r.suggest.map((x) => store.exerciseName(x.exerciseId));
        strength = h('section', { class: 'block' },
          h('h3', { class: 'block-title' }, 'Strength'),
          h('p', { class: 'note' }, r.reason === 'no-standard'
            ? `There is no bodyweight standard in the app for ${def.name.toLowerCase()}, so this muscle is tracked for recovery only.`
            : r.reason === 'setup'
              ? 'Add your bodyweight in Progress → Body → Strength to see a rating.'
              : `Not rated yet. Log one of these with a set of 1–${E1RM_MAX_REPS} reps: ${names.join(', ')}.`));
      }
      return h('div', { class: 'muscle-sheet' }, recovery, strength);
    },
  });
}

// ---------- Home summary ----------

/** A short recovery block for the Home screen; null when there is nothing recent to report. */
export function recoverySummary(onOpen) {
  const status = currentRecovery();
  if (!status.some((s) => s.lastWorked || s.report)) return null;
  const names = (state) => status.filter((s) => s.state === state).sort((a, b) => b.raw - a.raw).map((s) => muscleName(s.muscle));
  const worked = names('worked');
  const recovering = names('recovering');
  const line = (cls, label, list) => list.length > 0 && h('p', { class: 'recov-line' }, h('i', { class: `swatch ${cls}` }), h('strong', null, label), h('span', null, list.join(', ')));
  return h('section', { class: 'block', 'data-block': 'recovery' },
    h('div', { class: 'block-head' }, h('h2', { class: 'block-title' }, 'Recovery'), h('button', { class: 'link', type: 'button', onClick: onOpen }, 'Body map')),
    h('button', { class: 'recov', type: 'button', onClick: onOpen },
      line('st-worked', 'Needs rest', worked),
      line('st-recovering', 'Recovering', recovering),
      !worked.length && !recovering.length && h('p', { class: 'recov-line' }, h('i', { class: 'swatch st-fresh' }), h('strong', null, 'All fresh'), h('span', null, 'every muscle group is ready to train')),
      icon('next', 18)));
}
