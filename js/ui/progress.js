// Progress tab: per-exercise charts over time, and the personal-records dashboard.

import { h, icon, segmented, add } from '../lib/dom.js';
import { fmtDate, fmtNum, fmtSet, fmtWeight, fmtVolume, fmtShortDate, plural } from '../lib/format.js';
import { store } from '../core/store.js';
import { exerciseSeries, RANGES, rangeStart, weekStart, E1RM_MAX_REPS } from '../core/calc.js';
import { pushPage, registerScreen, pageHeader, screenHeader, refresh } from './app.js';
import { lineChart, barChart } from './charts.js';
import { pickExercise } from './pickers.js';
import { renderWorkoutDetail } from './history.js';
import { prLine } from './active.js';

const view = { tab: 'exercise', exerciseId: null, range: '90d', metric: 'maxWeight' };

const METRICS = [
  { id: 'maxWeight', label: 'Max weight' },
  { id: 'e1rm', label: 'Est. 1RM' },
  { id: 'volume', label: 'Volume' },
  { id: 'bestReps', label: 'Reps' },
];

function renderProgress(el) {
  add(el, 
    screenHeader('Progress'),
    segmented([{ id: 'exercise', label: 'By exercise' }, { id: 'records', label: 'Personal records' }], view.tab, (id) => { view.tab = id; refresh(); }, { label: 'Progress section' }));
  if (view.tab === 'records') renderRecords(el);
  else renderExercise(el, view, true);
}

registerScreen('progress', renderProgress);

/** Open one exercise's progress as its own page (used from the exercise library and the records list). */
export function openExerciseProgress(exerciseId) {
  const st = { exerciseId, range: view.range, metric: view.metric };
  pushPage((el) => {
    add(el, pageHeader(store.exerciseName(exerciseId)));
    renderExercise(el, st, false);
  });
}

// ---------- one exercise ----------

function frequencyBars(sessions, rangeId) {
  if (!sessions.length) return [];
  const from = rangeStart(rangeId) || new Date(sessions[0].date);
  const now = new Date();
  const days = (now - from) / 86400000;
  const bars = [];
  if (days <= 190) {
    const first = weekStart(from);
    for (let d = new Date(first); d <= now; d.setDate(d.getDate() + 7)) bars.push({ start: new Date(d), value: 0, label: fmtShortDate(d), tip: `Week of ${fmtShortDate(d)}` });
    for (const s of sessions) {
      const i = Math.round((weekStart(s.date) - first) / (7 * 86400000));
      if (bars[i]) bars[i].value += 1;
    }
  } else {
    const first = new Date(from.getFullYear(), from.getMonth(), 1);
    for (let d = new Date(first); d <= now; d.setMonth(d.getMonth() + 1)) {
      bars.push({ start: new Date(d), value: 0, label: d.toLocaleDateString(undefined, { month: 'short' }), tip: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) });
    }
    for (const s of sessions) {
      const d = new Date(s.date);
      const i = (d.getFullYear() - first.getFullYear()) * 12 + d.getMonth() - first.getMonth();
      if (bars[i]) bars[i].value += 1;
    }
  }
  return bars;
}

function renderExercise(el, st, showPicker) {
  const unit = store.prefs.unit;
  const index = store.index(unit);

  if (!st.exerciseId || !index.exercises.has(st.exerciseId)) {
    // default to the most recently performed exercise
    let latest = null;
    for (const ex of index.exercises.values()) {
      const d = ex.sessions[ex.sessions.length - 1].date;
      if (!latest || d > latest.d) latest = { id: ex.exerciseId, d };
    }
    if (showPicker || !st.exerciseId) st.exerciseId = latest ? latest.id : null;
  }
  const ex = st.exerciseId ? index.exercises.get(st.exerciseId) : null;

  if (showPicker) {
    add(el, h('button', { class: 'select-btn', 'data-action': 'pick-exercise', disabled: index.exercises.size === 0, onClick: () => pickExercise({ title: 'Choose exercise', onlyWithHistory: true, onPick: (e) => { st.exerciseId = e.id; refresh(); } }) },
      h('span', null, ex ? store.exerciseName(ex.exerciseId, ex.name) : 'Choose exercise'), icon('down', 20)));
  }
  if (!ex) {
    add(el, h('div', { class: 'empty' },
      h('p', { class: 'empty-title' }, st.exerciseId ? 'Not logged yet' : 'No progress to show yet'),
      h('p', null, st.exerciseId ? 'Log this exercise in a workout and its history, charts and records will appear here.' : 'Finish a workout and each exercise gets its own chart and records here.')));
    return;
  }

  const series = exerciseSeries(index, st.exerciseId, st.range);
  const metric = METRICS.find((m) => m.id === st.metric) || METRICS[0];
  const fmtValue = {
    maxWeight: (v) => fmtWeight(v, unit),
    e1rm: (v) => `${fmtWeight(Math.round(v), unit)} est.`,
    volume: (v) => fmtVolume(v, unit),
    bestReps: (v) => plural(v, 'rep'),
  }[metric.id];
  const titles = {
    maxWeight: 'Heaviest set each session',
    e1rm: `Estimated 1RM each session (Epley, sets of 1–${E1RM_MAX_REPS} reps)`,
    volume: 'Total volume each session (weight × reps)',
    bestReps: 'Most reps in one set each session',
  };

  add(el, 
    segmented(RANGES.map((r) => ({ id: r.id, label: r.id === 'all' ? 'All' : r.id === '6m' ? '6 mo' : r.id === '1y' ? '1 yr' : r.label.replace(' days', ' d') })), st.range, (id) => { st.range = id; refresh(); }, { label: 'Time range', small: true }),
    h('section', { class: 'block' },
      segmented(METRICS, st.metric, (id) => { st.metric = id; refresh(); }, { label: 'Chart metric', small: true }),
      h('p', { class: 'chart-title' }, titles[metric.id]),
      lineChart({
        label: `${ex.name}: ${titles[metric.id]}`,
        points: series.map((p) => ({ x: p.date, y: p[metric.id], note: metric.id === 'maxWeight' ? `${fmtSet(p.maxWeight, p.topReps)}` : p.workoutName })),
        formatValue: fmtValue,
      })),
    h('section', { class: 'block' },
      h('h2', { class: 'block-title' }, 'How often'),
      barChart({ label: `${ex.name} sessions over time`, bars: frequencyBars(series, st.range), formatValue: (v) => plural(v, 'session'), height: 130, highlightLast: true })));

  // records for this exercise
  const r = ex.records;
  const row = (label, value, meta) => h('div', { class: 'rec-row' }, h('dt', null, label), h('dd', null, h('strong', null, value), meta && h('span', { class: 'muted' }, meta)));
  add(el, h('section', { class: 'block' },
    h('h2', { class: 'block-title' }, 'Personal records'),
    h('dl', { class: 'rec' },
      r.heaviest && row('Heaviest lift', `${fmtSet(r.heaviest.weight, r.heaviest.reps)} ${unit}`, fmtDate(r.heaviest.date, { weekday: false, relative: false })),
      r.bestEst && row('Best estimated 1RM', `${fmtWeight(Math.round(r.bestEst.value), unit)} est.`, r.bestEst.reps === 1 ? 'an actual single' : `calculated from ${fmtSet(r.bestEst.weight, r.bestEst.reps)}`),
      r.bestEst && row('Best rep performance', `${fmtSet(r.bestEst.weight, r.bestEst.reps)} ${unit}`, fmtDate(r.bestEst.date, { weekday: false, relative: false })),
      r.bestVolume && row('Most volume in a workout', fmtVolume(r.bestVolume.value, unit), fmtDate(r.bestVolume.date, { weekday: false, relative: false })),
      row('Most recent PR', r.lastPrDate ? fmtDate(r.lastPrDate, { weekday: false, relative: false }) : 'None yet', r.lastPrDate ? '' : 'the first session set the baseline'),
      row('Times performed', String(ex.sessions.length)))));

  // session list — the same data as the chart, as a table
  add(el, h('section', { class: 'block' },
    h('h2', { class: 'block-title' }, `Sessions in this range`),
    series.length
      ? h('div', { class: 'list' }, [...series].reverse().map((p) =>
        h('button', { class: 'list-row', onClick: () => pushPage((v) => renderWorkoutDetail(v, p.workoutId)) },
          h('span', { class: 'list-main' },
            h('span', { class: 'list-title' }, fmtDate(p.date, { relative: false }), p.prs.length > 0 && h('span', { class: 'pr-chip' }, icon('medal', 14), String(p.prs.length))),
            h('span', { class: 'list-sub sets-line' }, p.sets.map((s) => fmtSet(s.weight, s.reps)).join('   '))),
          h('span', { class: 'row-value' }, h('strong', null, fmtNum(p.maxWeight)), ` × ${p.topReps}`))))
      : h('p', { class: 'empty-note' }, 'No sessions in this range. Try a longer one.')));
}

// ---------- PR dashboard ----------

function renderRecords(el) {
  const unit = store.prefs.unit;
  const index = store.index(unit);
  if (!index.exercises.size) {
    add(el, h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, 'No records yet'), h('p', null, 'Your first session of each exercise sets the baseline. Beat it and the record shows up here.')));
    return;
  }
  const fact = (value, label) => h('div', { class: 'fact' }, h('div', { class: 'fact-value' }, value), h('div', { class: 'fact-label' }, label));
  add(el, h('div', { class: 'facts' },
    fact(String(index.totals.prs), index.totals.prs === 1 ? 'record set' : 'records set'),
    fact(String(index.exercises.size), index.exercises.size === 1 ? 'exercise tracked' : 'exercises tracked'),
    fact(index.bestWorkoutVolume ? fmtVolume(index.bestWorkoutVolume.value, unit) : '—', 'biggest workout')));

  const recent = index.prEvents.slice(-5).reverse();
  if (recent.length) {
    add(el, h('section', { class: 'block' },
      h('h2', { class: 'block-title' }, 'Latest records'),
      h('ul', { class: 'pr-list' }, recent.map((ev) => {
        const l = prLine(ev, unit);
        return h('li', { class: 'pr-item' }, h('span', { class: 'pr-medal' }, icon('medal', 20)),
          h('div', null, h('div', { class: 'pr-title' }, h('span', null, l.title), h('span', { class: 'muted' }, fmtDate(ev.date, { weekday: false }))), h('div', { class: 'pr-text' }, l.text)));
      }))));
  }

  const rows = [...index.exercises.values()].sort((a, b) => store.exerciseName(a.exerciseId, a.name).localeCompare(store.exerciseName(b.exerciseId, b.name)));
  add(el, h('section', { class: 'block' },
    h('h2', { class: 'block-title' }, 'All exercises'),
    h('p', { class: 'hint' }, `Estimated 1RM uses the Epley formula — weight × (1 + reps ÷ 30) — and is always marked “est.” It is never counted as a lift you completed.`),
    h('div', { class: 'list' }, rows.map((ex) => {
      const r = ex.records;
      return h('button', { class: 'list-row rec-card', 'data-record': ex.exerciseId, onClick: () => openExerciseProgress(ex.exerciseId) },
        h('span', { class: 'list-main' },
          h('span', { class: 'list-title' }, store.exerciseName(ex.exerciseId, ex.name)),
          h('span', { class: 'rec-grid' },
            h('span', null, h('small', null, 'Heaviest'), h('strong', null, r.heaviest ? `${fmtSet(r.heaviest.weight, r.heaviest.reps)}` : '—')),
            h('span', null, h('small', null, 'Est. 1RM'), h('strong', null, r.bestEst ? `${fmtNum(Math.round(r.bestEst.value))} ${unit}` : '—')),
            h('span', null, h('small', null, 'Last PR'), h('strong', null, r.lastPrDate ? fmtDate(r.lastPrDate, { weekday: false, relative: false }) : '—')))),
        icon('next', 18));
    }))));
}
