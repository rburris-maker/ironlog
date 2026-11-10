// Run with:  node --test tests/
// Covers the calculations the app's reliability depends on: estimated 1RM,
// previous-lift lookup, personal records (including after edits/deletes),
// the wall-clock timer, and repeating/finishing workouts.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  epley, convert, buildIndex, lastSession, exerciseSnapshot, livePRs, timer, weeklyFrequency, exerciseSeries,
} from '../js/core/calc.js';
import { workoutFromPrevious, workoutFromTemplate, finishWorkout, filledButUnchecked, blankWorkout, supersetInfo, linkSuperset, unlinkSuperset, normalizeSupersets, templateFromWorkout } from '../js/core/session.js';

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

test('AMRAP sets keep their flag and time through finishing, repeating and templates, and still count for records', () => {
  const w = blankWorkout({ unit: 'lb' }, 'Push Day');
  w.timer = { accumulatedMs: 60_000, runningSince: null };
  w.exercises = [{ uid: 'a', exerciseId: 'bench-press', name: 'Bench Press', sets: [set(185, 5), { id: 'am', weight: 135, reps: 17, done: true, amrap: true, seconds: 120 }] }];
  finishWorkout(w);
  assert.deepEqual(w.exercises[0].sets[1], { id: 'am', weight: 135, reps: 17, done: true, amrap: true, seconds: 120 });
  const ix = buildIndex([w], 'lb');
  assert.equal(ix.exercises.get('bench-press').sessions[0].sets[1].amrap, true);
  assert.equal(ix.exercises.get('bench-press').records.repsAtWeight.get('135').reps, 17);

  const again = workoutFromPrevious(w, { unit: 'lb' }, nameOf);
  const amrap = again.exercises[0].sets[1];
  assert.equal(amrap.amrap, true);
  assert.equal(amrap.seconds, 120);
  assert.equal(amrap.reps, null, 'today starts empty');
  assert.equal(again.exercises[0].sets[0].amrap, undefined);

  const tpl = templateFromWorkout(w, 'Push');
  assert.deepEqual(tpl.exercises[0].sets[1], { weight: 135, reps: null, amrap: true, seconds: 120 });
  const fromTpl = workoutFromTemplate(tpl, { unit: 'lb' }, nameOf);
  assert.equal(fromTpl.exercises[0].sets[1].amrap, true);
  assert.equal(fromTpl.exercises[0].sets[1].seconds, 120);
});

test('supersets: linking, labelling, unlinking and surviving a repeat', () => {
  const e = (uid, exerciseId) => ({ uid, exerciseId, name: exerciseId, sets: [set(100, 10)] });
  const list = [e('a', 'bench-press'), e('b', 'barbell-row'), e('c', 'squat'), e('d', 'leg-curl'), e('f', 'plank')];
  linkSuperset(list, 0, 1);
  linkSuperset(list, 2, 3);
  let info = supersetInfo(list);
  assert.deepEqual([info.get('a').letter, info.get('b').letter, info.get('c').letter, info.get('d').letter], ['A', 'A', 'B', 'B']);
  assert.ok(info.get('a').first && info.get('b').last);
  assert.equal(info.get('f'), undefined);

  linkSuperset(list, 1, 2); // join the two pairs into one giant set
  info = supersetInfo(list);
  assert.equal(info.get('d').letter, 'A');
  assert.equal(info.get('d').size, 4);

  unlinkSuperset(list, 1); // pull one out of the middle: a is left alone, c + d stay together
  info = supersetInfo(list);
  assert.equal(info.get('a'), undefined);
  assert.equal(list[0].supersetId, undefined);
  assert.equal(info.get('c').size, 2);

  // moving a partner away dissolves the pair
  const moved = [list[2], list[4], list[3]];
  normalizeSupersets(moved);
  assert.equal(moved[0].supersetId, undefined);
  assert.equal(moved[2].supersetId, undefined);

  // a repeated workout keeps its supersets
  const src = workout('w1', '2026-11-02', 'Upper', [['bench-press', [set(135, 10)]], ['barbell-row', [set(135, 10)]], ['plank', [set(0, 1)]]]);
  linkSuperset(src.exercises, 0, 1);
  const again = workoutFromPrevious(src, { unit: 'lb' }, nameOf);
  const info2 = supersetInfo(again.exercises);
  assert.equal(info2.get(again.exercises[0].uid).letter, 'A');
  assert.equal(info2.get(again.exercises[1].uid).last, true);
  assert.equal(info2.get(again.exercises[2].uid), undefined);
});

// ---------- body: muscle map, strength ratings, recovery ----------

import { BUILT_IN, MUSCLE_IDS, musclesOf } from '../js/core/exercises.js';
import { STANDARDS, scoreRatio, bodyweightAt, withBodyweight, strengthRatings, recoveryStatus, setEffort, nextLevel, tiredMuscles, RECOVERY } from '../js/core/body.js';

const musclesFor = (id) => musclesOf(BUILT_IN.find((e) => e.id === id));
const HOUR = 3600000;
const daysAgo = (d, now) => new Date(now - d * 24 * HOUR).toISOString();

test('every built-in exercise names valid muscles, and every standard lift exists', () => {
  for (const e of BUILT_IN) {
    assert.ok(e.muscles.primary.length > 0, `${e.id} has a primary muscle`);
    for (const m of [...e.muscles.primary, ...e.muscles.secondary]) assert.ok(MUSCLE_IDS.includes(m), `${e.id}: ${m}`);
  }
  for (const [id, std] of Object.entries(STANDARDS)) {
    assert.ok(BUILT_IN.some((e) => e.id === id), `${id} is a built-in exercise`);
    for (const t of [std.male, std.female]) {
      assert.equal(t.length, 5);
      for (let i = 1; i < 5; i++) assert.ok(t[i] > t[i - 1], `${id} thresholds increase`);
    }
    for (const m of Object.keys(std.rates)) assert.ok(MUSCLE_IDS.includes(m));
  }
  // custom exercises fall back to their group, and bad muscle ids are dropped
  assert.deepEqual(musclesOf({ group: 'Arms' }).primary, ['biceps', 'triceps']);
  assert.deepEqual(musclesOf({ group: 'Legs', muscles: { primary: ['calves', 'nope'], secondary: [] } }), { primary: ['calves'], secondary: [] });
  assert.deepEqual(musclesOf(null), { primary: [], secondary: [] });
});

test('strength score: 20 points per level, straight lines between', () => {
  const bench = STANDARDS['bench-press'].male; // 0.5, 1, 1.25, 1.5, 2
  assert.deepEqual(scoreRatio(0.25, bench), { score: 10, levelIndex: -1, level: 'Starting out' });
  assert.deepEqual(scoreRatio(0.5, bench), { score: 20, levelIndex: 0, level: 'Beginner' });
  assert.deepEqual(scoreRatio(1.25, bench), { score: 60, levelIndex: 2, level: 'Intermediate' });
  assert.deepEqual(scoreRatio(1.375, bench), { score: 70, levelIndex: 2, level: 'Intermediate' });
  assert.deepEqual(scoreRatio(3, bench), { score: 100, levelIndex: 4, level: 'Elite' });
});

test('bodyweight on the day of a lift comes from the log, converted to the right unit', () => {
  const log = [{ date: '2026-03-01T12:00:00Z', weight: 200, unit: 'lb' }, { date: '2026-06-01T12:00:00Z', weight: 85, unit: 'kg' }];
  assert.equal(bodyweightAt(log, '2026-01-10T10:00:00Z', 'lb'), 200); // before the log starts: first entry
  assert.equal(bodyweightAt(log, '2026-04-10T10:00:00Z', 'lb'), 200);
  assert.equal(bodyweightAt(log, '2026-07-01T10:00:00Z', 'kg'), 85);
  assert.equal(Math.round(bodyweightAt(log, '2026-07-01T10:00:00Z', 'lb')), 187);
  assert.equal(bodyweightAt([], '2026-07-01T10:00:00Z', 'lb'), null);
  // a second entry on the same day replaces the first
  const now = new Date('2026-06-01T18:00:00');
  const next = withBodyweight([{ date: new Date('2026-06-01T08:00:00').toISOString(), weight: 180, unit: 'lb' }], 182, 'lb', now);
  assert.equal(next.length, 1);
  assert.equal(next[0].weight, 182);
});

test('muscle ratings come from the best direct lift at the bodyweight of the day', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const ws = [
    workout('a', '2026-11-01T10:00:00Z', 'Push', [['bench-press', [set(225, 1)]], ['overhead-press', [set(95, 5)]]]),
    workout('b', '2026-11-03T10:00:00Z', 'Legs', [['squat', [set(315, 1)]], ['calf-raise', [set(200, 20)]]]),
    workout('old', '2025-01-03T10:00:00Z', 'Old', [['deadlift', [set(405, 1)]]]),
  ];
  const index = buildIndex(ws, 'lb');
  const log = [{ date: '2025-01-01T00:00:00Z', weight: 180, unit: 'lb' }];

  const none = strengthRatings({ index, bodyweightLog: log, table: '', now });
  assert.equal(none.ready, false);
  assert.equal(none.overall, null);

  const r = strengthRatings({ index, bodyweightLog: log, table: 'male', now });
  const m = Object.fromEntries(r.muscles.map((x) => [x.muscle, x]));
  // bench 225 / 180 = 1.25 → exactly Intermediate
  assert.equal(m.chest.level, 'Intermediate');
  assert.equal(m.chest.score, 60);
  assert.equal(m.chest.from.exerciseId, 'bench-press');
  assert.equal(m.chest.indirect, false);
  // shoulders: the overhead press rates them directly, so the bench (which only assists) is ignored
  assert.equal(m.shoulders.from.exerciseId, 'overhead-press');
  assert.equal(m.shoulders.level, 'Novice'); // 95×5 → est. 110.8 / 180 = 0.62
  // triceps have no direct lift logged → estimated from the better of the two pressing lifts
  assert.equal(m.triceps.indirect, true);
  assert.equal(m.triceps.from.exerciseId, 'bench-press');
  // squat 315 / 180 = 1.75 → Intermediate for quads and glutes
  assert.equal(m.quads.level, 'Intermediate');
  // deadlift is older than six months: still used, but flagged; it does not beat the squat for glutes on level alone
  assert.equal(m.lowerBack.from.stale, true);
  assert.equal(m.lowerBack.level, 'Intermediate'); // 405 / 180 = 2.25
  assert.equal(m.calves.reason, 'no-standard');
  assert.equal(m.biceps.reason, 'no-lifts');
  assert.ok(r.overall.score > 0 && r.overall.rated >= 6);

  // the women's table is stricter per pound lifted → the same lift rates higher
  const f = strengthRatings({ index, bodyweightLog: log, table: 'female', now });
  assert.ok(f.muscles.find((x) => x.muscle === 'chest').score > m.chest.score);

  // weighing less on the day raises the ratio
  const lighter = strengthRatings({ index, bodyweightLog: [{ date: '2025-01-01T00:00:00Z', weight: 150, unit: 'lb' }], table: 'male', now });
  assert.equal(lighter.muscles.find((x) => x.muscle === 'chest').level, 'Advanced'); // 225 / 150 = 1.5

  const nx = nextLevel(m.chest.from, 180);
  assert.deepEqual(nx, { level: 'Advanced', ratio: 1.5, e1rm: 270 });
});

test('recovery: sets load the muscles they work and fade by half each day', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const bench10 = Array.from({ length: 10 }, () => set(200, 5));
  const ws = [workout('w', daysAgo(0.01, now), 'Chest', [['bench-press', bench10]], { endedAt: daysAgo(0, now) })];
  const index = buildIndex(ws, 'lb');
  const at = (t, extra = {}) => Object.fromEntries(recoveryStatus({ workouts: ws, index, musclesFor, now: t, ...extra }).map((s) => [s.muscle, s]));

  const s0 = at(now);
  assert.equal(s0.chest.pct, 100);           // ten hard sets = fully worked
  assert.equal(s0.chest.state, 'worked');
  assert.equal(s0.chest.sets, 10);
  assert.equal(s0.triceps.pct, 50);          // assisting muscles take half
  assert.equal(s0.triceps.state, 'recovering');
  assert.equal(s0.quads.pct, 0);
  assert.equal(s0.quads.state, 'fresh');
  assert.equal(s0.quads.lastWorked, null);
  assert.equal(Math.round(s0.chest.readyInHours), 48); // 100% → 25% takes two half-lives

  const s1 = at(now + 24 * HOUR);
  assert.equal(s1.chest.pct, 50);
  assert.equal(s1.chest.state, 'recovering');
  assert.equal(s1.triceps.state, 'recovering');
  const s2 = at(now + 49 * HOUR);
  assert.equal(s2.chest.state, 'fresh');
  // after a week the workout no longer counts at all
  assert.equal(at(now + 8 * 24 * HOUR).chest.lastWorked, null);

  // muscles a routine would hit that still need rest
  const status = recoveryStatus({ workouts: ws, index, musclesFor, now });
  assert.deepEqual(tiredMuscles(['incline-bench-press', 'squat'], status, musclesFor), ['chest']);
  assert.deepEqual(tiredMuscles(['squat'], status, musclesFor), []);
});

test('recovery: warm-ups count less, AMRAP sets more, unchecked sets and deleted workouts not at all', () => {
  assert.equal(setEffort({ weight: 200, reps: 5 }, 233.33), 1);
  assert.equal(setEffort({ weight: 60, reps: 5 }, 233.33), 0.5);            // far below the best: a warm-up
  assert.equal(setEffort({ weight: 200, reps: 5, amrap: true }, 233.33), 1.25);
  assert.equal(setEffort({ weight: 0, reps: 15 }, 0), 1);                    // bodyweight work counts as a full set

  const now = Date.parse('2026-11-10T12:00:00Z');
  const ws = [
    workout('w', daysAgo(0.5, now), 'Legs', [['squat', [set(300, 5), set(300, 5, false)]]]),
    workout('gone', daysAgo(0.5, now), 'Deleted', [['squat', [set(300, 5)]]], { deletedAt: daysAgo(0.1, now) }),
    { id: 'live', name: 'Now', status: 'active', unit: 'lb', startedAt: daysAgo(0.01, now), exercises: [{ uid: 'x', exerciseId: 'barbell-curl', name: 'Barbell Curl', sets: [set(80, 8), set(80, 8)] }] },
  ];
  const index = buildIndex(ws, 'lb');
  const s = Object.fromEntries(recoveryStatus({ workouts: ws, index, musclesFor, now }).map((x) => [x.muscle, x]));
  assert.equal(s.quads.sets, 1);
  assert.equal(s.biceps.sets, 2);            // the workout in progress counts straight away
  assert.equal(s.biceps.pct, 20);
});

test('recovery: a soreness check-in overrides the estimate from that moment on', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const ws = [workout('w', daysAgo(1.01, now), 'Chest', [['bench-press', Array.from({ length: 10 }, () => set(200, 5))]], { endedAt: daysAgo(1, now) })];
  const index = buildIndex(ws, 'lb');
  const run = (soreness, t = now) => Object.fromEntries(recoveryStatus({ workouts: ws, index, musclesFor, soreness, now: t }).map((x) => [x.muscle, x]));

  assert.equal(run({}).chest.pct, 50);
  // "very sore" just now → needs rest, whatever the sets say
  const very = run({ chest: { level: 'very', at: new Date(now).toISOString() } });
  assert.equal(very.chest.pct, RECOVERY.report.very);
  assert.equal(very.chest.state, 'worked');
  assert.equal(very.chest.report.level, 'very');
  // "fresh" just now → ready, and untrained muscles can be marked sore too
  const fresh = run({ chest: { level: 'fresh', at: new Date(now).toISOString() }, calves: { level: 'sore', at: new Date(now).toISOString() } });
  assert.equal(fresh.chest.state, 'fresh');
  assert.equal(fresh.calves.state, 'recovering');
  // the report itself fades, and one older than a week is ignored
  assert.equal(run({ chest: { level: 'very', at: new Date(now).toISOString() } }, now + 24 * HOUR).chest.pct, 40);
  assert.equal(run({ quads: { level: 'very', at: daysAgo(9, now) } }).quads.report, null);
});

// ---------- groups ----------

import { weekBoard, postExercises, describeTargets, boardSince, BOARD_WEEKS } from '../js/core/groups.js';

test('group board: this week\'s count, goal, and a streak that survives an unfinished current week', () => {
  const now = new Date('2026-11-12T12:00:00');           // a Thursday
  const day = (offset, hour = 9) => { const d = new Date(now); d.setDate(d.getDate() + offset); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
  const members = [
    { user_id: 'a', display_name: 'Ann', share: true, active_since: null },
    { user_id: 'b', display_name: 'Bo', share: true, active_since: day(0, 11) },
    { user_id: 'c', display_name: 'Cy', share: false },
    { user_id: 'd', display_name: 'Di', share: true },
  ];
  const w = (user_id, offset) => ({ user_id, started_at: day(offset) });
  const workouts = [
    // Ann: 2 this week (Mon, Wed), 2 last week, 2 the week before, 1 three weeks back
    w('a', -3), w('a', -1), w('a', -8), w('a', -10), w('a', -15), w('a', -17), w('a', -22),
    // Bo: 1 this week, 2 last week
    w('b', -2), w('b', -9), w('b', -7),
    // a workout by someone who left the group is ignored
    w('z', -1),
  ];
  const rows = Object.fromEntries(weekBoard({ members, workouts, goal: 2, now }).map((r) => [r.name, r]));
  assert.equal(rows.Ann.count, 2);
  assert.equal(rows.Ann.met, true);
  assert.equal(rows.Ann.streak, 3);                       // this week + the two before; three weeks back missed
  assert.equal(rows.Bo.count, 1);
  assert.equal(rows.Bo.met, false);
  assert.equal(rows.Bo.streak, 1);                        // last week counted; this week is still open, so it is not broken
  assert.ok(rows.Bo.activeSince);
  assert.equal(rows.Di.count, 0);
  assert.equal(rows.Di.streak, 0);
  assert.equal(rows.Di.last, null);
  assert.equal(rows.Cy.share, false);
  // order: most workouts this week first; members who are not sharing last
  assert.deepEqual(weekBoard({ members, workouts, goal: 2, now }).map((r) => r.name), ['Ann', 'Bo', 'Di', 'Cy']);
  // the board asks the server for eight Monday-to-Sunday weeks
  const since = boardSince(now);
  assert.equal(since.getDay(), 1);
  assert.equal(Math.floor((now - since) / 86400000), (BOARD_WEEKS - 1) * 7 + 3); // Monday 00:00, seven weeks before this week
});

test('posting a routine to a group leaves weights out and describes custom exercises', () => {
  const tpl = { name: 'Push', unit: 'lb', exercises: [
    { uid: 'x', exerciseId: 'bench-press', name: 'Bench Press', supersetId: 's1', sets: [{ weight: 185, reps: 8 }, { weight: 185, reps: 8 }, { weight: 135, reps: null, amrap: true, seconds: 60 }] },
    { uid: 'y', exerciseId: 'c0ffee', name: 'Sled Drag', sets: [] },
  ] };
  const out = postExercises(tpl, (id) => (id === 'c0ffee' ? { group: 'Legs', muscles: { primary: ['quads'], secondary: [] } } : null));
  assert.deepEqual(out[0], { uid: 'p1', exerciseId: 'bench-press', name: 'Bench Press', supersetId: 's1', sets: [{ weight: null, reps: 8 }, { weight: null, reps: 8 }, { weight: null, reps: null, amrap: true, seconds: 60 }] });
  assert.deepEqual(out[1].custom, { group: 'Legs', muscles: { primary: ['quads'], secondary: [] } });
  assert.deepEqual(out[1].sets, [{ weight: null, reps: null }]);
  assert.equal(describeTargets(out[0].sets), '2 × 8, 1 × AMRAP 60s');
  assert.equal(describeTargets(out[1].sets), '1 set');
  assert.equal(describeTargets([{ reps: 5 }, { reps: 5 }, { reps: 3 }]), '2 × 5, 1 × 3');
});
