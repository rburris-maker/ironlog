// Workouts tab: saved templates (create, edit, rename, duplicate, delete) and the exercise library.

import { h, clear, icon, actionSheet, confirmDialog, promptDialog, toast, segmented, add } from '../lib/dom.js';
import { fmtDate, fmtNum, fmtCountdown, parseNum, plural } from '../lib/format.js';
import { store, uid } from '../core/store.js';
import { duplicateTemplate, supersetInfo, linkSuperset, unlinkSuperset, normalizeSupersets } from '../core/session.js';
import { GROUPS } from '../core/exercises.js';
import { pushPage, popPage, registerScreen, pageHeader, screenHeader, refresh } from './app.js';
import { startFromTemplate, summarizeExercises } from './active.js';
import { pickExercise, createExercise, pickDuration, editMuscles } from './pickers.js';
import { openExerciseProgress } from './progress.js';

let tab = 'templates';
let exQuery = '';

function renderWorkouts(el) {
  add(el, 
    screenHeader('Workouts'),
    segmented([{ id: 'templates', label: 'Templates' }, { id: 'exercises', label: 'Exercises' }], tab, (id) => { tab = id; refresh(); }, { label: 'Workouts section' }));
  if (tab === 'templates') renderTemplates(el); else renderExercises(el);
}

// ---------- templates ----------

function templateMenu(t) {
  actionSheet(t.name, [
    { label: 'Edit template', icon: 'edit', onSelect: () => pushPage(templatePage(t.id)) },
    { label: 'Rename', icon: 'note', onSelect: async () => {
      const name = await promptDialog({ title: 'Rename template', value: t.name });
      if (name) store.put('template', { ...t, name });
    } },
    { label: 'Duplicate', icon: 'copy', onSelect: () => { const c = duplicateTemplate(t); store.put('template', c); toast(`“${c.name}” created`); } },
    { label: 'Delete template', icon: 'trash', danger: true, onSelect: async () => {
      const ok = await confirmDialog({ title: `Delete “${t.name}”?`, message: 'Workouts you already completed from this template stay in your history.', confirmLabel: 'Delete template', danger: true });
      if (ok) store.remove('template', t.id);
    } },
  ]);
}

function renderTemplates(el) {
  const templates = store.templates();
  add(el, h('button', { class: 'btn btn-outline btn-block', 'data-action': 'new-template', onClick: () => pushPage(templatePage(null)) }, icon('plus', 20), 'New template'));
  if (!templates.length) {
    add(el, h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, 'No templates yet'), h('p', null, 'A template is a reusable routine — the exercises in order, with optional target sets, reps and weights.')));
    return;
  }
  add(el, h('div', { class: 'list' }, templates.map((t) =>
    h('div', { class: 'list-row list-row-split', 'data-template': t.name },
      h('button', { class: 'list-main', onClick: () => pushPage(templatePage(t.id)) },
        h('span', { class: 'list-title' }, t.name),
        h('span', { class: 'list-meta' }, plural(t.exercises.length, 'exercise')),
        h('span', { class: 'list-sub' }, summarizeExercises(t, 4) || 'Empty — tap to add exercises')),
      h('button', { class: 'btn btn-primary btn-small', onClick: () => startFromTemplate(t) }, 'Start'),
      h('button', { class: 'icon-btn', 'aria-label': `${t.name} options`, onClick: () => templateMenu(t) }, icon('more', 22))))));
}

/** Template editor page. Edits a private draft; nothing is saved until "Save template". */
function templatePage(id) {
  const existing = id ? store.get('template', id) : null;
  const draft = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid(), name: '', unit: store.prefs.unit, exercises: [] };
  const st = { dirty: false };

  return (el) => {
    const unit = draft.unit || store.prefs.unit;
    const list = h('div', { class: 'ex-list' });
    const touch = () => { st.dirty = true; };

    const cancel = async () => {
      if (st.dirty && !(await confirmDialog({ title: 'Discard your changes?', confirmLabel: 'Discard changes', danger: true }))) return;
      popPage();
    };
    const save = () => {
      const name = (draft.name || '').trim();
      if (!name) { toast('Give the template a name.'); nameInput.focus(); return; }
      draft.name = name;
      draft.unit = unit;
      for (const e of draft.exercises) if (!e.sets.length) e.sets.push({ weight: null, reps: null });
      store.put('template', draft);
      st.dirty = false;
      popPage();
      toast(existing ? 'Template updated' : 'Template saved');
    };

    const drawList = () => {
      clear(list);
      if (!draft.exercises.length) list.append(h('p', { class: 'empty-note' }, 'Add the exercises for this routine, in the order you do them.'));
      const groups = supersetInfo(draft.exercises);
      draft.exercises.forEach((e, pos) => {
        const ss = groups.get(e.uid);
        const next = draft.exercises[pos + 1];
        const linkedBelow = next && e.supersetId && next.supersetId === e.supersetId;
        const setMenu = (st, i) => actionSheet(`${store.exerciseName(e.exerciseId, e.name)}, set ${i + 1}`, [
          st.amrap
            ? { label: 'Make this a regular set', icon: 'repeat', onSelect: () => { delete st.amrap; delete st.seconds; touch(); drawList(); } }
            : { label: 'Make this an AMRAP set', icon: 'timer', onSelect: () => { st.amrap = true; st.reps = null; touch(); drawList(); } },
          st.amrap && { label: st.seconds ? `Change time (${fmtCountdown(st.seconds)})` : 'Add a time', icon: 'timer', onSelect: () => pickDuration({ title: 'AMRAP time', value: st.seconds || null, onPick: (secs) => { if (secs) st.seconds = secs; else delete st.seconds; touch(); drawList(); } }) },
        ]);
        const rows = h('div', { class: 'sets' },
          h('div', { class: 'set-row set-head tpl' }, h('span', null, 'Set'), h('span', null, `Target ${unit}`), h('span', null, 'Target reps'), h('span', { class: 'sr-only' }, 'Remove')),
          e.sets.map((s, i) => h('div', { class: 'set-row tpl' },
            h('button', { class: 'set-num', type: 'button', 'aria-label': `Set ${i + 1} options`, onClick: () => setMenu(s, i) }, String(i + 1)),
            h('span', null, h('input', { class: 'num', type: 'text', inputmode: 'decimal', placeholder: '—', 'aria-label': `Set ${i + 1} target weight`, value: s.weight != null ? fmtNum(s.weight) : '', onFocus: (ev) => ev.target.select(), onInput: (ev) => { s.weight = parseNum(ev.target.value); touch(); } })),
            s.amrap
              ? h('button', { class: 'num num-amrap', type: 'button', 'aria-label': `Set ${i + 1} is AMRAP. Tap to set a time.`, onClick: () => pickDuration({ title: 'AMRAP time', value: s.seconds || null, onPick: (secs) => { if (secs) s.seconds = secs; else delete s.seconds; touch(); drawList(); } }) }, s.seconds ? `AMRAP ${fmtCountdown(s.seconds)}` : 'AMRAP')
              : h('span', null, h('input', { class: 'num', type: 'text', inputmode: 'numeric', placeholder: '—', 'aria-label': `Set ${i + 1} target reps`, value: s.reps != null ? String(s.reps) : '', onFocus: (ev) => ev.target.select(), onInput: (ev) => { const n = parseNum(ev.target.value); s.reps = n == null ? null : Math.round(n); touch(); } })),
            h('button', { class: 'icon-btn', 'aria-label': `Remove set ${i + 1}`, onClick: () => { e.sets.splice(i, 1); touch(); drawList(); } }, icon('close', 18)))));
        list.append(h('section', { class: `ex ${ss ? `ss ${ss.first ? 'ss-first' : ''} ${ss.last ? 'ss-last' : ''}` : ''}`, 'data-template-exercise': e.exerciseId },
          ss && h('p', { class: 'ss-label' }, `Superset ${ss.letter}`, h('span', null, `${ss.position} of ${ss.size}`)),
          h('header', { class: 'ex-head' },
            h('div', { class: 'ex-title' }, h('h2', { class: 'ex-name' }, store.exerciseName(e.exerciseId, e.name))),
            h('div', { class: 'ex-tools' },
              h('button', { class: `icon-btn ${linkedBelow ? 'on' : ''}`, 'aria-label': linkedBelow ? 'Remove superset link with the exercise below' : 'Superset with the exercise below', 'aria-pressed': linkedBelow ? 'true' : 'false', title: 'Superset with the exercise below', disabled: !next, 'data-action': 'link-below',
                onClick: () => { if (linkedBelow) { if (!ss || ss.first) unlinkSuperset(draft.exercises, pos); else unlinkSuperset(draft.exercises, pos + 1); } else linkSuperset(draft.exercises, pos, pos + 1); touch(); drawList(); } }, icon('link', 20)),
              h('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: pos === 0, onClick: () => { draft.exercises.splice(pos - 1, 0, draft.exercises.splice(pos, 1)[0]); normalizeSupersets(draft.exercises); touch(); drawList(); } }, icon('up', 20)),
              h('button', { class: 'icon-btn', 'aria-label': 'Move down', disabled: pos === draft.exercises.length - 1, onClick: () => { draft.exercises.splice(pos + 1, 0, draft.exercises.splice(pos, 1)[0]); normalizeSupersets(draft.exercises); touch(); drawList(); } }, icon('down', 20)),
              h('button', { class: 'icon-btn danger', 'aria-label': `Remove ${e.name}`, onClick: () => { draft.exercises.splice(pos, 1); normalizeSupersets(draft.exercises); touch(); drawList(); } }, icon('trash', 20)))),
          rows,
          h('button', { class: 'add-set', onClick: () => { const prev = e.sets[e.sets.length - 1]; e.sets.push(prev ? { ...prev } : { weight: null, reps: null }); touch(); drawList(); } }, icon('plus', 18), 'Add set')));
      });
    };

    const nameInput = h('input', { class: 'field field-lg', type: 'text', placeholder: 'Template name, e.g. Push Day', 'aria-label': 'Template name', value: draft.name, maxlength: '60', onInput: (e) => { draft.name = e.target.value; touch(); } });
    drawList();
    add(el, 
      pageHeader(existing ? 'Edit template' : 'New template', { onBack: cancel, backLabel: 'Cancel', action: h('button', { class: 'btn btn-primary', 'data-action': 'save-template', onClick: save }, 'Save template') }),
      h('div', { class: 'form' }, nameInput, h('p', { class: 'hint' }, 'Targets are optional. Leave them blank and the app suggests what you lifted last time. Tap a set number to make it AMRAP; use the link button to superset an exercise with the one below it.')),
      list,
      h('button', { class: 'btn btn-outline btn-block btn-lg', 'data-action': 'add-exercise', onClick: () => pickExercise({ onPick: (ex) => {
        draft.exercises.push({ uid: uid(), exerciseId: ex.id, name: ex.name, sets: [{ weight: null, reps: null }, { weight: null, reps: null }, { weight: null, reps: null }] });
        touch(); drawList();
      } }) }, icon('plus', 22), 'Add exercise'));
  };
}

// ---------- exercise library ----------

function renderExercises(el) {
  const index = store.index();
  const list = h('div', { class: 'ex-lib' });
  const draw = () => {
    clear(list);
    const q = exQuery.trim().toLowerCase();
    const items = store.exercises().filter((e) => !q || e.name.toLowerCase().includes(q));
    if (!items.length) { list.append(h('p', { class: 'empty-note' }, 'No exercise with that name. Create it below.')); return; }
    for (const g of GROUPS) {
      const inGroup = items.filter((e) => (GROUPS.includes(e.group) ? e.group : 'Other') === g);
      if (!inGroup.length) continue;
      list.append(h('h2', { class: 'month' }, g));
      list.append(h('div', { class: 'list' }, inGroup.map((e) => {
        const hist = index.exercises.get(e.id);
        const main = h('button', { class: 'list-main', onClick: () => openExerciseProgress(e.id) },
          h('span', { class: 'list-title' }, e.name, !e.builtIn && h('span', { class: 'tag' }, 'Custom')),
          h('span', { class: 'list-meta' }, hist ? `${plural(hist.sessions.length, 'session')}, last ${fmtDate(hist.sessions[hist.sessions.length - 1].date, { weekday: false })}` : 'Not logged yet'));
        return h('div', { class: 'list-row list-row-split' }, main,
          e.builtIn ? icon('next', 18) : h('button', { class: 'icon-btn', 'aria-label': `${e.name} options`, onClick: () => customMenu(e) }, icon('more', 22)));
      })));
    }
  };
  draw();
  add(el, 
    h('div', { class: 'search-row' },
      h('input', { class: 'field', type: 'search', placeholder: 'Search exercises', 'aria-label': 'Search exercises', value: exQuery, onInput: (e) => { exQuery = e.target.value; draw(); } })),
    h('button', { class: 'btn btn-outline btn-block', 'data-action': 'new-exercise', onClick: () => createExercise(exQuery.trim(), 'Other', (ex) => { exQuery = ''; refresh(); toast(`${ex.name} added to your library`); }) }, icon('plus', 20), 'New custom exercise'),
    list);
}

function customMenu(e) {
  actionSheet(e.name, [
    { label: 'Rename', icon: 'edit', onSelect: async () => {
      const name = await promptDialog({ title: 'Rename exercise', value: e.name });
      if (!name) return;
      const doc = store.get('exercise', e.id);
      store.put('exercise', { ...doc, name });
      toast('Renamed. History and records stay attached to this exercise.');
    } },
    { label: 'Muscles worked', icon: 'dumbbell', onSelect: () => editMuscles(e, () => toast('Muscles updated')) },
    { label: 'Delete from library', icon: 'trash', danger: true, onSelect: async () => {
      const ok = await confirmDialog({ title: `Delete “${e.name}”?`, message: 'It disappears from the library. Workouts that already include it keep their sets and records.', confirmLabel: 'Delete exercise', danger: true });
      if (ok) store.remove('exercise', e.id);
    } },
  ]);
}

registerScreen('workouts', renderWorkouts);
