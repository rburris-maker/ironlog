// The live workout: starting (blank / template / repeat), the timer header,
// finishing and the post-workout summary.

import { h, icon, openSheet, confirmDialog, promptDialog, toast, add } from '../lib/dom.js';
import { fmtClock, fmtDate, fmtDurationLong, fmtVolume, fmtWeight, fmtSet, plural, fmtInt } from '../lib/format.js';
import { store } from '../core/store.js';
import { timer } from '../core/calc.js';
import { blankWorkout, workoutFromTemplate, workoutFromPrevious, finishWorkout, filledButUnchecked, completedSetCount, templateFromWorkout } from '../core/session.js';
import { go, pushPage, registerScreen, currentRoute } from './app.js';
import { workoutEditor } from './editor.js';
import { rest, openRestSheet } from './rest.js';
import { currentRecovery, stillRecovering } from './body.js';
import { groupsChanged } from './groupstate.js';

const nameOf = (id, fallback) => store.exerciseName(id, fallback);

export function summarizeExercises(w, max = 3) {
  const names = (w.exercises || []).map((e) => e.name);
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} + ${names.length - max} more`;
}

// ---------- starting ----------

async function begin(workout) {
  const cur = store.active();
  if (cur) {
    const ok = await confirmDialog({
      title: 'A workout is already in progress',
      message: `“${cur.name}” is still running. Starting a new one discards it.`,
      confirmLabel: 'Discard and start new', cancelLabel: 'Keep current', danger: true,
    });
    if (!ok) { go('workout'); return; }
    store.remove('workout', cur.id);
  }
  rest.stop();
  store.saveWorkout(workout);
  go('workout');
}

export const startBlank = () => begin(blankWorkout(store.prefs));
export const startFromTemplate = (tpl) => begin(workoutFromTemplate(tpl, store.prefs, nameOf));
export const repeatWorkout = (src) => begin(workoutFromPrevious(src, store.prefs, nameOf));

/** Start a workout someone posted to a group. The result is linked to the post so it shows on its results board. */
export function startFromGroupPost(post) {
  const w = workoutFromTemplate({ id: null, name: post.name, unit: post.unit, exercises: store.adoptExercises(post.exercises) }, store.prefs, nameOf);
  w.templateId = null;
  w.groupPostId = post.id;
  return begin(w);
}

/** Start my own session from the exercise list of a workout another member shared. */
export function startFromShared(template) {
  const w = workoutFromTemplate({ ...template, id: null, exercises: store.adoptExercises(template.exercises) }, store.prefs, nameOf);
  w.templateId = null;
  return begin(w);
}

/** "Start workout" sheet: blank, a saved template, or repeat a previous workout. */
export function openStartSheet() {
  if (store.active()) { go('workout'); return; }
  openSheet({
    title: 'Start workout',
    full: true,
    body: (close) => {
      const templates = store.templates();
      const recent = store.workouts().slice(0, 12);
      const status = currentRecovery();
      // which muscles this routine leans on that have not recovered yet
      const tired = (doc) => { const names = stillRecovering((doc.exercises || []).map((e) => e.exerciseId), status); return names.length ? `Still needs rest: ${names.join(', ')}` : ''; };
      const row = (title, meta, onClick, attrs = {}, warn = '') => h('button', { class: 'list-row', type: 'button', onClick: () => { close(); onClick(); }, ...attrs },
        h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, title), meta && h('span', { class: 'list-meta' }, meta), warn && h('span', { class: 'list-meta st-text-worked', 'data-tired': '' }, warn)),
        icon('play', 18));
      return h('div', { class: 'start' },
        h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'button', 'data-start': 'blank', onClick: () => { close(); startBlank(); } }, icon('plus', 22), 'Blank workout'),
        h('h3', { class: 'section-label' }, 'Saved templates'),
        templates.length
          ? h('div', { class: 'list' }, templates.map((t) => row(t.name, summarizeExercises(t) || 'No exercises yet', () => startFromTemplate(t), { 'data-start-template': t.name }, tired(t))))
          : h('p', { class: 'empty-note' }, 'No templates yet. Build one in the Workouts tab, or save a finished workout as a template.'),
        h('h3', { class: 'section-label' }, 'Repeat a previous workout'),
        recent.length
          ? h('div', { class: 'list' }, recent.map((w) => row(w.name, `${fmtDate(w.startedAt)} — ${summarizeExercises(w)}`, () => repeatWorkout(w), { 'data-start-repeat': w.name }, tired(w))))
          : h('p', { class: 'empty-note' }, 'Workouts you finish appear here, ready to repeat.'));
    },
  });
}

// ---------- the live screen ----------

function adjustDuration(w, done) {
  openSheet({
    title: 'Adjust workout time',
    body: (close) => {
      const total = Math.floor(timer.elapsedMs(w.timer) / 1000);
      const f = (label, value, max) => {
        const input = h('input', { class: 'field num-field', type: 'text', inputmode: 'numeric', value: String(value), 'aria-label': label, maxlength: '2', onFocus: (e) => e.target.select() });
        return { input, el: h('label', { class: 'time-part' }, input, h('span', null, label)), read: () => Math.min(max, Math.max(0, parseInt(input.value, 10) || 0)) };
      };
      const hh = f('hours', Math.floor(total / 3600), 23), mm = f('minutes', Math.floor((total % 3600) / 60), 59), ss = f('seconds', total % 60, 59);
      return h('form', { onSubmit: (e) => {
        e.preventDefault();
        w.timer = timer.set(w.timer, (hh.read() * 3600 + mm.read() * 60 + ss.read()) * 1000);
        store.saveWorkout(w, { silent: true });
        close(); done();
      } },
        h('p', { class: 'sheet-text' }, 'Forgot to start or stop on time? Set how long this workout has really been going.'),
        h('div', { class: 'time-parts' }, hh.el, mm.el, ss.el),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => close() }, 'Cancel'),
          h('button', { class: 'btn btn-primary', type: 'submit' }, 'Set time')));
    },
  });
}

let finishing = false;

function finishFlow(w) {
  const done = completedSetCount(w);
  const loose = filledButUnchecked(w);
  if (done + loose === 0) {
    toast('Log at least one set before finishing — or discard the workout.');
    return;
  }
  const commit = (countFilled, close) => {
    if (finishing || w.status === 'completed') return; // guards against a double tap
    finishing = true;
    try {
      finishWorkout(w, { countFilled });
      store.saveWorkout(w);
      store.refreshHighlights(w.id);
      groupsChanged();
      rest.stop();
      close();
      go('home');
      pushPage((el) => renderSummary(el, w.id));
    } finally { finishing = false; }
  };
  openSheet({
    title: 'Finish workout?',
    body: (close) => h('div', null,
      h('p', { class: 'sheet-text' }, `${fmtDurationLong(timer.elapsedMs(w.timer) / 1000)} so far, ${plural(done, 'set')} checked off.`),
      loose > 0 && h('p', { class: 'sheet-text warn' }, `${plural(loose, 'set has', 'sets have')} reps entered but ${loose === 1 ? 'isn’t' : 'aren’t'} checked off.`),
      h('div', { class: 'btn-col' },
        loose > 0
          ? [h('button', { class: 'btn btn-primary btn-lg', 'data-finish': 'count', onClick: () => commit(true, close) }, `Count ${loose === 1 ? 'it' : 'them'} and finish`),
            done > 0 && h('button', { class: 'btn btn-quiet', 'data-finish': 'skip', onClick: () => commit(false, close) }, `Finish without ${loose === 1 ? 'it' : 'them'}`)]
          : h('button', { class: 'btn btn-primary btn-lg', 'data-finish': 'count', onClick: () => commit(false, close) }, 'Finish workout'),
        h('button', { class: 'btn btn-quiet', onClick: () => close() }, 'Keep going'))),
  });
}

async function discardFlow(w) {
  const ok = await confirmDialog({ title: 'Discard this workout?', message: 'Everything logged in this session will be deleted. Your past workouts are not affected.', confirmLabel: 'Discard workout', danger: true });
  if (!ok) return;
  store.remove('workout', w.id);
  rest.stop();
  go('home');
}

function renderActive(el) {
  const w = store.active();
  if (!w) {
    add(el, h('div', { class: 'empty' },
      h('p', { class: 'empty-title' }, 'No workout in progress'),
      h('button', { class: 'btn btn-primary btn-lg', onClick: openStartSheet }, 'Start workout')));
    return;
  }
  const save = () => store.saveWorkout(w, { silent: true });
  const clock = h('button', { class: 'clock', 'data-live': 'timer', 'aria-label': 'Workout time. Tap to adjust.', onClick: () => adjustDuration(w, drawControls) }, fmtClock(timer.elapsedMs(w.timer) / 1000));
  const controls = h('div', { class: 'live-controls' });
  const name = h('button', { class: 'live-name', 'aria-label': 'Rename workout', onClick: async () => {
    const v = await promptDialog({ title: 'Workout name', value: w.name });
    if (v) { w.name = v; save(); name.firstChild.textContent = v; }
  } }, h('span', null, w.name), icon('edit', 16));

  function drawControls() {
    const running = timer.isRunning(w.timer);
    controls.replaceChildren(
      h('button', { class: `round-btn ${running ? '' : 'round-btn-warn'}`, 'data-action': 'pause', 'aria-label': running ? 'Pause timer' : 'Resume timer', title: running ? 'Pause timer' : 'Resume timer', onClick: () => {
        w.timer = running ? timer.pause(w.timer) : timer.resume(w.timer);
        save(); drawControls();
      } }, icon(running ? 'pause' : 'play', 22)),
      h('button', { class: 'pill', 'data-action': 'rest', onClick: openRestSheet }, icon('timer', 18), 'Rest'));
    clock.classList.toggle('paused', !running);
    clock.textContent = fmtClock(timer.elapsedMs(w.timer) / 1000);
  }
  drawControls();

  add(el, 
    h('header', { class: 'live-head' },
      h('div', { class: 'live-top' }, name, h('button', { class: 'btn btn-primary', 'data-action': 'finish', onClick: () => finishFlow(w) }, 'Finish')),
      h('div', { class: 'live-row' }, clock, controls)),
    workoutEditor({ workout: w, mode: 'active', onChange: save }),
    h('button', { class: 'btn btn-text danger btn-block', 'data-action': 'discard', onClick: () => discardFlow(w) }, 'Discard workout'));
}

registerScreen('workout', renderActive);

// ---------- summary after finishing ----------

export function prLine(ev, unit) {
  switch (ev.type) {
    case 'weight': return { title: ev.exerciseName, text: `Heaviest lift: ${fmtSet(ev.weight, ev.reps)} ${unit}`, was: `was ${fmtWeight(ev.previous, unit)}` };
    case 'e1rm': return { title: ev.exerciseName, text: `Best estimated 1RM: ${fmtWeight(Math.round(ev.value), unit)}`, was: `from ${fmtSet(ev.weight, ev.reps)}` };
    case 'reps': return { title: ev.exerciseName, text: `Most reps at ${fmtWeight(ev.weight, unit)}: ${ev.reps}`, was: `was ${ev.previous}` };
    case 'volume': return { title: ev.exerciseName, text: `Most volume in a workout: ${fmtVolume(ev.value, unit)}`, was: `was ${fmtVolume(ev.previous, unit)}` };
    default: return { title: 'Whole workout', text: `Most total volume: ${fmtVolume(ev.value, unit)}`, was: `was ${fmtVolume(ev.previous, unit)}` };
  }
}

export function prList(prs, unit) {
  return h('ul', { class: 'pr-list' }, prs.map((ev) => {
    const l = prLine(ev, unit);
    return h('li', { class: 'pr-item' }, h('span', { class: 'pr-medal' }, icon('medal', 20)),
      h('div', null, h('div', { class: 'pr-title' }, l.title), h('div', { class: 'pr-text' }, l.text, ' ', h('span', { class: 'muted' }, `(${l.was})`))));
  }));
}

function renderSummary(el, workoutId) {
  const w = store.get('workout', workoutId);
  if (!w) { go('home'); return; }
  const unit = store.prefs.unit;
  const sum = store.index(unit).byWorkout.get(w.id) || { volume: 0, setCount: 0, exerciseCount: 0, prs: [] };
  const fact = (value, label) => h('div', { class: 'fact' }, h('div', { class: 'fact-value' }, value), h('div', { class: 'fact-label' }, label));
  add(el, 
    h('div', { class: 'summary' },
      h('p', { class: 'summary-kicker' }, 'Workout saved'),
      h('h1', { class: 'summary-title' }, w.name),
      h('p', { class: 'summary-time', 'data-summary': 'duration' }, fmtDurationLong(w.durationSec)),
      h('div', { class: 'facts' },
        fact(String(sum.exerciseCount), sum.exerciseCount === 1 ? 'exercise' : 'exercises'),
        fact(String(sum.setCount), sum.setCount === 1 ? 'set' : 'sets'),
        fact(fmtInt(sum.volume), `${unit} lifted`)),
      sum.prs.length
        ? h('section', { class: 'block' }, h('h2', { class: 'block-title' }, plural(sum.prs.length, 'new personal record')), prList(sum.prs, unit))
        : h('p', { class: 'muted center' }, 'No new records this time. The numbers are saved for next time.'),
      h('div', { class: 'btn-col' },
        h('button', { class: 'btn btn-primary btn-lg', 'data-action': 'summary-done', onClick: () => go('home') }, 'Done'),
        !w.templateId && h('button', { class: 'btn btn-quiet', onClick: async () => {
          const name = await promptDialog({ title: 'Save as template', value: w.name, confirmLabel: 'Save template' });
          if (!name) return;
          store.put('template', templateFromWorkout(w, name), { silent: true });
          toast(`Template “${name}” saved`);
        } }, 'Save as template'))));
}

// ---------- "workout in progress" bar shown on every other screen ----------

export function drawActiveBar() {
  const bar = document.getElementById('active-bar');
  const w = store.ready ? store.active() : null;
  const show = !!w && currentRoute() !== 'workout';
  bar.hidden = !show;
  if (!show) { bar.replaceChildren(); return; }
  bar.replaceChildren(h('button', { class: 'active-bar-btn', onClick: () => go('workout') },
    h('span', { class: 'active-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'active-name' }, w.name),
    h('span', { class: 'active-clock', 'data-live': 'timer' }, fmtClock(timer.elapsedMs(w.timer) / 1000)),
    h('span', { class: 'active-go' }, 'Resume')));
}

/** Called a few times a second: keeps every visible workout clock current. */
export function tickClocks() {
  const w = store.ready ? store.active() : null;
  if (!w) return;
  const text = fmtClock(timer.elapsedMs(w.timer) / 1000);
  document.querySelectorAll('[data-live="timer"]').forEach((n) => { if (n.textContent !== text) n.textContent = text; });
}
