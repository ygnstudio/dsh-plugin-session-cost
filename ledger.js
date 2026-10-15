import { readFileSync, appendFileSync, statSync } from 'node:fs';

/** Per-session deltas with a cached read path and explicit legacy uncertainty. */
export function createLedger(path) {
	const seen = new Map();
	let cacheKey;
	let cached = [];
	const rows = () => {
		let stat;
		try { stat = statSync(path); }
		catch (error) { if (error.code === 'ENOENT') return []; throw error; }
		const key = `${stat.mtimeMs}:${stat.size}`;
		if (key !== cacheKey) {
			cached = readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
				try { return [JSON.parse(line)]; } catch { return [{ legacy: true }]; }
			});
			cacheKey = key;
		}
		return cached;
	};
	const valid = (row) => row.version === 2 && typeof row.session === 'string'
		&& row.session !== '[object Object]' && Number.isFinite(row.ts)
		&& Number.isFinite(row.cost) && row.cost >= 0;
	for (const row of rows().filter(valid)) {
		seen.set(row.session, { cost: row.total, calls: row.totalCalls });
	}
	return {
		prime(session, view) { seen.set(session.id, { cost: view.cost, calls: view.callCount }); },
		has(session) { return seen.has(session.id); },
		append(session, view, at = Date.now()) {
			if (typeof session.id !== 'string') throw new TypeError('Session.id required');
			const last = seen.get(session.id) ?? { cost: 0, calls: 0 };
			const cost = Math.max(0, view.cost - last.cost);
			const calls = Math.max(0, view.callCount - last.calls);
			if (cost === 0 && calls === 0) return;
			const row = { version: 2, ts: at, session: session.id, cost, calls, total: view.cost, totalCalls: view.callCount, currency: view.currency };
			appendFileSync(path, JSON.stringify(row) + '\n', { mode: 0o600 });
			// Advance only after durable write; a failed write remains retryable.
			seen.set(session.id, { cost: view.cost, calls: view.callCount });
			cacheKey = undefined;
		},
		read(now = Date.now()) {
			const all = rows();
			const accepted = all.filter(valid);
			const day = new Date(now); day.setHours(0, 0, 0, 0);
			const sum = (since) => {
				const selected = accepted.filter((r) => r.ts >= since && r.ts <= now && r.currency === 'CNY');
				return { cost: selected.reduce((s, r) => s + r.cost, 0), calls: selected.reduce((s, r) => s + r.calls, 0), sessions: new Set(selected.map((r) => r.session)).size };
			};
			return { rows: accepted.slice(-200), today: sum(day.getTime()), week: sum(day.getTime() - 6 * 86_400_000), legacyRows: all.length - accepted.length };
		}
	};
}
