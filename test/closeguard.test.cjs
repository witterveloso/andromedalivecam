'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createCloseGuard } = require('../desktop/closeguard.cjs');

function rig({ answer = 0, onAir = false, disabled = false, noWindow = false } = {}) {
  const calls = { dialogs: [], quit: 0, closed: 0, shown: 0 };
  const win = { isDestroyed: () => false, isMinimized: () => false, restore() {}, show() { calls.shown++; }, focus() {}, close() { calls.closed++; guard.handleClose({ preventDefault() { /* já confirmado ou novo pedido */ } }); } };
  const app = { quit() { calls.quit++; guard.handleBeforeQuit({ preventDefault() {} }); } };
  const dialog = { showMessageBox: async (_w, options) => { calls.dialogs.push(options); return { response: typeof answer === 'function' ? answer() : answer }; } };
  const guard = createCloseGuard({ dialog, app, disabled, getWindow: () => (noWindow ? null : win), isOnAir: async () => onAir });
  const evt = () => ({ prevented: false, preventDefault() { this.prevented = true; } });
  return { guard, calls, evt };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('tocar em fechar pergunta antes e "Continuar operando" mantém a mesa aberta', async () => {
  const { guard, calls, evt } = rig({ answer: 0 });
  const e = evt(); guard.handleClose(e); assert.equal(e.prevented, true, 'o fechamento é segurado');
  await flush(); await flush();
  assert.equal(calls.dialogs.length, 1); assert.equal(calls.closed, 0); assert.equal(guard.confirmed, false);
  assert.deepEqual(calls.dialogs[0].buttons, ['Continuar operando', 'Fechar o programa']);
  assert.equal(calls.dialogs[0].defaultId, 0, 'Enter fica em continuar'); assert.equal(calls.dialogs[0].cancelId, 0, 'Esc/X da pergunta continuam operando');
});

test('escolher fechar de propósito fecha, e só depois disso o fechamento passa direto', async () => {
  const { guard, calls, evt } = rig({ answer: 1 });
  guard.handleClose(evt()); await flush(); await flush();
  assert.equal(calls.dialogs.length, 1); assert.equal(calls.closed, 1); assert.equal(guard.confirmed, true);
  const again = evt(); guard.handleClose(again); assert.equal(again.prevented, false, 'confirmado: não pergunta de novo');
});

test('no ar: a pergunta avisa que a transmissão será interrompida', async () => {
  const { guard, calls, evt } = rig({ answer: 0, onAir: true });
  guard.handleClose(evt()); await flush(); await flush();
  assert.match(calls.dialogs[0].message, /no ar/i); assert.match(calls.dialogs[0].detail, /interrompe a transmiss/i); assert.deepEqual(calls.dialogs[0].buttons, ['Continuar no ar', 'Encerrar e fechar']);
});

test('toques repetidos no X enquanto a pergunta está aberta não empilham perguntas', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const calls = { dialogs: 0 };
  const win = { isDestroyed: () => false, isMinimized: () => false, restore() {}, show() {}, focus() {}, close() {} };
  const guard = createCloseGuard({ dialog: { showMessageBox: async () => { calls.dialogs++; await gate; return { response: 0 }; } }, app: { quit() {} }, getWindow: () => win });
  const mk = () => ({ preventDefault() {} });
  guard.handleClose(mk()); await flush(); guard.handleClose(mk()); guard.handleClose(mk()); await flush();
  assert.equal(calls.dialogs, 1); release(); await flush();
});

test('sair pelo app (Cmd+Q / app.quit) também pergunta; confirmando, o app sai', async () => {
  const { guard, calls, evt } = rig({ answer: 1 });
  const e = evt(); guard.handleBeforeQuit(e); assert.equal(e.prevented, true); await flush(); await flush();
  assert.equal(calls.quit, 1); assert.equal(guard.confirmed, true);
});

test('sem janela, no modo de verificação automática ou quando o programa decide encerrar, não pergunta', async () => {
  { const { guard, calls, evt } = rig({ noWindow: true }); const e = evt(); guard.handleBeforeQuit(e); assert.equal(e.prevented, false, 'sem janela o app sai direto'); await flush(); assert.equal(calls.dialogs.length, 0); }
  { const { guard, calls, evt } = rig({ disabled: true }); const a = evt(), b = evt(); guard.handleClose(a); guard.handleBeforeQuit(b); assert.equal(a.prevented || b.prevented, false); await flush(); assert.equal(calls.dialogs.length, 0); }
  const { guard, evt } = rig(); guard.confirmNow(); const e = evt(); guard.handleClose(e); assert.equal(e.prevented, false);
});
