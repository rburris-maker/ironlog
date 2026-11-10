// Run with:  node --test tests/
// Covers the calculations the app's reliability depends on: estimated 1RM,
// previous-lift lookup, personal records (including after edits/deletes),
// the wall-clock timer, and repeating/finishing workouts.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  epley, convert, buildIndex, lastSession, exerciseSnapshot, livePRs, timer, weeklyFrequency, exerciseSeries,
} from '../js/core/calc.js';
import { workoutFromPrevious, workoutFromTemplate, finishWorkout, filledButUnchecked, blankWorkout } from '../js/core/session.js';

let n = 0;
const set = (weight, reps, done = true) => ({ id: `s${++n}`, weight, reps, done });
const workout = (id, date, name, exercises, extra = {}) => ({
  id, name, status: 'completed', unit: 'lb', startedAt: new Date(date).toISOString(), durationSec: 3600,
  exercises: exercises.map(([exerciseId, sets]) => ({ uid: `e${++n}`, exerciseId, name: exerciseId, sets })),
  ...extra,
});
const nameOf = (id, fallback) => fallback || id;

test('Epley estimate: a single is the lift itself, reps scale by 1 + reps/30', () => {
  assert.equal(epley(225, 1), 225);
  assert.equal(Math.round(epley(185, 8)), 234); // 185 × (1 + 8/30) = 234.3
  assert.equal(epley(100, 30), null);           // too many reps to estimate from
  assert.equal(epley(0, 10), null);
});

test('unit conversion round-trips', () => {
  assert.equal(convert(100, 'kg', 'lb'), 220.46);
  assert.equal(convert(220.46, 'lb', 'kg'), 100);
  assert.equal(convert(135, 'lb', 'lb'), 135);
});

test('previous lift comes from the most recent session of that exercise, in any routine', () => {
  const ws = [
    workout('w1', '2026-11-02T17:00', 'Push Day', [['bench-press', [set(135, 10), set(155, 8), set(185, 5)]]]),
    workout('w2', '2026-11-05T17:00', 'Upper Body', [['bench-press', [set(140, 10), set(160, 8)]], ['barbell-row', [set(135, 8)]]]),
    workout('w3', '2026-11-06T17:00', 'Leg Day', [['squat', [set(225, 5)]]]),
  ];
  const ix = buildIndex(ws, 'lb');
  const last = lastSession(ix, 'bench-press');
  assert.equal(last.workoutName, 'Upper Body');
  assert.deepEqual(last.sets.map((s) => [s.weight, s.reps]), [[140, 10], [160, 8]]);
  const snap = exerciseSnapshot(ix, 'bench-press');
  assert.equal(snap.timesPerformed, 2);
  assert.equal(snap.heaviest.weight, 185);
  assert.equal(snap.workingWeight, 160);
  assert.equal(snap.workingReps, 8);
  // when editing the Nov 5 workout, "previous" is the session before it
  assert.equal(lastSession(ix, 'bench-press', { before: ws[1].startedAt, excludeWorkoutId: 'w2' }).workoutName, 'Push Day');
  assert.equal(lastSession(ix, 'overhead-press'), null);
});

test('unchecked sets and unfinished workouts never count', () => {
  const ws = [
    workout('w1', '2026-11-02', 'A', [['bench-press', [set(135, 10), set(999, 1, false)]]]),
    workout('w2', '2026-11-03', 'B', [['bench-press', [set(500, 1)]]], { status: 'active' }),
  ];
  const ix = buildIndex(ws, 'lb');
  assert.equal(ix.exercises.get('bench-press').records.heaviest.weight, 135);
  assert.equal(ix.totals.workouts, 1);
});

test('PR detection: first session is the baseline; later sessions earn weight, 1RM, rep and volume PRs', () => {
  const ws = [
    workout('w1', '2026-11-01', 'Push', [['bench-press', [set(135, 10), set(155, 8), set(185, 5)]]]),
    workout('w2', '2026-11-08', 'Push', [['bench-press', [set(135, 10), set(165, 8), set(195, 5)]]]),
    workout('w3', '2026-11-15', 'Push', [['bench-press', [set(135, 12)]]]),
  ];
  const ix = buildIndex(ws, 'lb');
  assert.equal(ix.byWorkout.get('w1').prs.length, 0, 'baseline session is not a PR');
  const types2 = ix.byWorkout.get('w2').prs.map((p) => p.type).sort();
  assert.deepEqual(types2, ['e1rm', 'volume', 'weight', 'workoutVolume']);
  const weightPr = ix.byWorkout.get('w2').prs.find((p) => p.type === 'weight');
  assert.equal(weightPr.weight, 195);
  assert.equal(weightPr.previous, 185);
  // 135 × 12 beats the old 135 × 10, but is not a weight or 1RM record
  assert.deepEqual(ix.byWorkout.get('w3').prs.map((p) => p.type), ['reps']);
  const rec = ix.exercises.get('bench-press').records;
  assert.equal(rec.heaviest.weight, 195);
  assert.equal(Math.round(rec.bestEst.value), 228); // 195 × (1 + 5/30) = 227.5
  assert.equal(rec.repsAtWeight.get('135').reps, 12);
  assert.equal(ix.totals.prs, 5);
});

test('an estimated 1RM never becomes the "heaviest lift"', () => {
  const ix = buildIndex([workout('w1', '2026-11-01', 'A', [['bench-press', [set(185, 8)]]])], 'lb');
  const rec = ix.exercises.get('bench-press').records;
  assert.equal(rec.heaviest.weight, 185);
  assert.ok(rec.bestEst.value > 230);
});

test('records stay correct after a workout is edited or deleted', () => {
  const w1 = workout('w1', '2026-11-01', 'Push', [['bench-press', [set(185, 5)]]]);
  const w2 = workout('w2', '2026-11-08', 'Push', [['bench-press', [set(225, 1)]]]);
  const w3 = workout('w3', '2026-11-15', 'Push', [['bench-press', [set(205, 3)]]]);
  let ix = buildIndex([w1, w2, w3], 'lb');
  assert.equal(ix.exercises.get('bench-press').records.heaviest.weight, 225);
  assert.equal(ix.byWorkout.get('w3').prs.filter((p) => p.type === 'weight').length, 0);

  // delete the 225 workout → record falls back, and w3 is now recognised as the PR it was
  w2.deletedAt = new Date().toISOString();
  ix = buildIndex([w1, w2, w3], 'lb');
  assert.equal(ix.exercises.get('bench-press').records.heaviest.weight, 205);
  assert.equal(ix.byWorkout.get('w3').prs.filter((p) => p.type === 'weight').length, 1);
  assert.equal(lastSession(ix, 'bench-press').workoutId, 'w3');

  // edit w3 down to a typo fix → record follows the edit
  w3.exercises[0].sets[0].weight = 175;
  ix = buildIndex([w1, w2, w3], 'lb');
  assert.equal(ix.exercises.get('bench-press').records.heaviest.weight, 185);
  assert.equal(ix.totals.prs, 0);
});

test('live PR check during a workout flags the set that earned it', () => {
  const ix = buildIndex([workout('w1', '2026-11-01', 'Push', [['bench-press', [set(185, 5)]]])], 'lb');
  const entry = { exerciseId: 'bench-press', sets: [set(135, 10), set(190, 5), set(195, 5, false)] };
  let prs = livePRs(ix, entry, 'lb');
  assert.equal(prs.find((p) => p.type === 'weight').setId, entry.sets[1].id);
  entry.sets[2].done = true;
  prs = livePRs(ix, entry, 'lb');
  assert.equal(prs.find((p) => p.type === 'weight').setId, entry.sets[2].id);
  assert.deepEqual(livePRs(ix, { exerciseId: 'squat', sets: [set(315, 5)] }, 'lb'), [], 'first time is a baseline');
});

test('mixed units are compared in one unit', () => {
  const ws = [
    workout('w1', '2026-11-01', 'A', [['squat', [set(100, 5)]]], { unit: 'kg' }),
    workout('w2', '2026-11-08', 'A', [['squat', [set(225, 5)]]]),
  ];
  const ix = buildIndex(ws, 'lb');
  assert.equal(ix.exercises.get('squat').records.heaviest.weight, 225);
  assert.equal(ix.exercises.get('squat').sessions[0].top.weight, 220.46);
});

test('timer is wall-clock based: survives being closed, pauses, resumes and can be corrected', () => {
  const t0 = 1_000_000;
  let t = timer.start(t0);
  assert.equal(timer.elapsedMs(t, t0 + 90_000), 90_000);
  // "refresh": the stored object is all that is needed to recover the elapsed time
  t = JSON.parse(JSON.stringify(t));
  assert.equal(timer.elapsedMs(t, t0 + 4_354_000), 4_354_000); // 1 h 12 min 34 s later
  t = timer.pause(t, t0 + 100_000);
  assert.equal(timer.elapsedMs(t, t0 + 999_000), 100_000, 'paused time does not advance');
  t = timer.resume(t, t0 + 200_000);
  assert.equal(timer.elapsedMs(t, t0 + 260_000), 160_000);
  t = timer.set(t, 30 * 60_000, t0 + 260_000);
  assert.equal(timer.elapsedMs(t, t0 + 320_000), 31 * 60_000);
  assert.ok(timer.isRunning(t));
});

test('repeating a workout creates a separate session and leaves the original untouched', () => {
  const src = workout('w1', '2026-11-02', 'Push Day', [['bench-press', [set(135, 10), set(155, 8), set(185, 5)]], ['tricep-pushdown', [set(40, 12)]]]);
  const before = JSON.stringify(src);
  const w = workoutFromPrevious(src, { unit: 'lb' }, nameOf);
  assert.notEqual(w.id, src.id);
  assert.equal(w.status, 'active');
  assert.equal(w.repeatedFromId, 'w1');
  assert.equal(w.name, 'Push Day');
  assert.deepEqual(w.exercises.map((e) => e.exerciseId), ['bench-press', 'tricep-pushdown']);
  assert.deepEqual(w.exercises[0].sets.map((s) => [s.target.weight, s.target.reps, s.weight, s.done]), [[135, 10, null, false], [155, 8, null, false], [185, 5, null, false]]);
  w.exercises[0].sets[0].weight = 999; w.name = 'changed';
  assert.equal(JSON.stringify(src), before, 'original workout is unchanged');
});

test('template → workout converts target weights to the user\'s unit', () => {
  const tpl = { id: 't1', name: 'Legs', unit: 'kg', exercises: [{ exerciseId: 'squat', name: 'Back Squat', sets: [{ weight: 100, reps: 5 }] }] };
  const w = workoutFromTemplate(tpl, { unit: 'lb' }, nameOf);
  assert.equal(w.templateId, 't1');
  assert.equal(w.exercises[0].sets[0].target.weight, 220.46);
});

test('finishing saves only completed sets, records the duration, and is idempotent', () => {
  const w = blankWorkout({ unit: 'lb' }, 'Push Day');
  w.timer = { accumulatedMs: 4_354_000, runningSince: null };
  w.exercises = [
    { uid: 'a', exerciseId: 'bench-press', name: 'Bench Press', sets: [set(135, 10), set(165, 8, false), set(null, null, false)] },
    { uid: 'b', exerciseId: 'squat', name: 'Squat', sets: [set(null, null, false)] },
  ];
  assert.equal(filledButUnchecked(w), 1);
  finishWorkout(w, { countFilled: true });
  assert.equal(w.status, 'completed');
  assert.equal(w.durationSec, 4354);
  assert.equal(w.exercises.length, 1);
  assert.deepEqual(w.exercises[0].sets.map((s) => [s.weight, s.reps]), [[135, 10], [165, 8]]);
  const snapshot = JSON.stringify(w);
  finishWorkout(w, { countFilled: true });
  assert.equal(JSON.stringify(w), snapshot);
});

test('weekly frequency buckets workouts by local week', () => {
  const now = new Date('2026-11-10T10:00:00');
  const dates = ['2026-11-09T18:00', '2026-11-10T07:00', '2026-11-04T18:00', '2026-09-01T18:00'].map((d) => new Date(d).toISOString());
  const weeks = weeklyFrequency(dates, 4, now);
  assert.deepEqual(weeks.map((w) => w.count), [0, 0, 1, 2]);
});

test('progress series uses saved sessions inside the chosen range', () => {
  const ws = [
    workout('w1', '2026-06-01', 'A', [['bench-press', [set(185, 5)]]]),
    workout('w2', '2026-11-01', 'A', [['bench-press', [set(190, 5)]]]),
    workout('w3', '2026-11-05', 'A', [['bench-press', [set(195, 5), set(135, 12)]]]),
  ];
  const ix = buildIndex(ws, 'lb');
  const now = new Date('2026-11-10T10:00:00');
  assert.deepEqual(exerciseSeries(ix, 'bench-press', '30d', now).map((p) => p.maxWeight), [190, 195]);
  assert.equal(exerciseSeries(ix, 'bench-press', 'all', now).length, 3);
  assert.equal(exerciseSeries(ix, 'bench-press', '30d', now)[1].bestReps, 12);
});
