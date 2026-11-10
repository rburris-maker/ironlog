// Groups: people who share workouts and results with each other.
//
// Group data lives only in the cloud (it belongs to several accounts), so unlike
// workouts it is fetched when needed rather than stored on the device. The server
// functions in supabase/schema.sql decide what each member may see; this file is
// the thin client for them plus the calculations for the weekly board.

import { weekStart } from './calc.js';
import { BUILT_IN } from './exercises.js';

const builtIn = new Set(BUILT_IN.map((e) => e.id));

function friendly(error) {
  const msg = String((error && error.message) || error || '');
  if (/failed to fetch|networkerror|load failed|network request failed|timeout/i.test(msg)) return 'No connection. Groups need the internet — try again when you are back online.';
  if (/JWT|not authenticated|Sign in first/i.test(msg)) return 'Your sign-in has expired. Sign out and back in, then try again.';
  if (/could not find the function|schema cache|does not exist/i.test(msg)) return 'Groups are not set up on this database yet.';
  return msg || 'Something went wrong. Try again.';
}

/** The server calls. Every method returns the function's JSON result or throws an Error with a readable message. */
export function createGroupsApi(client) {
  const call = async (fn, params) => {
    let res;
    try { res = await client.rpc(fn, params); } catch (err) { throw new Error(friendly(err)); }
    if (res.error) throw new Error(friendly(res.error));
    return res.data;
  };
  return {
    list: (weekStartIso) => call('my_groups', { p_week_start: weekStartIso }),
    create: (name, displayName) => call('group_create', { p_name: name, p_display_name: displayName }),
    join: (code, displayName) => call('group_join', { p_code: code, p_display_name: displayName }),
    leave: (groupId) => call('group_leave', { p_group: groupId }),
    update: (groupId, name, weeklyGoal) => call('group_update', { p_group: groupId, p_name: name, p_weekly_goal: weeklyGoal }),
    setMe: (groupId, displayName, share) => call('group_set_me', { p_group: groupId, p_display_name: displayName, p_share: share }),
    removeMember: (groupId, userId) => call('group_remove_member', { p_group: groupId, p_user: userId }),
    remove: (groupId) => call('group_delete', { p_group: groupId }),
    overview: (groupId, sinceIso) => call('group_overview', { p_group: groupId, p_since: sinceIso }),
    workout: (groupId, workoutId) => call('group_workout', { p_group: groupId, p_workout: workoutId }),
    post: (groupId, { name, unit, exercises, note }) => call('group_post_create', { p_group: groupId, p_name: name, p_unit: unit, p_exercises: exercises, p_note: note || '' }),
    deletePost: (postId) => call('group_post_delete', { p_post: postId }),
    postResults: (postId) => call('group_post_results', { p_post: postId }),
  };
}

export const BOARD_WEEKS = 8;

/** How far back the group screen asks for workouts: the start of the week BOARD_WEEKS - 1 weeks ago. */
export function boardSince(now = new Date()) {
  const d = weekStart(now);
  d.setDate(d.getDate() - (BOARD_WEEKS - 1) * 7);
  return d;
}

/**
 * The weekly accountability board.
 *   members   [{ user_id, display_name, share, active_since }]
 *   workouts  light rows from the server: [{ user_id, started_at, ... }]
 *   goal      workouts per week each member is aiming for
 * Returns one row per member: this week's count, whether the goal is met, the
 * streak of consecutive weeks at goal (the current week counts once it is met,
 * and does not break the streak while it is still in progress), and the last workout.
 */
export function weekBoard({ members, workouts, goal, now = new Date() }) {
  const thisWeek = weekStart(now).getTime();
  const WEEK = 7 * 86400000;
  const rows = (members || []).map((m) => {
    const counts = new Array(BOARD_WEEKS).fill(0); // index 0 = this week, 1 = last week, …
    let last = null;
    for (const w of workouts || []) {
      if (w.user_id !== m.user_id) continue;
      if (!last || w.started_at > last) last = w.started_at;
      // Math.round absorbs the hour gained or lost when a week contains a clock change
      const i = Math.round((thisWeek - weekStart(w.started_at).getTime()) / WEEK);
      if (i >= 0 && i < BOARD_WEEKS) counts[i] += 1;
    }
    let streak = 0;
    for (let i = counts[0] >= goal ? 0 : 1; i < BOARD_WEEKS && counts[i] >= goal; i++) streak += 1;
    return {
      userId: m.user_id,
      name: m.display_name,
      share: m.share !== false,
      count: counts[0],
      met: counts[0] >= goal,
      streak,
      weeks: counts,
      last,
      activeSince: m.active_since || null,
    };
  });
  return rows.sort((a, b) => Number(b.share) - Number(a.share) || b.count - a.count || b.streak - a.streak || a.name.localeCompare(b.name));
}

/**
 * Turn one of my templates (or a template made from a workout) into the exercise list of a group post.
 * Weights are personal, so they are left out: each member's own previous numbers fill in when they start it.
 * Custom exercises carry their group and muscles so other members' libraries can recreate them.
 */
export function postExercises(template, exerciseOf) {
  return (template.exercises || []).map((e, i) => {
    const out = {
      uid: `p${i + 1}`,
      exerciseId: e.exerciseId,
      name: e.name,
      sets: (e.sets && e.sets.length ? e.sets : [{ reps: null }]).map((s) => ({
        weight: null,
        reps: s.amrap ? null : (Number.isFinite(s.reps) ? s.reps : null),
        ...(s.amrap ? { amrap: true, ...(s.seconds > 0 ? { seconds: s.seconds } : {}) } : {}),
      })),
    };
    if (e.supersetId) out.supersetId = e.supersetId;
    if (!builtIn.has(e.exerciseId)) {
      const ex = exerciseOf ? exerciseOf(e.exerciseId) : null;
      out.custom = { group: (ex && ex.group) || 'Other', ...(ex && ex.muscles ? { muscles: ex.muscles } : {}) };
    }
    return out;
  });
}

/** "3 × 8", "2 × 10, 1 × AMRAP 60s" — the target of one posted exercise. */
export function describeTargets(sets) {
  const parts = [];
  for (const s of sets || []) {
    const label = s.amrap ? `AMRAP${s.seconds > 0 ? ` ${s.seconds}s` : ''}` : (Number.isFinite(s.reps) ? String(s.reps) : '');
    const prev = parts[parts.length - 1];
    if (prev && prev.label === label) prev.n += 1; else parts.push({ label, n: 1 });
  }
  return parts.map((p) => (p.label ? `${p.n} × ${p.label}` : `${p.n} ${p.n === 1 ? 'set' : 'sets'}`)).join(', ');
}

/** A shared workout row from the server as a document shaped like the app's own workouts. */
export function sharedToDoc(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    unit: row.unit || 'lb',
    status: 'completed',
    startedAt: row.started_at,
    durationSec: row.duration_seconds || 0,
    groupPostId: row.group_post_id || null,
    exercises: Array.isArray(row.exercises) ? row.exercises : [],
    highlights: row.highlights || null,
  };
}
