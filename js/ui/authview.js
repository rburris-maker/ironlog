// Sign in / create account / reset password.

import { h, clear, segmented } from '../lib/dom.js';
import { APP_NAME } from '../../config.js';
import { friendlyAuthError } from '../core/auth.js';

/** Render the sign-in screen into #auth. `client` is the Supabase client. */
export function showAuth(client, { message = '' } = {}) {
  const root = document.getElementById('auth');
  root.hidden = false;
  document.getElementById('app').hidden = true;
  let mode = 'signin';

  const draw = (note = message, noteKind = 'info') => {
    clear(root);
    const email = h('input', { class: 'field field-lg', type: 'email', name: 'email', autocomplete: 'email', placeholder: 'Email', 'aria-label': 'Email', required: true, inputmode: 'email' });
    const password = h('input', { class: 'field field-lg', type: 'password', name: 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', placeholder: mode === 'signup' ? 'Password (6+ characters)' : 'Password', 'aria-label': 'Password', required: true, minlength: '6' });
    const status = h('p', { class: `auth-note ${noteKind}`, role: 'status' }, note);
    const submit = h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Email me a reset link' : 'Sign in');
    const say = (text, kind = 'info') => { status.textContent = text; status.className = `auth-note ${kind}`; };

    const onSubmit = async (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      say(mode === 'reset' ? 'Sending…' : mode === 'signup' ? 'Creating your account…' : 'Signing in…');
      try {
        if (mode === 'reset') {
          const { error } = await client.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
          if (error) throw error;
          say('If that email has an account, a reset link is on its way.', 'good');
        } else if (mode === 'signup') {
          const { data, error } = await client.auth.signUp({ email: email.value.trim(), password: password.value });
          if (error) throw error;
          if (!data.session) say('Almost done — open the confirmation link we just emailed you, then sign in.', 'good');
        } else {
          const { error } = await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
          if (error) throw error;
        }
      } catch (err) {
        say(friendlyAuthError(err), 'bad');
      } finally {
        submit.disabled = false;
      }
    };

    root.append(h('div', { class: 'auth-card' },
      h('div', { class: 'wordmark wordmark-lg' }, APP_NAME),
      h('p', { class: 'auth-tag' }, 'Log every set. See what you lifted last time. Beat it.'),
      mode !== 'reset' && segmented([{ id: 'signin', label: 'Sign in' }, { id: 'signup', label: 'Create account' }], mode, (id) => { mode = id; draw(''); }, { label: 'Account' }),
      h('form', { class: 'auth-form', onSubmit },
        email,
        mode !== 'reset' && password,
        submit,
        status),
      mode === 'reset'
        ? h('button', { class: 'link', type: 'button', onClick: () => { mode = 'signin'; draw(''); } }, 'Back to sign in')
        : h('button', { class: 'link', type: 'button', onClick: () => { mode = 'reset'; draw(''); } }, 'Forgot your password?')));
  };
  draw();
}

/** Shown after following a password-reset link. */
export function showNewPassword(client, done) {
  const root = document.getElementById('auth');
  root.hidden = false;
  document.getElementById('app').hidden = true;
  clear(root);
  const password = h('input', { class: 'field field-lg', type: 'password', autocomplete: 'new-password', placeholder: 'New password (6+ characters)', 'aria-label': 'New password', required: true, minlength: '6' });
  const status = h('p', { class: 'auth-note', role: 'status' });
  root.append(h('div', { class: 'auth-card' },
    h('div', { class: 'wordmark wordmark-lg' }, APP_NAME),
    h('p', { class: 'auth-tag' }, 'Choose a new password.'),
    h('form', { class: 'auth-form', onSubmit: async (e) => {
      e.preventDefault();
      const { error } = await client.auth.updateUser({ password: password.value });
      if (error) { status.textContent = friendlyAuthError(error); status.className = 'auth-note bad'; return; }
      done();
    } }, password, h('button', { class: 'btn btn-primary btn-block btn-lg', type: 'submit' }, 'Save password'), status)));
}

export function hideAuth() {
  const root = document.getElementById('auth');
  root.hidden = true;
  clear(root);
  document.getElementById('app').hidden = false;
}

export function showFatal(title, text, actionLabel, action) {
  const root = document.getElementById('auth');
  root.hidden = false;
  document.getElementById('app').hidden = true;
  clear(root);
  root.append(h('div', { class: 'auth-card' },
    h('div', { class: 'wordmark wordmark-lg' }, APP_NAME),
    h('h1', { class: 'auth-title' }, title),
    h('p', { class: 'auth-tag' }, text),
    actionLabel && h('button', { class: 'btn btn-primary btn-block btn-lg', onClick: action }, actionLabel)));
}
