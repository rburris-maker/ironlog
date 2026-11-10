// Pure calculations: unit conversion, estimated 1RM, volume, previous-lift lookup,
// personal records and analytics. No DOM, no storage — everything here is derived
// from the list of saved workouts, so editing or deleting a workout can never leave
// a stale record behind.

export const LB_PER_KG = 2.2046226218;

/** Estimated 1RM is only calculated from sets of 1–12 reps; beyond that the estimate is unreliable. */
export const E1RM_MAX_REPS = 12;

export function convert(weight, from, to) {
  if (weight == null) return null;
  if (!from || !to || from === to) return weight;
  const v = from === 'kg' ? weight * LB_PER_KG : weight / LB_PER_KG;
  return Math.round(v * 100) / 100;
}

/**
 * Epley formula: 1RM ≈ weight × (1 + reps / 30).
 * A single rep is an actual lift, so it returns the weight itself.
 */
export function epley(weight, reps) {
  if (!(weight > 0) || !(reps >= 1) || reps > E1RM_MAX_REPS) return null;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

/** A set counts toward history and records only when it is checked off and has reps. */
export function isCountable(set) {
  return !!set && set.done === true && Number.isFinite(set.reps) && set.reps > 0;
}

/** Completed sets of one exercise entry, converted to `unit`. */
export function countableSets(entry, fromUnit, unit) {
  const out = [];
  for (const s of entry.sets || []) {
    if (!isCountable(s)) continue;
    const w = Number.isFinite(s.weight) ? s.weight : 0;
    out.push({ id: s.id, weight: convert(w, fromUnit, unit), reps: s.reps });
  }
  return out;
}

export function volumeOf(sets) {
  let v = 0;
  for (const s of sets) v += s.weight * s.reps;
  return Math.round(v * 100) / 100;
}

const weightKey = (w) => String(Math.round(w * 100) / 100);
const EPS = 1e-6;

function summarizeSession(workout, sets) {
  let top = null;      // heaviest set (most reps breaks ties)
  let bestEst = null;  // set with the highest estimated 1RM
  let maxReps = 0;
  const repsByWeight = new Map();
  for (const s of sets) {
    if (!top || s.weight > top.weight + EPS || (Math.abs(s.weight - top.weight) < EPS && s.reps > top.reps)) top = s;
    const est = epley(s.weight, s.reps);
    if (est != null && (!bestEst || est > bestEst.value + EPS)) {
      bestEst = { value: est, weight: s.weight, reps: s.reps, setId: s.id };
    }
    if (s.reps > maxReps) maxReps = s.reps;
    const k = weightKey(s.weight);
    const cur = repsByWeight.get(k);
    if (!cur || s.reps > cur.reps) repsByWeight.set(k, s);
  }
  return {
    workoutId: workout.id,
    workoutName: workout.name,
    date: workout.startedAt,
    sets,
    top,
    bestEst,
    maxReps,
    repsByWeight,
    volume: volumeOf(sets),
  };
}

function emptyRecords() {
  return {
    heaviest: null,   // { weight, reps, date, workoutId } — an actual completed lift
    bestEst: null,    // { value, weight, reps, date, workoutId } — an estimate, never shown as a lift
    bestVolume: null, // { value, date, workoutId } — most volume for this exercise in one workout
    repsAtWeight: new Map(), // weight -> { reps, date, workoutId }
    lastPrDate: null,
  };
}

/**
 * Compare one session against the records that existed before it.
 * The first time an exercise is ever performed sets the baseline and is not announced as a PR.
 * At most one event per record type per session.
 */
export function detectPRs(records, session, { includeVolume = true } = {}) {
  const events = [];
  if (!records || !session || !session.sets.length) return events;
  const hasHistory = records.heaviest || records.repsAtWeight.size > 0;
  if (!hasHistory) return events;

  if (records.heaviest && session.top && session.top.weight > records.heaviest.weight + EPS) {
    events.push({ type: 'weight', weight: session.top.weight, reps: session.top.reps, setId: session.top.id, previous: records.heaviest.weight });
  }
  if (records.bestEst && session.bestEst && session.bestEst.value > records.bestEst.value + EPS) {
    events.push({ type: 'e1rm', value: session.bestEst.value, weight: session.bestEst.weight, reps: session.bestEst.reps, setId: session.bestEst.setId, previous: records.bestEst.value });
  }
  let repBest = null;
  for (const [k, s] of session.repsByWeight) {
    const prior = records.repsAtWeight.get(k);
    if (prior && s.reps > prior.reps && (!repBest || s.weight > repBest.weight)) {
      repBest = { type: 'reps', weight: s.weight, reps: s.reps, setId: s.id, previous: prior.reps };
    }
  }
  if (repBest) events.push(repBest);
  if (includeVolume && records.bestVolume && session.volume > records.bestVolume.value + EPS) {
    events.push({ type: 'volume', value: session.volume, previous: records.bestVolume.value });
  }
  return events;
}

function applySession(records, session) {
  const stamp = { date: session.date, workoutId: session.workoutId };
  if (session.top && (!records.heaviest || session.top.weight > records.heaviest.weight + EPS)) {
    records.heaviest = { weight: session.top.weight, reps: session.top.reps, ...stamp };
  }
  if (session.bestEst && (!records.bestEst || session.bestEst.value > records.bestEst.value + EPS)) {
    records.bestEst = { value: session.bestEst.value, weight: session.bestEst.weight, reps: session.bestEst.reps, ...stamp };
  }
  if (!records.bestVolume || session.volume > records.bestVolume.value + EPS) {
    records.bestVolume = { value: session.volume, ...stamp };
  }
  for (const [k, s] of session.repsByWeight) {
    const prior = records.repsAtWeight.get(k);
    if (!prior || s.reps > prior.reps) records.repsAtWeight.set(k, { weight: s.weight, reps: s.reps, ...stamp });
  }
}

const byStart = (a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : (a.createdAt || '') < (b.createdAt || '') ? -1 : 1);

/**
 * Walk every completed workout in date order and derive, per exercise:
 * the list of sessions, the current records and every PR event.
 * `unit` is the unit all weights are converted to.
 */
export function buildIndex(workouts, unit) {
  const completed = workouts.filter((w) => w.status === 'completed' && !w.deletedAt).sort(byStart);
  const exercises = new Map(); // exerciseId -> { sessions, records, prCount }
  const byWorkout = new Map(); // workoutId -> { volume, setCount, exerciseCount, prs, setFlags }
  const prEvents = [];
  let bestWorkoutVolume = null;
  let totalSeconds = 0;

  for (const w of completed) {
    totalSeconds += w.durationSec || 0;
    const grouped = new Map();
    for (const entry of w.exercises || []) {
      const sets = countableSets(entry, w.unit, unit);
      if (!sets.length) continue;
      const g = grouped.get(entry.exerciseId);
      if (g) g.sets.push(...sets);
      else grouped.set(entry.exerciseId, { name: entry.name, sets });
    }
    const summary = { volume: 0, setCount: 0, exerciseCount: grouped.size, prs: [], setFlags: new Map() };
    for (const [exerciseId, g] of grouped) {
      let ex = exercises.get(exerciseId);
      if (!ex) { ex = { exerciseId, name: g.name, sessions: [], records: emptyRecords(), prCount: 0 }; exercises.set(exerciseId, ex); }
      const session = summarizeSession(w, g.sets);
      const events = detectPRs(ex.records, session);
      applySession(ex.records, session);
      ex.sessions.push(session);
      ex.name = g.name || ex.name;
      session.prs = events;
      for (const ev of events) {
        const full = { ...ev, exerciseId, exerciseName: g.name, workoutId: w.id, date: w.startedAt };
        prEvents.push(full);
        summary.prs.push(full);
        ex.prCount += 1;
        ex.records.lastPrDate = w.startedAt;
        if (ev.setId) {
          const flags = summary.setFlags.get(ev.setId) || [];
          flags.push(ev.type);
          summary.setFlags.set(ev.setId, flags);
        }
      }
      summary.volume += session.volume;
      summary.setCount += g.sets.length;
    }
    summary.volume = Math.round(summary.volume * 100) / 100;
    if (summary.setCount > 0) {
      if (bestWorkoutVolume && summary.volume > bestWorkoutVolume.value + EPS) {
        const ev = { type: 'workoutVolume', value: summary.volume, previous: bestWorkoutVolume.value, workoutId: w.id, workoutName: w.name, date: w.startedAt };
        prEvents.push(ev);
        summary.prs.push(ev);
      }
      if (!bestWorkoutVolume || summary.volume > bestWorkoutVolume.value + EPS) {
        bestWorkoutVolume = { value: summary.volume, workoutId: w.id, workoutName: w.name, date: w.startedAt };
      }
    }
    byWorkout.set(w.id, summary);
  }

  return {
    unit,
    completed,
    exercises,
    byWorkout,
    prEvents,
    bestWorkoutVolume,
    totals: { workouts: completed.length, seconds: totalSeconds, prs: prEvents.length },
  };
}

/**
 * Most recent completed session of an exercise, wherever it was performed.
 * `before` limits the search to sessions that started earlier (used when editing an old workout).
 */
export function lastSession(index, exerciseId, { before = null, excludeWorkoutId = null } = {}) {
  const ex = index.exercises.get(exerciseId);
  if (!ex) return null;
  for (let i = ex.sessions.length - 1; i >= 0; i--) {
    const s = ex.sessions[i];
    if (excludeWorkoutId && s.workoutId === excludeWorkoutId) continue;
    if (before && !(s.date < before)) continue;
    return s;
  }
  return null;
}

/** Everything the workout screen shows above an exercise's set table. */
export function exerciseSnapshot(index, exerciseId, opts) {
  const ex = index.exercises.get(exerciseId);
  const last = lastSession(index, exerciseId, opts);
  return {
    last,
    lastDate: last ? last.date : null,
    workingWeight: last && last.top ? last.top.weight : null,
    workingReps: last && last.top ? last.top.reps : null,
    heaviest: ex ? ex.records.heaviest : null,
    bestEst: ex ? ex.records.bestEst : null,
    timesPerformed: ex ? ex.sessions.length : 0,
    records: ex ? ex.records : null,
  };
}

/**
 * PRs in a workout that is still in progress, measured against saved history.
 * Returns events tagged with the set that earned them. Volume is left out
 * until the workout is finished because it keeps growing.
 */
export function livePRs(index, entry, workoutUnit) {
  const ex = index.exercises.get(entry.exerciseId);
  if (!ex) return [];
  const sets = countableSets(entry, workoutUnit, index.unit);
  if (!sets.length) return [];
  const session = summarizeSession({ id: null, name: '', startedAt: '' }, sets);
  return detectPRs(ex.records, session, { includeVolume: false });
}

// ---------- analytics ----------

/** Monday 00:00 local time of the week containing `d`. */
export function weekStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

/** Workouts per week for the last `weeks` weeks, oldest first. */
export function weeklyFrequency(dates, weeks = 8, now = new Date()) {
  const start = weekStart(now);
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setDate(d.getDate() - i * 7);
    buckets.push({ start: d, count: 0 });
  }
  const first = buckets[0].start.getTime();
  for (const iso of dates) {
    const t = weekStart(iso).getTime();
    if (t < first) continue;
    const idx = Math.round((t - first) / (7 * 86400000));
    if (buckets[idx]) buckets[idx].count += 1;
  }
  return buckets;
}

export const RANGES = [
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: '6m', label: '6 months', days: 183 },
  { id: '1y', label: '1 year', days: 365 },
  { id: 'all', label: 'All time', days: null },
];

export function rangeStart(rangeId, now = new Date()) {
  const r = RANGES.find((x) => x.id === rangeId);
  if (!r || r.days == null) return null;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - r.days);
  return d;
}

/** One point per session for the progress charts. */
export function exerciseSeries(index, exerciseId, rangeId, now = new Date()) {
  const ex = index.exercises.get(exerciseId);
  if (!ex) return [];
  const from = rangeStart(rangeId, now);
  return ex.sessions
    .filter((s) => !from || new Date(s.date) >= from)
    .map((s) => ({
      date: s.date,
      workoutId: s.workoutId,
      workoutName: s.workoutName,
      maxWeight: s.top ? s.top.weight : 0,
      topReps: s.top ? s.top.reps : 0,
      e1rm: s.bestEst ? Math.round(s.bestEst.value * 10) / 10 : null,
      volume: s.volume,
      bestReps: s.maxReps,
      sets: s.sets,
      prs: s.prs || [],
    }));
}

// ---------- workout timer (wall-clock based, so it survives refreshes and a locked phone) ----------

export const timer = {
  start(now = Date.now()) { return { accumulatedMs: 0, runningSince: now }; },
  elapsedMs(t, now = Date.now()) {
    if (!t) return 0;
    return Math.max(0, (t.accumulatedMs || 0) + (t.runningSince ? now - t.runningSince : 0));
  },
  isRunning(t) { return !!(t && t.runningSince); },
  pause(t, now = Date.now()) { return { accumulatedMs: timer.elapsedMs(t, now), runningSince: null }; },
  resume(t, now = Date.now()) { return timer.isRunning(t) ? t : { accumulatedMs: (t && t.accumulatedMs) || 0, runningSince: now }; },
  /** Manually set the elapsed time; keeps running if it was running. */
  set(t, elapsedMs, now = Date.now()) {
    return { accumulatedMs: Math.max(0, elapsedMs), runningSince: timer.isRunning(t) ? now : null };
  },
};
