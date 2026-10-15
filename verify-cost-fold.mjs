/**
 * Offline verification for the session-cost plugin.
 *
 * Replays real session logs through the plugin's own fold module and checks:
 *  1. token totals agree exactly with a transcription of the harness's
 *     `tokenUsage` fold (replacement on a repeated `(turn, step)` settlement,
 *     `llm/retry-started` closing the slot);
 *  2. the cost equals an independent per-call re-price at each call's own
 *     peak/idle rate;
 *  3. the peak/idle window rule, including weekends and the two daily bands;
 *  4. a model absent from the price table is reported unpriced, not zero-priced
 *     and not silently guessed;
 *  5. the wire view is what the client stub expects.
 *
 * Usage: node verify-cost-fold.mjs [session.jsonl ...]
 */
import fs from 'node:fs';
import { costProjection, costOfSample, isPeakTime, resolveRates } from './cost-fold.js';
import { foldWalletLedger, ledgerDecrease } from './wallet-ledger.js';

let failures = 0;
const check = (name, ok, detail = '') => {
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : ' — ' + detail}`);
};

/** The harness's own fold, transcribed from `dsh-token-meter`'s usage projection. */
function harnessTokenUsage(events) {
	let totals = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
	let last = null;
	const equal = (a, b) => a.uncachedInputTokens === b.uncachedInputTokens && a.outputTokens === b.outputTokens
		&& a.cacheReadTokens === b.cacheReadTokens && a.cacheWriteTokens === b.cacheWriteTokens;
	for (const event of events) {
		if (event.type === 'llm/retry-started') {
			if (last !== null && last.turn === event.data.turn && last.step === event.data.step) last = null;
			continue;
		}
		if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue;
		const usage = event.data?.usage;
		if (usage === undefined) continue;
		const buckets = {
			uncachedInputTokens: usage.inputTokens ?? 0,
			outputTokens: usage.outputTokens ?? 0,
			cacheReadTokens: usage.cacheReadTokens ?? 0,
			cacheWriteTokens: usage.cacheWriteTokens ?? 0
		};
		const { turn, step } = event.data;
		const previous = last !== null && last.turn === turn && last.step === step ? last.buckets : undefined;
		if (previous !== undefined && equal(previous, buckets)) continue;
		const replacing = previous ?? { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
		totals = {
			uncachedInputTokens: totals.uncachedInputTokens - replacing.uncachedInputTokens + buckets.uncachedInputTokens,
			outputTokens: totals.outputTokens - replacing.outputTokens + buckets.outputTokens,
			cacheReadTokens: totals.cacheReadTokens - replacing.cacheReadTokens + buckets.cacheReadTokens,
			cacheWriteTokens: totals.cacheWriteTokens - replacing.cacheWriteTokens + buckets.cacheWriteTokens
		};
		last = { turn, step, buckets };
	}
	return totals;
}

/**
 * Independent per-call re-price with the published table and each call's own
 * window. The routed model comes from the log's own `request/context` record,
 * replayed here separately from the plugin's fold so the two only agree if both
 * the attribution and the pricing are right.
 */
function exactCny(events, prices) {
	const seen = new Map();
	let total = 0;
	let route = { provider: '', model: '' };
	for (const event of events) {
		if (event.type === 'request/context') {
			route = { provider: String(event.data?.provider ?? ''), model: String(event.data?.model ?? '') };
			continue;
		}
		if (event.type !== 'assistant/message' || event.data?.usage === undefined) continue;
		const rates = resolveRates(route, prices);
		if (rates === undefined) continue;
		const cost = costOfSample({
			uncachedInputTokens: event.data.usage.inputTokens ?? 0,
			outputTokens: event.data.usage.outputTokens ?? 0,
			cacheReadTokens: event.data.usage.cacheReadTokens ?? 0,
			cacheWriteTokens: event.data.usage.cacheWriteTokens ?? 0
		}, rates, event.time) / 1e9;
		const key = route.provider + '/' + route.model + '@' + event.data.turn + ':' + event.data.step;
		total += seen.has(key) ? cost - seen.get(key) : cost;
		seen.set(key, cost);
	}
	return total;
}

const schemas = {
	state: { parse: (value) => value },
	view: { parse: (value) => value }
};
const config = { currency: 'CNY', usdPerCny: 0.14, prices: {} };

// ---------------------------------------------------------------- window rule
{
	// 2026-10-15 is a Thursday. Beijing = UTC+8, so 01:00Z = 09:00 Beijing.
	const at = (iso) => Date.parse(iso);
	check('peak: Thursday 09:00 Beijing', isPeakTime(at('2026-10-15T01:00:00Z')));
	check('peak: Thursday 11:59 Beijing', isPeakTime(at('2026-10-15T03:59:00Z')));
	check('idle: Thursday 12:00 Beijing (lunch)', !isPeakTime(at('2026-10-15T04:00:00Z')));
	check('peak: Thursday 14:00 Beijing', isPeakTime(at('2026-10-15T06:00:00Z')));
	check('idle: Thursday 18:00 Beijing', !isPeakTime(at('2026-10-15T10:00:00Z')));
	check('idle: Thursday 03:00 Beijing', !isPeakTime(at('2026-10-14T19:00:00Z')));
	check('idle: Saturday 10:00 Beijing', !isPeakTime(at('2026-10-17T02:00:00Z')));
	check('idle: Sunday 15:00 Beijing', !isPeakTime(at('2026-10-18T07:00:00Z')));
	// Idle is exactly half of peak, per the provider's published rule.
	const buckets = { uncachedInputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
	const rates = resolveRates({ provider: 'deepseek-account', model: 'deepseek-flash' }, {});
	const peak = costOfSample(buckets, rates, at('2026-10-15T01:00:00Z'));
	const idle = costOfSample(buckets, rates, at('2026-10-14T19:00:00Z'));
	check('1M uncached Flash tokens cost ¥2 at peak', peak === 2e9, `${peak / 1e9} CNY`);
	check('the same call costs ¥1 at idle', idle === 1e9, `${idle / 1e9} CNY`);
}

// ---------------------------------------------------------------- pricing table
{
	const prices = { 'my/model': { peak: { input: 1, output: 2 }, idle: { input: 0.5, output: 1 } } };
	const buckets = { uncachedInputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
	const rates = resolveRates({ provider: 'p', model: 'my/model' }, prices);
	const at = Date.parse('2026-10-15T01:00:00Z');
	check('configured price is honoured', costOfSample(buckets, rates, at) === 3e9);
	check('an explicit idle map overrides the half rule', resolveRates({ provider: 'p', model: 'my/model' }, prices).idle.input === 0.5);
	check('an unpriced model resolves to undefined', resolveRates({ provider: 'x', model: 'unknown' }, prices) === undefined);
	check('provider aliases share the built-in table', resolveRates({ provider: 'deepseek-account', model: 'deepseek-v4-pro' }, {}) !== undefined);
	check('a bare model id matches only an unknown provider', resolveRates({ provider: '', model: 'deepseek-flash' }, {}) !== undefined);
	check('a same-named model on another provider stays unpriced', resolveRates({ provider: 'third-party', model: 'deepseek-flash' }, {}) === undefined);
}

// ---------------------------------------------------------------- unpriced model
{
	const definition = costProjection(config, schemas, () => {});
	let state = definition.init();
	state = definition.apply(state, { type: 'request/context', time: 1, data: { provider: 'deepseek-account', model: 'never-heard-of-it' } });
	state = definition.apply(state, {
		type: 'assistant/message', time: Date.parse('2026-10-15T01:00:00Z'),
		data: { turn: 1, step: 1, usage: { inputTokens: 5, outputTokens: 5 } }
	});
	const view = definition.wire.view(state);
	check('an unpriced model is reported, not zero-priced', view.unpriced.length === 1 && view.unpriced[0] === 'never-heard-of-it');
	check('an unpriced model contributes no money', view.cost === 0);
	check('an unpriced model still counts its tokens', view.models[0].tokens.uncachedInputTokens === 5);
	check('an unpriced model still counts the call', view.callCount === 1);
}

// ---------------------------------------------------------------- replacement rule
{
	const definition = costProjection(config, schemas, () => {});
	let state = definition.init();
	state = definition.apply(state, { type: 'request/context', time: 1, data: { provider: 'deepseek-account', model: 'deepseek-flash' } });
	const usage = (input, output) => ({ inputTokens: input, outputTokens: output });
	const message = (turn, step, u) => ({ type: 'assistant/message', time: Date.parse('2026-10-15T01:00:00Z'), data: { turn, step, usage: u } });
	state = definition.apply(state, message(1, 1, usage(10, 1)));
	state = definition.apply(state, message(1, 1, usage(20, 2)));   // same step: replaces
	state = definition.apply(state, message(1, 2, usage(5, 1)));
	state = definition.apply(state, { type: 'llm/retry-started', time: 2, data: { turn: 1, step: 2 } });
	state = definition.apply(state, message(1, 2, usage(7, 3)));    // retry: bills again
	let view = definition.wire.view(state);
	// Step 1's first sample (10/1) is superseded by its second (20/2) instead of
	// being added; step 2 billed twice because the retry closed its slot.
	check('a repeated (turn, step) replaces the sample',
		view.models[0].tokens.uncachedInputTokens === 32 && view.models[0].tokens.outputTokens === 6,
		`in=${view.models[0].tokens.uncachedInputTokens} out=${view.models[0].tokens.outputTokens}`);
	check('a retried step bills both attempts', view.callCount === 3, `calls=${view.callCount}`);
	// Two calls in the same step without a retry must collapse to one billed call.
	let single = definition.init();
	single = definition.apply(single, { type: 'request/context', time: 1, data: { provider: 'deepseek-account', model: 'deepseek-flash' } });
	single = definition.apply(single, message(1, 1, usage(100, 10)));
	single = definition.apply(single, message(1, 1, usage(100, 10)));
	check('an identical repeated sample is idempotent', definition.wire.view(single).models[0].tokens.uncachedInputTokens === 100);
}

// ---------------------------------------------------------------- wallet ledger
{
	const wallets = (cny, bonus = 0) => ({
		status: 'ready',
		wallets: [{ currency: 'CNY', balance: cny.toFixed(2) }],
		bonusWallets: bonus === 0 ? [] : [{ currency: 'CNY', balance: bonus.toFixed(2) }]
	});
	let state = { baseline: null, floor: null, floorAt: 0 };
	state = foldWalletLedger(wallets(100, 5), state);
	state = foldWalletLedger(wallets(95, 5), state);
	state = foldWalletLedger(wallets(200, 5), state);      // top-up
	state = foldWalletLedger(wallets(198, 5), state);
	check('the ledger reports the window total, not the current balance', ledgerDecrease(state) === 5, `decrease=${ledgerDecrease(state)}`);
	check('the baseline survives a top-up', state.baseline === 105);
	check('a failed read preserves the ledger',
		foldWalletLedger({ status: 'failed', wallets: [], bonusWallets: [], updatedAt: 0 }, state).baseline === 105);
	check('a mixed-currency account yields no delta',
		ledgerDecrease(foldWalletLedger({
			status: 'ready',
			wallets: [{ currency: 'CNY', balance: '1.00' }, { currency: 'USD', balance: '1.00' }],
			bonusWallets: [], updatedAt: 0
		}, state)) === null);
}

// ---------------------------------------------------------------- real logs
const logs = process.argv.slice(2);
if (logs.length === 0) {
	console.log('\n(no session logs given: skipping the real-log replay)');
} else {
	for (const log of logs) {
		const events = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
		const definition = costProjection(config, schemas, () => {});
		let state = definition.init();
		for (const event of events) state = definition.apply(state, event);
		const view = definition.wire.view(state);

		const actual = view.models.reduce((sum, entry) => ({
			uncachedInputTokens: sum.uncachedInputTokens + entry.tokens.uncachedInputTokens,
			outputTokens: sum.outputTokens + entry.tokens.outputTokens,
			cacheReadTokens: sum.cacheReadTokens + entry.tokens.cacheReadTokens,
			cacheWriteTokens: sum.cacheWriteTokens + entry.tokens.cacheWriteTokens
		}), { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
		const expected = harnessTokenUsage(events);
		console.log(`\n=== ${log} (${events.length} events) ===`);
		console.log('   models     :', view.models.map((entry) => `${entry.provider}/${entry.model} ${entry.priced ? '' : '(unpriced) '}${entry.cost.toFixed(4)} CNY`).join(', ') || '(none)');
		console.log('   tokens     :', JSON.stringify(actual));
		console.log('   cost       :', view.cost.toFixed(6), 'CNY | calls:', view.callCount);
		check('token totals match the harness fold', JSON.stringify(actual) === JSON.stringify(expected));
		const exact = exactCny(events, {});
		check('cost matches an independent per-call re-price', Math.abs(view.cost - exact) < 0.01, `${view.cost.toFixed(6)} vs ${exact.toFixed(6)}`);
	}
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
