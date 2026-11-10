// Home: start or resume, the last workout, lifetime numbers, weekly frequency, quick templates.

import { h, icon, add } from '../lib/dom.js';
import { fmtDate, fmtDurationShort, fmtVolume, fmtHours, fmtInt, fmtClock, fmtShortDate, plural } from '../lib/format.js';
import { store } from '../core/store.js';
import { timer, weeklyFrequency } from '../core/calc.js';
import { APP_NAME, NOTICE } from '../../config.js';
import { go, pushPage, registerScreen, ctx } from './app.js';
import { openStartSheet, startFromTemplate, repeatWorkout, summarizeExercises } from './active.js';
import { barChart } from './charts.js';
import { renderWorkoutDetail, workoutRow } from './history.js';

function syncBadge() {
  if (ctx.mode !== 'cloud') return null;
  const s = ctx.syncState;
  const offline = s.status === 'offline' || ctx.offlineAuth;
  const text = s.status === 'error' ? 'Sync problem' : offline ? (s.pending ? `Offline, ${s.pending} to upload` : 'Offline') : s.pending ? 'Saving…' : 'Saved';
  return h('button', { class: `sync-badge ${s.status === 'error' ? 'bad' : offline ? 'warn' : ''}`, onClick: () => go('profile'), 'aria-label': `Sync status: ${text}` }, icon('cloud', 16), text);
}

function renderHome(el) {
  const unit = store.prefs.unit;
  const index = store.index(unit);
  const workouts = store.workouts();
  const active = store.active();
  const last = workouts[0];
  const weeks = weeklyFrequency(workouts.map((w) => w.startedAt), 8);
  const thisWeek = weeks[weeks.length - 1].count;

  add(el, h('header', { class: 'home-head' }, h('div', { class: 'wordmark' }, APP_NAME), syncBadge()));
  if (NOTICE) add(el, h('p', { class: 'notice' }, NOTICE));

  add(el, active
    ? h('button', { class: 'btn btn-primary btn-block btn-hero', 'data-action': 'resume', onClick: () => go('workout') },
      h('span', null, `Resume ${active.name}`), h('span', { class: 'hero-clock', 'data-live': 'timer' }, fmtClock(timer.elapsedMs(active.timer) / 1000)))
    : h('button', { class: 'btn btn-primary btn-block btn-hero', 'data-action': 'start', onClick: openStartSheet }, h('span', null, 'Start workout')));

  const templates = store.templates();
  if (templates.length && !active) {
    add(el, h('div', { class: 'quick', 'aria-label': 'Saved routines' }, templates.map((t) =>
      h('button', { class: 'chip chip-lg', type: 'button', 'data-quick': t.name, onClick: () => startFromTemplate(t) }, t.name))));
  }

  const stat = (value, label, onClick) => h(onClick ? 'button' : 'div', { class: 'stat', onClick }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
  add(el, h('section', { class: 'stats', 'aria-label': 'Totals' },
    stat(fmtInt(index.totals.workouts), index.totals.workouts === 1 ? 'workout' : 'workouts', () => go('history')),
    stat(fmtHours(index.totals.seconds), 'hours'),
    stat(fmtInt(index.totals.prs), index.totals.prs === 1 ? 'record' : 'records', () => go('progress')),
    stat(String(thisWeek), 'this week')));

  if (!workouts.length) {
    add(el, h('div', { class: 'empty' },
      h('p', { class: 'empty-title' }, 'Your log starts with the first set'),
      h('p', null, 'Start a workout, check off sets as you go, and next time your previous numbers will be waiting beside every exercise.')));
    return;
  }

  const sum = index.byWorkout.get(last.id) || { volume: 0, setCount: 0, prs: [] };
  add(el, h('section', { class: 'block' },
    h('h2', { class: 'block-title' }, 'Last workout'),
    h('div', { class: 'last' },
      h('button', { class: 'last-main', onClick: () => pushPage((v) => renderWorkoutDetail(v, last.id)) },
        h('span', { class: 'last-name' }, last.name),
        h('span', { class: 'list-meta' }, `${fmtDate(last.startedAt)}, ${fmtDurationShort(last.durationSec)}`),
        h('span', { class: 'last-facts' },
          h('span', null, h('strong', null, String(sum.setCount)), sum.setCount === 1 ? ' set' : ' sets'),
          h('span', null, h('strong', null, fmtInt(sum.volume)), ` ${unit}`),
          sum.prs.length > 0 && h('span', { class: 'accent' }, h('strong', null, String(sum.prs.length)), sum.prs.length === 1 ? ' record' : ' records')),
        h('span', { class: 'list-sub' }, summarizeExercises(last, 4))),
      h('button', { class: 'btn btn-outline', 'data-action': 'repeat-last', onClick: () => repeatWorkout(last) }, icon('repeat', 18), 'Repeat'))));

  add(el, h('section', { class: 'block' },
    h('h2', { class: 'block-title' }, 'Workouts per week'),
    barChart({
      label: 'Workouts per week, last 8 weeks',
      highlightLast: true,
      bars: weeks.map((w, i) => ({
        label: i === weeks.length - 1 ? 'This wk' : fmtShortDate(w.start),
        value: w.count,
        tip: `Week of ${fmtShortDate(w.start)}`,
      })),
      formatValue: (v) => plural(v, 'workout'),
    })));

  if (workouts.length > 1) {
    add(el, h('section', { class: 'block' },
      h('div', { class: 'block-head' }, h('h2', { class: 'block-title' }, 'Recent'), h('button', { class: 'link', onClick: () => go('history') }, 'All history')),
      h('div', { class: 'list' }, workouts.slice(1, 5).map((w) => workoutRow(w, index, unit)))));
  }
}

registerScreen('home', renderHome);