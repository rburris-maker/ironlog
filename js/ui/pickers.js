// Exercise picker: search the library, filter by muscle group, or create a custom exercise.

import { h, clear, icon, openSheet } from '../lib/dom.js';
import { fmtDate } from '../lib/format.js';
import { store } from '../core/store.js';
import { GROUPS } from '../core/exercises.js';

/**
 * pickExercise({ title, onPick, onlyWithHistory })
 * Calls onPick(exercise) with a library exercise (existing or newly created).
 */
export function pickExercise({ title = 'Add exercise', onPick, onlyWithHistory = false }) {
  const index = store.index();
  let query = '';
  let group = 'All';

  openSheet({
    title,
    full: true,
    body: (close) => {
      const list = h('div', { class: 'pick-list' });
      const groups = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Muscle group' });
      const search = h('input', { class: 'field', type: 'search', placeholder: 'Search exercises', 'aria-label': 'Search exercises', autocomplete: 'off', enterkeyhint: 'search', onInput: (e) => { query = e.target.value; drawList(); } });

      const choose = (ex) => { close(); onPick(ex); };

      const drawGroups = () => {
        clear(groups);
        for (const g of ['All', ...GROUPS]) {
          groups.append(h('button', { class: `chip ${g === group ? 'on' : ''}`, type: 'button', onClick: () => { group = g; drawGroups(); drawList(); } }, g));
        }
      };

      const drawList = () => {
        clear(list);
        const q = query.trim().toLowerCase();
        let items = store.exercises();
        if (onlyWithHistory) items = items.filter((e) => index.exercises.has(e.id));
        if (group !== 'All') items = items.filter((e) => e.group === group);
        if (q) items = items.filter((e) => e.name.toLowerCase().includes(q));
        // exercises you have done come first, most recent first
        const lastOf = (e) => { const x = index.exercises.get(e.id); return x ? x.sessions[x.sessions.length - 1].date : ''; };
        items.sort((a, b) => (lastOf(b) || '').localeCompare(lastOf(a) || '') || a.name.localeCompare(b.name));

        for (const ex of items) {
          const last = lastOf(ex);
          list.append(h('button', { class: 'pick-item', type: 'button', onClick: () => choose(ex) },
            h('span', { class: 'pick-name' }, ex.name),
            h('span', { class: 'pick-meta' }, last ? `Last ${fmtDate(last, { weekday: false })}` : ex.builtIn ? ex.group : `${ex.group}, custom`)));
        }
        const exact = q && store.exercises().some((e) => e.name.toLowerCase() === q);
        if (q && !exact && !onlyWithHistory) {
          list.append(h('button', { class: 'pick-item pick-create', type: 'button', onClick: () => createExercise(query.trim(), group !== 'All' ? group : 'Other', choose) },
            icon('plus', 20), h('span', { class: 'pick-name' }, `Create “${query.trim()}”`)));
        }
        if (!items.length && !q) {
          list.append(h('p', { class: 'empty-note' }, onlyWithHistory ? 'Finish a workout and your exercises will show up here.' : 'No exercises in this group yet.'));
        }
      };

      drawGroups();
      drawList();
      return h('div', { class: 'pick' },
        search,
        groups,
        list,
        !onlyWithHistory && h('button', { class: 'btn btn-quiet btn-block', type: 'button', onClick: () => createExercise(query.trim(), group !== 'All' ? group : 'Other', choose) }, icon('plus', 20), 'New custom exercise'));
    },
  });
}

/** Small form: name + muscle group. Calls done(exercise). */
export function createExercise(name, group, done) {
  openSheet({
    title: 'New exercise',
    body: (close) => {
      const nameInput = h('input', { class: 'field', type: 'text', value: name || '', placeholder: 'Exercise name', 'aria-label': 'Exercise name', maxlength: '60', autocomplete: 'off' });
      const groupSel = h('select', { class: 'field', 'aria-label': 'Muscle group' }, GROUPS.map((g) => h('option', { value: g, selected: g === group }, g)));
      setTimeout(() => nameInput.focus(), 50);
      return h('form', { onSubmit: (e) => {
        e.preventDefault();
        const ex = store.addExercise(nameInput.value, groupSel.value);
        if (!ex) { nameInput.focus(); return; }
        close();
        done(ex);
      } },
        h('label', { class: 'label' }, 'Name'), nameInput,
        h('label', { class: 'label' }, 'Muscle group'), groupSel,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn btn-quiet', type: 'button', onClick: () => close() }, 'Cancel'),
          h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create exercise')));
    },
  });
}
