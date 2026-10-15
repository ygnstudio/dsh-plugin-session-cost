/**
 * Wallet ledger fold — the pure half of the account-decrease metric.
 *
 * The platform wallet is the only externally reported money figure available,
 * but it is an account-level balance, not a per-conversation charge. This fold
 * turns a sequence of wallet reads into the one number that is still meaningful:
 * how far the account has fallen while the plugin was watching, with top-ups
 * excluded.
 *
 * Semantics, in order of importance:
 * - `baseline` is fixed by the first readable total and never moves, so a later
 *   top-up cannot re-base the measurement.
 * - `floor` is the lowest total observed so far. The reported decrease is
 *   `baseline - floor`, which is the total spend across the window regardless of
 *   top-ups mixed into it.
 * - A mixed-currency account exposes no single comparable total, so both fields
 *   become null and consumers show no delta rather than a wrong one.
 *
 * @module dsh-plugin-session-cost/wallet-ledger
 */

/**
 * Sum one wallet read's totals.
 * @param state - a wallet read: `{ wallets, bonusWallets }`.
 * @returns a map of currency to summed amount, skipping unparseable balances.
 */
function totalsOf(state) {
	const totals = new Map();
	for (const wallet of [...(state.wallets ?? []), ...(state.bonusWallets ?? [])]) {
		const amount = Number(wallet?.balance);
		if (!Number.isFinite(amount)) continue;
		const currency = typeof wallet.currency === 'string' ? wallet.currency : 'CNY';
		totals.set(currency, (totals.get(currency) ?? 0) + amount);
	}
	return totals;
}

/**
 * Fold one wallet read into the running ledger.
 *
 * @param next - a fresh wallet read, with `status` and both wallet lists.
 * @param previous - the ledger carried over from the previous read.
 * @returns the read plus `baseline`, `floor`, and the time the floor was set.
 */
export function foldWalletLedger(next, previous) {
	const carried = { baseline: previous.baseline, floor: previous.floor, floorAt: previous.floorAt };
	if (next.status !== 'ready') return { ...next, ...carried };
	const totals = totalsOf(next);
	if (totals.size !== 1) return { ...next, baseline: null, floor: null, floorAt: 0 };
	const total = [...totals.values()][0];
	const baseline = previous.baseline ?? total;
	const floor = previous.floor ?? total;
	const lowered = total < floor;
	return {
		...next,
		baseline,
		floor: lowered ? total : floor,
		floorAt: lowered ? Date.now() : previous.floorAt
	};
}

/**
 * The decrease the ledger reports.
 * @param state - a folded ledger state.
 * @returns the decrease in major units, or null when no comparison exists.
 */
export function ledgerDecrease(state) {
	if (state === null || state === undefined) return null;
	if (state.baseline === null || state.floor === null) return null;
	return Math.max(0, state.baseline - state.floor);
}
