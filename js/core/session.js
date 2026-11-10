// Creating, repeating and finishing workouts. Every function here builds a NEW
// workout with a fresh ID — a completed workout is never reused as the live session.

import { timer, convert, isCountable } from './calc.js';
import { uid, nowIso } from './store.js';

const round = (n) => (n == null ? null : Math.round(n * 100) / 100);

export function newSet(target) {
  const s = { id: uid(), weight: null, reps: null, done: false };
  if (target && (target.weight != null || target.reps != null)) {
    s.target = { weight: target.weight ?? null, reps: target.reps ?? null };
  }
  return s;
}

export function newEntry(exercise, targets = []) {
  return {
    uid: uid(),
    exerciseId: exercise.id,
    name: exercise.name,
    notes: '',
    sets: targets.length ? targets.map(newSet) : [newSet()],
  };
}

function defaultName(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Morning workout' : h < 17 ? 'Afternoon workout' : 'Evening workout';
}

export function blankWorkout(prefs, name) {
  const now = nowIso();
  return {
    id: uid(),
    name: name || defaultName(),
    status: 'active',
    unit: prefs.unit,
    startedAt: now,
    endedAt: null,
    durationSec: null,
    timer: timer.start(),
    templateId: null,
    repeatedFromId: null,
    notes: '',
    exercises: [],
    createdAt: now,
  };
}

/** Start a workout from a saved template. The template itself is not touched. */
export function workoutFromTemplate(tpl, prefs, nameOf) {
  const w = blankWorkout(prefs, tpl.name);
  w.templateId = tpl.id;
  const from = tpl.unit || prefs.unit;
  w.exercises = (tpl.exercises || []).map((e) => newEntry(
    { id: e.exerciseId, name: nameOf(e.exerciseId, e.name) },
    (e.sets || []).map((s) => ({ weight: round(convert(s.weight, from, w.unit)), reps: s.reps })),
  ));
  return w;
}

/**
 * Repeat a completed workout: same exercises and the same number of sets,
 * with what was lifted last time carried along as the suggested numbers.
 * The original workout is only read, never modified.
 */
export function workoutFromPrevious(src, prefs, nameOf) {
  const w = blankWorkout(prefs, src.name);
  w.repeatedFromId = src.id;
  w.templateId = src.templateId || null;
  w.exercises = (src.exercises || [])
    .map((e) => {
      const done = (e.sets || []).filter(isCountable);
      if (!done.length) return null;
      const entry = newEntry(
        { id: e.exerciseId, name: nameOf(e.exerciseId, e.name) },
        done.map((s) => ({ weight: round(convert(s.weight, src.unit, w.unit)), reps: s.reps })),
      );
      return entry;
    })
    .filter(Boolean);
  return w;
}

/** Sets that have reps typed in but were never checked off. */
export function filledButUnchecked(w) {
  let n = 0;
  for (const e of w.exercises) for (const s of e.sets) if (!s.done && Number.isFinite(s.reps) && s.reps > 0) n += 1;
  return n;
}

export function completedSetCount(w) {
  let n = 0;
  for (const e of w.exercises) for (const s of e.sets) if (isCountable(s)) n += 1;
  return n;
}

/** Drop empty sets and exercises so only what was actually performed is stored. */
export function tidy(w, { countFilled = false } = {}) {
  for (const e of w.exercises) {
    for (const s of e.sets) {
      if (countFilled && !s.done && Number.isFinite(s.reps) && s.reps > 0) s.done = true;
    }
    e.sets = e.sets.filter(isCountable).map((s) => ({ id: s.id, weight: Number.isFinite(s.weight) ? s.weight : 0, reps: s.reps, done: true }));
  }
  w.exercises = w.exercises.filter((e) => e.sets.length > 0);
  return w;
}

/** Stop the clock and turn the live session into a completed workout. Safe to call twice. */
export function finishWorkout(w, opts = {}) {
  if (w.status === 'completed') return w;
  const now = Date.now();
  tidy(w, opts);
  w.durationSec = Math.round(timer.elapsedMs(w.timer, now) / 1000);
  w.endedAt = new Date(now).toISOString();
  w.timer = null;
  w.status = 'completed';
  return w;
}

/** A template made from a workout: exercise order plus the sets performed as targets. */
export function templateFromWorkout(w, name) {
  return {
    id: uid(),
    name: name || w.name,
    unit: w.unit,
    exercises: w.exercises.map((e) => ({
      uid: uid(),
      exerciseId: e.exerciseId,
      name: e.name,
      sets: e.sets.filter((s) => Number.isFinite(s.reps) && s.reps > 0).map((s) => ({ weight: Number.isFinite(s.weight) ? s.weight : null, reps: s.reps })),
    })).map((e) => (e.sets.length ? e : { ...e, sets: [{ weight: null, reps: null }] })),
  };
}

export function duplicateTemplate(tpl, name) {
  const copy = JSON.parse(JSON.stringify(tpl));
  copy.id = uid();
  copy.name = name || `${tpl.name} copy`;
  delete copy.createdAt; delete copy.updatedAt; delete copy.deletedAt;
  copy.sort = undefined;
  copy.exercises.forEach((e) => { e.uid = uid(); });
  return copy;
}
