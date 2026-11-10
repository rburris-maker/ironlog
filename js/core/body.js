// Body analysis: a strength rating per muscle group, and an estimate of how
// recovered each muscle is. Pure calculations — everything is derived from the
// saved workouts, the same way personal records are.

import { convert, epley, countableSets } from './calc.js';
import { MUSCLE_IDS } from './exercises.js';

// ---------- strength standards ----------
//
// Bodyweight-ratio standards (one-rep max ÷ bodyweight) published by Strength Level,
// https://strengthlevel.com/strength-standards — their "Entire Community" tables.
// Order: Beginner, Novice, Intermediate, Advanced, Elite. Strength Level defines the
// levels as stronger than 5%, 20%, 50%, 80% and 95% of lifters who logged that lift.
// Dumbbell lifts are the weight of ONE dumbbell, which is how they are usually logged.
//
// `rates` says which muscles a lift is evidence for: 1 = it tests that muscle
// directly, 0.5 = the muscle assists, so the lift is only used when nothing
// direct has been logged.

export const LEVELS = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'];
export const LEVEL_PERCENTILES = [5, 20, 50, 80, 95];
export const BELOW_BEGINNER = 'Starting out';

export const STANDARDS_SOURCE = { name: 'Strength Level', url: 'https://strengthlevel.com/strength-standards' };

export const STANDARDS = {
  'bench-press': { male: [0.5, 1, 1.25, 1.5, 2], female: [0.3, 0.5, 0.75, 1.1, 1.45], rates: { chest: 1, triceps: 0.5, shoulders: 0.5 } },
  'incline-bench-press': { male: [0.5, 0.75, 1, 1.5, 1.75], female: [0.25, 0.4, 0.65, 0.95, 1.25], rates: { chest: 1, shoulders: 0.5, triceps: 0.5 } },
  'dumbbell-bench-press': { male: [0.2, 0.35, 0.5, 0.7, 0.9], female: [0.1, 0.2, 0.3, 0.45, 0.6], rates: { chest: 1, triceps: 0.5 }, perDumbbell: true },
  'incline-dumbbell-press': { male: [0.25, 0.35, 0.5, 0.65, 0.85], female: [0.1, 0.2, 0.3, 0.45, 0.55], rates: { chest: 1, shoulders: 0.5 }, perDumbbell: true },
  'close-grip-bench-press': { male: [0.5, 0.75, 1.25, 1.5, 2], female: [0.3, 0.5, 0.75, 1.05, 1.35], rates: { triceps: 1, chest: 0.5 } },
  'overhead-press': { male: [0.35, 0.55, 0.8, 1.05, 1.35], female: [0.2, 0.35, 0.5, 0.7, 0.95], rates: { shoulders: 1, triceps: 0.5 } },
  'dumbbell-shoulder-press': { male: [0.15, 0.25, 0.4, 0.55, 0.7], female: [0.1, 0.15, 0.25, 0.35, 0.45], rates: { shoulders: 1, triceps: 0.5 }, perDumbbell: true },
  'barbell-row': { male: [0.5, 0.75, 1, 1.5, 1.75], female: [0.3, 0.45, 0.7, 0.95, 1.25], rates: { back: 1, biceps: 0.5 } },
  'dumbbell-row': { male: [0.2, 0.35, 0.55, 0.75, 1], female: [0.15, 0.25, 0.35, 0.45, 0.6], rates: { back: 1, biceps: 0.5 }, perDumbbell: true },
  'lat-pulldown': { male: [0.5, 0.75, 1, 1.5, 1.75], female: [0.35, 0.5, 0.75, 0.95, 1.25], rates: { back: 1, biceps: 0.5 } },
  'barbell-curl': { male: [0.25, 0.4, 0.6, 0.8, 1.05], female: [0.1, 0.25, 0.4, 0.55, 0.75], rates: { biceps: 1 } },
  'deadlift': { male: [1, 1.5, 2, 2.5, 3.25], female: [0.75, 1, 1.5, 2, 2.5], rates: { lowerBack: 1, hamstrings: 1, glutes: 1, back: 0.5 } },
  'romanian-deadlift': { male: [0.75, 1, 1.5, 2, 2.75], female: [0.5, 0.75, 1, 1.5, 2], rates: { hamstrings: 1, glutes: 1, lowerBack: 0.5 } },
  'squat': { male: [0.75, 1.25, 1.75, 2.25, 2.75], female: [0.5, 0.75, 1.25, 1.75, 2.25], rates: { quads: 1, glutes: 1 } },
  'front-squat': { male: [0.75, 1, 1.25, 1.75, 2.25], female: [0.5, 0.75, 1, 1.25, 1.5], rates: { quads: 1 } },
};

/** Standard lifts that can rate a muscle, direct ones first. */
export function liftsThatRate(muscle) {
  return Object.entries(STANDARDS)
    .filter(([, s]) => s.rates[muscle])
    .sort((a, b) => b[1].rates[muscle] - a[1].rates[muscle])
    .map(([id, s]) => ({ exerciseId: id, direct: s.rates[muscle] === 1 }));
}

/**
 * Turn a strength ratio into a 0–100 score: 20 at Beginner, 40 Novice, 60 Intermediate,
 * 80 Advanced, 100 at Elite, in straight lines between. `levelIndex` is -1 below Beginner.
 */
export function scoreRatio(ratio, thresholds) {
  if (!(ratio > 0) || !thresholds) return { score: 0, levelIndex: -1, level: BELOW_BEGINNER };
  const xs = [0, ...thresholds];
  let score = 100;
  let levelIndex = thresholds.length - 1;
  for (let i = 1; i < xs.length; i++) {
    if (ratio < xs[i]) {
      const span = xs[i] - xs[i - 1];
      score = (i - 1) * 20 + (span > 0 ? ((ratio - xs[i - 1]) / span) * 20 : 0);
      levelIndex = i - 2;
      break;
    }
  }
  return { score: Math.round(score), levelIndex, level: levelIndex < 0 ? BELOW_BEGINNER : LEVELS[levelIndex] };
}

export function levelOfScore(score) {
  const levelIndex = Math.min(LEVELS.length - 1, Math.floor(score / 20) - 1);
  return { levelIndex, level: levelIndex < 0 ? BELOW_BEGINNER : LEVELS[levelIndex] };
}

// ---------- bodyweight ----------

const sortedLog = (log) => [...(Array.isArray(log) ? log : [])]
  .filter((e) => e && e.weight > 0 && e.date)
  .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/**
 * Bodyweight on the day of a lift: the latest entry on or before that day,
 * or the first entry ever if the lift is older than the log. Returned in `unit`.
 */
export function bodyweightAt(log, dateIso, unit) {
  const entries = sortedLog(log);
  if (!entries.length) return null;
  const day = String(dateIso || '').slice(0, 10);
  let pick = entries[0];
  for (const e of entries) {
    if (String(e.date).slice(0, 10) <= day) pick = e; else break;
  }
  return convert(pick.weight, pick.unit || unit, unit);
}

export function latestBodyweight(log) {
  const entries = sortedLog(log);
  return entries.length ? entries[entries.length - 1] : null;
}

/** Add today's bodyweight, replacing an entry already made the same day. */
export function withBodyweight(log, weight, unit, now = new Date()) {
  const date = now.toISOString();
  const local = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const rest = sortedLog(log).filter((e) => local(e.date) !== local(date));
  return [...rest, { date, weight, unit }].slice(-400);
}

// ---------- strength ratings ----------

/**
 * Rate every muscle from the user's best recent standard lifts.
 *   index         buildIndex() result
 *   bodyweightLog [{ date, weight, unit }]
 *   table         'male' | 'female' — which published table to compare with
 * A lift counts for 180 days; if nothing is that recent the best older lift is used and marked `stale`.
 */
export function strengthRatings({ index, bodyweightLog, table, now = new Date(), windowDays = 180 }) {
  const ready = (table === 'male' || table === 'female') && !!latestBodyweight(bodyweightLog);
  const lifts = [];
  if (ready) {
    const cutoff = now.getTime() - windowDays * 86400000;
    for (const [exerciseId, std] of Object.entries(STANDARDS)) {
      const ex = index.exercises.get(exerciseId);
      if (!ex) continue;
      let recent = null;
      let older = null;
      for (const s of ex.sessions) {
        if (!s.bestEst) continue;
        const bw = bodyweightAt(bodyweightLog, s.date, index.unit);
        if (!(bw > 0)) continue;
        const rec = { exerciseId, name: ex.name, ratio: s.bestEst.value / bw, e1rm: s.bestEst.value, weight: s.bestEst.weight, reps: s.bestEst.reps, date: s.date, bodyweight: bw };
        if (new Date(s.date).getTime() >= cutoff) { if (!recent || rec.ratio > recent.ratio) recent = rec; }
        else if (!older || rec.ratio > older.ratio) older = rec;
      }
      const pick = recent || (older && { ...older, stale: true });
      if (!pick) continue;
      lifts.push({ ...pick, ...scoreRatio(pick.ratio, std[table]), thresholds: std[table], rates: std.rates, perDumbbell: !!std.perDumbbell });
    }
  }

  const muscles = MUSCLE_IDS.map((muscle) => {
    const possible = liftsThatRate(muscle);
    if (!possible.length) return { muscle, score: null, reason: 'no-standard', lifts: [], suggest: [] };
    const mine = lifts.filter((l) => l.rates[muscle]).sort((a, b) => b.rates[muscle] - a.rates[muscle] || b.score - a.score);
    if (!mine.length) return { muscle, score: null, reason: ready ? 'no-lifts' : 'setup', lifts: [], suggest: possible };
    const direct = mine.filter((l) => l.rates[muscle] === 1);
    const from = (direct.length ? direct : mine).reduce((a, b) => (b.score > a.score ? b : a));
    return { muscle, score: from.score, levelIndex: from.levelIndex, level: from.level, from, indirect: !direct.length, lifts: mine, suggest: possible };
  });

  const rated = muscles.filter((m) => m.score != null);
  let overall = null;
  if (rated.length) {
    const score = Math.round(rated.reduce((a, m) => a + m.score, 0) / rated.length);
    const sorted = [...rated].sort((a, b) => b.score - a.score);
    overall = { score, ...levelOfScore(score), rated: rated.length, strongest: sorted[0], weakest: sorted[sorted.length - 1] };
  }
  return { ready, lifts, muscles, overall };
}

/** The next level up for a rated lift, as a ratio and as an estimated 1RM at the current bodyweight. */
export function nextLevel(lift, bodyweightNow) {
  const i = lift.levelIndex + 1;
  if (i >= LEVELS.length) return null;
  const ratio = lift.thresholds[i];
  return { level: LEVELS[i], ratio, e1rm: bodyweightNow > 0 ? ratio * bodyweightNow : null };
}

// ---------- recovery ----------
//
// An estimate, not a measurement. Every checked-off set adds load to the muscles
// the exercise works (assisting muscles get half). Load fades with a half-life of
// a day, so about ten hard sets for a muscle take roughly two days to clear —
// in line with the usual 48–72 hours between hard sessions for the same muscle.

export const RECOVERY = {
  halfLifeHours: 24,
  fullLoad: 10,       // effective sets that count as 100% worked
  workedFrom: 60,     // % and above: needs rest
  freshBelow: 25,     // % below which the muscle is ready again
  lookbackDays: 7,
  report: { fresh: 10, sore: 45, very: 80 }, // what a soreness check-in sets the level to
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** How much one set counts: warm-ups less, sets taken to failure (AMRAP) more. */
export function setEffort(set, bestEst) {
  let f = 1;
  const est = epley(set.weight, set.reps);
  if (est != null && bestEst > 0) f = clamp(est / bestEst, 0.5, 1);
  if (set.amrap) f *= 1.25;
  return f;
}

const endOf = (w, now) => {
  if (w.status === 'active') return now;
  if (w.endedAt) return Date.parse(w.endedAt);
  return Date.parse(w.startedAt) + (w.durationSec || 0) * 1000;
};

/**
 * Per-muscle recovery state right now.
 *   workouts    every saved workout (finished ones and the one in progress)
 *   index       buildIndex() result, for each exercise's best estimated 1RM
 *   musclesFor  (exerciseId) => { primary, secondary }
 *   soreness    { [muscle]: { level: 'fresh' | 'sore' | 'very', at: ISO } } — the user's own check-ins
 */
export function recoveryStatus({ workouts, index, musclesFor, soreness = {}, now = Date.now() }) {
  const R = RECOVERY;
  const since = now - R.lookbackDays * 86400000;
  const decay = (ms) => 0.5 ** (Math.max(0, ms) / (R.halfLifeHours * 3600000));
  const events = new Map(MUSCLE_IDS.map((m) => [m, []]));
  const sets = new Map(MUSCLE_IDS.map((m) => [m, 0]));

  for (const w of workouts || []) {
    if (w.deletedAt || (w.status !== 'completed' && w.status !== 'active')) continue;
    const t = endOf(w, now);
    if (!(t >= since) || t > now + 60000) continue;
    for (const entry of w.exercises || []) {
      const done = countableSets(entry, w.unit, index.unit);
      if (!done.length) continue;
      const m = musclesFor(entry.exerciseId) || { primary: [], secondary: [] };
      const ex = index.exercises.get(entry.exerciseId);
      const best = ex && ex.records.bestEst ? ex.records.bestEst.value : 0;
      let load = 0;
      for (const s of done) load += setEffort(s, best);
      for (const id of m.primary) { if (events.has(id)) { events.get(id).push({ t, load }); sets.set(id, sets.get(id) + done.length); } }
      for (const id of m.secondary) { if (events.has(id) && !m.primary.includes(id)) events.get(id).push({ t, load: load * 0.5 }); }
    }
  }

  return MUSCLE_IDS.map((muscle) => {
    const list = events.get(muscle);
    const rep = soreness && soreness[muscle];
    const at = rep && rep.at ? Date.parse(rep.at) : NaN;
    const report = rep && R.report[rep.level] != null && at >= since && at <= now + 60000 ? { level: rep.level, at: rep.at } : null;
    const pctOf = (load) => (load / R.fullLoad) * 100;
    let pct = 0;
    if (report) {
      let before = 0;
      for (const e of list) if (e.t <= at) before += pctOf(e.load) * decay(at - e.t);
      const target = R.report[report.level];
      const base = report.level === 'fresh' ? Math.min(before, target) : Math.max(before, target);
      pct = base * decay(now - at);
      for (const e of list) if (e.t > at) pct += pctOf(e.load) * decay(now - e.t);
    } else {
      for (const e of list) pct += pctOf(e.load) * decay(now - e.t);
    }
    const state = pct >= R.workedFrom ? 'worked' : pct >= R.freshBelow ? 'recovering' : 'fresh';
    const readyInHours = pct > R.freshBelow ? R.halfLifeHours * Math.log2(pct / R.freshBelow) : 0;
    const lastWorked = list.length ? new Date(Math.max(...list.map((e) => e.t))).toISOString() : null;
    return { muscle, pct: Math.round(Math.min(100, pct)), raw: pct, state, readyInHours, lastWorked, sets: sets.get(muscle), report };
  });
}

/** Muscles an exercise list would hit hard that are still marked as needing rest. */
export function tiredMuscles(exerciseIds, status, musclesFor) {
  const worked = new Set(status.filter((s) => s.state === 'worked').map((s) => s.muscle));
  const out = [];
  for (const id of exerciseIds) {
    for (const m of (musclesFor(id) || { primary: [] }).primary) if (worked.has(m) && !out.includes(m)) out.push(m);
  }
  return out;
}
