/**
 * Session cost fold — the pure half of the cost projection.
 *
 * Turns the durable session log into per-model billed token totals and the cost
 * of those tokens, priced from a table rather than from any provider-reported
 * money figure (the harness records no per-call price). Nothing here touches a
 * service, the clock, or the filesystem, so the whole billing rule is testable
 * as a pure function.
 *
 * The fold reproduces the harness's own accounting: a repeated `(turn, step)`
 * settlement REPLACES the previous sample instead of adding to it, and
 * `llm/retry-started` closes the replacement slot so a retried attempt bills
 * again. Token totals therefore agree exactly with the `tokenUsage` projection
 * the rest of the UI reads.
 *
 * @module dsh-plugin-session-cost/cost-fold
 */

/**
 * Built-in prices in CNY per million tokens.
 *
 * `peak` is the published high-season rate; `idle` defaults to exactly half of
 * `peak`, which is the provider's own rule. Peak hours are Beijing time
 * Monday-Friday 09:00-12:00 and 14:00-18:00; everything else is idle.
 */
export const BUILTIN_PRICES = {
	deepseek: {
		'deepseek-flash': { peak: { input: 2, output: 8, cacheRead: 0.04 } },
		'deepseek-v4-pro': { peak: { input: 9, output: 27, cacheRead: 0.3 } }
	}
};

/** Providers whose models share that published price list. */
const PROVIDER_ALIASES = {
	'deepseek-account': 'deepseek',
	'deepseek-api-key': 'deepseek',
	'deepseek-official': 'deepseek'
};

/**
 * Fixed-point scale for stored cost: one unit is 1e-9 of the price table's
 * currency. Prices are quoted per million tokens, so billing a partly cached
 * call lands far below one cent; nanounits keep that arithmetic exact in an
 * integer and only round at the edge of display.
 */
export const NANO = 1e9;

/** Tokens per million: the unit every published model price uses. */
const TOKENS_PER_PRICE_UNIT = 1e6;

/** Rate fields a price entry may carry. */
const RATE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite'];

/** @returns the value when it is a non-negative integer, otherwise zero. */
export const whole = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

/** Empty token buckets. */
export const zeroBuckets = () => ({
	uncachedInputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0
});

/** @returns a detached copy of one token-bucket record. */
export function cleanBuckets(source) {
	return {
		uncachedInputTokens: whole(source?.uncachedInputTokens),
		outputTokens: whole(source?.outputTokens),
		cacheReadTokens: whole(source?.cacheReadTokens),
		cacheWriteTokens: whole(source?.cacheWriteTokens)
	};
}

/** Add two token bucket records. */
export function addBuckets(left, right) {
	return {
		uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
		outputTokens: left.outputTokens + right.outputTokens,
		cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
		cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens
	};
}

/** Subtract token buckets, treating a missing subtrahend as zero. */
export function subtractBuckets(left, right) {
	if (right === undefined) return left;
	return {
		uncachedInputTokens: left.uncachedInputTokens - right.uncachedInputTokens,
		outputTokens: left.outputTokens - right.outputTokens,
		cacheReadTokens: left.cacheReadTokens - right.cacheReadTokens,
		cacheWriteTokens: left.cacheWriteTokens - right.cacheWriteTokens
	};
}

/**
 * Whether one instant falls in the provider's peak billing window.
 * @param ms - epoch milliseconds of the billed call.
 * @returns true for Beijing-time Monday-Friday 09:00-12:00 and 14:00-18:00.
 *   The official rule also counts Chinese statutory holidays as idle all day;
 *   this function ships no holiday calendar, so a weekday holiday bills at
 *   the peak rate (a slight overestimate on those days).
 */
export function isPeakTime(ms) {
	const beijing = new Date(ms + 8 * 3600_000);
	const day = beijing.getUTCDay();
	if (day === 0 || day === 6) return false;
	const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
	return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60);
}

/**
 * Normalize one price entry.
 * @param entry - a bare peak rate map, or `{ peak, idle }`.
 * @returns peak and idle rate maps with every field defaulted to zero.
 */
export function normalizeEntry(entry) {
	const rates = (source) => {
		const out = {};
		for (const field of RATE_FIELDS) {
			const raw = source === undefined ? undefined : source[field];
			out[field] = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0;
		}
		return out;
	};
	const shifted = entry !== null && typeof entry === 'object' ? entry : {};
	const table = shifted.peak !== undefined || shifted.idle !== undefined ? shifted : { peak: shifted };
	const peak = rates(table.peak);
	return {
		peak,
		idle: table.idle === undefined
			? { input: peak.input / 2, output: peak.output / 2, cacheRead: peak.cacheRead / 2, cacheWrite: peak.cacheWrite / 2 }
			: rates(table.idle)
	};
}

/**
 * Resolve one model's rates.
 *
 * Lookup order is `provider/model`, then the provider alias, then the bare model
 * id, so a config key may be written as either `"deepseek/deepseek-flash"` or
 * just `"deepseek-flash"`.
 *
 * @param model - the routed provider and model id, or null before the first request.
 * @param overrides - configured `config.prices` entries.
 * @returns peak and idle rates, or undefined when the model is not priced.
 */
export function resolveRates(model, overrides) {
	if (model === null || model === undefined || model.model === '') return undefined;
	const provider = PROVIDER_ALIASES[model.provider] ?? model.provider;
	for (const key of [`${provider}/${model.model}`, `${model.provider}/${model.model}`, model.model]) {
		if (overrides[key] !== undefined) return normalizeEntry(overrides[key]);
	}
	const builtin = BUILTIN_PRICES[provider];
	if (builtin !== undefined && builtin[model.model] !== undefined) return normalizeEntry(builtin[model.model]);
	// A bare model id matches only an unknown provider. A different provider
	// serving a same-named model (a third-party API relaying "deepseek-flash",
	// say) publishes its own rates, so it stays unpriced rather than billing
	// at DeepSeek's table.
	if (provider === '') {
		for (const table of Object.values(BUILTIN_PRICES)) {
			if (table[model.model] !== undefined) return normalizeEntry(table[model.model]);
		}
	}
	return undefined;
}

/**
 * Price one usage sample.
 * @param buckets - the sample's token buckets.
 * @param rates - the resolved peak/idle rates for the routed model.
 * @param at - epoch milliseconds of the billed call.
 * @returns rounded cost in nanounits of the price table's currency.
 */
export function costOfSample(buckets, rates, at) {
	const window = isPeakTime(at) ? rates.peak : rates.idle;
	const perUnit = (tokens, rate) => (tokens * rate * NANO) / TOKENS_PER_PRICE_UNIT;
	return Math.round(
		perUnit(buckets.uncachedInputTokens, window.input)
		+ perUnit(buckets.outputTokens, window.output)
		+ perUnit(buckets.cacheReadTokens, window.cacheRead)
		+ perUnit(buckets.cacheWriteTokens, window.cacheWrite)
	);
}

/**
 * The token buckets one durable event reports, if any.
 *
 * Prefer the committed sample, otherwise use the last stream usage. Failed
 * attempts carry only the stream in DSH 0.2.0-rc.2. Never add both copies.
 *
 * @param event - a session event.
 * @returns the billed buckets, or undefined when the event carries no usage.
 */
export function usageBuckets(event) {
	const stream = event.data?.stream;
	const usage = event.data?.usage ?? (Array.isArray(stream)
		? stream.findLast((record) => record.type === 'chunk' && record.chunk?.type === 'usage')?.chunk.usage : undefined);
	if (usage === undefined || usage === null || typeof usage !== 'object') return undefined;
	return {
		uncachedInputTokens: whole(usage.inputTokens),
		outputTokens: whole(usage.outputTokens),
		cacheReadTokens: whole(usage.cacheReadTokens),
		cacheWriteTokens: whole(usage.cacheWriteTokens)
	};
}

/**
 * Fold one session event into the cost state.
 *
 * @param state - the previous fold state.
 * @param event - the next durable event.
 * @param prices - configured price overrides.
 * @returns the next state, or the same reference when the event is irrelevant.
 */
export function foldCost(state, event, prices) {
	switch (event.type) {
		// `request/context` is the only durable record of which route a request
		// took, so it is remembered here and read back on each usage sample.
		case 'request/context': {
			const provider = typeof event.data?.provider === 'string' ? event.data.provider : '';
			const model = typeof event.data?.model === 'string' ? event.data.model : '';
			if (provider === '' && model === '') return state;
			if (state.current !== null && state.current.provider === provider && state.current.model === model) return state;
			return { ...state, current: { provider, model } };
		}
		case 'llm/retry-started':
			// A retry closes the replacement slot: the retried attempt bills again
			// instead of superseding the attempt that already failed.
			return state.lastTurn === event.data.turn && state.lastStep === event.data.step
				? { ...state, lastTurn: -1, lastStep: -1 }
				: state;
		case 'assistant/message':
		case 'assistant/attempt': {
			const buckets = usageBuckets(event);
			if (buckets === undefined) return state;
			const { turn, step } = event.data;
			const current = state.current ?? { provider: '', model: '' };
			const rates = resolveRates(current, prices);
			const index = state.models.findIndex((entry) => entry.provider === current.provider && entry.model === current.model);
			const replacing = state.lastTurn === turn && state.lastStep === step && index !== -1;
			const previous = index === -1 ? undefined : state.models[index];
			const base = replacing
				? {
					...previous,
					nano: Math.max(0, previous.nano - (previous.lastNano ?? 0)),
					buckets: subtractBuckets(previous.buckets, previous.lastBuckets)
				}
				: previous ?? {
					provider: current.provider,
					model: current.model,
					name: current.model,
					priced: false,
					nano: 0,
					buckets: zeroBuckets()
				};
			const added = rates === undefined ? 0 : costOfSample(buckets, rates, event.time);
			const next = {
				...base,
				priced: rates !== undefined,
				nano: base.nano + added,
				buckets: addBuckets(base.buckets, buckets),
				lastNano: added,
				lastBuckets: buckets
			};
			const models = index === -1 ? [...state.models, next] : state.models.map((entry, at) => (at === index ? next : entry));
			return { ...state, models, calls: state.calls + (replacing ? 0 : 1), lastTurn: turn, lastStep: step };
		}
		default:
			return state;
	}
}

/**
 * Build the session-projection definition this plugin registers.
 *
 * The wire view carries finished money figures, so the client renders what the
 * Host computed instead of re-pricing tokens itself.
 *
 * @param config - the normalized plugin configuration.
 * @param schemas - the state and view validators the registry calls.
 * @param onTurnEnd - invoked when a turn ends, used to refresh the wallet.
 * @returns the definition to register on `ctx.sessionProjections`.
 */
export function costProjection(config, schemas) {
	return {
		key: 'sessionCost',
		stateVersion: 2,
		stateSchema: schemas.state,
		init: () => ({ models: [], calls: 0, lastTurn: -1, lastStep: -1, current: null }),
		apply: (state, event) => foldCost(state, event, config.prices),
		wire: {
			viewSchema: schemas.view,
			view: (state) => {
				const ratio = config.currency === 'USD' ? config.usdPerCny : 1;
				const models = state.models.map((entry) => ({
					provider: entry.provider,
					model: entry.model,
					name: entry.name,
					priced: entry.priced,
					cost: (entry.nano / NANO) * ratio,
					tokens: entry.buckets
				}));
				return {
					current: state.current,
					currency: config.currency,
					cost: models.reduce((total, entry) => total + entry.cost, 0),
					callCount: state.calls,
					unpriced: models.filter((entry) => !entry.priced).map((entry) => entry.model),
					models
				};
			}
		}
	};
}
