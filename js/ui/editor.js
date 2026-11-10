// The set-logging table used by both the live workout and "edit a past workout".
// Built for speed between sets: the last performance sits beside every row, the
// inputs are pre-suggested, and one tap on the check mark logs a set.

import { h, clear, icon, actionSheet, confirmDialog, openSheet, toast } from '../lib/dom.js';
import { fmtNum, fmtSet, fmtWeight, fmtDate, parseNum, plural } from '../lib/format.js';
import { store } from '../core/store.js';
import { exerciseSnapshot, livePRs } from '../core/calc.js';
import { newEntry, newSet } from '../core/session.js';
import { pickExercise } from './pickers.js';
import { rest } from './rest.js';

/** Suggested numbers for a set: its target, else last time's same set, else the set above it. */
function suggestion(entry, i, last) {
  const s = entry.sets[i];
  let weight = s.target ? s.target.weight : null;
  let reps = s.target ? s.target.reps : null;
  const p = last && last.sets[i];
  if (p) { weight ??= p.weight; reps ??= p.reps; }
  for (let j = i - 1; j >= 0 && (weight == null || reps == null); j--) {
    weight ??= entry.sets[j].weight;
    reps ??= entry.sets[j].reps;
  }
  if (last && last.sets.length) {
    const tail = last.sets[last.sets.length - 1];
    weight ??= tail.weight; reps ??= tail.reps;
  }
  return { weight, reps };
}

function prMessage(ev, name, unit) {
  if (ev.type === 'weight') return `${name} — ${fmtWeight(ev.weight, unit)}!`;
  if (ev.type === 'e1rm') return `${name} — estimated 1RM ${fmtWeight(Math.round(ev.value), unit)}`;
  return `${name} — ${fmtSet(ev.weight, ev.reps)}, most reps at this weight`;
}

/**
 * workoutEditor({ workout, mode: 'active' | 'edit', onChange }) → element
 * Mutates `workout` directly and calls onChange() after every change.
 */
export function workoutEditor({ workout, mode, onChange }) {
  const unit = workout.unit;
  const root = h('div', { class: 'editor' });
  const list = h('div', { class: 'ex-list' });
  const snapOpts = mode === 'edit' ? { before: workout.startedAt, excludeWorkoutId: workout.id } : {};
  const index = () => store.index(unit);

  const changed = () => onChange();

  function drawAll() {
    clear(list);
    if (!workout.exercises.length) {
      list.append(h('div', { class: 'empty' },
        h('p', { class: 'empty-title' }, 'No exercises yet'),
        h('p', null, 'Add your first exercise. What you lifted last time shows up automatically.')));
    }
    workout.exercises.forEach((entry) => list.append(drawEntry(entry)));
  }

  function redraw(entry) {
    const old = list.querySelector(`[data-uid="${entry.uid}"]`);
    const next = drawEntry(entry);
    if (old) old.replaceWith(next); else list.append(next);
  }

  function drawEntry(entry) {
    const snap = exerciseSnapshot(index(), entry.exerciseId, snapOpts);
    const last = snap.last;
    const flags = new Map();
    if (mode === 'active') {
      for (const ev of livePRs(index(), entry, unit)) if (ev.setId) flags.set(ev.setId, ev.type);
    }
    const pos = workout.exercises.indexOf(entry);

    const stat = (label, value, extra) => h('div', { class: 'ex-stat' }, h('dt', null, label), h('dd', null, value, extra && h('small', null, extra)));
    const stats = snap.timesPerformed
      ? h('dl', { class: 'ex-stats' },
        stat('Last', last ? fmtDate(last.date, { weekday: false }) : '—'),
        stat('Top set', last && last.top ? fmtSet(last.top.weight, last.top.reps) : '—'),
        stat('Heaviest', snap.heaviest ? fmtNum(snap.heaviest.weight) : '—', snap.heaviest ? unit : ''),
        stat('Est. 1RM', snap.bestEst ? fmtNum(Math.round(snap.bestEst.value)) : '—', snap.bestEst ? unit : ''))
      : h('p', { class: 'ex-first' }, 'First time logging this exercise — today sets your baseline.');

    const rows = h('div', { class: 'sets', role: 'table', 'aria-label': `${entry.name} sets` },
      h('div', { class: 'set-row set-head', role: 'row' },
        h('span', { role: 'columnheader' }, 'Set'),
        h('span', { role: 'columnheader' }, 'Previous'),
        h('span', { role: 'columnheader' }, unit),
        h('span', { role: 'columnheader' }, 'Reps'),
        h('span', { role: 'columnheader', class: 'sr-only' }, 'Done')),
      entry.sets.map((s, i) => drawRow(entry, s, i, last, flags)));

    return h('section', { class: 'ex', 'data-uid': entry.uid, 'data-exercise': entry.exerciseId },
      h('header', { class: 'ex-head' },
        h('div', { class: 'ex-title' },
          h('h2', { class: 'ex-name' }, entry.name),
          snap.timesPerformed > 0 && h('span', { class: 'ex-count' }, plural(snap.timesPerformed, 'session'))),
        h('button', { class: 'icon-btn', 'aria-label': `${entry.name} options`, onClick: () => entryMenu(entry, pos) }, icon('more', 24))),
      stats,
      entry.notes && h('button', { class: 'ex-note', onClick: () => editNote(entry) }, icon('note', 16), h('span', null, entry.notes)),
      rows,
      h('button', { class: 'add-set', type: 'button', onClick: () => { entry.sets.push(newSet()); changed(); redraw(entry); } }, icon('plus', 18), 'Add set'));
  }

  function drawRow(entry, s, i, last, flags) {
    const prev = last && last.sets[i];
    const sug = suggestion(entry, i, last);
    const pr = flags.get(s.id);

    const weight = h('input', {
      class: 'num', type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'next',
      'aria-label': `Set ${i + 1} weight in ${unit}`, placeholder: sug.weight != null ? fmtNum(sug.weight) : 'BW',
      value: s.weight != null ? fmtNum(s.weight) : '',
      onFocus: (e) => e.target.select(),
      onInput: (e) => { s.weight = parseNum(e.target.value); changed(); },
      onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); reps.focus(); } },
      onChange: () => updateMarks(entry),
    });
    const reps = h('input', {
      class: 'num', type: 'text', inputmode: 'numeric', autocomplete: 'off', enterkeyhint: 'done',
      'aria-label': `Set ${i + 1} reps`, placeholder: sug.reps != null ? String(sug.reps) : '',
      value: s.reps != null ? String(s.reps) : '',
      onFocus: (e) => e.target.select(),
      onInput: (e) => { const n = parseNum(e.target.value); s.reps = n == null ? null : Math.round(n); changed(); },
      onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!s.done) toggle(entry, s, i, last); else e.target.blur(); } },
      onChange: () => updateMarks(entry),
    });

    return h('div', { class: `set-row ${s.done ? 'done' : ''} ${pr ? 'pr' : ''}`, role: 'row', 'data-set': s.id },
      h('button', { class: 'set-num', type: 'button', role: 'cell', 'aria-label': `Set ${i + 1} options`, onClick: () => setMenu(entry, s, i) },
        pr ? h('span', { class: 'pr-tag', title: 'Personal record' }, 'PR') : String(i + 1)),
      h('button', { class: 'set-prev', type: 'button', role: 'cell', disabled: !prev,
        'aria-label': prev ? `Previous: ${fmtSet(prev.weight, prev.reps)}. Tap to copy.` : 'No previous set',
        onClick: () => { if (!prev) return; s.weight = prev.weight; s.reps = prev.reps; changed(); redraw(entry); } },
        prev ? fmtSet(prev.weight, prev.reps) : '—'),
      h('span', { role: 'cell' }, weight),
      h('span', { role: 'cell' }, reps),
      h('button', { class: 'set-check', type: 'button', role: 'cell', 'aria-pressed': s.done ? 'true' : 'false', 'aria-label': s.done ? `Set ${i + 1} done. Tap to undo.` : `Mark set ${i + 1} done`, onClick: () => toggle(entry, s, i, last) }, icon('check', 22)));
  }

  /** Refresh the PR tags of an exercise in place (no re-render, so typing is never interrupted). */
  function updateMarks(entry) {
    if (mode !== 'active') return;
    const flags = new Map();
    for (const ev of livePRs(index(), entry, unit)) if (ev.setId) flags.set(ev.setId, ev.type);
    entry.sets.forEach((s, i) => {
      const row = list.querySelector(`[data-set="${s.id}"]`);
      if (!row) return;
      const pr = flags.has(s.id);
      row.classList.toggle('pr', pr);
      const num = row.querySelector('.set-num');
      clear(num);
      num.append(pr ? h('span', { class: 'pr-tag', title: 'Personal record' }, 'PR') : String(i + 1));
    });
  }

  function toggle(entry, s, i, last) {
    if (s.done) {
      s.done = false;
    } else {
      const sug = suggestion(entry, i, last);
      if (s.weight == null && sug.weight != null) s.weight = sug.weight;
      if (s.reps == null && sug.reps != null) s.reps = sug.reps;
      if (!(s.reps > 0)) {
        const input = list.querySelector(`[data-set="${s.id}"] input[inputmode="numeric"]`);
        if (input) { input.focus(); input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 400); }
        return;
      }
      const before = mode === 'active' ? livePRs(index(), entry, unit) : [];
      s.done = true;
      if (mode === 'active') {
        const after = livePRs(index(), entry, unit);
        const fresh = after.filter((ev) => ev.setId === s.id && !before.some((b) => b.type === ev.type && b.setId === s.id));
        const ev = fresh.find((e) => e.type === 'weight') || fresh.find((e) => e.type === 'e1rm') || fresh.find((e) => e.type === 'reps');
        if (ev) toast(prMessage(ev, entry.name, unit), { kind: 'pr', title: 'New personal record!', duration: 4500 });
        if (store.prefs.restAuto) rest.start(store.prefs.restSeconds);
      }
    }
    changed();
    redraw(entry);
  }

  function setMenu(entry, s, i) {
    actionSheet(`${entry.name}, set ${i + 1}`, [
      { label: 'Add a set below', icon: 'plus', onSelect: () => { entry.sets.splice(i + 1, 0, newSet()); changed(); redraw(entry); } },
      { label: 'Remove this set', icon: 'trash', danger: true, onSelect: () => { entry.sets.splice(i, 1); changed(); redraw(entry); } },
    ]);
  }

  function editNote(entry) {
    openSheet({
      title: `Note for ${entry.name}`,
      body: (close) => {
        const ta = h('textarea', { class: 'field', rows: '4', placeholder: 'Grip, seat height, how it felt…', 'aria-label': 'Exercise note', maxlength: '500' }, entry.notes || '');
        setTimeout(() => ta.focus(), 50);
        return h('div', null, ta,
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn btn-quiet', onClick: () => close() }, 'Cancel'),
            h('button', { class: 'btn btn-primary', onClick: () => { entry.notes = ta.value.trim(); changed(); close(); redraw(entry); } }, 'Save note')));
      },
    });
  }

  function move(pos, delta) {
    const to = pos + delta;
    if (to < 0 || to >= workout.exercises.length) return;
    const [e] = workout.exercises.splice(pos, 1);
    workout.exercises.splice(to, 0, e);
    changed();
    drawAll();
  }

  function entryMenu(entry, pos) {
    actionSheet(entry.name, [
      { label: entry.notes ? 'Edit note' : 'Add a note', icon: 'note', onSelect: () => editNote(entry) },
      pos > 0 && { label: 'Move up', icon: 'up', onSelect: () => move(pos, -1) },
      pos < workout.exercises.length - 1 && { label: 'Move down', icon: 'down', onSelect: () => move(pos, 1) },
      { label: 'Swap for another exercise', icon: 'swap', onSelect: () => pickExercise({ title: 'Swap exercise', onPick: (ex) => { entry.exerciseId = ex.id; entry.name = ex.name; changed(); redraw(entry); } }) },
      { label: 'Remove exercise', icon: 'trash', danger: true, onSelect: async () => {
        const logged = entry.sets.some((s) => s.done);
        if (logged && !(await confirmDialog({ title: `Remove ${entry.name}?`, message: 'The sets you logged for it in this workout will be removed.', confirmLabel: 'Remove exercise', danger: true }))) return;
        workout.exercises.splice(workout.exercises.indexOf(entry), 1);
        changed();
        drawAll();
      } },
    ]);
  }

  function addExercise() {
    pickExercise({
      onPick: (ex) => {
        const last = exerciseSnapshot(index(), ex.id, snapOpts).last;
        const count = last ? last.sets.length : 3;
        const entry = newEntry(ex);
        entry.sets = Array.from({ length: count }, () => newSet());
        workout.exercises.push(entry);
        changed();
        if (workout.exercises.length === 1) drawAll(); else list.append(drawEntry(entry));
        requestAnimationFrame(() => {
          const el = list.querySelector(`[data-uid="${entry.uid}"]`);
          if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
      },
    });
  }

  drawAll();
  root.append(list, h('button', { class: 'btn btn-outline btn-block btn-lg', type: 'button', 'data-action': 'add-exercise', onClick: addExercise }, icon('plus', 22), 'Add exercise'));
  return root;
}
