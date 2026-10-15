/**
 * Session cost & balance projection — Host half.
 *
 * Folds the durable session log into a billed token/cost total per model and
 * publishes it as the `sessionCost` session projection, so the Web client (and
 * any other consumer) reads one already-computed number. Cost is derived from
 * the provider-reported usage samples the harness already records; nothing here
 * calls a model or changes model-visible content.
 *
 * The only harness import is `defineTool`: it compiles the parameter and output
 * schemas this tool declares into real JSON Schema, and the profile resolver
 * maps that package to the running installation.
 *
 * @module dsh-plugin-session-cost
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import { readFileSync } from 'node:fs';
import { dataDir, prepareData, atomicJson, protectedRoute, readJsonBody } from './runtime.js';
import { createLedger } from './ledger.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanBuckets, costProjection, whole } from './cost-fold.js';
import { foldWalletLedger } from './wallet-ledger.js';
import { ADAPTERS, readAccounts, writeAccounts, maskAccount, configureAccounts, refreshSavedAccount, refreshAllAccounts, testAccount, listWorkbuddyLogins, listDeepseekLogins, listDshKeys, dshResolveKeyRef } from './accounts.js';

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const PRICING_PATH = join(dataDir('session-cost'), 'pricing.json');
const LEDGER_PATH = join(dataDir('session-cost'), 'ledger.jsonl');

//#region projection contracts

/**
 * Field-wise validators.
 *
 * The plugin declares no Schemastery `Config` and imports no schema package at
 * module scope: it loads from its own directory, and the harness validates both
 * the persisted fold state and every client-visible value by calling
 * `.parse()` on what a projection registers. Each validator below therefore
 * exposes exactly that one method, returning a fresh fully-typed plain object —
 * which is also what makes the value safe to checkpoint and to send.
 */

/** @returns the value when it is a non-negative integer, otherwise zero. */
const nanno = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

/** @returns the value when it is a finite non-negative number, otherwise zero. */
const nonNegative = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);

/** @returns the value when it is a string, otherwise the fallback. */
const text = (value, fallback = '') => (typeof value === 'string' ? value : fallback);

/** @returns a detached copy of one model total, or undefined when the entry is unusable. */
function cleanModelTotal(source) {
	if (source === null || typeof source !== 'object' || typeof source.model !== 'string') return undefined;
	return {
		provider: text(source.provider),
		model: source.model,
		name: text(source.name, source.model),
		priced: source.priced === true,
		nano: nanno(source.nano),
		buckets: cleanBuckets(source.buckets),
		...(source.lastBuckets === undefined ? {} : { lastNano: nanno(source.lastNano), lastBuckets: cleanBuckets(source.lastBuckets) })
	};
}

/** @returns a detached copy of the persisted fold state. */
function cleanCostState(source) {
	const models = Array.isArray(source?.models) ? source.models.map(cleanModelTotal).filter(Boolean) : [];
	const current = source?.current;
	return {
		models,
		calls: nanno(source?.calls),
		lastTurn: Number.isInteger(source?.lastTurn) ? source.lastTurn : -1,
		lastStep: Number.isInteger(source?.lastStep) ? source.lastStep : -1,
		current: current !== null && typeof current === 'object' && typeof current.model === 'string'
			? { provider: text(current.provider), model: current.model }
			: null
	};
}

/** @returns a detached copy of the client-visible cost view. */
function cleanCostView(source) {
	const models = Array.isArray(source?.models) ? source.models.map((entry) => ({
		provider: text(entry?.provider),
		model: text(entry?.model),
		name: text(entry?.name),
		priced: entry?.priced === true,
		cost: nonNegative(entry?.cost),
		tokens: cleanBuckets(entry?.tokens)
	})) : [];
	return {
		currency: source?.currency === 'USD' ? 'USD' : 'CNY',
		cost: nonNegative(source?.cost),
		callCount: nanno(source?.callCount),
		current: source?.current && typeof source.current.provider === 'string' ? { provider: source.current.provider, model: text(source.current.model) } : null,
		unpriced: Array.isArray(source?.unpriced) ? source.unpriced.map((entry) => text(entry)) : [],
		models
	};
}

/** @returns a detached copy of the wallet state. */
function cleanBalanceState(source) {
	const wallets = (value) => (Array.isArray(value) ? value : []).map((wallet) => ({
		currency: text(wallet?.currency, 'CNY'),
		balance: text(wallet?.balance, '0')
	}));
	const status = source?.status;
	return {
		status: status === 'ready' || status === 'signed-out' || status === 'failed' ? status : 'idle',
		wallets: wallets(source?.wallets),
		bonusWallets: wallets(source?.bonusWallets),
		updatedAt: nonNegative(source?.updatedAt),
		// Spend observed by polling the wallet: `floor` is the lowest total seen
		// since this plugin started watching, so spending during the window is
		// `baseline - floor`. A top-up raises the total but never the delta, which
		// is why the floor and not the current total is what the delta reports.
		// Both are null when the account holds no single comparable currency.
		baseline: source?.baseline === undefined || source.baseline === null ? null : nonNegative(source.baseline),
		floor: source?.floor === undefined || source.floor === null ? null : nonNegative(source.floor),
		floorAt: nonNegative(source?.floorAt)
	};
}

/**
 * Wrap a cleaner as the schema the projection registry calls.
 * @param clean - turns one raw value into the validated, detached result.
 * @returns the registration surface: `parse` is the only member the harness uses.
 */
const schema = (clean) => ({ parse: clean });

const costStateSchema = schema(cleanCostState);
const costViewSchema = schema(cleanCostView);
const balanceStateSchema = schema(cleanBalanceState);

//#endregion
//#endregion

//#region config

/**
 * Client build version reported to Platform when the row config does not set
 * `clientVersion`; it should track the running harness release.
 */
const DEFAULT_CLIENT_VERSION = '0.2.0-rc.2';

/**
 * Normalize the row's `config` into the shape the fold and the client depend on.
 * Unknown keys are dropped and every value is clamped, so a hand-written patch
 * can never put the projection into a state the client cannot render.
 *
 * @param raw - the row's `config`, or undefined.
 * @returns the effective configuration.
 */
function normalizeConfig(raw) {
	const source = raw !== null && typeof raw === 'object' ? raw : {};
	const prices = source.prices !== null && typeof source.prices === 'object' && !Array.isArray(source.prices) ? source.prices : {};
	return {
		// CNY-only: the official price list is published in yuan, so no display
		// currency or exchange rate exists anywhere in the plugin.
		currency: 'CNY',
		usdPerCny: 1,
		prices,
		balancePollMs: Number.isInteger(source.balancePollMs) && source.balancePollMs >= 1000 ? source.balancePollMs : 120_000,
		clientVersion: typeof source.clientVersion === 'string' && source.clientVersion !== '' ? source.clientVersion : DEFAULT_CLIENT_VERSION,
		warnBalanceBelow: typeof source.warnBalanceBelow === 'number' && Number.isFinite(source.warnBalanceBelow) && source.warnBalanceBelow > 0
			? source.warnBalanceBelow
			: null,
		pricingUpdated: null,
		pricingSource: null
	};
}

/**
 * Overlay the plugin-directory `pricing.json` onto the normalized config. The
 * file caches the last fetched official table plus the user's warning line;
 * it is written by the plugin itself (fetch and settings save), never edited
 * by hand.
 *
 * @param config - the normalized row config, mutated in place.
 */
function applyPricingFile(config) {
	let body;
	try {
		body = JSON.parse(readFileSync(PRICING_PATH, 'utf8'));
	} catch {
		return;
	}
	if (body === null || typeof body !== 'object' || Array.isArray(body)) return;
	if (body.prices !== null && typeof body.prices === 'object' && !Array.isArray(body.prices) && Object.keys(body.prices).length > 0) {
		config.prices = body.prices;
		config.pricingSource = 'official';
	}
	if (typeof body.warnBalanceBelow === 'number' && Number.isFinite(body.warnBalanceBelow)) {
		// Zero (or a negative) turns the low-balance warning off.
		config.warnBalanceBelow = body.warnBalanceBelow > 0 ? body.warnBalanceBelow : null;
	}
	if (typeof body.updated === 'string' && body.updated !== '') config.pricingUpdated = body.updated;
}

/** Persist the current pricing state (fetched table + warning line). */
function writePricingFile(config) {
	const body = { updated: config.pricingUpdated, warnBalanceBelow: config.warnBalanceBelow, prices: config.prices };
	atomicJson(PRICING_PATH, body);
}

/**
 * Fetch the official DeepSeek price list (zh-CN page, yuan per million
 * tokens) and parse it into the override shape the fold consumes.
 * Parsing is deliberately conservative: any layout surprise yields null and
 * the built-in table keeps serving, rather than half-guessed numbers.
 *
 * @returns {{date: string, prices: object} | null}
 */
async function fetchOfficialPrices(signal) {
	const res = await fetch('https://api-docs.deepseek.com/zh-cn/quick_start/pricing', {
		headers: { 'user-agent': 'dsh-plugin-session-cost' },
		signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)])
	});
	if (!res.ok) return null;
	const html = await res.text();
	const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
	const rows = [...text.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) =>
		[...m[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
	);
	if (rows.length === 0) return null;
	const header = rows[0];
	const models = header.slice(1).map((cell) => cell.replace(/\(\d+\)/g, '').trim()).filter((cell) => cell !== '');
	if (models.length === 0 || !models.every((cell) => /^[\w.-]+$/.test(cell))) return null;
	// Section rows carry their labels in the leading cells and one value per
	// model at the tail; rows between a section row and its "高峰时段" sibling
	// are the idle/peak pair for one bucket.
	const yuan = (cell) => {
		const m = /^([\d.]+)\s*元$/.test(cell) ? Number(cell.replace('元', '')) : NaN;
		return Number.isFinite(m) ? m : null;
	};
	const grid = { cacheRead: {}, input: {}, output: {} };
	const bucketOf = (row) =>
		row.some((cell) => cell.includes('缓存命中')) ? 'cacheRead'
			: row.some((cell) => cell.includes('缓存未命中')) ? 'input'
				: row.some((cell) => cell.includes('百万tokens输出')) ? 'output'
					: null;
	for (let i = 0; i < rows.length; i++) {
		const bucket = bucketOf(rows[i]);
		if (bucket === null) continue;
		const idle = rows[i].slice(-models.length).map(yuan);
		const peakRow = rows[i + 1];
		if (peakRow === undefined || !peakRow.some((cell) => cell.includes('高峰'))) return null;
		const peak = peakRow.slice(-models.length).map(yuan);
		if (idle.includes(null) || peak.includes(null)) return null;
		for (let m = 0; m < models.length; m++) {
			grid[bucket][m] = { idle: idle[m], peak: peak[m] };
		}
		i++;
	}
	const prices = {};
	for (let m = 0; m < models.length; m++) {
		const c = grid.cacheRead[m];
		const i2 = grid.input[m];
		const o = grid.output[m];
		if (c === undefined || i2 === undefined || o === undefined) return null;
		prices[`deepseek/${models[m]}`] = {
			peak: { input: i2.peak, output: o.peak, cacheRead: c.peak },
			idle: { input: i2.idle, output: o.idle, cacheRead: c.idle }
		};
	}
	const now = new Date();
	const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	return { date, prices };
}

//#endregion

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

//#region balance

/**
 * Read the signed-in account's wallet balances through whichever account
 * provider this profile mounted. The provider is optional: a profile without
 * one reports `signed-out`, and a provider that is still initializing reports
 * `failed`, so the plugin never blocks on the account subsystem.
 *
 * @param ctx - plugin context.
 * @param version - client build version the provider reports to Platform.
 * @param timeoutMs - how long one wallet read may take.
 * @returns the wallet state to publish.
 */
async function readBalance(ctx, version, timeoutMs) {
	const account = ctx.get('deepseekAccount');
	const empty = { wallets: [], bonusWallets: [], updatedAt: Date.now() };
	if (account === undefined || typeof account.getBalance !== 'function') return { status: 'signed-out', ...empty };
	// The provider derives the Platform client headers from this identity, so it
	// must describe the UI that is asking rather than the last caller.
	const metadata = {
		version,
		// No host-side locale service exists in this tree; the wire locale is
		// pinned to the app's default until a real source is wired in.
		locale: 'zh_CN',
		timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
	};
	// The provider owns its own request timeout, but a hung account provider must
	// not hold the pill's value forever, so the read races a hard deadline.
	let timer;
	const balance = await Promise.race([
		Promise.resolve(account.getBalance(metadata)),
		new Promise((resolve) => {
			timer = setTimeout(() => resolve(undefined), timeoutMs);
			timer.unref?.();
		})
	]);
	if (timer !== undefined) clearTimeout(timer);
	if (balance === undefined || balance === null) return { status: 'signed-out', ...empty };
	if (balance.status !== 'ready') return { status: 'failed', ...empty };
	const map = (wallet) => ({ currency: String(wallet.currency), balance: String(wallet.balance) });
	return {
		status: 'ready',
		wallets: (balance.value ?? []).map(map),
		bonusWallets: (balance.bonusWallets ?? []).map(map),
		updatedAt: Date.now()
	};
}

//#endregion

//#region formatting

/**
 * One-line wallet description.
 * @param state - the latest wallet read.
 * @returns human-readable balance text.
 */
function describeWallet(state) {
	if (state.status === 'idle') return '余额读取中';
	if (state.status === 'signed-out') return '未登录 DeepSeek 账号';
	if (state.status === 'failed') return '余额读取失败';
	const bonus = new Set(state.bonusWallets.filter((wallet) => Number(wallet.balance) > 0));
	const rows = [...state.wallets, ...bonus];
	if (rows.length === 0) return '余额为空';
	const symbol = (wallet) => (wallet.currency === 'CNY' ? '¥' : '$');
	return rows.map((wallet) => `${symbol(wallet)}${wallet.balance}${bonus.has(wallet) ? '（赠送）' : ''}`).join(' + ');
}

/**
 * Compose the model-facing report.
 * @param view - the published cost view.
 * @param wallet - the wallet description.
 * @returns a compact multi-line summary.
 */
function describeSummary(view, wallet) {
	const symbol = view.currency === 'CNY' ? '¥' : '$';
	const lines = [`本会话花费约 ${symbol}${view.cost.toFixed(4)}（${view.callCount} 次模型调用）`];
	for (const entry of view.models) {
		const { tokens } = entry;
		const prompt = tokens.uncachedInputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens;
		const cache = prompt > 0 ? Math.round((tokens.cacheReadTokens / prompt) * 100) : 0;
		lines.push(`- ${entry.name || entry.model || '(未标注模型)'}${entry.priced ? '' : '（未定价）'}: ${symbol}${entry.cost.toFixed(4)}；输入 ${tokens.uncachedInputTokens} / 缓存命中 ${tokens.cacheReadTokens}（${cache}%）/ 缓存写入 ${tokens.cacheWriteTokens}；输出 ${tokens.outputTokens}`);
	}
	if (view.unpriced.length > 0) lines.push(`未定价模型：${[...new Set(view.unpriced)].join('、')} —— 在插件 config.prices 中补充单价后即可计入金额。`);
	lines.push(`账号余额：${wallet}`);
	return lines.join('\n');
}

//#endregion

/**
 * Mount the session-cost projection, the balance poller, and the read-only
 * `session_cost` tool.
 *
 * @param ctx - plugin context owning every registration below.
 * @param rawConfig - the row's `config`. A plain-JS plugin is loaded exactly as
 *   written, so the schema is applied here rather than declared as an export.
 */
export function apply(ctx, rawConfig) {
	const lifetime = new AbortController();
	ctx.effect(() => () => lifetime.abort(), 'session-cost: requests');
	prepareData('session-cost', PLUGIN_DIR, ['accounts.json', 'pricing.json', 'ledger.jsonl']);
	configureAccounts({ signal: lifetime.signal, deepseekAccount: ctx.deepseekAccount, credentials: ctx.credentials });
	const config = normalizeConfig(rawConfig);
	applyPricingFile(config);
	const ledger = createLedger(LEDGER_PATH);

	/**
	 * Pull the official price list and hot-apply it. The fetched table lands
	 * in `config.prices` (the fold reads it per event), is cached to
	 * pricing.json for the next launch, and stamps the panel's table date.
	 * Failure keeps whatever the file or the built-in table already supplied.
	 */
	let priceRead;
	let priceCheckedAt = 0;
	const refreshPrices = () => {
		if (priceRead) return priceRead;
		if (Date.now() - priceCheckedAt < 5 * 60_000) return Promise.resolve(true);
		priceRead = fetchOfficialPrices(lifetime.signal).then((result) => {
			lifetime.signal.throwIfAborted();
			if (result === null) return false;
			const next = { ...config, prices: result.prices, pricingUpdated: result.date, pricingSource: 'official' };
			writePricingFile(next);
			Object.assign(config, next);
			priceCheckedAt = Date.now();
			return true;
		}).catch(() => false).finally(() => { priceRead = undefined; });
		return priceRead;
	};

	ctx.effect(() => {
		void refreshPrices();
		const handle = setInterval(() => void refreshPrices(), 86_400_000);
		handle.unref?.();
		return () => clearInterval(handle);
	}, 'session-cost: price refresh');
	/**
	 * Latest wallet read. It is deliberately outside the fold: a wallet query is
	 * not session-durable, so nothing about it belongs in the log or in a
	 * checkpoint. The projection publishes this value, and a `turn/end` event
	 * re-materializes it, so a finished task always shows a fresh balance.
	 */
	let balance = {
		status: 'idle',
		wallets: [],
		bonusWallets: [],
		updatedAt: 0,
		baseline: null,
		floor: null,
		floorAt: 0
	};
	let balanceRead;
	/** Pending "read the wallet shortly after this turn" timer. */
	let afterTurnTimer;

	ctx.sessionProjections.register(costProjection(config, { state: costStateSchema, view: costViewSchema }));

	ctx.sessionProjections.register({
		key: 'sessionCostBalance',
		stateVersion: 1,
		stateSchema: balanceStateSchema,
		init: () => balance,
		// The fold carries no wallet data of its own; a committed turn is the only
		// thing that needs to re-derive the view from the live read below.
		apply: (state, event) => {
			if (event.type !== 'turn/end') return state;
			// Platform posts a charge shortly after a call settles, so a finished
			// turn is the moment a fresh wallet read is worth the request.
			return { ...balance };
		},
		wire: {
			viewSchema: balanceStateSchema,
			view: () => balance
		}
	});

	/** Refresh the wallet at most once per `balancePollMs`, sharing one in-flight read. */
	const refreshBalance = () => {
		if (balanceRead !== undefined) return balanceRead;
		balanceRead = readBalance(ctx, config.clientVersion, 30_000)
			.catch(() => ({ status: 'failed', wallets: [], bonusWallets: [], updatedAt: Date.now() }))
			.then((next) => {
				if (!lifetime.signal.aborted) balance = foldWalletLedger(next, balance);
				balanceRead = undefined;
			});
		return balanceRead;
	};

	/**
	 * Read the wallet once shortly after a turn, so a charge the Platform posts a
	 * few seconds late still lands in the delta without polling faster.
	 */
	const refreshBalanceAfterTurn = () => {
		if (afterTurnTimer !== undefined) clearTimeout(afterTurnTimer);
		afterTurnTimer = setTimeout(() => {
			afterTurnTimer = undefined;
			void refreshBalance();
		}, 5_000);
		afterTurnTimer.unref?.();
	};

	ctx.effect(() => {
		let stopped = false;
		const tick = async () => {
			if (stopped) return;
			await refreshBalance();
		};
		void tick();
		const handle = setInterval(() => void tick(), config.balancePollMs);
		handle.unref?.();
		return () => {
			stopped = true;
			clearInterval(handle);
			if (afterTurnTimer !== undefined) clearTimeout(afterTurnTimer);
		};
	}, 'session-cost: balance poller');

	// Ledger: every live settled turn appends one row; the fold itself stays
	// session-pure, cross-session history lives only in this file.
	ctx.effect(() => ctx.on('session/event', (session, event) => {
		if (!['turn/start', 'request/context', 'turn/end'].includes(event.type)) return;
		try {
			const view = ctx.sessionProjections.snapshot(session, ['sessionCost']).values.sessionCost;
			if (!view) return;
			if ((event.type === 'turn/start' || event.type === 'request/context') && !ledger.has(session)) ledger.prime(session, view);
			if (event.type === 'turn/end') {
				if (ledger.has(session)) ledger.append(session, view, event.time);
				else ledger.prime(session, view); // Activated mid-turn: do not book historical totals as new spend.
				refreshBalanceAfterTurn();
			}
		} catch { ctx.logger.warn('session-cost: 账本未写入，原记录已保留'); }
	}), 'session-cost: ledger');

	// HTTP surface for the settings page, the panel aggregates, and CSV export.
	// The webServer service is optional in this tree; without it the pill keeps
	// working off projections and only the extra surfaces stay hidden.
	const webServer = ctx.get('webServer');
	if (webServer !== undefined && typeof webServer.register === 'function') {
		const register = (route) => protectedRoute(ctx, route, lifetime.signal);
		ctx.effect(() => register({
			kind: 'exact',
			path: '/api/session-cost/ledger',
			handler: async (req, res) => {
				if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
				const { rows, today, week, legacyRows } = ledger.read();
				res.writeHead(200, JSON_HEADERS);
				res.end(JSON.stringify({ today, week, rows, legacyRows }));
			}
		}), 'session-cost: ledger api');

		ctx.effect(() => register({
			kind: 'exact',
			path: '/api/session-cost/pricing',
			handler: async (req, res) => {
				if (req.method === 'GET' || req.method === 'HEAD') {
					res.writeHead(200, JSON_HEADERS);
					res.end(JSON.stringify({
						updated: config.pricingUpdated,
						source: config.pricingSource,
						warnBalanceBelow: config.warnBalanceBelow,
						prices: config.prices
					}));
					return;
				}
				if (req.method !== 'PUT') { res.writeHead(405); res.end(); return; }
				// Only the warning line is user-writable; the table itself comes
				// from the official page, never from hand editing.
				try {
					const body = await readJsonBody(req);
					if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('object expected');
					const warnBalanceBelow = typeof body.warnBalanceBelow === 'number' && Number.isFinite(body.warnBalanceBelow) && body.warnBalanceBelow > 0
						? Math.min(500, body.warnBalanceBelow)
						: null;
					lifetime.signal.throwIfAborted();
					writePricingFile({ ...config, warnBalanceBelow });
					config.warnBalanceBelow = warnBalanceBelow;
					res.writeHead(200, JSON_HEADERS);
					res.end(JSON.stringify({ ok: true }));
				} catch (error) {
					res.writeHead(error.status || 400, JSON_HEADERS);
					res.end(JSON.stringify({ ok: false, error: String((error && error.message) || error) }));
				}
			}
		}), 'session-cost: pricing api');

		ctx.effect(() => register({
			kind: 'exact',
			path: '/api/session-cost/pricing/refresh',
			handler: async (req, res) => {
				if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
				const ok = await refreshPrices();
				res.writeHead(200, JSON_HEADERS);
				res.end(JSON.stringify({ ok, updated: config.pricingUpdated }));
			}
		}), 'session-cost: pricing refresh api');

		// Multi-account watching: the settings page owns writes, the panel only
		// ever reads the masked view. Keys round-trip through PUT but never GET.
		ctx.effect(() => register({
			kind: 'exact',
			path: '/api/session-cost/accounts',
			handler: async (req, res) => {
				if (req.method === 'GET' || req.method === 'HEAD') {
					const { accounts, revision } = readAccounts();
					res.writeHead(200, JSON_HEADERS);
					res.end(JSON.stringify({
						revision,
						providers: Object.entries(ADAPTERS).map(([id, a]) => ({ id, label: a.label, kind: a.kind, auth: a.auth })),
						accounts: accounts.map(maskAccount)
					}));
					return;
				}
				if (req.method !== 'PUT') { res.writeHead(405); res.end(); return; }
				try {
					const body = await readJsonBody(req);
					if (body === null || typeof body !== 'object' || !Array.isArray(body.accounts) || body.accounts.length > 100 || !Number.isSafeInteger(body.revision)) throw new Error('账号列表或版本无效');
					const prev = new Map(readAccounts().accounts.map((a) => [a.id, a]));
					const next = body.accounts.map((raw, index) => {
						if (raw === null || typeof raw !== 'object') throw new Error(`accounts[${index}] object expected`);
						const provider = String(raw.provider ?? '');
						if (!Object.hasOwn(ADAPTERS, provider)) throw new Error(`未知厂商: ${provider}`);
						const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : `acc-${Date.now().toString(36)}-${index}`;
						const old = prev.get(id);
						const imported = typeof raw.importRef === 'string' && raw.importRef !== '' ? raw.importRef : null;
						if (imported && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(imported)) throw new Error('凭据引用无效');
						const entered = typeof raw.key === 'string' ? raw.key.trim() : '';
						if (entered.length > 8192) throw new Error('密钥长度无效');
						const keyRef = entered ? null : (imported ?? old?.keyRef ?? null);
						const key = keyRef ? '' : (entered || old?.key || '');
						return {
							id,
							provider,
							key, keyRef,
							note: typeof raw.note === 'string' ? raw.note.trim().slice(0, 60) : '',
							warnBelow: typeof raw.warnBelow === 'number' && Number.isFinite(raw.warnBelow) && raw.warnBelow > 0 ? Math.min(ADAPTERS[provider].kind === 'plan' ? 100 : 500, raw.warnBelow) : null,
							polling: raw.polling !== false,
							monitor: raw.monitor === true,
							bindProviderId: typeof raw.bindProviderId === 'string' && raw.bindProviderId !== '' ? raw.bindProviderId : null,
							loginUid: typeof raw.loginUid === 'string' && raw.loginUid !== '' ? raw.loginUid : (old?.loginUid ?? null),
							snapshot: old?.provider === provider && old?.key === key && (old?.keyRef ?? null) === keyRef && (old?.loginUid ?? null) === (raw.loginUid || old?.loginUid || null) ? old?.snapshot ?? null : null
						};
					});
					if (new Set(next.map((a) => a.id)).size !== next.length) throw new Error('账号 ID 重复');
					const revision = writeAccounts(next, body.revision);
					res.writeHead(200, JSON_HEADERS);
					res.end(JSON.stringify({ ok: true, revision, accounts: next.map(maskAccount) }));
				} catch (error) {
					res.writeHead(error.status || 400, JSON_HEADERS);
					res.end(JSON.stringify({ ok: false, error: String((error && error.message) || error) }));
				}
			}
		}), 'session-cost: accounts api');

		ctx.effect(() => register({
			kind: 'exact',
			path: '/api/session-cost/accounts/query',
			handler: async (req, res) => {
				if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
				try {
					const body = await readJsonBody(req);
					const account = await refreshSavedAccount(body?.id, { signal: lifetime.signal });
					if (!account) throw new Error('账号已移除');
					res.writeHead(200, JSON_HEADERS);
					res.end(JSON.stringify({ ok: true, account: maskAccount(account) }));
				} catch (error) {
					res.writeHead(error.status || 400, JSON_HEADERS);
					res.end(JSON.stringify({ ok: false, error: String((error && error.message) || error) }));
				}
			}
		}), 'session-cost: accounts query api');

		// Local login discovery for auth:'login' providers (WorkBuddy 多账号).
		ctx.effect(() => register({
			kind: 'exact',
			path: '/api/session-cost/accounts/local-logins',
			handler: async (req, res) => {
				if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
				try {
					const [workbuddy, deepseek] = await Promise.all([listWorkbuddyLogins(), listDeepseekLogins()]);
					const result = {
						ok: true,
						logins: { workbuddy, 'deepseek-account': deepseek },
						keys: listDshKeys()
					};
					res.writeHead(200, JSON_HEADERS);
					res.end(JSON.stringify(result));
				} catch (error) {
					res.writeHead(200, JSON_HEADERS);
					res.end(JSON.stringify({ ok: true, logins: {}, keys: [], error: String((error && error.message) || error) }));
				}
			}
		}), 'session-cost: local logins api');

		// Test a provider/key pair without saving it: the settings page's
		// 测试连接 button. Same adapter path as a real refresh.
		ctx.effect(() => register({
			kind: 'exact',
			path: '/api/session-cost/accounts/test',
			handler: async (req, res) => {
				if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
				try {
					const body = await readJsonBody(req);
					const provider = String(body?.provider ?? '');
					const saved = typeof body?.accountId === 'string' ? readAccounts().accounts.find((a) => a.id === body.accountId && a.provider === provider) : null;
					const entered = typeof body?.key === 'string' ? body.key.trim() : '';
					const ref = typeof body?.importRef === 'string' && body.importRef !== '' ? body.importRef : saved?.keyRef;
					const imported = entered === '' && ref ? await dshResolveKeyRef(ref) : null;
					const key = entered || imported || (!ref ? saved?.key : '') || '';
					const adapter = Object.hasOwn(ADAPTERS, provider) ? ADAPTERS[provider] : undefined;
					if (adapter === undefined) throw new Error(`未知厂商: ${provider}`);
					if (adapter.auth !== 'login' && key === '') throw new Error('请填写 API key');
					const result = await testAccount(provider, key, { loginUid: typeof body?.loginUid === 'string' ? body.loginUid : null });
					res.writeHead(200, JSON_HEADERS);
					res.end(JSON.stringify(result.status === 'ok'
						? { ok: true, items: result.items }
						: { ok: false, error: result.error ?? '查询失败' }));
				} catch (error) {
					res.writeHead(error.status || 400, JSON_HEADERS);
					res.end(JSON.stringify({ ok: false, error: String((error && error.message) || error) }));
				}
			}
		}), 'session-cost: accounts test api');
	}

	// Balance poller for the multi-account watch: one pass every 5 minutes,
	// plus a first pass shortly after startup so the panel never opens empty.
	ctx.effect(() => {
		const handle = setInterval(() => void refreshAllAccounts({ signal: lifetime.signal }).catch(() => {}), 5 * 60_000);
		handle.unref?.();
		const first = setTimeout(() => void refreshAllAccounts({ signal: lifetime.signal }).catch(() => {}), 10_000);
		return () => {
			clearInterval(handle);
			clearTimeout(first);
		};
	}, 'session-cost: accounts poller');

	ctx.effect(() => ctx.tools.register(defineTool({
		name: 'session_cost',
		description: 'Report what this session has cost so far: billed tokens per model, the estimated amount in the configured currency, and the signed-in account balance. The amount is derived from the provider-reported usage already recorded in the session log and priced with the plugin\'s price table, so it is an estimate rather than an invoice.',
		parameters: {},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					summary: { type: 'string', required: true },
					currency: { type: 'string', required: true },
					cost: { type: 'number', required: true },
					callCount: { type: 'integer', required: true },
					models: {
						type: 'array',
						required: true,
						items: {
							type: 'object',
							additionalProperties: false,
							properties: {
								provider: { type: 'string', required: true },
								model: { type: 'string', required: true },
								priced: { type: 'boolean', required: true },
								cost: { type: 'number', required: true },
								uncachedInputTokens: { type: 'integer', required: true },
								cacheReadTokens: { type: 'integer', required: true },
								cacheWriteTokens: { type: 'integer', required: true },
								outputTokens: { type: 'integer', required: true }
							}
						}
					},
					balance: { type: 'string', required: true },
					unpriced: { type: 'array', required: true, items: { type: 'string' } }
				}
			},
			render: (_args, value) => [{ type: 'text', text: value.summary }]
		},
		execute(_args, exec) {
			const session = exec.agent?.session;
			if (session === undefined) throw new Error('session_cost requires an owning agent session');
			const view = ctx.sessionProjections.snapshot(session, ['sessionCost']).values.sessionCost
				?? cleanCostView({ currency: config.currency });
			const wallet = describeWallet(balance);
			let summary = describeSummary(view, wallet);
			if (config.pricingUpdated !== null) summary += `\n单价表日期：${config.pricingUpdated}`;
			if (config.warnBalanceBelow !== null && balance.status === 'ready') {
				const total = balance.wallets.concat(balance.bonusWallets).reduce((sum, w) => sum + Number(w.balance || 0), 0);
				if (Number.isFinite(total) && total < config.warnBalanceBelow) summary += `\n⚠️ 账号余额合计 ¥${total.toFixed(2)}，已低于预警线 ¥${config.warnBalanceBelow}`;
			}
			return Promise.resolve({
				summary,
				currency: view.currency,
				cost: view.cost,
				callCount: view.callCount,
				models: view.models.map((entry) => ({
					provider: entry.provider,
					model: entry.model,
					priced: entry.priced,
					cost: entry.cost,
					uncachedInputTokens: entry.tokens.uncachedInputTokens,
					cacheReadTokens: entry.tokens.cacheReadTokens,
					cacheWriteTokens: entry.tokens.cacheWriteTokens,
					outputTokens: entry.tokens.outputTokens
				})),
				balance: wallet,
				unpriced: [...new Set(view.unpriced)]
			});
		}
		})), 'session-cost: session_cost tool');
}
