// Groups: create or join one, the weekly board, workouts posted for the group,
// each member's results, and the feed of what everyone has finished.

import { h, add, icon, openSheet, actionSheet, confirmDialog, toast } from '../lib/dom.js';
import { fmtDate, fmtDurationShort, fmtSet, plural } from '../lib/format.js';
import { store } from '../core/store.js';
import { convert, weekStart, isCountable } from '../core/calc.js';
import { createGroupsApi, weekBoard, boardSince, postExercises, describeTargets, sharedToDoc } from '../core/groups.js';
import { templateFromWorkout } from '../core/session.js';
import { ctx, pushPage, popPage, pageHeader, refreshWhenIdle } from './app.js';
import { startFromGroupPost, startFromShared, prLine, summarizeExercises } from './active.js';
import { groupCache, groupsChanged } from './groupstate.js';

const LIST_TTL = 60000;
const PAGE_TTL = 30000;
const JOIN_KEY = 'ironlog:join';
const SHARE_NOTE = 'Workouts you finish from now on are shared with the group: exercises, sets, weights, reps, time and records. Notes, bodyweight, soreness check-ins and strength ratings are never shared, and you can switch sharing off at any time.';

export const groupsAvailable = () => ctx.mode === 'cloud' && !!ctx.client && !!ctx.user;
const api = () => createGroupsApi(ctx.client);
const me = () => (ctx.user ? ctx.user.id : null);
const when = (iso) => { const t = fmtDate(iso, { weekday: false }); return /^(Today|Yesterday)$/.test(t) ? t.toLowerCase() : t; };

function cache() {
  const uid = me();
  if (groupCache.userId !== uid) {
    Object.assign(groupCache, { userId: uid, list: null, listAt: 0, listError: null, listLoading: false });
    groupCache.pages = new Map();
    try { const saved = JSON.parse(localStorage.getItem(`ironlog:groups:${uid}`) || 'null'); if (Array.isArray(saved)) groupCache.list = saved; } catch { /* no saved copy */ }
  }
  return groupCache;
}
const remember = () => { try { localStorage.setItem(`ironlog:groups:${me()}`, JSON.stringify(groupCache.list || [])); } catch { /* storage blocked */ } };

/** Upload anything still waiting on this device, so the group sees the workout that was just finished. */
async function pushPending() {
  if (ctx.sync && store.ready && store.dirty().length) { try { await ctx.sync.run(); } catch { /* shown by the sync status */ } }
}

async function loadList(force = false) {
  const c = cache();
  if (!groupsAvailable() || c.listLoading || (!force && Date.now() - c.listAt < LIST_TTL)) return;
  c.listLoading = true;
  try {
    await pushPending();
    c.list = await api().list(weekStart(new Date()).toISOString());
    c.listAt = Date.now();
    c.listError = null;
    remember();
  } catch (err) {
    c.listError = err.message;
    c.listAt = Date.now() - LIST_TTL + 15000; // try again in 15 seconds, not on every repaint
  } finally { c.listLoading = false; refreshWhenIdle(); }
}

/** Fetch-and-remember for one page of group data. Returns { data, error, loading } as currently known. */
function page(key, fetcher, force = false) {
  const c = cache();
  let p = c.pages.get(key);
  if (!p) { p = { data: null, at: 0, error: null, loading: false }; c.pages.set(key, p); }
  if (groupsAvailable() && !p.loading && (force || Date.now() - p.at >= PAGE_TTL)) {
    p.loading = true;
    (async () => {
      try { await pushPending(); p.data = await fetcher(); p.error = null; p.at = Date.now(); }
      catch (err) { p.error = err.message; p.at = Date.now() - PAGE_TTL + 10000; }
      finally { p.loading = false; refreshWhenIdle(); }
    })();
  }
  return p;
}

const waiting = (p, what) => h('div', { class: 'empty' },
  p.error ? h('p', { class: 'empty-title' }, 'Could not load') : h('p', { class: 'muted' }, `Loading ${what}…`),
  p.error && h('p', null, p.error),
  p.error && h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => { p.at = 0; refreshWhenIdle(); } }, 'Try again'));

const run = async (work, done) => {
  try { const out = await work(); groupsChanged(); if (done) done(out); loadList(true); }
  catch (err) { toast(err.message); }
};

function defaultName() {
  const saved = (store.prefs.displayName || '').trim();
  if (saved) return saved;
  const local = String((ctx.user && ctx.user.email) || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : '';
}

// ---------- invite links ----------

// An invite link is the app's address ending in #join=CODE. Remember the code now —
// the visitor may have to sign in or create an account first — and offer to join after.
try {
  const m = /^#join=([A-Za-z0-9]{4,12})$/.exec(location.hash || '');
  if (m) {
    sessionStorage.setItem(JOIN_KEY, m[1].toUpperCase());
    history.replaceState(null, '', `${location.pathname}${location.search}#home`);
  }
} catch { /* storage or history unavailable */ }

export function consumeJoinLink() {
  let code = null;
  try { code = sessionStorage.getItem(JOIN_KEY); } catch { /* ignore */ }
  if (!code || !groupsAvailable()) return;
  try { sessionStorage.removeItem(JOIN_KEY); } catch { /* ignore */ }
  openJoinGroup(code);
}

const inviteLink = (code) => `${location.origin}${location.pathname}#join=${code}`;

async function shareInvite(g) {
  const text = `Join “${g.name}” on Ironlog. Open the link, or use the code ${g.join_code} under Groups.`;
  const url = inviteLink(g.join_code);
  if (navigator.share) {
    try { await navigator.share({ title: g.name, text, url }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Invite copied — paste it into a message'); }
  catch { toast(`Share this code: ${g.join_code}`); }
}

// ---------- create / join ----------

function nameField() {
  return h('input', { class: 'field', type: 'text', name: 'display-name', value: defaultName(), maxlength: '40', autocomplete: 'off', placeholder: 'First name or nickname', 'aria-label': 'Your name in the group' });
}

export function openCreateGroup() {
  openSheet({
    title: 'New group',
    body: (close) => {
      const name = h('input', { class: 'field', type: 'text', name: 'group-name', maxlength: '60', autocomplete: 'off', placeholder: 'e.g. Morning Crew', 'aria-label': 'Group name' });
      const mine = nameField();
      const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create group');
      setTimeout(() => name.focus(), 50);
      return h('form', { class: 'form', 'data-form': 'group-create', onSubmit: async (e) => {
        e.preventDefault();
        if (submit.disabled) return;
        if (!name.value.trim()) { name.focus(); return; }
        if (!mine.value.trim()) { mine.focus(); return; }
        submit.disabled = true;
        await run(() => api().create(name.value, mine.value), (g) => {
          store.setPrefs({ displayName: mine.value.trim() });
          close();
          openGroup(g.id, g);
          toast('Group created — share the invite code');
        });
        submit.disabled = false;
      } },
        h('label', { class: 'label' }, 'Group name', name),
        h('label', { class: 'label' }, 'Your name in the group', mine),
        h('p', { class: 'hint' }, SHARE_NOTE),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => close() }, 'Cancel'), submit));
    },
  });
}

export function openJoinGroup(code = '') {
  openSheet({
    title: 'Join a group',
    body: (close) => {
      const codeInput = h('input', { class: 'field field-lg code-field', type: 'text', name: 'join-code', value: code, maxlength: '12', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABC123', 'aria-label': 'Invite code' });
      const mine = nameField();
      const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Join group');
      setTimeout(() => (code ? mine : codeInput).focus(), 50);
      return h('form', { class: 'form', 'data-form': 'group-join', onSubmit: async (e) => {
        e.preventDefault();
        if (submit.disabled) return;
        if (!codeInput.value.trim()) { codeInput.focus(); return; }
        if (!mine.value.trim()) { mine.focus(); return; }
        submit.disabled = true;
        await run(() => api().join(codeInput.value, mine.value), (g) => {
          store.setPrefs({ displayName: mine.value.trim() });
          close();
          openGroup(g.id, g);
          toast(`You joined ${g.name}`);
        });
        submit.disabled = false;
      } },
        h('label', { class: 'label' }, 'Invite code', codeInput),
        h('label', { class: 'label' }, 'Your name in the group', mine),
        h('p', { class: 'hint' }, SHARE_NOTE),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => close() }, 'Cancel'), submit));
    },
  });
}

// ---------- the list of my groups (Home block and Workouts tab) ----------

function groupRow(g) {
  return h('button', { class: 'list-row', type: 'button', 'data-group': g.name, onClick: () => openGroup(g.id, g) },
    h('span', { class: 'list-main' },
      h('span', { class: 'list-title' }, g.name),
      h('span', { class: 'list-meta' }, g.member_count === 1 ? 'Just you so far — share the invite code' : `${g.trained} of ${g.member_count} trained this week`)),
    icon('next', 18));
}

function groupButtons() {
  return h('div', { class: 'btn-row' },
    h('button', { class: 'btn btn-quiet', type: 'button', 'data-action': 'group-join', onClick: () => openJoinGroup() }, 'Join with a code'),
    h('button', { class: 'btn btn-outline', type: 'button', 'data-action': 'group-create', onClick: openCreateGroup }, icon('plus', 18), 'New group'));
}

function groupList({ intro }) {
  const c = cache();
  loadList();
  const list = c.list;
  if (list == null) return [h('p', { class: 'empty-note' }, c.listError || 'Loading your groups…')];
  return [
    list.length > 0 && h('div', { class: 'list' }, list.map(groupRow)),
    !list.length && h('p', { class: 'note' }, intro),
    c.listError && list.length > 0 && h('p', { class: 'hint' }, 'Showing the last copy saved on this device.'),
    groupButtons(),
  ];
}

/** Home screen block. Nothing is shown in device-only mode, where there are no accounts to group. */
export function groupsBlock() {
  if (!groupsAvailable()) return null;
  return h('section', { class: 'block', 'data-block': 'groups' },
    h('h2', { class: 'block-title' }, 'Groups'),
    groupList({ intro: 'Train with other people: share workouts and results, and see who has shown up this week — together or on your own schedules.' }));
}

/** Workouts → Groups. */
export function renderGroupsTab(el) {
  if (!groupsAvailable()) {
    add(el, h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, 'Groups need an account'), h('p', null, 'Groups share workouts between accounts, so they are available once the app is connected to its database and you are signed in.')));
    return;
  }
  add(el, h('section', { class: 'block' },
    groupList({ intro: 'A group shares workouts and results and keeps a weekly board of who has trained. Create one and send the invite code, or join with a code someone sent you.' })));
}

// ---------- one group ----------

export function openGroup(id, known = null) {
  pushPage((el) => renderGroup(el, id, known));
}

const dots = (count, goal) => h('span', { class: 'dots', 'aria-hidden': 'true' },
  Array.from({ length: goal }, (_, i) => h('i', { class: i < count ? 'on' : '' })),
  count > goal && h('small', null, `+${count - goal}`));

function renderGroup(el, id, known) {
  const c = cache();
  const p = page(`group:${id}`, () => api().overview(id, boardSince().toISOString()));
  const data = p.data;
  const g = data ? data.group : (c.list || []).find((x) => x.id === id) || known;
  add(el, pageHeader(g ? g.name : 'Group', {
    action: data && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Group options', 'data-action': 'group-menu', onClick: () => groupMenu(data) }, icon('more', 24)),
  }));
  if (!data) { add(el, waiting(p, 'the group')); return; }

  const goal = g.weekly_goal;
  const board = weekBoard({ members: data.members, workouts: data.workouts, goal });
  const sharing = board.filter((r) => r.share);
  const met = sharing.filter((r) => r.met).length;
  const nameOf = (userId) => { const m = data.members.find((x) => x.user_id === userId); return m ? (userId === me() ? `${m.display_name} (you)` : m.display_name) : 'Former member'; };

  add(el,
    h('section', { class: 'invite' },
      h('div', { class: 'invite-text' }, h('span', null, 'Invite code'), h('strong', { class: 'invite-code', 'data-invite-code': g.join_code }, g.join_code)),
      h('button', { class: 'btn btn-quiet btn-small', type: 'button', 'data-action': 'share-invite', onClick: () => shareInvite(g) }, 'Share invite')),
    !g.share && h('p', { class: 'notice' }, 'You are not sharing your workouts with this group. Change it under the ⋯ menu.'));

  add(el, h('section', { class: 'block', 'data-section': 'board' },
    h('div', { class: 'block-head' }, h('h2', { class: 'block-title' }, 'This week'), h('span', { class: 'muted small' }, `Goal: ${plural(goal, 'workout')} each`)),
    h('p', { class: 'note', 'data-board-summary': '' }, sharing.length ? `${met} of ${sharing.length} ${sharing.length === 1 ? 'member has' : 'members have'} hit the goal.` : 'Nobody is sharing workouts yet.'),
    h('div', { class: 'list' }, board.map((r) =>
      h('div', { class: 'list-row board-row', 'data-member': r.name, 'data-count': String(r.count), 'data-met': String(r.met), 'data-streak': String(r.streak) },
        h('span', { class: 'list-main' },
          h('span', { class: 'list-title' }, r.name, r.userId === me() && h('span', { class: 'tag' }, 'You'), r.activeSince && h('span', { class: 'live-tag', 'data-live-now': '' }, 'Working out now')),
          h('span', { class: 'list-meta' }, !r.share ? 'Not sharing workouts' : r.last ? `Last workout ${when(r.last)}${r.streak > 1 ? ` · ${r.streak}-week streak` : ''}` : 'No workouts shared yet'),
          r.share && dots(r.count, goal)),
        r.share && h('span', { class: `state ${r.met ? 'st-fresh' : ''}` }, h('strong', null, `${r.count} / ${goal}`), h('small', null, r.met ? 'goal met' : 'this week')))))));

  add(el, h('section', { class: 'block', 'data-section': 'posts' },
    h('div', { class: 'block-head' }, h('h2', { class: 'block-title' }, 'Group workouts'), h('button', { class: 'link', type: 'button', 'data-action': 'post-workout', onClick: () => openPostSheet(g) }, 'Post a workout')),
    data.posts.length
      ? h('div', { class: 'list' }, data.posts.map((post) =>
        h('button', { class: 'list-row', type: 'button', 'data-post': post.name, onClick: () => openPost(g, post) },
          h('span', { class: 'list-main' },
            h('span', { class: 'list-title' }, post.name),
            h('span', { class: 'list-meta' }, `${nameOf(post.author_id)} · ${when(post.created_at)} · ${post.results ? plural(post.results, 'result') : 'no results yet'}`),
            h('span', { class: 'list-sub' }, summarizeExercises(post, 4))),
          icon('next', 18))))
      : h('p', { class: 'empty-note' }, 'Post one of your routines and everyone in the group can do it. Each person’s result lands on the same board, whenever they train.')));

  add(el, h('section', { class: 'block', 'data-section': 'feed' },
    h('h2', { class: 'block-title' }, 'Recent workouts'),
    data.workouts.length
      ? h('div', { class: 'list' }, data.workouts.slice(0, 40).map((w) =>
        h('button', { class: 'list-row', type: 'button', 'data-shared': w.name, 'data-by': nameOf(w.user_id), onClick: () => openShared(g, w.id, w.name) },
          h('span', { class: 'list-main' },
            h('span', { class: 'list-title' }, nameOf(w.user_id), w.prs > 0 && h('span', { class: 'pr-chip' }, icon('medal', 14), String(w.prs))),
            h('span', { class: 'list-meta' }, `${w.name} · ${when(w.started_at)} · ${plural(w.sets, 'set')}${w.duration_seconds ? ` · ${fmtDurationShort(w.duration_seconds)}` : ''}`),
            h('span', { class: 'list-sub' }, (w.exercise_names || []).slice(0, 4).join(', '))),
          icon('next', 18))))
      : h('p', { class: 'empty-note' }, 'Workouts members finish show up here.')),
  h('button', { class: 'btn btn-quiet btn-block', type: 'button', 'data-action': 'group-refresh', 'data-loaded': String(p.at), disabled: p.loading, onClick: () => { p.at = 0; refreshWhenIdle(); } }, p.loading ? 'Refreshing…' : 'Refresh'));
}

// ---------- group options ----------

function groupMenu(data) {
  const g = data.group;
  const owner = g.owner_id === me();
  // drop the group from what is on screen straight away, without waiting for the list to reload
  const left = () => {
    const c = cache();
    c.list = (c.list || []).filter((x) => x.id !== g.id);
    c.pages.delete(`group:${g.id}`);
    remember();
    popPage();
  };
  actionSheet(g.name, [
    { label: 'My name and sharing', icon: 'user', onSelect: () => openSheet({
      title: 'My name and sharing',
      body: (close) => {
        const name = h('input', { class: 'field', type: 'text', value: g.display_name, maxlength: '40', autocomplete: 'off', 'aria-label': 'Your name in the group' });
        const share = h('input', { type: 'checkbox', checked: g.share, name: 'share' });
        return h('form', { class: 'form', 'data-form': 'group-me', onSubmit: (e) => { e.preventDefault(); if (!name.value.trim()) { name.focus(); return; } run(() => api().setMe(g.id, name.value, share.checked), () => { close(); toast('Saved'); }); } },
          h('label', { class: 'label' }, 'Your name in this group', name),
          h('label', { class: 'check-row' }, share, h('span', null, 'Share my finished workouts with this group')),
          h('p', { class: 'hint' }, 'With sharing off the group sees your name but none of your workouts, and you are left off the weekly board. You still see everyone else.'),
          h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save')));
      },
    }) },
    owner && { label: 'Group name and weekly goal', icon: 'edit', onSelect: () => openSheet({
      title: 'Group settings',
      body: (close) => {
        const name = h('input', { class: 'field', type: 'text', value: g.name, maxlength: '60', autocomplete: 'off', 'aria-label': 'Group name' });
        const goal = h('select', { class: 'field', name: 'weekly-goal', 'aria-label': 'Weekly goal' }, [1, 2, 3, 4, 5, 6, 7].map((n) => h('option', { value: String(n), selected: n === g.weekly_goal }, `${plural(n, 'workout')} a week`)));
        return h('form', { class: 'form', 'data-form': 'group-settings', onSubmit: (e) => { e.preventDefault(); if (!name.value.trim()) { name.focus(); return; } run(() => api().update(g.id, name.value, Number(goal.value)), () => { close(); toast('Saved'); }); } },
          h('label', { class: 'label' }, 'Group name', name),
          h('label', { class: 'label' }, 'Weekly goal for each member', goal),
          h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save')));
      },
    }) },
    owner && data.members.length > 1 && { label: 'Remove a member', icon: 'close', onSelect: () => openSheet({
      title: 'Remove a member',
      body: (close) => h('div', { class: 'list' }, data.members.filter((m) => m.user_id !== me()).map((m) =>
        h('button', { class: 'list-row', type: 'button', onClick: async () => {
          const ok = await confirmDialog({ title: `Remove ${m.display_name}?`, message: 'They stop seeing the group and the group stops seeing their workouts. They can join again with the code.', confirmLabel: 'Remove', danger: true });
          if (ok) run(() => api().removeMember(g.id, m.user_id), () => { close(); toast(`${m.display_name} removed`); });
        } }, h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, m.display_name)), h('span', { class: 'danger' }, 'Remove')))),
    }) },
    { label: 'Leave group', icon: 'back', danger: !owner, onSelect: async () => {
      const ok = await confirmDialog({
        title: `Leave ${g.name}?`,
        message: data.members.length === 1 ? 'You are the only member, so the group is deleted.' : owner ? 'The group stops seeing your workouts, and the longest-standing member becomes the owner.' : 'The group stops seeing your workouts. You can join again with the code.',
        confirmLabel: 'Leave group', danger: true,
      });
      if (ok) run(() => api().leave(g.id), () => { left(); toast('You left the group'); });
    } },
    owner && data.members.length > 1 && { label: 'Delete group for everyone', icon: 'trash', danger: true, onSelect: async () => {
      const ok = await confirmDialog({ title: `Delete ${g.name}?`, message: 'The group, its posted workouts and its board are removed for every member. Everyone keeps their own workout history.', confirmLabel: 'Delete group', danger: true });
      if (ok) run(() => api().remove(g.id), () => { left(); toast('Group deleted'); });
    } },
  ]);
}

// ---------- posting a workout to the group ----------

function openPostSheet(g) {
  const templates = store.templates();
  const recent = store.workouts().slice(0, 8);
  openSheet({
    title: 'Post a workout',
    full: true,
    body: (close) => {
      const pick = (source, kind) => { close(); confirmPost(g, kind === 'workout' ? templateFromWorkout(source) : source); };
      const row = (title, meta, onClick, attrs) => h('button', { class: 'list-row', type: 'button', onClick, ...attrs },
        h('span', { class: 'list-main' }, h('span', { class: 'list-title' }, title), meta && h('span', { class: 'list-meta' }, meta)), icon('next', 18));
      return h('div', { class: 'start' },
        h('p', { class: 'sheet-text' }, 'Choose a routine to share. The group gets the exercises, sets and reps; weights are left out so each person’s own numbers fill in.'),
        h('h3', { class: 'section-label' }, 'Saved templates'),
        templates.length
          ? h('div', { class: 'list' }, templates.filter((t) => (t.exercises || []).length).map((t) => row(t.name, summarizeExercises(t), () => pick(t, 'template'), { 'data-post-template': t.name })))
          : h('p', { class: 'empty-note' }, 'No templates yet.'),
        h('h3', { class: 'section-label' }, 'A workout you finished'),
        recent.length
          ? h('div', { class: 'list' }, recent.map((w) => row(w.name, `${fmtDate(w.startedAt)} — ${summarizeExercises(w)}`, () => pick(w, 'workout'), { 'data-post-workout': w.name })))
          : h('p', { class: 'empty-note' }, 'Workouts you finish appear here.'));
    },
  });
}

function confirmPost(g, template) {
  openSheet({
    title: 'Post to the group',
    body: (close) => {
      const name = h('input', { class: 'field', type: 'text', name: 'post-name', value: template.name, maxlength: '60', autocomplete: 'off', 'aria-label': 'Workout name' });
      const note = h('input', { class: 'field', type: 'text', name: 'post-note', maxlength: '280', autocomplete: 'off', placeholder: 'Optional, e.g. “Last set to failure”', 'aria-label': 'Note for the group' });
      const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Post workout');
      return h('form', { class: 'form', 'data-form': 'group-post', onSubmit: async (e) => {
        e.preventDefault();
        if (submit.disabled) return;
        if (!name.value.trim()) { name.focus(); return; }
        submit.disabled = true;
        await run(() => api().post(g.id, { name: name.value, unit: template.unit || store.prefs.unit, exercises: postExercises(template, (id) => store.exercise(id)), note: note.value }),
          () => { close(); toast(`Posted to ${g.name}`); });
        submit.disabled = false;
      } },
        h('label', { class: 'label' }, 'Name', name),
        h('label', { class: 'label' }, 'Note for the group', note),
        h('p', { class: 'hint' }, `${plural(template.exercises.length, 'exercise')}: ${summarizeExercises(template, 6)}`),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => close() }, 'Cancel'), submit));
    },
  });
}

// ---------- a posted workout and its results ----------

/** Completed sets of a shared workout as "225 × 5" strings, converted to my unit. */
function setTexts(entry, fromUnit, unit) {
  return (entry.sets || []).filter(isCountable).map((s) => `${fmtSet(convert(Number.isFinite(s.weight) ? s.weight : 0, fromUnit, unit), s.reps)}${s.amrap ? ' AMRAP' : ''}`);
}

function openPost(g, post) {
  pushPage((el) => {
    const unit = store.prefs.unit;
    const p = page(`post:${post.id}`, () => api().postResults(post.id));
    const group = (cache().pages.get(`group:${g.id}`) || {}).data;
    const nameOf = (userId) => { const m = group && group.members.find((x) => x.user_id === userId); return m ? (userId === me() ? `${m.display_name} (you)` : m.display_name) : 'Member'; };
    const canDelete = post.author_id === me() || g.owner_id === me();
    add(el,
      pageHeader(post.name, { action: canDelete && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete this group workout', 'data-action': 'delete-post', onClick: async () => {
        const ok = await confirmDialog({ title: `Delete “${post.name}”?`, message: 'It is removed from the group. Workouts members already logged from it stay in their own history.', confirmLabel: 'Delete', danger: true });
        if (ok) run(() => api().deletePost(post.id), () => { popPage(); toast('Group workout deleted'); });
      } }, icon('trash', 22)) }),
      h('p', { class: 'note' }, `Posted by ${nameOf(post.author_id)} ${when(post.created_at)} in ${g.name}.`),
      post.note && h('p', { class: 'post-note' }, post.note),
      h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'button', 'data-action': 'start-post', onClick: () => startFromGroupPost(post) }, icon('play', 20), 'Start this workout'),
      h('section', { class: 'block' },
        h('h2', { class: 'block-title' }, 'The workout'),
        h('dl', { class: 'rec' }, (post.exercises || []).map((e) => h('div', { class: 'rec-row' }, h('dt', null, e.name), h('dd', null, h('span', null, describeTargets(e.sets))))))));

    if (!p.data) { add(el, waiting(p, 'results')); return; }
    const results = p.data.results.map(sharedToDoc);
    add(el, h('section', { class: 'block', 'data-section': 'results' },
      h('h2', { class: 'block-title' }, results.length ? `Results (${results.length})` : 'Results'),
      results.length
        ? h('div', { class: 'list' }, results.map((w) =>
          h('button', { class: 'list-row result-row', type: 'button', 'data-result-by': nameOf(w.userId), onClick: () => openShared(g, w.id, w.name) },
            h('span', { class: 'list-main' },
              h('span', { class: 'list-title' }, nameOf(w.userId), w.highlights && w.highlights.prs.length > 0 && h('span', { class: 'pr-chip' }, icon('medal', 14), String(w.highlights.prs.length))),
              h('span', { class: 'list-meta' }, `${when(w.startedAt)}${w.durationSec ? ` · ${fmtDurationShort(w.durationSec)}` : ''}`),
              w.exercises.map((e) => { const sets = setTexts(e, w.unit, unit); return sets.length > 0 && h('span', { class: 'result-line' }, h('b', null, e.name), ` ${sets.join(', ')}`); })),
            icon('next', 18))))
        : h('p', { class: 'empty-note' }, 'Nobody has logged this one yet. Start it, finish it, and your result appears here for the group.')),
    results.length > 0 && h('p', { class: 'hint' }, `Weights are shown in ${unit}.`));
  });
}

// ---------- one shared workout ----------

function convertRecord(ev, from, to) {
  if (from === to) return ev;
  const c = (v) => (v == null ? v : convert(v, from, to));
  const out = { ...ev, weight: c(ev.weight), value: c(ev.value) };
  if (ev.type !== 'reps') out.previous = c(ev.previous);
  return out;
}

function openShared(g, workoutId, title) {
  pushPage((el) => {
    const unit = store.prefs.unit;
    const p = page(`shared:${g.id}:${workoutId}`, () => api().workout(g.id, workoutId));
    add(el, pageHeader(title || 'Workout'));
    if (!p.data) { add(el, waiting(p, 'the workout')); return; }
    const w = sharedToDoc(p.data);
    const group = (cache().pages.get(`group:${g.id}`) || {}).data;
    const member = group && group.members.find((x) => x.user_id === w.userId);
    const mine = w.userId === me();
    const prs = w.highlights && Array.isArray(w.highlights.prs) ? w.highlights.prs.map((ev) => convertRecord(ev, w.highlights.unit || w.unit, unit)) : [];
    add(el,
      h('p', { class: 'note', 'data-shared-by': member ? member.display_name : '' }, `${member ? member.display_name : 'A member'}${mine ? ' (you)' : ''} · ${fmtDate(w.startedAt)}${w.durationSec ? ` · ${fmtDurationShort(w.durationSec)}` : ''}`),
      prs.length > 0 && h('ul', { class: 'pr-list' }, prs.map((ev) => { const l = prLine(ev, unit); return h('li', { class: 'pr-item' }, h('span', { class: 'pr-medal' }, icon('medal', 20)), h('div', null, h('div', { class: 'pr-title' }, l.title), h('div', { class: 'pr-text' }, l.text))); })),
      w.exercises.map((e) => {
        const sets = (e.sets || []).filter(isCountable);
        return sets.length > 0 && h('section', { class: 'block shared-ex', 'data-shared-exercise': e.name },
          h('h2', { class: 'block-title' }, e.name),
          h('ol', { class: 'shared-sets' }, sets.map((s, i) => h('li', null,
            h('span', { class: 'shared-n' }, String(i + 1)),
            h('strong', null, fmtSet(convert(Number.isFinite(s.weight) ? s.weight : 0, w.unit, unit), s.reps)),
            s.amrap && h('span', { class: 'amrap-tag' }, s.seconds > 0 ? `AMRAP ${s.seconds}s` : 'AMRAP')))));
      }),
      h('p', { class: 'hint' }, `Weights are shown in ${unit}.`),
      !mine && h('button', { class: 'btn btn-outline btn-block', type: 'button', 'data-action': 'do-shared', onClick: () => {
        const tpl = templateFromWorkout(w);
        tpl.exercises = tpl.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, weight: null })) }));
        startFromShared(tpl);
      } }, icon('repeat', 18), 'Do this workout'));
  });
}
