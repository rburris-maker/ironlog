// History: every completed workout, searchable; workout detail; editing and deleting.

import { h, icon, confirmDialog, promptDialog, toast, actionSheet, add } from '../lib/dom.js';
import { fmtDate, fmtDateFull, fmtTime, fmtDurationShort, fmtDurationLong, fmtVolume, fmtMonth, fmtSet, fmtInt, fmtNum, localDay, toLocalInput, plural } from '../lib/format.js';
import { store } from '../core/store.js';
import { epley, countableSets, volumeOf } from '../core/calc.js';
import { tidy, templateFromWorkout } from '../core/session.js';
import { pushPage, popPage, registerScreen, pageHeader, screenHeader, refresh } from './app.js';
import { repeatWorkout, summarizeExercises, prList } from './active.js';
import { workoutEditor } from './editor.js';

export function workoutRow(w, index, unit) {
  const sum = index.byWorkout.get(w.id) || { volume: 0, setCount: 0, prs: [] };
  return h('button', { class: 'list-row', type: 'button', 'data-workout': w.id, onClick: () => pushPage((el) => renderWorkoutDetail(el, w.id)) },
    h('span', { class: 'list-main' },
      h('span', { class: 'list-title' }, w.name, sum.prs.length > 0 && h('span', { class: 'pr-chip', title: plural(sum.prs.length, 'personal record') }, icon('medal', 14), String(sum.prs.length))),
      h('span', { class: 'list-meta' }, `${fmtDate(w.startedAt)}, ${fmtDurationShort(w.durationSec)}, ${fmtVolume(sum.volume, unit)}`),
      h('span', { class: 'list-sub' }, summarizeExercises(w))),
    icon('next', 18));
}

// ---------- list with search and filters ----------

const filter = { q: '', exerciseId: '', from: '', to: '' };

function renderHistory(el) {
  const unit = store.prefs.unit;
  const index = store.index(unit);
  const all = store.workouts();
  const listEl = h('div', { class: 'history-list' });
  const countEl = h('p', { class: 'result-count', 'aria-live': 'polite' });

  const used = new Map();
  for (const w of all) for (const e of w.exercises) if (!used.has(e.exerciseId)) used.set(e.exerciseId, store.exerciseName(e.exerciseId, e.name));
  const exerciseOptions = [...used.entries()].sort((a, b) => a[1].localeCompare(b[1]));

  const drawList = () => {
    const q = filter.q.trim().toLowerCase();
    const items = all.filter((w) => {
      if (filter.exerciseId && !w.exercises.some((e) => e.exerciseId === filter.exerciseId)) return false;
      const day = localDay(w.startedAt);
      if (filter.from && day < filter.from) return false;
      if (filter.to && day > filter.to) return false;
      if (q) {
        const hay = [w.name, ...w.exercises.map((e) => e.name), fmtDateFull(w.startedAt)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    listEl.replaceChildren();
    const filtered = q || filter.exerciseId || filter.from || filter.to;
    countEl.textContent = filtered ? `${plural(items.length, 'workout')} of ${all.length}` : '';
    if (!all.length) {
      listEl.append(h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, 'No workouts yet'), h('p', null, 'Finished workouts are listed here, newest first.')));
      return;
    }
    if (!items.length) {
      listEl.append(h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, 'Nothing matches'), h('button', { class: 'btn btn-quiet', onClick: () => { Object.assign(filter, { q: '', exerciseId: '', from: '', to: '' }); refresh(); } }, 'Clear search and filters')));
      return;
    }
    let month = '';
    let group = null;
    for (const w of items) {
      const m = fmtMonth(w.startedAt);
      if (m !== month) {
        month = m;
        listEl.append(h('h2', { class: 'month' }, m));
        group = h('div', { class: 'list' });
        listEl.append(group);
      }
      group.append(workoutRow(w, index, unit));
    }
  };

  const hasFilters = filter.exerciseId || filter.from || filter.to;
  const filters = h('div', { class: 'filters', hidden: !hasFilters },
    h('label', { class: 'label' }, 'Exercise',
      h('select', { class: 'field', onChange: (e) => { filter.exerciseId = e.target.value; drawList(); } },
        h('option', { value: '' }, 'Any exercise'),
        exerciseOptions.map(([id, name]) => h('option', { value: id, selected: id === filter.exerciseId }, name)))),
    h('div', { class: 'two' },
      h('label', { class: 'label' }, 'From', h('input', { class: 'field', type: 'date', value: filter.from, onChange: (e) => { filter.from = e.target.value; drawList(); } })),
      h('label', { class: 'label' }, 'To', h('input', { class: 'field', type: 'date', value: filter.to, onChange: (e) => { filter.to = e.target.value; drawList(); } }))));

  add(el, 
    screenHeader('History'),
    h('div', { class: 'search-row' },
      h('input', { class: 'field', type: 'search', placeholder: 'Search workouts or exercises', 'aria-label': 'Search workouts or exercises', value: filter.q, onInput: (e) => { filter.q = e.target.value; drawList(); } }),
      h('button', { class: `btn btn-quiet ${hasFilters ? 'on' : ''}`, 'aria-expanded': hasFilters ? 'true' : 'false', 'data-action': 'filters', onClick: (e) => { filters.hidden = !filters.hidden; e.currentTarget.setAttribute('aria-expanded', String(!filters.hidden)); } }, 'Filters')),
    filters,
    countEl,
    listEl);
  drawList();
}

registerScreen('history', renderHistory);

// ---------- detail ----------

export function renderWorkoutDetail(el, id) {
  const w = store.get('workout', id);
  if (!w || w.deletedAt) {
    add(el, pageHeader('Workout'), h('div', { class: 'empty' }, h('p', null, 'This workout was deleted.')));
    return;
  }
  const unit = store.prefs.unit;
  const index = store.index(unit);
  const sum = index.byWorkout.get(w.id) || { volume: 0, setCount: 0, exerciseCount: 0, prs: [], setFlags: new Map() };

  const menu = () => actionSheet(w.name, [
    { label: 'Edit workout', icon: 'edit', onSelect: () => pushPage(editPage(w.id)) },
    { label: 'Save as template', icon: 'copy', onSelect: async () => {
      const name = await promptDialog({ title: 'Save as template', value: w.name, confirmLabel: 'Save template' });
      if (!name) return;
      store.put('template', templateFromWorkout(w, name), { silent: true });
      toast(`Template “${name}” saved`);
    } },
    { label: 'Delete workout', icon: 'trash', danger: true, onSelect: async () => {
      const ok = await confirmDialog({ title: 'Delete this workout?', message: `“${w.name}” from ${fmtDate(w.startedAt, { relative: false })} will be removed from your history, and your records will be recalculated without it.`, confirmLabel: 'Delete workout', danger: true });
      if (!ok) return;
      store.remove('workout', w.id);
      popPage();
      toast('Workout deleted');
    } },
  ]);

  const fact = (value, label) => h('div', { class: 'fact' }, h('div', { class: 'fact-value' }, value), h('div', { class: 'fact-label' }, label));

  add(el, 
    pageHeader(w.name, { action: h('button', { class: 'icon-btn', 'aria-label': 'Workout options', 'data-action': 'workout-menu', onClick: menu }, icon('more', 24)) }),
    h('p', { class: 'detail-date' }, `${fmtDateFull(w.startedAt)} at ${fmtTime(w.startedAt)}`),
    h('div', { class: 'facts' },
      fact(fmtDurationLong(w.durationSec), 'duration'),
      fact(plural(sum.setCount, 'set'), plural(sum.exerciseCount, 'exercise')),
      fact(fmtInt(sum.volume), `${unit} volume`)),
    h('button', { class: 'btn btn-primary btn-block btn-lg', 'data-action': 'repeat', onClick: () => repeatWorkout(w) }, icon('repeat', 20), 'Repeat workout'),
    sum.prs.length > 0 && h('section', { class: 'block' }, h('h2', { class: 'block-title' }, plural(sum.prs.length, 'personal record')), prList(sum.prs, unit)),
    w.exercises.map((e) => {
      const sets = countableSets(e, w.unit, unit);
      return h('section', { class: 'block detail-ex' },
        h('div', { class: 'block-head' }, h('h2', { class: 'ex-name' }, store.exerciseName(e.exerciseId, e.name)), h('span', { class: 'muted' }, fmtVolume(volumeOf(sets), unit))),
        e.notes && h('p', { class: 'detail-note' }, e.notes),
        h('table', { class: 'detail-sets' },
          h('thead', null, h('tr', null, h('th', null, 'Set'), h('th', null, `Weight × reps`), h('th', null, 'Est. 1RM'))),
          h('tbody', null, sets.map((s, i) => {
            const est = epley(s.weight, s.reps);
            const flags = sum.setFlags.get(s.id);
            return h('tr', { class: flags ? 'pr' : '' },
              h('td', null, String(i + 1)),
              h('td', null, h('strong', null, fmtSet(s.weight, s.reps)), s.weight > 0 ? ` ${unit}` : '', flags && h('span', { class: 'pr-tag' }, 'PR')),
              h('td', { class: 'muted' }, est != null && s.reps > 1 ? `${fmtNum(Math.round(est))} est.` : s.reps === 1 && s.weight > 0 ? 'actual' : '—'));
          }))));
    }),
    w.repeatedFromId && h('p', { class: 'muted small' }, 'Started by repeating an earlier workout.'));
}

// ---------- edit a completed workout ----------

/** Returns a page renderer. The draft lives outside the renderer so a background refresh never loses edits. */
function editPage(id) {
  const original = store.get('workout', id);
  // Work on a private copy; the saved workout only changes when "Save changes" is tapped.
  const draft = original ? JSON.parse(JSON.stringify(original)) : null;
  const st = { dirty: false, saved: false, when: draft ? toLocalInput(draft.startedAt) : '' };

  return (el) => {
    if (!draft) { add(el, pageHeader('Edit workout'), h('div', { class: 'empty' }, h('p', null, 'This workout no longer exists.'))); return; }
    const touch = () => { st.dirty = true; };

    const cancel = async () => {
      if (st.dirty && !st.saved && !(await confirmDialog({ title: 'Discard your changes?', message: 'The workout will stay as it was.', confirmLabel: 'Discard changes', danger: true }))) return;
      popPage();
    };
    const save = () => {
      if (st.saved) return;
      const when = new Date(st.when);
      if (!Number.isNaN(when.getTime())) draft.startedAt = when.toISOString();
      draft.durationSec = Math.max(0, draft.durationSec || 0);
      draft.endedAt = new Date(new Date(draft.startedAt).getTime() + draft.durationSec * 1000).toISOString();
      draft.name = (draft.name || '').trim() || original.name;
      const check = JSON.parse(JSON.stringify(draft));
      tidy(check, { countFilled: true });
      if (!check.exercises.length) { toast('A workout needs at least one completed set. Delete it instead if it should not exist.'); return; }
      tidy(draft, { countFilled: true });
      st.saved = true;
      store.saveWorkout(draft);
      popPage();
      toast('Workout updated — records recalculated');
    };

    const total = draft.durationSec || 0;
    const parts = { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
    const setDuration = () => { draft.durationSec = parts.h * 3600 + parts.m * 60 + parts.s; touch(); };
    const part = (key, label, max) => h('input', { class: 'field num-field', type: 'text', inputmode: 'numeric', value: String(parts[key]), 'aria-label': label, maxlength: '2', onFocus: (e) => e.target.select(),
      onInput: (e) => { parts[key] = Math.min(max, Math.max(0, parseInt(e.target.value, 10) || 0)); setDuration(); } });

    add(el, 
      pageHeader('Edit workout', { onBack: cancel, backLabel: 'Cancel', action: h('button', { class: 'btn btn-primary', 'data-action': 'save-edit', onClick: save }, 'Save changes') }),
      h('div', { class: 'form' },
        h('label', { class: 'label' }, 'Name', h('input', { class: 'field', type: 'text', value: draft.name, maxlength: '60', onInput: (e) => { draft.name = e.target.value; touch(); } })),
        h('label', { class: 'label' }, 'Date and time', h('input', { class: 'field', type: 'datetime-local', value: st.when, onInput: (e) => { st.when = e.target.value; touch(); } })),
        h('div', { class: 'label' }, 'Duration',
          h('div', { class: 'time-parts' },
            h('label', { class: 'time-part' }, part('h', 'Hours', 99), h('span', null, 'hours')),
            h('label', { class: 'time-part' }, part('m', 'Minutes', 59), h('span', null, 'minutes')),
            h('label', { class: 'time-part' }, part('s', 'Seconds', 59), h('span', null, 'seconds'))))),
      workoutEditor({ workout: draft, mode: 'edit', onChange: touch }));
  };
}
