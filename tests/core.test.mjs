import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createLedger } from '../ledger.js';
import { foldCost, costProjection, usageBuckets } from '../cost-fold.js';

const home = mkdtempSync(join(tmpdir(), 'dsh-cost-test-'));
process.env.DSH_HOME = home;
const { prepareData, dataDir, protectedRoute, readJsonBody } = await import('../runtime.js');
const account = await import('../accounts.js');
prepareData('session-cost', home, []);

test('real compact attempt usage is counted once and last usage wins', () => {
 const event = { type: 'assistant/attempt', time: Date.UTC(2026, 9, 15, 1), data: { turn: 1, step: 1, stream: [
  { type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 12, outputTokens: 1 } } },
  { type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 1_000_000, outputTokens: 100_000 } } }
 ] } };
 const definition = costProjection({ prices: {}, currency: 'CNY' }, { state: {}, view: {} });
 let state = definition.init();
 state = foldCost(state, { type: 'request/context', data: { provider: 'deepseek-account', model: 'deepseek-flash' } }, {});
 state = foldCost(state, event, {});
 assert.equal(definition.wire.view(state).cost, 2.8);
 assert.equal(state.calls, 1);
 assert.equal(definition.wire.view(state).current.provider, 'deepseek-account');
 assert.equal(usageBuckets({ ...event, data: { ...event.data, usage: { inputTokens: 5 } } }).uncachedInputTokens, 5);
 assert.equal(foldCost(state, event, {}).calls, 1);
});

test('ledger separates Session objects, stores call deltas and deduplicates', () => {
 const path = join(home, 'ledger-test.jsonl');
 const ledger = createLedger(path);
 const a = { id: 'A' }, b = { id: 'B' };
 ledger.append(a, { cost: 10, callCount: 2, currency: 'CNY' });
 ledger.append(b, { cost: 5, callCount: 1, currency: 'CNY' });
 ledger.append(b, { cost: 12, callCount: 3, currency: 'CNY' });
 ledger.append(b, { cost: 12, callCount: 3, currency: 'CNY' });
 const result = ledger.read();
 assert.equal(result.today.cost, 22); assert.equal(result.today.calls, 5); assert.equal(result.today.sessions, 2);
 const resumed = createLedger(path); resumed.append(b, { cost: 13, callCount: 4, currency: 'CNY' });
 assert.equal(resumed.read().today.cost, 23);
});

test('legacy object-key rows remain on disk but are not presented as verified totals', () => {
 const path = join(home, 'legacy.jsonl');
 writeFileSync(path, JSON.stringify({ ts: Date.now(), session: '[object Object]', cost: 100 }) + '\n');
 const result = createLedger(path).read();
 assert.equal(result.legacyRows, 1); assert.equal(result.today.cost, 0);
 assert.match(readFileSync(path, 'utf8'), /100/);
});

test('migration does not resurrect deleted overrides on next startup', () => {
 const source = join(home, 'legacy'); mkdirSync(source);
 writeFileSync(join(source, 'config.json'), '{"example":1}');
 prepareData('example', source, ['config.json']);
 const target = join(dataDir('example'), 'config.json');
 assert.equal(statSync(target).mode & 0o777, 0o600);
 unlinkSync(target); prepareData('example', source, ['config.json']);
 assert.throws(() => statSync(target), { code: 'ENOENT' });
});

test('all business routes reject anonymous requests before body or adapter work', async () => {
 let handler, entered = 0;
 protectedRoute({ webServer: { register: (r) => { handler = r.handler; } }, connection: { admit: () => ({ rejection: 401 }) } },
  { kind: 'exact', path: '/api/example', handler: () => { entered++; } });
 let status;
 await handler({ method: 'PUT', headers: {} }, { writeHead: (n) => { status = n; }, end() {} });
 assert.equal(status, 401); assert.equal(entered, 0);
});

test('authenticated writes reject non-JSON before invoking handlers', async () => {
 let handler, entered = 0, status;
 protectedRoute({ webServer: { register: (r) => { handler = r.handler; } }, connection: { admit: () => ({ peer: {} }) } },
  { handler: () => { entered++; } });
 await handler({ method: 'POST', headers: { 'content-type': 'text/plain' } }, { writeHead: (n) => { status = n; }, end() {} });
 assert.equal(status, 415); assert.equal(entered, 0);
});

test('request body enforces size limits', async () => {
 await assert.rejects(readJsonBody(Readable.from([Buffer.from('123456')]), 4), { status: 413 });
 assert.deepEqual(await readJsonBody(Readable.from([Buffer.from('{"ok":true}')])), { ok: true });
});

test('delayed poll never restores deleted accounts or overwrites key changes', async () => {
 const lifetime = new AbortController(); account.configureAccounts({ signal: lifetime.signal });
 account.writeAccounts([{ id: 'A', provider: 'deepseek', key: 'synthetic-old' }]);
 let release;
 account.ADAPTERS.deepseek.query = () => new Promise((resolve) => { release = resolve; });
 const pending = account.refreshSavedAccount('A');
 await Promise.resolve();
 account.writeAccounts([{ id: 'B', provider: 'deepseek', key: 'synthetic-new' }]);
 release({ status: 'ok', items: [] }); await pending;
 assert.deepEqual(account.readAccounts().accounts.map((a) => a.id), ['B']);
 assert.equal(statSync(join(dataDir('session-cost'), 'accounts.json')).mode & 0o777, 0o600);
});

test('concurrent configuration saves reject stale revisions', () => {
 const snapshot = account.readAccounts();
 account.writeAccounts(snapshot.accounts, snapshot.revision);
 assert.throws(() => account.writeAccounts([], snapshot.revision), { status: 409 });
});

test('zero and negative balances remain below the warning threshold', () => {
 for (const remaining of [1, 0, -1]) assert.ok(account.accountAlarm({ provider: 'deepseek', warnBelow: 10, snapshot: { status: 'ok', items: [{ remaining, primary: true }] } }));
});

test('unloading discards a late account refresh without touching persisted state', async () => {
 const lifetime = new AbortController(); account.configureAccounts({ signal: lifetime.signal });
 account.writeAccounts([{ id: 'abort', provider: 'deepseek', key: 'synthetic' }]);
 const before = readFileSync(join(dataDir('session-cost'), 'accounts.json'), 'utf8');
 let release; account.ADAPTERS.deepseek.query = () => new Promise((r) => { release = r; });
 const pending = account.refreshSavedAccount('abort'); await Promise.resolve();
 lifetime.abort(); release({ status: 'ok', items: [{ remaining: 1 }] });
 await assert.rejects(pending, { name: 'AbortError' });
 assert.equal(readFileSync(join(dataDir('session-cost'), 'accounts.json'), 'utf8'), before);
});

test('DeepSeek display names use the Host profile without returning private fields', async () => {
 account.configureAccounts({ signal: new AbortController().signal, deepseekAccount: {
  getState: () => ({ status: 'credential-stored' }),
  getProfile: async () => ({ status: 'ready', value: { name: 'Synthetic user', id: 'private-id', token: 'not-for-client' } })
 } });
 const rows = await account.listDeepseekLogins();
 assert.equal(rows[0].nickname, 'Synthetic user');
 assert.equal(rows[0].token, undefined); assert.equal(rows[0].id, undefined);
 assert.equal(account.maskAccount({ provider: 'deepseek-account', loginUid: 'dsh-default' }).loginName, 'Synthetic user');
});
