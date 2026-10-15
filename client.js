/**
 * Session cost & balance pill — Web client half.
 *
 * Renders one compact pill beside the host's own composer stats: what this
 * session has cost so far, and what the signed-in account has left. Both values
 * arrive from the Host as session projections, so this module computes no
 * session data of its own and adds no request path.
 *
 * @module dsh-plugin-session-cost/client
 */

window.__ModuleLoader__.load({
	id: 'dsh-plugin-session-cost',
	factory(require) {
		// Only the platform seed table is requireable here: React and the JSX
		// runtime. Requiring a harness client package would tie this entry to a
		// build this file cannot check.
		const React = require('react');
		const h = React.createElement;

		const CSS = [
			'.dshScWrap{min-width:0;display:inline-flex;position:relative}',
			'.dshScPill{box-sizing:border-box;corner-shape:round;max-width:100%;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;font-variant-numeric:tabular-nums;white-space:nowrap;background:0 0;border:none;border-radius:999px;align-items:center;gap:4px;padding:0 6px;display:inline-flex;cursor:pointer}',
			'.dshScPill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
			'.dshScValue{text-overflow:ellipsis;min-width:0;overflow:hidden}',
			'.dshScDim{color:inherit;opacity:.8}',
			'.dshScPanel{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);z-index:40;width:360px;max-height:min(560px,70vh);overflow-y:auto;box-sizing:border-box;padding:12px 14px;text-align:left;white-space:normal;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);box-shadow:var(--dsw-elevation-panel);font-size:12px;line-height:18px;display:flex;flex-direction:column;gap:5px;cursor:default}',
			'.dshScRow{display:flex;justify-content:space-between;gap:16px}',
			'.dshScKey{color:var(--dsw-alias-label-tertiary)}',
			'.dshScGrid{display:grid;grid-template-columns:1fr 1fr;gap:7px 14px}',
			'.dshScStat{display:flex;flex-direction:column;min-width:0}',
			'.dshScStatKey{font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary)}',
			'.dshScStatVal{font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.dshScSep{border-top:.5px solid var(--dsw-alias-separator-primary);margin:3px 0 1px}',
			'.dshScNote{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
			'.dshScHero{display:flex;flex-direction:column;gap:1px;padding-bottom:2px}',
			'.dshScHeroTop{display:flex;flex-direction:column;align-items:flex-start;gap:0}',
			'.dshScHeroLabel{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
			'.dshScHeroValue{font-size:22px;line-height:26px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.01em}',
			'.dshScHeroSub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
			'.dshScSec{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);padding-top:3px}',
			'.dshScBalance{font-size:15px;line-height:20px;font-weight:600;font-variant-numeric:tabular-nums}',
			'.dshScLegend{display:inline-flex;align-items:center;gap:6px;min-width:0;overflow:hidden;text-overflow:ellipsis}',
			'.dshScChip{flex:none;width:8px;height:8px;border-radius:2px;display:inline-block}',
			'.dshScWarn{color:#c62828!important}',
			'.dshScWarnRow{color:#c62828;font-size:11px;line-height:16px}',
			'@keyframes dshScWarnPulse{0%,100%{background:rgba(198,40,40,0);box-shadow:0 0 0 0 rgba(198,40,40,0)}50%{background:rgba(198,40,40,.16);box-shadow:0 0 0 5px rgba(198,40,40,.10)}}',
			'.dshScPill.dshScWarn{animation:dshScWarnPulse 1.6s ease-in-out infinite}',
		'.dshScTable{display:grid;gap:0;width:max-content;margin:0 auto;font-size:11.5px;font-variant-numeric:tabular-nums;white-space:nowrap}',
		'.dshScTableHead{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary);text-align:center;padding:3px 6px;background:var(--dsw-alias-fill-tertiary,rgba(127,127,127,.12))}',
		'.dshScTableHead:first-child{border-top-left-radius:6px;border-bottom-left-radius:6px}',
		'.dshScTableHeadR{border-top-right-radius:6px;border-bottom-right-radius:6px}',
		'.dshScTableCell{text-align:center;padding:2px 6px}',
		'.dshScTableName{white-space:nowrap;text-align:center;padding:1px 6px}',
		'.dshScTableBand{background:var(--dsw-alias-fill-tertiary,rgba(127,127,127,.07))}',
		'.dshScTableBandL{border-top-left-radius:6px;border-bottom-left-radius:6px}',
		'.dshScTableBandR{border-top-right-radius:6px;border-bottom-right-radius:6px}',
			'.dshScTableSub{font-size:11px;color:var(--dsw-alias-label-tertiary)}',
			'.dshScLink{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;text-decoration:underline;text-underline-offset:2px;cursor:pointer;background:0 0;border:none;padding:0;font:inherit}',
			'.dshScLink:hover{color:var(--dsw-alias-label-secondary)}',
		'.dshScLink:active{transform:translateY(.5px)}',
		'.dshScPanel{scrollbar-width:none}',
		'.dshScPanel::-webkit-scrollbar{width:6px;background:transparent}',
		'.dshScPanel::-webkit-scrollbar-thumb{background:transparent;border-radius:3px}',
		'.dshScPanel:hover::-webkit-scrollbar-thumb,.dshScPanel.dshScScroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-fill-tertiary,rgba(127,127,127,.4))}',
		'.dshScTableNow{color:var(--dsw-alias-label-primary);font-weight:500}',
		'.dshScSecRow{display:flex;justify-content:flex-start;align-items:baseline;gap:8px}',
		'.dshScNow{flex:none;font-style:normal;font-size:10px;line-height:14px;color:#409cff;background:rgba(64,156,255,.14);border-radius:999px;padding:0 6px;white-space:nowrap}',
		'.dshScStep{display:inline-flex;align-items:center;gap:6px}',
		'.dshScStepBtn{width:14px;height:14px;border:none;border-radius:999px;padding:0;font-size:10px;line-height:14px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-fill-tertiary,rgba(127,127,127,.12));cursor:pointer}',
		'.dshScStepBtn:hover{color:var(--dsw-alias-label-primary)}',
		'.dshScStepBtn:active{transform:translateY(.5px)}',
		'.dshScStepVal{min-width:36px;text-align:center;font-variant-numeric:tabular-nums}',
            '.dshScSet{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;width:100%;max-width:560px;min-width:0;border:0;padding:4px 0 16px;margin:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}',
            '.dshScSetHead{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dshScSetTitle{font-size:15px;line-height:22px;font-weight:600}.dshScSetSub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin-top:4px}',
            '.dshScCard,.dshScAddP{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-fill-tertiary,rgba(127,127,127,.04));padding:12px}.dshScCardTop{display:flex;align-items:center;justify-content:space-between;gap:12px}.dshScName{display:block;font-size:13px;line-height:20px;font-weight:600}.dshScPtag,.dshScKeyTail{font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin-right:8px}.dshScKeyTail{font-variant-numeric:tabular-nums}',
            '.dshScOps{display:flex;gap:4px;flex:none;align-items:center}.dshScLinkB,.dshScDel{height:32px;min-height:0;border:0;border-radius:4px;background:transparent;padding:4px 6px;font:inherit;font-size:12px;line-height:20px;cursor:pointer;color:var(--dsw-alias-label-secondary)}.dshScLinkB:hover,.dshScDel:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshScDel:hover{color:var(--dsw-alias-label-danger,#c62828)}',
            '.dshScBal{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px;border-top:1px solid var(--dsw-alias-separator-primary);padding-top:10px}.dshScBal>div{min-width:0}.dshScBk{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}.dshScBv{font-size:14px;line-height:22px;font-variant-numeric:tabular-nums}.dshScBvR{color:var(--dsw-alias-label-danger,#c62828)}.dshScBvD{font-size:12px;color:var(--dsw-alias-label-secondary)}',
            '.dshScMeta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px;border-top:1px solid var(--dsw-alias-separator-primary);padding-top:8px}.dshScMi{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}.dshScWarnInput{box-sizing:border-box;width:48px;min-width:0;height:32px;padding:5px 4px;text-align:center;font:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
            '.dshScSw{position:relative;box-sizing:border-box;width:32px;height:32px;flex:none;border:0;padding:0;background:transparent;cursor:pointer}.dshScSw:before{content:"";position:absolute;width:28px;height:16px;top:8px;left:2px;border-radius:999px;background:var(--dsw-alias-border-l2)}.dshScSw:after{content:"";position:absolute;width:12px;height:12px;top:10px;left:4px;border-radius:50%;background:#fff;box-shadow:0 1px 2px #0002;transition:transform .12s}.dshScSwOn:before{background:var(--dsw-alias-brand-primary,#4d6bfe)}.dshScSwOn:after{transform:translateX(12px)}',
            '.dshScTxt,.dshScSel,.dshScBtn{box-sizing:border-box;height:32px;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:20px;padding:5px 8px}.dshScBtn{padding:5px 12px;cursor:pointer;flex:none}.dshScBtnP{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent;color:#fff}.dshScMono{font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px}',
            '.dshScAddP{display:flex;flex-direction:column;gap:8px}.dshScPh{font-size:13px;line-height:20px;font-weight:600}.dshScRow8{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dshScAddFields{display:grid;grid-template-columns:1fr 1fr}.dshScAddFields>*{width:100%}.dshScForm{display:flex;flex-direction:column;gap:8px;margin-top:10px;border-top:1px solid var(--dsw-alias-separator-primary);padding-top:10px}.dshScFl{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin-bottom:4px}',
            '.dshScTest{font-size:12px;line-height:18px;margin-right:auto;min-width:0;overflow-wrap:anywhere}.dshScTestOk{color:#259348}.dshScTestErr,.dshScError{color:var(--dsw-alias-label-danger,#c62828)}.dshScEmpty,.dshScStatus{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}.dshScSet button:disabled{opacity:.5;cursor:default}.dshScSet :focus-visible{outline:2px solid var(--dsw-alias-border-focus,#4d6bfe);outline-offset:1px}',
            '.dshScPanel{position:fixed;transform:none;inset:auto;margin:0;width:min(380px,calc(100vw - 24px));padding:18px;gap:8px;border-radius:12px;overscroll-behavior:contain;font-size:13px;line-height:20px;scrollbar-width:thin}.dshScHeroValue{font-size:28px;line-height:36px}.dshScHeroLabel{font-size:12px}.dshScSep{margin:7px 0}.dshScGrid{gap:10px 16px;grid-template-columns:minmax(0,1fr) auto}.dshScStatVal{white-space:normal;overflow:visible;text-overflow:clip}.dshScLegend{white-space:normal;overflow-wrap:anywhere}.dshScBalance{font-size:15px}',
            '.dshScPill{min-height:28px;padding:2px 6px}.dshScPill.dshScWarn{animation:none}.dshScNote{font-size:12px;line-height:18px}.dshScSecRow{width:100%;border:0;background:transparent;color:inherit;text-align:left;min-height:40px;padding:0;cursor:pointer}.dshScTable{width:100%;font-size:11px}.dshScTableName,.dshScTableCell,.dshScTableHead{white-space:normal;padding:4px}.dshScNow{font-size:10px}',
            '@media(prefers-reduced-motion:reduce){.dshScSw:after{transition:none}.dshScPill.dshScWarn{animation:none}}',

	].join('');

		/** Money text for the pill and the panel. */
		function money(value, currency) {
			const symbol = currency === 'USD' ? '$' : '\u00a5';
			if (value === 0) return symbol + '0.00';
		if (value < 0.01) return symbol + value.toFixed(4);
			if (value < 1) return symbol + value.toFixed(3);
			return symbol + value.toFixed(2);
		}

		/** Group whole tokens for the panel's figures. */
		/** One label/value row inside the panel. */
		function row(key, value) {
			return h('div', { className: 'dshScRow' }, h('span', { className: 'dshScKey' }, key), h('span', null, value));
		}

		/** One label-over-value cell in a two-column stat grid. */
		function stat(key, value, strong) {
			return h('div', { className: 'dshScStat', key },
				h('span', { className: 'dshScStatKey' }, key),
				h('span', { className: strong === true ? 'dshScStatVal dshScBalance' : 'dshScStatVal' }, value));
		}

		/**
		 * Shared extras fetched off the plugin's HTTP surface: the pricing file
		 * (thresholds, table date) and the cross-session ledger aggregates. Both
		 * are optional — without the webServer service the pill renders exactly
		 * what the projections carry, as before.
		 */
            const extras = { pricing: null, ledger: null, accounts: null, error: '' };
            const listeners = new Set();
            const pending = new Map();
            const checkedAt = new Map();
            const controllers = new Set();
            const notify = () => listeners.forEach((fn) => fn());
            async function request(url, options = {}) {
                const controller = new AbortController(); controllers.add(controller);
                const timer = setTimeout(() => controller.abort(), 20_000);
                try {
                    const response = await fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
                        headers: { 'content-type': 'application/json', ...options.headers } });
                    const body = await response.json();
                    if (!response.ok || body?.ok === false) throw new Error(body?.error || 'HTTP ' + response.status);
                    return body;
                } finally { clearTimeout(timer); controllers.delete(controller); }
            }
            function loadExtra(key, force = false) {
                if (pending.has(key)) return pending.get(key);
                if (!force && extras[key] && Date.now() - (checkedAt.get(key) || 0) < 10_000) return Promise.resolve(extras[key]);
                const operation = request('/api/session-cost/' + key).then((data) => {
                    if (key === 'accounts' && extras.accounts && data.revision < extras.accounts.revision) return extras.accounts;
                    extras[key] = data; extras.error = ''; checkedAt.set(key, Date.now()); return data;
                }).catch((error) => { extras.error = error.name === 'AbortError' ? '查询超时，请重试' : error.message; throw error; })
                  .finally(() => { pending.delete(key); notify(); });
                pending.set(key, operation); return operation;
            }
            const loadPricing = (force) => loadExtra('pricing', force);
            const loadLedger = (force) => loadExtra('ledger', force);
            const loadAccounts = (force) => loadExtra('accounts', force);

		// ---- 多账号(accounts.js 的客户端镜像,逻辑与 settings.html 一致) ----
		function acctTitle(a, t) { return a.note || a.loginName || (a.keyTail ? 'key ··' + a.keyTail : t('panel.acctLocal')); }
		function acctAlarm(a) {
			const snap = a && a.snapshot;
			if (!snap || snap.status !== 'ok' || !Array.isArray(snap.items)) return null;
			if (a.kind === 'plan') {
				const th = typeof a.warnBelow === 'number' && a.warnBelow > 0 ? a.warnBelow : 10;
				return snap.items.find((it) => it.unit === '%' && typeof it.remaining === 'number' && it.remaining < th) || null;
			}
			if (typeof a.warnBelow !== 'number') return null;
			const p = snap.items.find((it) => it.primary) || snap.items[0];
			return p && typeof p.remaining === 'number' && Number.isFinite(p.remaining) && p.remaining < a.warnBelow ? p : null;
		}
		function acctFmt(it) {
			if (it.unit === '%') return Math.round(it.remaining) + '%';
			return (it.unit === 'CNY' ? '¥' : (it.unit || '') + ' ') + Number(it.remaining).toFixed(2);
		}

		/**
		 * One composer-dock pill: this session's cost, then the account balance.
		 * The headline is always the session figure — the wallet delta is
		 * account-level and would mislead as a per-session number.
		 * @param props - the slot's hooks; `t` is bound by the entry's locale.
		 */
		function CostPill({ useProjection, t }) {
			const cost = useProjection('sessionCost');
		const [open, setOpen] = React.useState(false);
		const [, force] = React.useState(0);
		const [pricingOpen, setPricingOpen] = React.useState(false);
		// Click-to-open: hover never opens the panel. While it is open, a
		// mousedown outside the wrap or Esc closes it.
		const wrapRef = React.useRef(null);
		const panelRef = React.useRef(null);
		const scrollTimer = React.useRef(null);
		React.useEffect(() => {
			if (!open) return undefined;
			const onDown = (event) => {
				if (wrapRef.current !== null && !wrapRef.current.contains(event.target)) setOpen(false);
			};
			const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
			document.addEventListener('mousedown', onDown, true);
			document.addEventListener('keydown', onKey);
			return () => {
				document.removeEventListener('mousedown', onDown, true);
				document.removeEventListener('keydown', onKey);
			};
		}, [open]);
		// Auto-hiding scrollbar: visible while scrolling, gone 400ms after.
		const onPanelScroll = () => {
			const el = panelRef.current;
			if (el === null) return;
			el.classList.add('dshScScroll');
			if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
			scrollTimer.current = setTimeout(() => { scrollTimer.current = null; el.classList.remove('dshScScroll'); }, 400);
		};
		React.useEffect(() => () => {
			if (scrollTimer.current !== null) clearTimeout(scrollTimer.current);
		}, []);

                React.useEffect(() => {
                    if (!open) return;
                    void loadLedger().catch(() => {});
                    void loadAccounts().catch(() => {});
                    void loadPricing().catch(() => {});
                }, [open]);
                React.useEffect(() => {
                    const update = () => force((n) => n + 1);
                    listeners.add(update);
                    void loadAccounts().catch(() => {});
                    const id = setInterval(() => { if (!document.hidden) void loadAccounts(true).catch(() => {}); }, 60_000);
                    return () => { clearInterval(id); listeners.delete(update); };
                }, []);
                React.useLayoutEffect(() => {
                    if (!open) return;
                    const surface = panelRef.current;
                    // Native top layer avoids clipping and transformed ancestors in the host composer.
                    surface?.showPopover?.();
                    const place = () => {
                        if (!panelRef.current || !wrapRef.current) return;
                        const rect = wrapRef.current.getBoundingClientRect();
                        const panel = panelRef.current;
                        const width = Math.min(380, window.innerWidth - 24);
                        panel.style.left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12)) + 'px';
                        panel.style.bottom = Math.max(12, window.innerHeight - rect.top + 8) + 'px';
                        panel.style.maxHeight = Math.max(100, Math.min(560, rect.top - 20)) + 'px';
                    };
                    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
                    return () => { surface?.hidePopover?.(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
                }, [open]);

			const models = cost === undefined ? [] : cost.models;
			const total = cost === undefined ? 0 : cost.cost;
			const currency = cost === undefined ? 'CNY' : cost.currency;
			// Multi-account watch: the bound account follows the session's
			// provider; monitored accounts trail below it in the panel.
			const acctList = extras.accounts && Array.isArray(extras.accounts.accounts) ? extras.accounts.accounts : [];
			const currentProvider = cost?.current?.provider;
			// A single configured account is implicitly the current one; the
			// bind field only matters once a second account shows up.
			const currentAcct = acctList.find((a) => a.bindProviderId && a.bindProviderId === currentProvider)
				?? (acctList.length === 1 && (!acctList[0].bindProviderId || acctList[0].bindProviderId === currentProvider) ? acctList[0] : null);
			const watched = acctList.filter((a) => a.monitor === true && a !== currentAcct);
			const acctWarnedEntry = [currentAcct, ...watched].filter(Boolean)
				.map((a) => ({ account: a, item: acctAlarm(a) }))
				.find((x) => x.item !== null) ?? null;
			const warned = acctWarnedEntry !== null;
			const acctWarnKey = acctWarnedEntry === null ? '' : acctWarnedEntry.account.id + ':' + acctWarnedEntry.item.label;
			// System notification on the safe→warned edge only, once per crossing.
			const warnedRef = React.useRef(null);
			React.useEffect(() => {
				const key = acctWarnKey;
				if (key !== '' && warnedRef.current !== key && typeof Notification !== 'undefined') {
					const body = t('panel.warnAcct', { name: acctTitle(acctWarnedEntry.account, t), value: acctFmt(acctWarnedEntry.item) });
					const fire = () => { try { new Notification(t('panel.warnSetting'), { body }); } catch { /* 系统拒绝时静默 */ } };
					if (Notification.permission === 'granted') fire();
				}
				warnedRef.current = key === '' ? null : key;
			}, [acctWarnKey]);

			// Keep the hook order and dock anchor stable while projections load.
			// Keep a stable component from the first render, including empty/loading states.

			const ledger = extras.ledger;
			// Model legend chips cycle through a small palette, the same role the
			// color squares play in the host's own context-usage popover.
			const CHIPS = ['#8e8e93', '#a05eb5', '#0a84ff', '#30b0c7', '#ff9f0a'];
			const legend = (entry, index) => [
				h('span', { key: 'n', className: 'dshScLegend' },
					h('i', { className: 'dshScChip', style: { background: CHIPS[index % CHIPS.length] } }),
					entry.name || entry.model
				),
				h('span', { key: 'v', className: 'dshScStatVal' }, entry.priced ? money(entry.cost, currency) : t('panel.unpriced'))
			];
		// Whether right now falls in the published peak window (Beijing time
		// weekdays 9:00-12:00 and 14:00-18:00), so the active tier is marked.
		const beijingNow = new Date(Date.now() + 8 * 3600_000);
		const bDay = beijingNow.getUTCDay();
		const bMin = beijingNow.getUTCHours() * 60 + beijingNow.getUTCMinutes();
		const peakNow = bDay !== 0 && bDay !== 6 && ((bMin >= 540 && bMin < 720) || (bMin >= 840 && bMin < 1080));
		// The official price table in the site's own orientation: one row per
		// billing item × tier, one column per model. The tier in effect right
		// now is highlighted; zebra bands group each item's two tiers.
		const pricingTable = () => {
			const prices = extras.pricing && extras.pricing.prices;
			if (prices === undefined || prices === null) return null;
			const entries = Object.entries(prices);
			if (entries.length === 0) return null;
			const num = (v) => (typeof v === 'number' ? String(v) : '—');
			const activeTier = peakNow ? 'peak' : 'idle';
			const items = [
				['cacheRead', t('price.itemCacheHit')],
				['input', t('price.itemInput')],
				['output', t('price.itemOutput')]
			];
			const cells = [h('span', { key: 'h0', className: 'dshScTableHead' }, t('price.item')),
				h('span', { key: 'h1', className: 'dshScTableHead' }, t('price.tier'))];
			entries.forEach(([key], index) => {
				const model = key.includes('/') ? key.slice(key.indexOf('/') + 1) : key;
				const last = index === entries.length - 1 ? ' dshScTableHeadR' : '';
				cells.push(h('span', { key: 'hm' + index, className: 'dshScTableHead' + last }, model));
			});
			items.forEach(([field, label]) => {
				['idle', 'peak'].forEach((tier) => {
					const now = tier === activeTier;
					const mark = now ? ' dshScTableNow' : '';
					// Zebra per row: peak rows carry the band, the official look;
					// item and tier are spelled out on every row, never folded.
					const stripe = tier === 'peak' ? ' dshScTableBand' : '';
					const stripeL = tier === 'peak' ? ' dshScTableBandL' : '';
					const stripeR = tier === 'peak' ? ' dshScTableBandR' : '';
					cells.push(h('span', { key: field + tier + 'i', className: 'dshScTableName' + mark + stripe + stripeL }, label));
					cells.push(h('span', { key: field + tier + 't', className: 'dshScTableCell' + mark + stripe },
						t(tier === 'idle' ? 'price.idle' : 'price.peak')));
					entries.forEach(([key, entry], modelIndex) => {
						const last = modelIndex === entries.length - 1 ? stripeR : '';
						cells.push(h('span', { key: field + tier + 'm' + modelIndex, className: 'dshScTableCell' + mark + stripe + last }, num(entry && entry[tier] && entry[tier][field])));
					});
				});
			});
			return h('div', { className: 'dshScTable', style: { gridTemplateColumns: '1fr auto' + ' auto'.repeat(entries.length) } }, cells);
		};

			const heroSub = cost === undefined || cost.callCount === 0 ? null : [
				t('panel.calls') + ' ' + cost.callCount,
			].filter(Boolean).join(' · ');
		const acctValue = (a) => {
			const snap = a.snapshot;
			if (snap === null || snap === undefined) return t('panel.acctWait');
			if (snap.status === 'auth_failed') return t('panel.acctDead');
			if (snap.status !== 'ok') return t('panel.acctFail');
			const primary = Array.isArray(snap.items) ? (snap.items.find((it) => it.primary) || snap.items[0]) : null;
			return primary ? acctFmt(primary) : t('panel.acctWait');
		};
		const acctPrimary = (a) => {
			const snap = a && a.snapshot;
			if (!snap || snap.status !== 'ok' || !Array.isArray(snap.items)) return null;
			return snap.items.find((it) => it.primary) || snap.items[0] || null;
		};
		const acctRow = (a, badge) => h('div', { key: (badge ? 'cur' : 'w') + a.id, className: 'dshScGrid' },
			h('span', { key: 'n', className: 'dshScLegend' }, acctTitle(a, t), badge ? h('i', { className: 'dshScNow', style: { marginLeft: '6px' } }, t('panel.acctCurrent')) : null),
			h('span', { key: 'v', className: acctAlarm(a) ? 'dshScStatVal dshScWarn' : 'dshScStatVal' }, acctValue(a))
		);
		const openSettings = () => {
			setOpen(false);
			pluginNav.openBundle('dsh-plugin-session-cost');
		};
		const acctSection = [
			h('div', { key: 'a-sep', className: 'dshScSep' }),
			h('div', { key: 'a-sec', className: 'dshScSec' }, t('panel.secAccount')),
			...(acctList.length === 0 ? [
				h('div', { key: 'a-empty', className: 'dshScNote' },
					h('button', { type: 'button', className: 'dshScLink', onClick: openSettings }, t('panel.acctEmpty')))
			] : [
				currentAcct === null
					? h('div', { key: 'a-none', className: 'dshScNote' }, t('panel.acctUnbound'))
					: acctRow(currentAcct, true),
				...watched.map((a) => acctRow(a, false)),
				h('div', { key: 'a-manage', className: 'dshScNote' },
					h('button', { type: 'button', className: 'dshScLink', onClick: openSettings }, t('panel.acctManage')))
			])
		];

		const panel = h('div', {
			className: 'dshScPanel',
			popover: 'manual',
			role: 'group',
			ref: panelRef,
			onScroll: onPanelScroll,
			'aria-label': t('panel.title')
		},
			h('div', { className: 'dshScHero' },
					h('div', { className: 'dshScHeroTop' },
						h('span', { className: 'dshScHeroLabel' }, t('panel.sessionCost')),
						h('span', { className: 'dshScHeroValue' }, money(total, currency))
					),
					heroSub === null ? null : h('div', { className: 'dshScHeroSub' }, heroSub)
				),
				h('div', { className: 'dshScSep' }),
				h('div', { className: 'dshScSec' }, t('panel.secModels')),
				h('div', { className: 'dshScGrid' }, models.map(legend)),
				acctSection,
				ledger === null ? null : h('div', { className: 'dshScSep' }),
				ledger === null ? null : h('div', { className: 'dshScSec' }, t('panel.secTotals')),
				ledger === null ? null : h('div', { className: 'dshScGrid' },
					stat(t('panel.today'), money(ledger.today.cost, 'CNY') + ' · ' + t('panel.sessions', { count: ledger.today.sessions })),
					stat(t('panel.week'), money(ledger.week.cost, 'CNY') + ' · ' + t('panel.sessions', { count: ledger.week.sessions }))
				),
				h('div', { className: 'dshScSep' }),
			h('button', { type: 'button', className: 'dshScSecRow', 'aria-expanded': pricingOpen, onClick: () => setPricingOpen((value) => !value) },
				h('span', { className: 'dshScSec' }, (pricingOpen ? '▾ ' : '▸ ') + t('panel.secPricing', {
					value: extras.pricing && extras.pricing.updated ? extras.pricing.updated : t('panel.pricingBuiltinShort')
				})),
				h('i', { className: 'dshScNow' }, t(peakNow ? 'price.nowPeak' : 'price.nowIdle'))
			),
			pricingOpen ? h('div', { className: 'dshScNote' }, t('price.window')) : null,
			pricingOpen ? pricingTable() : null,
				h('div', { className: 'dshScNote' }, t('panel.note')),
            ledger?.legacyRows > 0 ? h('div', { className: 'dshScNote' }, t('panel.legacy')) : null,
            extras.error ? h('div', { className: 'dshScStatus dshScError', role: 'status' }, extras.error, h('button', { type: 'button', className: 'dshScLink', onClick: () => { void Promise.allSettled([loadAccounts(true), loadLedger(true), loadPricing(true)]); } }, t('set.retry'))) : null
			);

		return h('span', {
			className: 'dshScWrap',
			ref: wrapRef
		},
			h('button', {
				type: 'button',
				className: warned ? 'dshScPill dshScWarn' : 'dshScPill',
				'aria-expanded': open,
				onClick: () => setOpen((value) => !value)
			},
					h('span', { className: 'dshScDim' }, t('pill.cost') + ' '),
					h('span', { className: 'dshScValue' }, cost === undefined ? t('panel.pending') : money(total, currency)),
					currentAcct === null || acctPrimary(currentAcct) === null ? null : h('span', { className: 'dshScDim' }, ' · ' + (currentAcct.note || currentAcct.loginName ? acctTitle(currentAcct, t) + ' ' : '') + acctFmt(acctPrimary(currentAcct)))
				),
				open ? panel : null
			);
		}

		// ---- 设置区(settings.section 原生组件;数据全走 webServer 端点) ----
		const PROVIDER_HELP = {
			deepseek: '去 platform.deepseek.com → API keys 创建一个,粘贴到上面;也可直接从下方导入 dsh「模型」里已配置的 key;可分别看到充值/赠送余额',
			'deepseek-account': '使用 DSH 已登录的 DeepSeek 账号，显示充值余额、赠送余额与合计。',
			'cp-kimi': 'Kimi For Coding 套餐用户,到 kimi.com 控制台获取 API key;按 5 小时/周窗口显示剩余百分比',
			codex: '先在 Codex 完成登录，再点「测试连接」识别当前套餐与额度。',
			workbuddy: '无需 key。在 WorkBuddy 客户端登录过的账号会出现在「本机账号」里(含 WorkDaddy 备份的历史账号),选一个添加即可',
			codebuddy: '本机登录态读取开发中,暂未开放'
		};
		// dsh「模型」配置(credentials.yaml refs)里的可导入 key:按厂商名匹配引用名
		const IMPORT_TOKEN = { deepseek: 'DEEPSEEK', 'cp-kimi': 'KIMI' };
		const importableFor = (provider, keys) => {
			const token = IMPORT_TOKEN[provider];
			if (!token || !Array.isArray(keys)) return [];
			return keys.filter((k) => typeof k.ref === 'string' && k.ref.includes(token));
		};
		function EditForm({ a, t, logins, keys, onCancel, onSave, onTest }) {
			const [note, setNote] = React.useState(a.note || '');
			const [key, setKey] = React.useState('');
			const [importRef, setImportRef] = React.useState('');
			const [loginUid, setLoginUid] = React.useState(a.loginUid || '');
			const [bind, setBind] = React.useState(a.bindProviderId || '');
			const [res, setRes] = React.useState(null);
			const full = { width: '100%', boxSizing: 'border-box' };
			const providerLogins = Array.isArray(logins[a.provider]) ? logins[a.provider] : [];
			const imports = importableFor(a.provider, keys);
			const cred = () => ({ key: key.trim(), importRef: importRef || null, loginUid: loginUid || null });
			return h('div', { className: 'dshScForm' },
				h('div', null,
					h('div', { className: 'dshScFl' }, t('set.fNote')),
					h('input', { className: 'dshScTxt', style: full, value: note, placeholder: t('set.fNotePh'), onChange: (e) => setNote(e.target.value) })),
				a.authType === 'login'
					? providerLogins.length > 0
						? h('div', null,
							h('div', { className: 'dshScFl' }, t('set.fLogin')),
							h('select', { className: 'dshScSel', style: full, value: loginUid || providerLogins[0].uid, onChange: (e) => setLoginUid(e.target.value) },
								providerLogins.map((l) => h('option', { key: l.uid, value: l.uid }, (l.nickname || l.uid.slice(0, 8)) + (l.phone ? ' · ' + l.phone : '')))))
						: h('div', { className: 'dshScSetSub' }, t('set.loginAuto'))
					: h('div', null,
						h('div', { className: 'dshScFl' }, t('set.fKey')),
						imports.length > 0
							? h('select', { className: 'dshScSel', style: { ...full, marginBottom: '6px' }, value: importRef, onChange: (e) => setImportRef(e.target.value) },
								h('option', { value: '' }, t('set.importManual')),
								imports.map((k) => h('option', { key: k.ref, value: k.ref }, t('set.importRef', { ref: k.ref, tail: k.tail }))))
							: null,
						importRef === ''
							? h('input', { className: 'dshScTxt dshScMono', type: 'password', autoComplete: 'off', style: full, value: key, placeholder: 'sk-', onChange: (e) => setKey(e.target.value) })
							: null),
				h('div', null,
					h('div', { className: 'dshScFl' }, t('set.fBind')),
					h('input', { className: 'dshScTxt dshScMono', style: full, value: bind, placeholder: 'deepseek-official', onChange: (e) => setBind(e.target.value) })),
				h('div', { className: 'dshScRow8', style: { justifyContent: 'flex-end' } },
					h('span', { className: res === null ? 'dshScTest' : (res.ok ? 'dshScTest dshScTestOk' : 'dshScTest dshScTestErr') }, res === null ? '' : res.text),
					h('button', { type: 'button', className: 'dshScBtn', disabled: res?.pending, onClick: () => onTest(setRes, cred()) }, t('set.test')),
					h('button', { type: 'button', className: 'dshScBtn', onClick: onCancel }, t('set.cancel')),
					h('button', { type: 'button', className: 'dshScBtn dshScBtnP', onClick: () => onSave({ note: note.trim(), ...cred(), bindProviderId: bind.trim() || null }) }, t('set.save'))));
		}
        function SettingsApp({ t }) {
            const [data, setData] = React.useState(extras.accounts);
            const [logins, setLogins] = React.useState({});
            const [keys, setKeys] = React.useState([]);
            const [editing, setEditing] = React.useState(null);
            const [toast, setToast] = React.useState('');
            const [saving, setSaving] = React.useState(false);
            const [querying, setQuerying] = React.useState({});
            const savingRef = React.useRef(false);
            const scope = React.useRef(null);
            if (!scope.current) scope.current = new AbortController();
            const [addForm, setAddForm] = React.useState({ provider: '', note: '', key: '', loginUid: '', importRef: '' });
            const [addTest, setAddTest] = React.useState(null);
            const alive = () => !scope.current.signal.aborted;
            const say = (msg) => { if (alive()) setToast(msg); };
            const load = () => loadAccounts(true).then((d) => { if (alive()) setData(d); return d; });
            React.useEffect(() => {
                if (scope.current.signal.aborted) scope.current = new AbortController();
                const update = () => { if (alive() && extras.accounts) setData(extras.accounts); };
                listeners.add(update);
                void load().catch((e) => say(e.message));
                // Discovery can involve another app; it never gates the settings form.
                void request('/api/session-cost/accounts/local-logins', { signal: scope.current.signal }).then((d) => {
                    if (!alive()) return;
                    setLogins(d.logins || {}); setKeys(Array.isArray(d.keys) ? d.keys : []);
                }).catch(() => {});
                return () => { scope.current.abort(); listeners.delete(update); };
            }, []);
            const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
            const providers = Array.isArray(data?.providers) ? data.providers : [];
            const isLogin = (id) => providers.find((x) => x.id === id)?.auth === 'login';
            const save = async (next, revision = data?.revision) => {
                if (savingRef.current) return false;
                savingRef.current = true; setSaving(true); say(t('set.saving'));
                try {
                    const result = await request('/api/session-cost/accounts', { method: 'PUT', signal: scope.current.signal, body: JSON.stringify({ accounts: next, revision }) });
                    extras.accounts = { ...data, ...result }; checkedAt.set('accounts', Date.now()); notify();
                    say(t('set.saved')); return result;
                } catch (e) { say(e.message); return false; }
                finally { savingRef.current = false; if (alive()) setSaving(false); }
            };
            const mutate = (id, patch) => {
                const latest = extras.accounts || data;
                return save(latest.accounts.map((a) => a.id === id ? { ...a, ...patch } : a), latest.revision);
            };
            const runTest = async (provider, key, loginUid, setRes, importRef, accountId) => {
                setRes({ ok: false, text: t('set.testing'), pending: true });
                try {
                    await request('/api/session-cost/accounts/test', { method: 'POST', signal: scope.current.signal, body: JSON.stringify({ provider, key, loginUid: loginUid || null, importRef: importRef || null, accountId }) });
                    if (alive()) setRes({ ok: true, text: t('set.testOk') });
                } catch (e) { if (alive()) setRes({ ok: false, text: e.message }); }
            };
            const refreshOne = async (a) => {
                if (querying[a.id]) return;
                setQuerying((v) => ({ ...v, [a.id]: true }));
                try {
                    await request('/api/session-cost/accounts/query', { method: 'POST', signal: scope.current.signal, body: JSON.stringify({ id: a.id }) });
                    await load();
                } catch (e) { say(e.message); }
                finally { if (alive()) setQuerying((v) => ({ ...v, [a.id]: false })); }
            };
            const delOne = async (a) => {
                if (!window.confirm(t('set.delConfirm', { name: acctTitle(a, t) }))) return;
                const latest = extras.accounts || data;
                await save(latest.accounts.filter((x) => x.id !== a.id), latest.revision);
            };

			const resetText = (it) => (it.resetsAt ? new Date(it.resetsAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric' }) + ' ' + t('set.reset') : '');
			const balCol = (a, it, key) => {
				const th = a.kind === 'plan' ? (typeof a.warnBelow === 'number' && a.warnBelow > 0 ? a.warnBelow : 10) : null;
				const warned = a.kind === 'plan'
					? (typeof it.remaining === 'number' && it.remaining < th)
					: (typeof a.warnBelow === 'number' && it.primary === true && Number.isFinite(it.remaining) && it.remaining < a.warnBelow);
				const sub = [
					it.used !== null && it.used !== undefined ? t('set.used') + ' ' + acctFmt({ ...it, remaining: it.used }) : '',
					resetText(it)
				].filter(Boolean).join(' · ');
				return h('div', { key },
					h('div', { className: 'dshScBk' }, it.label),
					h('div', { className: warned ? 'dshScBv dshScBvR' : 'dshScBv' }, (a.kind === 'plan' ? t('set.left') + ' ' : '') + acctFmt(it)),
					sub !== '' ? h('div', { className: 'dshScBk' }, sub) : null);
			};
			const balCols = (a) => {
				const snap = a.snapshot;
				if (snap === null || snap === undefined) {
					return [h('div', { key: 'w' }, h('div', { className: 'dshScBk' }, t('set.wait')), h('div', { className: 'dshScBv dshScBvD' }, t('set.waitHint')))];
				}
				if (snap.status === 'auth_failed') {
					return [h('div', { key: 'd' },
						h('div', { className: 'dshScBk' }, t('set.lastQuery') + ' ' + new Date(snap.at).toLocaleTimeString('zh-CN')),
						h('div', { className: 'dshScBv dshScBvR' }, a.authType === 'login' ? t('set.deadLogin') : t('set.dead')))];
				}
				if (snap.status !== 'ok') {
					return [h('div', { key: 'e' }, h('div', { className: 'dshScBk' }, t('set.lastQuery')), h('div', { className: 'dshScBv dshScBvR' }, snap.error || t('set.fail')))];
				}
				const items = Array.isArray(snap.items) ? snap.items : [];
				if (a.kind === 'plan') {
					const fiveH = items.find((it) => /5\s*小时/i.test(it.label));
					const week = items.find((it) => /周/.test(it.label));
					const rest = items.filter((it) => it !== fiveH && it !== week);
					const cols = [];
					cols.push(fiveH !== undefined
						? balCol(a, fiveH, '5h')
						: h('div', { key: '5h' }, h('div', { className: 'dshScBk' }, t('set.win5h')), h('div', { className: 'dshScBv dshScBvD' }, t('set.noWindow'))));
					if (week !== undefined) cols.push(balCol(a, week, 'wk'));
					rest.forEach((it, i) => cols.push(balCol(a, it, 'r' + i)));
					if (snap.stale === true) cols.push(h('div', { key: 'st' }, h('div', { className: 'dshScBk', style: { color: '#c62828' } }, t('set.stale'))));
					return cols;
				}
				const cols = items.map((it, i) => balCol(a, it, 'i' + i));
				if (snap.stale === true) cols.push(h('div', { key: 'st' }, h('div', { className: 'dshScBk', style: { color: '#c62828' } }, t('set.stale'))));
				return cols;
			};
			const warnUnit = (a) => {
				if (a.kind === 'plan') return '%';
				const primary = a.snapshot && Array.isArray(a.snapshot.items) ? (a.snapshot.items.find((it) => it.primary) || a.snapshot.items[0]) : null;
				return primary && primary.unit && primary.unit !== 'CNY' ? primary.unit : '¥';
			};
			const keyChip = (a) => h('span', { className: 'dshScKeyTail' }, a.authType === 'login' ? (a.loginName || t('panel.acctLocal')) : 'sk-••••' + a.keyTail);
			const card = (a) => {
				const dead = a.snapshot !== null && a.snapshot !== undefined && a.snapshot.status === 'auth_failed';
				return h('div', { key: a.id, className: 'dshScCard', style: dead ? { opacity: 0.6 } : undefined },
					h('div', { className: 'dshScCardTop' },
						h('div', { style: { minWidth: 0 } }, h('span', { className: 'dshScName' }, acctTitle(a, t)), h('span', { className: 'dshScPtag' }, a.providerLabel), keyChip(a)),
						h('div', { className: 'dshScOps' },
							h('button', { type: 'button', className: 'dshScLinkB', disabled: querying[a.id], onClick: () => refreshOne(a) }, querying[a.id] ? t('set.refreshing') : t('set.refresh')),
							h('button', { type: 'button', className: 'dshScLinkB', onClick: () => setEditing(editing === a.id ? null : a.id) }, t('set.edit')),
							h('button', { type: 'button', className: 'dshScDel', onClick: () => delOne(a) }, t('set.del')))),
					h('div', { className: 'dshScBal' }, balCols(a)),
					h('div', { className: 'dshScMeta' },
						h('span', { className: 'dshScMi' }, t('set.warn') + ' ',
							h('input', {
								className: 'dshScWarnInput', defaultValue: typeof a.warnBelow === 'number' ? a.warnBelow : '',
								placeholder: a.kind === 'plan' ? '10' : t('panel.warnOff'), key: 'w' + a.id + String(a.warnBelow),
								onBlur: (e) => {
									const v = parseFloat(e.target.value);
									const next = a.kind === 'plan'
										? (Number.isFinite(v) && v >= 1 ? Math.min(100, v) : null)
										: (Number.isFinite(v) && v > 0 ? Math.min(500, v) : null);
									if (next !== a.warnBelow) void mutate(a.id, { warnBelow: next });
								}
							}), ' ' + warnUnit(a)),
						h('span', { className: 'dshScMi' }, t('set.polling') + ' ',
							h('button', { type: 'button', className: a.polling ? 'dshScSw dshScSwOn' : 'dshScSw', role: 'switch', 'aria-checked': a.polling, 'aria-label': t('set.polling'), onClick: () => void mutate(a.id, { polling: !a.polling }) })),
						h('span', { className: 'dshScMi' }, t('set.monitor') + ' ',
							h('button', { type: 'button', className: a.monitor ? 'dshScSw dshScSwOn' : 'dshScSw', role: 'switch', 'aria-checked': a.monitor, 'aria-label': t('set.monitor'), onClick: () => void mutate(a.id, { monitor: !a.monitor }) }))),
					editing === a.id
						? h(EditForm, {
							a, t, logins, keys,
							onCancel: () => setEditing(null),
							onSave: (patch) => {
								const merged = { note: patch.note, loginUid: patch.loginUid, bindProviderId: patch.bindProviderId };
								if (patch.key !== '') merged.key = patch.key;
								if (patch.importRef) merged.importRef = patch.importRef;
								void mutate(a.id, merged).then((ok) => { if (ok && alive()) setEditing(null); });
							},
							onTest: (setRes, cred) => runTest(a.provider, cred.key, cred.loginUid || a.loginUid, setRes, cred.importRef, a.id)
						})
						: null);
			};
			const addProvider = addForm.provider !== '' ? addForm.provider : (providers.length > 0 ? providers[0].id : '');
			const loginMode = addProvider !== '' && isLogin(addProvider);
			const addLogins = Array.isArray(logins[addProvider]) ? logins[addProvider] : [];
			const addImports = importableFor(addProvider, keys);
			const onAddTest = () => {
				if (!loginMode && addForm.key.trim() === '' && addForm.importRef === '') { say(t('set.needKey')); return; }
				runTest(addProvider, addForm.key.trim(), addForm.loginUid, setAddTest, addForm.importRef || null);
			};
			const onAdd = () => {
				if (!loginMode && addForm.key.trim() === '' && addForm.importRef === '') { say(t('set.needKey')); return; }
				const fresh = {
					id: '', provider: addProvider, note: addForm.note.trim(), key: loginMode ? '' : addForm.key.trim(),
					importRef: loginMode || addForm.importRef === '' ? null : addForm.importRef,
					loginUid: loginMode ? (addForm.loginUid || null) : null,
					warnBelow: 10, polling: true, monitor: false, bindProviderId: null
				};
                void save(accounts.concat([fresh])).then((result) => {
                    if (!result || !alive()) return;
                    setAddForm({ provider: addProvider, note: '', key: '', loginUid: '', importRef: '' });
                    setAddTest(null); say(t('set.added'));
                    const added = result.accounts.find((a) => !accounts.some((old) => old.id === a.id));
                    if (added) void refreshOne(added);
                });
			};
			if (data === null) return h('div', { className: 'dshScEmpty', role: 'status' }, toast || t('set.loading'), toast ? h('button', { type: 'button', className: 'dshScBtn', onClick: () => void load().catch((e) => say(e.message)) }, t('set.retry')) : null);
			return h('fieldset', { className: 'dshScSet', disabled: saving, 'aria-busy': saving },
				h('div', { className: 'dshScSetHead' },
					h('div', null,
						h('div', { className: 'dshScSetTitle' }, t('set.title')),
						h('div', { className: 'dshScSetSub' }, t('set.sub'))),
					h('button', {
						type: 'button', className: 'dshScBtn',
						onClick: () => {
							if (typeof Notification === 'undefined') { say(t('set.notifyNa')); return; }
							void Notification.requestPermission().then((p) => say(p === 'granted' ? t('set.notifyOn') : t('set.notifyOff')));
						}
					}, t('set.notify'))),
				accounts.length === 0 ? h('div', { className: 'dshScEmpty' }, t('set.empty')) : accounts.map(card),
				h('div', { className: 'dshScAddP' },
					h('div', { className: 'dshScPh' }, t('set.add')),
					h('div', { className: 'dshScRow8 dshScAddFields' },
						h('select', { className: 'dshScSel', 'aria-label': t('set.provider'), value: addProvider, onChange: (e) => setAddForm({ ...addForm, provider: e.target.value }) },
							providers.map((p) => h('option', { key: p.id, value: p.id }, p.label))),
						h('input', { className: 'dshScTxt', style: { flex: 1 }, 'aria-label': t('set.fNote'), value: addForm.note, placeholder: t('set.notePh'), onChange: (e) => setAddForm({ ...addForm, note: e.target.value }) })),
					loginMode
						? addLogins.length > 0
							? h('select', { className: 'dshScSel', value: addForm.loginUid || addLogins[0].uid, onChange: (e) => setAddForm({ ...addForm, loginUid: e.target.value }) },
								addLogins.map((l) => h('option', { key: l.uid, value: l.uid }, (l.nickname || l.uid.slice(0, 8)) + (l.phone ? ' · ' + l.phone : ''))))
							: h('div', { className: 'dshScSetSub' }, t('set.loginAuto'))
						: h('div', null,
							addImports.length > 0
								? h('select', { className: 'dshScSel', style: { marginBottom: '6px' }, value: addForm.importRef, onChange: (e) => setAddForm({ ...addForm, importRef: e.target.value }) },
									h('option', { value: '' }, t('set.importManual')),
									addImports.map((k) => h('option', { key: k.ref, value: k.ref }, t('set.importRef', { ref: k.ref, tail: k.tail }))))
								: null,
							addForm.importRef === ''
								? h('input', { className: 'dshScTxt dshScMono', type: 'password', autoComplete: 'off', style: { width: '100%' }, 'aria-label': 'API key', value: addForm.key, placeholder: t('set.keyPh'), onChange: (e) => setAddForm({ ...addForm, key: e.target.value }) })
								: null),
					PROVIDER_HELP[addProvider] !== undefined ? h('div', { className: 'dshScSetSub' }, PROVIDER_HELP[addProvider]) : null,
					h('div', { className: 'dshScRow8', style: { justifyContent: 'flex-end' } },
						h('span', { className: addTest === null ? 'dshScTest' : (addTest.ok ? 'dshScTest dshScTestOk' : 'dshScTest dshScTestErr') }, addTest === null ? '' : addTest.text),
						h('button', { type: 'button', className: 'dshScBtn', disabled: addTest?.pending, onClick: onAddTest }, t('set.test')),
						h('button', { type: 'button', className: 'dshScBtn dshScBtnP', onClick: onAdd }, t('set.addBtn')))),
				toast !== ''
					? h('div', { className: 'dshScStatus', role: 'status', 'aria-live': 'polite' }, toast, h('button', { type: 'button', className: 'dshScLink', onClick: () => void load().catch((e) => say(e.message)) }, t('set.retry')))
					: null);
		}

		/**
		 * Client plugin body: register the dictionaries, the pill styles, and the
		 * composer-dock entry that renders them.
		 * @param ctx - client root context.
		 */
		let pluginNav = null;
		function apply(ctx) {
			pluginNav = ctx.pluginNavigation ?? null;
			ctx.effect(() => {
				const tag = document.createElement('style');
				tag.dataset.plugin = 'dsh-plugin-session-cost';
				tag.textContent = CSS;
				document.head.appendChild(tag);
				return () => tag.remove();
			}, 'session-cost: styles');

			ctx.effect(() => ctx.locale.register('dsh-plugin-session-cost', {
				zh: {
					'pill.cost': '会话',
					'pill.balance': '余额',
					'panel.title': '\u672c\u4f1a\u8bdd\u82b1\u8d39',
					'panel.sessionCost': '\u672c\u4f1a\u8bdd\u82b1\u8d39',
					'panel.calls': '\u6a21\u578b\u8c03\u7528',
					'panel.balance': '\u8d26\u53f7\u4f59\u989d',
					'panel.balanceUnavailable': '\u4e0d\u53ef\u7528',
					'panel.unpriced': '\u672a\u5b9a\u4ef7',
					'panel.accountNow': '\u5f53\u524d\u4f59\u989d',
					'panel.warnSetting': '\u4f59\u989d\u9884\u8b66',
					'panel.warnOff': '\u5173',
					'panel.warnHint': '余额低于预警线时在面板提醒;每次调整 ¥5,范围 ¥0–500,¥0 为关闭。',
					'panel.acctCurrent': '最近调用账号',
					'panel.acctUnbound': '当前会话未匹配到账号,可在设置页给账号绑定供应商。',
					'panel.acctManage': '账号与预警在设置页管理 →',
				'panel.acctEmpty': '还没有账号,去设置页添加 →',
					'panel.acctDead': 'key 已失效',
					'panel.acctWait': '待查询',
					'panel.acctFail': '查询失败',
				'panel.acctLocal': '本机登录',
				'set.tab': '费用与账号',
				'set.title': '费用与账号',
				'set.sub': '管理余额、查询状态与提醒。后台每 5 分钟更新。',
				'set.notify': '开启系统通知',
				'set.notifyOn': '系统通知已开启',
				'set.notifyOff': '未授权,预警将只在面板内显示',
				'set.notifyNa': '当前环境不支持系统通知',
				'set.loading': '加载中…',
				'set.empty': '还没有账号,在下方添加。',
				'set.add': '添加账号',
				'set.notePh': '备注,如:公司报销',
				'set.keyPh': 'API key，保存在本机私有数据目录',
				'set.test': '测试连接',
				'set.testing': '测试中…',
				'set.testOk': '✓ 连接成功',
				'set.needKey': '请先填写 API key',
				'set.addBtn': '添加',
				'set.added': '已添加,首次查询将在数秒后自动进行',
				'set.refresh': '刷新',
				'set.refreshing': '查询中…',
				'set.edit': '编辑',
				'set.del': '删除',
				'set.save': '保存', 'set.saving': '保存中…',
				'set.cancel': '取消',
				'set.saved': '已保存',
				'set.delConfirm': '删除账号「{name}」?',
				'set.warn': '预警',
				'set.polling': '后台查询',
				'set.monitor': '面板监控',
				'set.wait': '尚未查询',
				'set.waitHint': '点「刷新」拉取',
				'set.dead': 'key 已失效',
				'set.deadLogin': '登录已失效',
				'set.lastQuery': '最近查询',
				'set.fail': '查询失败',
				'set.stale': '网络异常,显示上次成功值',
				'set.win5h': '5 小时窗口',
				'set.noWindow': '当前套餐无',
				'set.left': '剩',
				'set.used': '已用',
				'set.reset': '重置',
				'set.fNote': '备注',
				'set.fNotePh': '卡片显示名',
				'set.fKey': 'API key(留空不更换)',
				'set.fLogin': '本机账号',
				'set.noLogin': '未检测到本机登录',
				'set.loginAuto': '无需选择,自动读取本机登录态',
				'set.importManual': '手动填写 key',
				'set.importRef': '使用 DSH 凭据 · {ref}',
				'set.fBind': '跟随 provider id(留空时,单账号自动视为当前账户)',
					'panel.warnAcct': '{name} 剩余 {value},已低于预警线',
					'panel.spent': '\u5df2\u82b1 {value}',
					'panel.avgPerCall': '平均每次调用',
					'panel.today': '今日累计',
					'panel.week': '近 7 天累计',
					'panel.sessions': '{count} 个会话',
					'panel.warnBelow': '⚠️ 余额已低于预警线 {value}',
					'panel.pricingDate': '单价表日期：{value}',
					'panel.pricingBuiltinShort': '内置',
					'panel.secModels': '模型',
					'panel.secAccount': '账户',
					'panel.secTotals': '累计',
					'panel.secPricing': '价目表 · {value}',
				'price.item': '计费项',
				'price.tier': '时段',
				'price.itemCacheHit': '输入命中',
				'price.itemInput': '输入未命中',
				'price.itemOutput': '输出',
				'price.idle': '空闲',
				'price.peak': '高峰',
				'price.nowPeak': '高峰价生效中',
				'price.nowIdle': '空闲价生效中',
				'price.window': '北京时间：工作日 9:00–12:00、14:00–18:00 高峰；其余时段（含周末及法定节假日全天）空闲，半价。单位：元/百万 tokens',
					'panel.note': '依据主会话用量估算，不含自动命名等辅助调用；节假日按普通工作日估算。实际费用以供应商账单为准。',
                    'panel.legacy': '旧版账本存在无法确认归属的记录，已保留原文件；累计仅含本次升级后的已校验记录。',
                    'panel.pending': '等待用量', 'set.retry': '重试', 'set.provider': '服务提供商'
				},
				en: {
					'pill.cost': 'session',
					'pill.balance': 'balance',
					'panel.title': 'Session cost',
					'panel.sessionCost': 'This session',
					'panel.calls': 'Model calls',
					'panel.balance': 'Balance',
					'panel.balanceUnavailable': 'unavailable',
					'panel.unpriced': 'unpriced',
					'panel.accountNow': 'Balance now',
					'panel.warnSetting': 'Balance alert',
					'panel.warnOff': 'off',
					'panel.warnHint': 'Warns in this panel when the balance drops below the line; ±¥5 per step, ¥0–500, ¥0 disables.',
					'panel.acctCurrent': 'last used',
					'panel.acctUnbound': 'No account matched this session; bind a provider in the settings page.',
					'panel.acctManage': 'Manage accounts & alerts →',
				'panel.acctEmpty': 'No accounts yet, add one in settings →',
					'panel.acctDead': 'key expired',
					'panel.acctWait': 'pending',
					'panel.acctFail': 'query failed',
				'panel.acctLocal': 'local login',
				'set.tab': 'Cost & accounts',
				'set.title': 'Cost & accounts',
				'set.sub': 'Auto-refresh every 5 minutes; alerts below the line',
				'set.notify': 'Enable notifications',
				'set.notifyOn': 'Notifications enabled',
				'set.notifyOff': 'Not authorized; alerts stay in the panel',
				'set.notifyNa': 'Notifications unavailable here',
				'set.loading': 'Loading…',
				'set.empty': 'No accounts yet; add one below.',
				'set.add': 'Add account',
				'set.notePh': 'Note, e.g. Reimbursable',
				'set.keyPh': 'API key, stored locally, only the tail is shown',
				'set.test': 'Test',
				'set.testing': 'Testing…',
				'set.testOk': '✓ Connected',
				'set.needKey': 'Enter the API key first',
				'set.addBtn': 'Add',
				'set.added': 'Added; the first query runs in a few seconds',
				'set.refresh': 'Refresh',
				'set.refreshing': 'Querying…',
				'set.edit': 'Edit',
				'set.del': 'Delete',
				'set.save': 'Save', 'set.saving': 'Saving…',
				'set.cancel': 'Cancel',
				'set.saved': 'Saved',
				'set.delConfirm': 'Delete account "{name}"?',
				'set.warn': 'Alert',
				'set.polling': 'Background query',
				'set.monitor': 'Panel watch',
				'set.wait': 'Not queried yet',
				'set.waitHint': 'Click Refresh to fetch',
				'set.dead': 'key expired',
				'set.deadLogin': 'login expired',
				'set.lastQuery': 'Last query',
				'set.fail': 'query failed',
				'set.stale': 'Network error; showing last good values',
				'set.win5h': '5-hour window',
				'set.noWindow': 'Not in this plan',
				'set.left': 'left',
				'set.used': 'used',
				'set.reset': 'resets',
				'set.fNote': 'Note',
				'set.fNotePh': 'Card display name',
				'set.fKey': 'API key (leave blank to keep)',
				'set.fLogin': 'Local account',
				'set.noLogin': 'No local login detected',
				'set.loginAuto': 'Nothing to pick — the local login is read automatically',
				'set.importManual': 'Enter the key manually',
				'set.importRef': 'Use DSH credential · {ref}',
				'set.fBind': 'Follow provider id (a single account follows automatically)',
					'panel.warnAcct': '{name} is down to {value}, below the alert line',
					'panel.spent': 'spent {value}',
					'panel.avgPerCall': 'Average per call',
					'panel.today': 'Today',
					'panel.week': 'Last 7 days',
					'panel.sessions': '{count} sessions',
					'panel.warnBelow': '⚠️ Balance is below the warning line {value}',
					'panel.pricingDate': 'Price table dated: {value}',
					'panel.pricingBuiltinShort': 'built-in',
					'panel.secModels': 'Models',
					'panel.secAccount': 'Account',
					'panel.secTotals': 'Totals',
					'panel.secPricing': 'Price list · {value}',
				'price.item': 'Item',
				'price.tier': 'Hours',
				'price.itemCacheHit': 'Input · hit',
				'price.itemInput': 'Input · miss',
				'price.itemOutput': 'Output',
				'price.idle': 'idle',
				'price.peak': 'peak',
				'price.nowPeak': 'peak rates apply',
				'price.nowIdle': 'off-peak rates apply',
				'price.window': 'Beijing time: peak weekdays 9:00-12:00 & 14:00-18:00; off-peak (incl. weekends) at half price. Unit: yuan / 1M tokens',
					'panel.note': 'Main conversation usage only; excludes auxiliary calls such as titles. Public holidays use the regular weekday estimate. Refer to provider invoices.',
                    'panel.legacy': 'Legacy records are preserved but excluded from verified totals.',
                    'panel.pending': 'Awaiting usage', 'set.retry': 'Retry', 'set.provider': 'Provider'
				}
			}), 'session-cost: dictionaries');

			ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
				name: 'conversation.composer.dock',
				id: 'session-cost',
				order: 10,
				locale: 'dsh-plugin-session-cost'
			}, CostPill));

			// Settings surface: native component in the dsh settings shell (⌘,
			// sidebar) via the settings.section slot — the same home title-oil
			// uses. (plugins.detail.section was tried first: it renders only on
			// the plugin manager's detail pages and its subject shape differs per
			// page kind; the settings shell is where users actually look.)
			const SettingsSection = (props) => h(SettingsApp, { t: props.t });
			const tNav = ctx.locale.bind('dsh-plugin-session-cost');
			ctx.slots.inject('settings.section', () => ctx.slots.register({
				name: 'settings.section',
				id: 'session-cost',
				order: 80,
				label: () => tNav('set.tab'),
				locale: 'dsh-plugin-session-cost'
			}, SettingsSection));
			ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
				name: 'plugins.bundle.config', key: 'dsh-plugin-session-cost', locale: 'dsh-plugin-session-cost'
			}, SettingsSection));



			void loadPricing().catch(() => {});
            ctx.effect(() => () => { controllers.forEach((c) => c.abort()); controllers.clear(); listeners.clear(); }, 'session-cost: client requests');
		}

		// The loader unwraps a module-exports shape (default/apply/inject), the
		// same contract the shipped client bundles follow. Every ctx service the
		// body touches must appear in `inject` (locale + slots).
		const plugin = { inject: ['locale', 'slots', 'pluginNavigation'], apply };
		const module_ = { exports: {} };
		module_.exports.default = plugin;
		module_.exports.apply = apply;
		module_.exports.inject = plugin.inject;
		return module_.exports;
	}
});
