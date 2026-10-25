import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../lib/member-session.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const serverId = 'server_identity_for_test_123456';
const user = { id: 'member-1', username: 'member_one', name: 'Private Name', birthDate: '1990-01-01', age: 36, historyConsent: false };
const quota = { limit: 10, used: 2, remaining: 8, resetAt: '2026-10-26T00:00:00+09:00' };
function storage(shared = new Map()) {
  return { getItem: key => shared.get(key) ?? null, setItem: (key, value) => shared.set(key, String(value)), removeItem: key => shared.delete(key), values: shared };
}
function runtime({ persistent = storage(), tab = storage(), origin = 'https://gateway.example.com', handlers = {} } = {}) {
  const calls = [], events = new Map();
  const context = {
    exports: {}, Headers, AbortSignal, Event, crypto: { randomUUID: () => '01234567-89ab-4cde-8fab-0123456789ab' },
    Date, JSON, Set, Error, Number, Math, Promise, localStorage: persistent, sessionStorage: tab,
    setTimeout: () => 1, clearTimeout: () => {}, document: { visibilityState: 'visible' },
    window: { dispatchEvent: () => {}, addEventListener: (name, handler) => events.set(name, handler), setInterval: () => 1 },
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ path, body, headers: init.headers });
      const result = handlers[path] ? await handlers[path](body) : path === '/v1/auth/config'
        ? { configured: true, mode: 'member', serverId } : path === '/v1/members/me' ? { user, quota, recoveryReady: true } : {};
      return { ok: !result.status || result.status < 400, status: result.status || 200, json: async () => result };
    },
    require: id => id === 'react' ? { useEffect: () => {}, useSyncExternalStore: (_subscribe, snapshot) => snapshot() }
      : id === '@/lib/ai-conversation' ? { aiApiOrigin: () => origin } : null,
  };
  vm.runInNewContext(compiled, context);
  return { api: context.exports, state: () => context.exports.useMemberSession(), calls, persistent, tab, events };
}
function session(extra = {}) {
  return { accessToken: 'a'.repeat(64), expiresAt: Date.now() / 1000 + 28800, user, quota, recoveryReady: true, serverId, ...extra };
}
const device = () => ({ clientId: '01234567-89ab-4cde-8fab-0123456789ab', rememberToken: 'r'.repeat(64), expiresAt: Date.now() / 1000 + 30 * 86400, serverId });

test('ordinary login never persists a device, profile, password or recovery code', async () => {
  const app = runtime({ handlers: { '/v1/members/login': () => session({ recoveryCode: 'EVAN-private-code' }) } });
  await app.state().retryConnection();
  assert.equal(await app.state().signIn('member_one', '123456'), true);
  assert.equal(app.state().remembered, false);
  assert.equal(app.persistent.values.size, 0);
  assert.equal(app.calls.find(c => c.path.endsWith('/login')).body.rememberDevice, false);
  assert.equal(app.calls.find(c => c.path.endsWith('/login')).body.clientId, undefined);
  const saved = [...app.tab.values.values()].join('');
  for (const privateValue of ['Private Name', '1990-01-01', '"password"', 'EVAN-private-code']) assert.equal(saved.includes(privateValue), false);
  assert.equal(app.state().recoveryCode, 'EVAN-private-code');
  app.state().dismissRecoveryCode();
  assert.equal(app.state().recoveryCode, null);
});

test('checked device restores a new browser tab and survives configured tunnel origin changes', async () => {
  const remembered = device();
  const persistent = storage();
  const app = runtime({ persistent, handlers: { '/v1/members/login': () => session({ clientId: remembered.clientId, rememberToken: remembered.rememberToken, rememberExpiresAt: remembered.expiresAt }) } });
  await app.state().retryConnection();
  assert.equal(await app.state().signIn('member_one', '123456', true), true);
  assert.equal(app.state().remembered, true);
  const saved = JSON.parse(persistent.getItem('evan-member-device'));
  assert.deepEqual(Object.keys(saved).sort(), ['clientId', 'expiresAt', 'rememberToken', 'serverId']);
  const reopened = runtime({ persistent, origin: 'https://replacement-gateway.example.com', handlers: {
    '/v1/members/remember': body => {
      assert.equal(body.clientId, remembered.clientId);
      assert.equal(body.rememberToken, remembered.rememberToken);
      return session({ clientId: remembered.clientId, rememberExpiresAt: remembered.expiresAt });
    },
  } });
  await reopened.state().retryConnection();
  assert.equal(reopened.state().user.username, 'member_one');
  assert.equal(reopened.state().quota.remaining, 8);
  assert.equal(reopened.state().remembered, true);
});

test('expired or different server credentials are discarded without sending the secret', async () => {
  for (const changed of [{ expiresAt: 1 }, { serverId: 'a_different_server_identity' }, { rememberToken: 'bad' }]) {
    const persistent = storage();
    persistent.setItem('evan-member-device', JSON.stringify({ ...device(), ...changed }));
    const app = runtime({ persistent });
    await app.state().retryConnection();
    assert.equal(app.state().user, null);
    assert.equal(app.calls.some(c => c.path.endsWith('/remember')), false);
    assert.equal(persistent.values.size, 0);
  }
});

test('server revocation clears remembered login; transient errors retain it for retry', async () => {
  for (const status of [401, 503]) {
    const persistent = storage();
    persistent.setItem('evan-member-device', JSON.stringify(device()));
    const app = runtime({ persistent, handlers: { '/v1/members/remember': () => ({ status, detail: 'Unavailable' }) } });
    await app.state().retryConnection();
    assert.equal(app.state().user, null);
    assert.equal(Boolean(persistent.getItem('evan-member-device')), status === 503);
  }
});

test('logout revokes remembered credential before clearing local state, including other tabs', async () => {
  const remembered = device();
  const app = runtime({ handlers: { '/v1/members/login': () => session({ clientId: remembered.clientId, rememberToken: remembered.rememberToken, rememberExpiresAt: remembered.expiresAt }) } });
  await app.state().retryConnection();
  await app.state().signIn('member_one', '123456', true);
  await app.state().signOut();
  assert.equal(app.state().user, null);
  assert.equal(app.persistent.values.size, 0);
  assert.equal(app.tab.values.size, 0);
  assert.ok(app.calls.some(c => c.path.endsWith('/forget') && c.body.rememberToken === remembered.rememberToken));
  assert.ok(app.calls.some(c => c.path.endsWith('/logout')));
});

test('storage failure does not silently create an account without requested auto login', async () => {
  const broken = { ...storage(), setItem: () => { throw new Error('denied'); } };
  const app = runtime({ persistent: broken });
  await app.state().retryConnection();
  assert.equal(await app.state().signUp({ username: 'member_one', password: '123456', rememberDevice: true }), false);
  assert.equal(app.calls.some(c => c.path.endsWith('/signup')), false);
  assert.match(app.state().error, /체크를 해제/);
});

test('logout in a different tab clears the remembered tab session', async () => {
  const remembered = device();
  const app = runtime({ handlers: { '/v1/members/login': () => session({ clientId: remembered.clientId, rememberToken: remembered.rememberToken, rememberExpiresAt: remembered.expiresAt }) } });
  await app.state().retryConnection();
  await app.state().signIn('member_one', '123456', true);
  app.events.get('storage')({ key: 'evan-member-device', newValue: null });
  assert.equal(app.state().user, null);
});

test('committed signup retains its session and one-time code if previous browser cleanup fails', async () => {
  const persistent = storage();
  persistent.setItem('evan-member-device', JSON.stringify(device()));
  const app = runtime({ persistent, handlers: {
    '/v1/members/remember': () => ({ status: 503, detail: 'temporary' }),
    '/v1/members/signup': () => session({ recoveryCode: 'EVAN-new-private-code' }),
    '/v1/members/forget': () => ({ status: 503, detail: 'temporary' }),
  } });
  await app.state().retryConnection();
  assert.equal(await app.state().signUp({ username: 'member_one', password: '123456' }), true);
  assert.equal(app.state().user.username, 'member_one');
  assert.equal(app.state().recoveryCode, 'EVAN-new-private-code');
  assert.equal(app.state().remembered, false);
  assert.match(app.state().error, /이전 자동 로그인/);
});

test('storage failure after signup never loses successful signup or its recovery code', async () => {
  const remembered = device();
  const persistent = storage();
  const ordinarySet = persistent.setItem;
  persistent.setItem = (key, value) => { if (key === 'evan-member-device') throw new Error('quota'); ordinarySet(key, value); };
  const app = runtime({ persistent, handlers: { '/v1/members/signup': () => session({ recoveryCode: 'EVAN-new-private-code',
    clientId: remembered.clientId, rememberToken: remembered.rememberToken, rememberExpiresAt: remembered.expiresAt }) } });
  await app.state().retryConnection();
  assert.equal(await app.state().signUp({ username: 'member_one', password: '123456', rememberDevice: true }), true);
  assert.equal(app.state().user.username, 'member_one');
  assert.equal(app.state().recoveryCode, 'EVAN-new-private-code');
  assert.equal(app.state().remembered, false);
  assert.match(app.state().error, /저장하지 못해/);
});

test('a pending remember response cannot sign in after another tab logged out', async () => {
  const remembered = device();
  const persistent = storage();
  persistent.setItem('evan-member-device', JSON.stringify(remembered));
  let resolve, started;
  const begun = new Promise(done => { started = done; });
  const pending = new Promise(done => { resolve = done; });
  const app = runtime({ persistent, handlers: { '/v1/members/remember': () => { started(); return pending; } } });
  const initialization = app.state().retryConnection();
  await begun;
  persistent.removeItem('evan-member-device');
  app.events.get('storage')({ key: 'evan-member-device', newValue: null });
  resolve(session({ clientId: remembered.clientId, rememberExpiresAt: remembered.expiresAt }));
  await initialization;
  assert.equal(app.state().user, null);
  assert.equal(app.state().remembered, false);
  assert.equal(app.tab.values.size, 0);
});
