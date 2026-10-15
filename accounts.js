/**
 * Multi-account balance/quota watching: the data layer, the provider adapter
 * framework, and the first two adapters (DeepSeek balance, Kimi For Coding
 * plan). Channel specs absorbed from the open-source dsh-balance-inquiry
 * project (MIT) and trimmed to this plugin's needs.
 *
 * An account is `{ id, provider, key, note, warnBelow, polling, monitor,
 * bindProviderId, snapshot }`. The snapshot carries `items[]` so one account
 * can yield several readings (per-currency balances, per-window plan tiers):
 * `{ label, remaining, total, used, unit, resetsAt, primary }`.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { promisify } from 'node:util';
import { dataDir, atomicJson } from './runtime.js';

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const ACCOUNTS_PATH = join(dataDir('session-cost'), 'accounts.json');
const queryScope = new AsyncLocalStorage();
let runtime = {};
export function configureAccounts(next) { runtime = next; }
const querySignal = () => {
 const signal = queryScope.getStore()?.signal ?? runtime.signal;
 return signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
};

const REQUEST_TIMEOUT_MS = 15_000;
/** Transient failures keep the last good snapshot this long. */
const KEEP_LAST_GOOD_MS = 10 * 60_000;

function parseNum(value) {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
	return null;
}

async function getJson(url, key, extraHeaders) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...extraHeaders },
			signal: querySignal()
		});
		if (res.status === 401 || res.status === 403) return { auth: false };
		if (!res.ok) return { error: `HTTP ${res.status}` };
		try {
			return { body: await res.json() };
		} catch {
			return { error: '响应不是 JSON' };
		}
	} catch (error) {
		return { error: String((error && error.message) || error) };
	} finally {
		clearTimeout(timer);
	}
}

// ---- DeepSeek 官方余额：充值 / 赠送 / 合计（每个币种一组） ----
async function queryDeepseek(key) {
	const out = await getJson('https://api.deepseek.com/user/balance', key);
	if (out.auth === false) return { status: 'auth_failed', error: 'Authentication failed (401/403)' };
	if (out.error) return { status: 'error', error: out.error };
	const infos = Array.isArray(out.body?.balance_infos) ? out.body.balance_infos : [];
	if (infos.length === 0) return { status: 'error', error: "缺少字段 'balance_infos'" };
	const items = [];
	for (const info of infos) {
		const unit = typeof info?.currency === 'string' ? info.currency : 'CNY';
		const total = parseNum(info?.total_balance) ?? 0;
		const topped = parseNum(info?.topped_up_balance);
		const granted = parseNum(info?.granted_balance);
		if (topped !== null) items.push({ label: '充值余额', remaining: topped, total: null, used: null, unit, resetsAt: null, primary: false });
		if (granted !== null) items.push({ label: '赠送余额', remaining: granted, total: null, used: null, unit, resetsAt: null, primary: false });
		items.push({ label: unit === 'CNY' ? '合计' : `合计(${unit})`, remaining: total, total: null, used: null, unit, resetsAt: null, primary: true });
	}
	return { status: 'ok', items };
}

// ---- Kimi For Coding 套餐：5 小时窗口 + 周窗口用量百分比 ----
async function queryKimiCoding(key) {
	const out = await getJson('https://api.kimi.com/coding/v1/usages', key);
	if (out.auth === false) return { status: 'auth_failed', error: 'Authentication failed (401/403)' };
	if (out.error) return { status: 'error', error: out.error };
	const body = out.body ?? {};
	const items = [];
	const pushTier = (label, raw, primary) => {
		if (!raw || typeof raw !== 'object') return;
		const limit = parseNum(raw.limit) ?? 1;
		const remaining = parseNum(raw.remaining) ?? 0;
		const used = Math.max(limit - remaining, 0);
		const utilization = limit > 0 ? (used / limit) * 100 : 0;
		items.push({
			label, remaining: Math.max(100 - utilization, 0), total: 100, used: utilization,
			unit: '%', resetsAt: typeof raw.resetTime === 'string' ? raw.resetTime : null, primary
		});
	};
	const limits = Array.isArray(body.limits) ? body.limits : [];
	for (const entry of limits) pushTier('5 小时窗口', entry?.detail, items.length === 0);
	pushTier('周窗口', body.usage, items.length === 0);
	if (items.length === 0) return { status: 'error', error: "缺少字段 'limits/usage'" };
	if (!items.some((item) => item.primary)) items[0].primary = true;
	return { status: 'ok', items };
}

// ---- Codex 登录态:读本机 ~/.codex/auth.json,走 ChatGPT 后端用量接口 ----
// auth.json 由 codex CLI 登录写入(tokens.access_token / tokens.account_id)。
async function queryCodex() {
	const authPath = join(homedir(), '.codex', 'auth.json');
	let auth;
	try {
		auth = JSON.parse(readFileSync(authPath, 'utf8'));
	} catch {
		return { status: 'error', error: '未找到本机 Codex 登录(~/.codex/auth.json)' };
	}
	const token = auth?.tokens?.access_token;
	const accountId = auth?.tokens?.account_id;
	if (typeof token !== 'string' || token === '') return { status: 'auth_failed', error: '本机 Codex 登录缺少 access_token' };
	const out = await getJson('https://chatgpt.com/backend-api/wham/usage', token,
		accountId ? { 'ChatGPT-Account-Id': accountId } : {});
	if (out.auth === false) return { status: 'auth_failed', error: '登录态已过期,请重新登录 codex' };
	if (out.error) return { status: 'error', error: out.error };
	const limit = out.body?.rate_limit;
	const items = [];
	const pushWindow = (label, win, primary) => {
		if (!win || typeof win !== 'object') return;
		const usedPct = parseNum(win.used_percent);
		if (usedPct === null) return;
		items.push({
			label, remaining: Math.max(100 - usedPct, 0), total: 100, used: usedPct,
			unit: '%', resetsAt: typeof win.reset_at === 'number' ? new Date(win.reset_at * 1000).toISOString() : null, primary
		});
	};
	pushWindow('5 小时窗口', limit?.primary_window, true);
	pushWindow('周窗口', limit?.secondary_window, false);
	if (items.length === 0) return { status: 'error', error: "缺少字段 'rate_limit'" };
	return { status: 'ok', items };
}

// ---- WorkBuddy 登录态:读本机凭据文件,查官方积分余额 ----
// 凭据: <AppSupport>/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop[-ai].info
// 5.6+ 的 token 字段是 $wbEncrypted 信封(AES-256-GCM);取钥借 WorkBuddy 自带
// Electron 的原生绑定(ELECTRON_RUN_AS_NODE=1 子进程),密钥只走管道、不落盘。
// WorkBuddy 兼容逻辑改编自 WorkDaddy scripts/lib.js (AGPL-3.0-or-later)。
// Copyright (C) 2024-2026 WorkDaddy Contributors; 2026 ygnstudio.
// 变更：异步取钥、超时与取消、缓存、DSH 多账号集成。见 THIRD_PARTY_NOTICES.md。
import { execFile } from 'node:child_process';
const execFileAsync = promisify(execFile);
import { createHash, createDecipheriv } from 'node:crypto';

const WB_AUTH_CANDIDATES = [
	['https://www.workbuddy.cn', 'workbuddy-desktop.info'],
	['https://www.workbuddy.ai', 'workbuddy-desktop-ai.info']
];
const WB_EXE_CANDIDATES = [
	'/Applications/WorkBuddy.app/Contents/MacOS/Electron',
	join(homedir(), 'Applications', 'WorkBuddy.app', 'Contents', 'MacOS', 'Electron')
];
const wbKeyCache = { key: null, failAt: 0, pending: null };

async function wbStaticKey() {
	if (wbKeyCache.key) return wbKeyCache.key;
	if (wbKeyCache.failAt && Date.now() - wbKeyCache.failAt < 60_000) throw new Error('取钥暂不可用(60s 后重试)');
	const script = 'try{const b=process._linkedBinding("electron_browser_workbuddy_storage");const p=JSON.parse(b.loggerGet());if(p&&p.version===1&&typeof p.atRestSecretKey==="string"){const k=require("crypto").createHash("sha256").update(p.atRestSecretKey,"utf8").digest();process.stdout.write("WBKEY "+k.toString("base64")+"\\n");k.fill(0);process.exit(0)}process.exit(4)}catch(e){process.stderr.write(String(e&&e.message||e).slice(0,200));process.exit(3)}';
	if (wbKeyCache.pending) return wbKeyCache.pending;
	wbKeyCache.pending = (async () => {
		for (const exe of WB_EXE_CANDIDATES) {
			if (!existsSync(exe)) continue;
			try {
				const r = await execFileAsync(exe, ['-e', script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 5_000, maxBuffer: 8192, encoding: 'utf8', signal: querySignal() });
				const m = r.stdout.match(/WBKEY ([A-Za-z0-9+/=]+)/);
				if (m) { wbKeyCache.key = Buffer.from(m[1], 'base64'); wbKeyCache.failAt = 0; return wbKeyCache.key; }
			} catch { if (runtime.signal?.aborted) throw new Error('查询已取消'); }
		}
		wbKeyCache.failAt = Date.now();
		throw new Error('暂时无法读取 WorkBuddy 登录，请打开客户端后重试');
	})();
	try { return await wbKeyCache.pending; } finally { wbKeyCache.pending = null; }
}

function wbOpenEnvelope(value, key) {
	const env = JSON.parse(Buffer.from(value.envelope, 'base64').toString('utf8'));
	const lp = (s) => { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(4); l.writeUInt32BE(b.length); return Buffer.concat([l, b]); };
	const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
	const aad = Buffer.concat([
		Buffer.from('WB-AAD\0', 'ascii'), Buffer.from([1]), lp('WBEV1'), lp('sym-v1'),
		u32(env.suite || 1), lp(env.keyId || ''), Buffer.from([2]), Buffer.from([0]), Buffer.from([0])
	]);
	const d = createDecipheriv('aes-256-gcm', key, Buffer.from(env.nonce, 'base64'), { authTagLength: 16 });
	d.setAAD(aad);
	d.setAuthTag(Buffer.from(env.authTag, 'base64'));
	return Buffer.concat([d.update(Buffer.from(env.ciphertext, 'base64')), d.final()]).toString('utf8');
}

function wbFindAuth() {
	const root = join(homedir(), 'Library', 'Application Support', 'CodeBuddyExtension', 'Data', 'Public', 'auth');
	for (const [host, name] of WB_AUTH_CANDIDATES) {
		const file = join(root, name);
		if (!existsSync(file)) continue;
		try {
			const body = JSON.parse(readFileSync(file, 'utf8'));
			return { host, body };
		} catch { /* 损坏文件尝试下一个 */ }
	}
	return null;
}

// ---- 本机多账号枚举:WorkDaddy 备份目录(accounts/<uid>.info + meta.json 昵称)
// 优先,官方当前登录文件兜底 ----
const WD_DIR = join(homedir(), 'Library', 'Application Support', 'WorkDaddy');
async function wbDecryptField(v) {
	if (typeof v === 'string') return v;
	if (v?.$wbEncrypted === 1) { try { return wbOpenEnvelope(v, await wbStaticKey()); } catch { return null; } }
	return null;
}
function wbReadLoginFile(file) {
	try {
		const body = JSON.parse(readFileSync(file, 'utf8'));
		const uid = body?.account?.uid;
		return typeof uid === 'string' && uid ? { uid, body } : null;
	} catch { return null; }
}
export async function listWorkbuddyLogins() {
	const out = new Map();
	// WorkDaddy 备份(多账号)
	try {
		const meta = JSON.parse(readFileSync(join(WD_DIR, 'meta.json'), 'utf8'))?.accounts ?? {};
		const dir = join(WD_DIR, 'accounts');
		for (const name of readdirSync(dir)) {
			if (!name.endsWith('.info')) continue;
			const found = wbReadLoginFile(join(dir, name));
			if (!found) continue;
			const m = meta[found.uid] ?? {};
			const nickname = m.nickname || await wbDecryptField(found.body?.account?.nickname) || '';
			out.set(found.uid, { uid: found.uid, nickname, phone: typeof m.phone === 'string' ? m.phone : '', source: 'workdaddy' });
		}
	} catch { /* WorkDaddy 未安装或无备份 */ }
	// 官方当前登录(兜底,覆盖同名条目为 current)
	const current = wbFindAuth();
	if (current) {
		const uid = current.body?.account?.uid;
		if (typeof uid === 'string' && uid) {
			const prev = out.get(uid) ?? {};
			const nickname = prev.nickname || await wbDecryptField(current.body?.account?.nickname) || '';
			out.set(uid, { uid, nickname, phone: prev.phone || '', source: 'current' });
		}
	}
	const result = [...out.values()];
	loginNameCache.map = new Map(result.map((v) => [v.uid, v.nickname || v.phone || null]));
	loginNameCache.at = Date.now();
	return result;
}
function wbLoadAccountBody(loginUid) {
	if (loginUid && /^[A-Za-z0-9_-]+$/.test(loginUid)) {
		const backup = wbReadLoginFile(join(WD_DIR, 'accounts', `${loginUid}.info`));
		if (backup) return { host: 'https://www.workbuddy.cn', body: backup.body };
	}
	return wbFindAuth();
}

async function wbRefreshToken(auth, apiHost) {
	const refreshToken = await wbDecryptField(auth.refreshToken);
	if (!refreshToken) return null;
	try {
		const res = await fetch(`${apiHost}/v2/plugin/auth/token/refresh`, {
			method: 'POST',
			headers: { accept: 'application/json', 'content-type': 'application/json', 'X-Refresh-Token': refreshToken, authorization: `Bearer ${await wbDecryptField(auth.accessToken) || ''}` },
			body: '{}',
			signal: querySignal()
		});
		const payload = await res.json().catch(() => ({}));
		if (!res.ok || (typeof payload.code === 'number' && payload.code !== 0 && payload.code !== 200)) return null;
		const token = payload.data?.accessToken ?? payload.data?.access_token;
		return typeof token === 'string' && token ? token : null;
	} catch { return null; }
}

function wbFirstNumber(obj, fields) {
	for (const f of fields) {
		const raw = obj?.[f];
		if (raw === undefined || raw === null || raw === '') continue;
		const n = Number(raw);
		if (Number.isFinite(n)) return n;
	}
	return null;
}

async function queryWorkbuddy(_key, account) {
	const found = wbLoadAccountBody(account?.loginUid ?? null);
	if (!found) return { status: 'error', error: '未找到本机 WorkBuddy 登录(CodeBuddyExtension/auth)' };
	const { host, body } = found;
	const auth = body?.auth ?? {};
	let token = await wbDecryptField(auth.accessToken);
	if (!token) return { status: 'auth_failed', error: '本机 WorkBuddy 登录缺少 accessToken' };
	const domain = typeof auth.domain === 'string' ? auth.domain : '';
	const apiHost = /^(?:[a-z0-9-]+\.)*(?:workbuddy\.(?:cn|ai)|codebuddy\.(?:cn|ai))$/i.test(domain) ? `https://${domain}` : host;
	const expiresAt = Number(auth.expiresAt) || null;
	if (expiresAt !== null && expiresAt < Date.now()) {
		// 备份账号的官方客户端不会替它刷新,自己走 refresh 流程(仅内存用,不写回)
		const refreshExpiresAt = Number(auth.refreshExpiresAt) || null;
		if (refreshExpiresAt !== null && refreshExpiresAt < Date.now()) {
			return { status: 'auth_failed', error: '登录态已过期,请在 WorkBuddy 中重新登录该账号' };
		}
		token = await wbRefreshToken(auth, apiHost);
		if (!token) return { status: 'auth_failed', error: '登录态已过期且刷新失败,请打开 WorkBuddy 刷新登录' };
	}
	const now = new Date();
	const far = new Date(now.getTime()); far.setFullYear(far.getFullYear() + 101);
	const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	let res;
	try {
		res = await fetch(`${apiHost}/v2/billing/meter/get-user-resource`, {
			method: 'POST',
			headers: {
				accept: 'application/json, text/plain, */*', 'content-type': 'application/json',
				'x-client-platform': 'web', origin: apiHost, referer: `${apiHost}/profile/plans-usage`,
				authorization: `Bearer ${token}`
			},
			body: JSON.stringify({
				PageNumber: 1, PageSize: 100, ProductCode: 'p_tcaca', Status: [0, 3],
				PackageEndTimeRangeBegin: fmt(now), PackageEndTimeRangeEnd: fmt(far)
			}),
			signal: querySignal()
		});
	} catch (e) {
		return { status: 'error', error: String(e.message || e) };
	} finally {
		clearTimeout(timer);
	}
	if (res.status === 401 || res.status === 403) return { status: 'auth_failed', error: '登录身份已过期,请打开 WorkBuddy 刷新登录' };
	if (!res.ok) return { status: 'error', error: `HTTP ${res.status}` };
	let payload;
	try { payload = await res.json(); } catch { return { status: 'error', error: '响应不是 JSON' }; }
	if (payload.code !== 0 && payload.code !== undefined && payload.code !== null) {
		return { status: 'error', error: payload.msg || `code=${payload.code}` };
	}
	const data = payload.data?.Response?.Data ?? payload.data?.data?.Response?.Data ?? null;
	const accounts = Array.isArray(data?.Accounts) ? data.Accounts
		: Array.isArray(payload.data?.accounts) ? payload.data.accounts : [];
	if (accounts.length === 0) return { status: 'error', error: "缺少字段 'Accounts'" };
	// 收敛为充值/赠送/合计三档(与 DeepSeek 一致):运营/赠送/裂变/补偿/签到类
	// 属赠送,套餐本体(旗舰/专业/Pro 等)属充值;用尽(剩余 0)不计入。
	const granted = /赠送|裂变|补偿|运营|签到|奖励|活动/i;
	let topped = 0, grant = 0, grantReset = null;
	for (const a of accounts) {
		const remaining = wbFirstNumber(a, ['CycleCapacityRemainPrecise', 'CycleCapacityRemain', 'CapacityRemainPrecise', 'CapacityRemain']);
		if (remaining === null || remaining <= 0) continue;
		const label = ([a.PackageName, a.PackageTypeName, a.AccountName, a.ProductName, a.Name].find((x) => typeof x === 'string' && x.trim()) || '').trim();
		const end = [a.CycleEndTime, a.DeductionEndTime, a.PackageEndTime].find((x) => typeof x === 'string' && x.trim());
		if (granted.test(label)) {
			grant += remaining;
			if (end && (grantReset === null || end < grantReset)) grantReset = end;
		} else {
			topped += remaining;
		}
	}
	const items = [];
	items.push({ label: '充值余额', remaining: Number(topped.toFixed(2)), total: null, used: null, unit: '积分', resetsAt: null, primary: false });
	items.push({ label: '赠送余额', remaining: Number(grant.toFixed(2)), total: null, used: null, unit: '积分', resetsAt: grantReset ? grantReset.replace(' ', 'T') : null, primary: false });
	items.push({ label: '合计', remaining: Number((topped + grant).toFixed(2)), total: null, used: null, unit: '积分', resetsAt: null, primary: true });
	return { status: 'ok', items };
}

// DeepSeek login stays owned by the Host service. Legacy key-reference
// discovery below returns labels only; queries resolve refs through credentials.
const DSH_CREDENTIALS_PATH = join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml');
function dshReadCredentials() {
	try { return readFileSync(DSH_CREDENTIALS_PATH, 'utf8'); } catch { return null; }
}
/** dsh「模型」配置里已存的厂商 key(refs 区,如 FLOWIX_DSH_DEEPSEEK_API_KEY)。
 *  设置页「导入」用:列表只给引用名与尾号,真值由服务端在保存/测试时解析。 */
export function listDshKeys() {
	const text = dshReadCredentials();
	if (text === null) return [];
	const refs = text.match(/refs:\n((?: {2}\S+:\s*\S+\n?)+)/);
	if (refs === null) return [];
	const out = [];
	for (const line of refs[1].split('\n')) {
		const m = line.match(/^ {2}(\S+): *(\S+) *$/);
		if (m === null) continue;
		out.push({ ref: m[1], tail: m[2].slice(-4) });
	}
	return out;
}
export async function dshResolveKeyRef(ref) {
	if (typeof ref !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) return null;
	return (await runtime.credentials?.resolve(ref))?.value ?? null;
}

let dskProfileCache = { at: 0, name: null };
let dskProfileRead;
const deepseekMetadata = () => ({ version: '0.2.0-rc.2', locale: 'zh_CN', timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 });
function refreshDeepseekName() {
	if (Date.now() - dskProfileCache.at < 60_000) return Promise.resolve();
	if (dskProfileRead) return dskProfileRead;
	const signal = runtime.signal;
	dskProfileRead = Promise.resolve(runtime.deepseekAccount?.getProfile?.(deepseekMetadata())).then((profile) => {
		if (!signal?.aborted) dskProfileCache = { at: Date.now(), name: profile?.status === 'ready' ? profile.value?.name ?? null : null };
	}).catch(() => {}).finally(() => { dskProfileRead = undefined; });
	return dskProfileRead;
}
export async function listDeepseekLogins() {
	const state = await runtime.deepseekAccount?.getState();
	if (!state || state.status === 'signed-out') { dskProfileCache = { at: 0, name: null }; return []; }
	await refreshDeepseekName();
	return [{ uid: 'dsh-default', nickname: dskProfileCache.name || '', phone: '', source: 'dsh' }];
}
async function queryDeepseekAccount() {
	void refreshDeepseekName();
	const balance = await runtime.deepseekAccount?.getBalance(deepseekMetadata());
	if (!balance) return { status: 'auth_failed', error: '请先在 DSH 中登录 DeepSeek 账号' };
	if (balance.status !== 'ready') return { status: 'error', error: '余额暂不可用，请稍后重试' };
	const summary = { body: { normal_wallets: balance.value, bonus_wallets: balance.bonusWallets } };
	const sum = (wallets) => (Array.isArray(wallets) ? wallets : []).reduce((acc, w) => {
		const n = parseNum(w?.balance);
		if (n === null) return acc;
		const cur = typeof w?.currency === 'string' ? w.currency : 'CNY';
		acc.set(cur, (acc.get(cur) ?? 0) + n);
		return acc;
	}, new Map());
	const normal = sum(summary.body?.normal_wallets);
	const bonus = sum(summary.body?.bonus_wallets);
	const currencies = [...new Set([...normal.keys(), ...bonus.keys()])];
	if (currencies.length === 0) return { status: 'error', error: "缺少字段 'normal_wallets'" };
	const items = [];
	for (const cur of currencies) {
		const topped = normal.get(cur) ?? 0;
		const grantSum = bonus.get(cur) ?? 0;
		const tag = currencies.length > 1 ? ` ${cur}` : '';
		items.push({ label: `充值余额${tag}`, remaining: Number(topped.toFixed(2)), total: null, used: null, unit: cur, resetsAt: null, primary: false });
		items.push({ label: `赠送余额${tag}`, remaining: Number(grantSum.toFixed(2)), total: null, used: null, unit: cur, resetsAt: null, primary: false });
		items.push({ label: `合计${tag}`, remaining: Number((topped + grantSum).toFixed(2)), total: null, used: null, unit: cur, resetsAt: null, primary: true });
	}
	return { status: 'ok', items };
}

// ---- 本机登录态,端点核实中:先占位,探测到本地账号前如实报错 ----
const queryLocalPending = (name) => async () => ({ status: 'error', error: `${name} 本机登录态读取开发中` });

/** Provider registry. kind: balance 显示金额并参与预警线判定;plan 显示百分比,剩余 <10% 预警。
 *  auth: key 需 API key;login 读本机登录信息,无需 key。 */
export const ADAPTERS = {
	deepseek: { kind: 'balance', label: 'DeepSeek(API key)', auth: 'key', query: queryDeepseek },
	'deepseek-account': { kind: 'balance', label: 'DeepSeek 账号(登录态)', auth: 'login', query: queryDeepseekAccount },
	'cp-kimi': { kind: 'plan', label: 'Kimi For Coding', auth: 'key', query: queryKimiCoding },
	codex: { kind: 'plan', label: 'Codex(登录态)', auth: 'login', query: queryCodex },
	workbuddy: { kind: 'balance', label: 'WorkBuddy 积分(登录态)', auth: 'login', query: queryWorkbuddy },
	codebuddy: { kind: 'plan', label: 'CodeBuddy(登录态)', auth: 'login', query: queryLocalPending('CodeBuddy') }
};

export function readAccounts() {
	try {
		const body = JSON.parse(readFileSync(ACCOUNTS_PATH, 'utf8'));
		return { revision: Number.isSafeInteger(body?.revision) ? body.revision : 0, accounts: Array.isArray(body?.accounts) ? body.accounts : [] };
	} catch (error) {
		if (error.code === 'ENOENT') return { revision: 0, accounts: [] };
		throw new Error('账号文件无法读取，已保留原文件');
	}
}

export function writeAccounts(accounts, expectedRevision) {
	runtime.signal?.throwIfAborted();
	const current = readAccounts();
	if (expectedRevision !== undefined && expectedRevision !== current.revision) {
		throw Object.assign(new Error('账号已在其他窗口更新，请刷新后重试'), { status: 409 });
	}
	const revision = current.revision + 1;
	atomicJson(ACCOUNTS_PATH, { revision, accounts });
	return revision;
}

/** Strip secrets for panel/settings rendering: only the key tail survives. */
const loginNameCache = { at: 0, map: new Map() };
function loginNameFor(loginUid) {
	if (!loginUid) return null;
	if (loginUid === 'dsh-default') return dskProfileCache.name;

	return loginNameCache.map.get(loginUid) ?? null;
}
export function maskAccount(account) {
	const key = typeof account.key === 'string' ? account.key : '';
	return {
		id: account.id,
		provider: account.provider,
		providerLabel: ADAPTERS[account.provider]?.label ?? account.provider,
		kind: ADAPTERS[account.provider]?.kind ?? 'balance',
		authType: ADAPTERS[account.provider]?.auth ?? 'key',
		keyTail: key.length >= 4 ? key.slice(-4) : '',
		keyRef: account.keyRef || null,
		note: typeof account.note === 'string' ? account.note : '',
		warnBelow: typeof account.warnBelow === 'number' ? account.warnBelow : null,
		polling: account.polling !== false,
		monitor: account.monitor === true,
		bindProviderId: typeof account.bindProviderId === 'string' ? account.bindProviderId : null,
		loginUid: typeof account.loginUid === 'string' ? account.loginUid : null,
		loginName: loginNameFor(account.loginUid),
		snapshot: account.snapshot ?? null
	};
}

/**
 * Query one account and fold the outcome into its snapshot. Transient errors
 * keep the last good reading for KEEP_LAST_GOOD_MS (flagged stale); auth
 * failures replace it immediately so a dead key never shows stale money.
 */
export async function refreshAccount(account, options = {}) {
	const signal = options.signal ?? runtime.signal;
	signal?.throwIfAborted();
	const adapter = ADAPTERS[account.provider];
	const needsKey = adapter?.auth !== 'login';
	if (adapter === undefined || (needsKey && !account.key && !account.keyRef)) {
		account.snapshot = { at: Date.now(), status: 'error', error: '未知厂商或缺少 key', stale: false, items: [] };
		return account;
	}
	const key = account.keyRef ? await dshResolveKeyRef(account.keyRef) : account.key;
	const result = await queryScope.run({ signal }, () => adapter.query(key, account));
	signal?.throwIfAborted();
	if (result.status === 'ok') {
		account.snapshot = { at: Date.now(), status: 'ok', error: null, stale: false, items: result.items };
		return account;
	}
	const prev = account.snapshot;
	const keepable = result.status === 'error'
		&& prev?.status === 'ok' && typeof prev.at === 'number' && Date.now() - prev.at < KEEP_LAST_GOOD_MS;
	if (keepable) {
		account.snapshot = { ...prev, stale: true };
		return account;
	}
	account.snapshot = { at: Date.now(), status: result.status, error: result.error ?? '查询失败', stale: false, items: [] };
	return account;
}

const pendingReads = new Map();
const identity = (a) => JSON.stringify([a.provider, a.key || '', a.keyRef || '', a.loginUid || '']);

/** A delayed network result may change a reading, never the user's configuration. */
export async function refreshSavedAccount(id, options = {}) {
	const signal = options.signal ?? runtime.signal;
	signal?.throwIfAborted();
	const before = readAccounts().accounts.find((a) => a.id === id);
	if (!before) throw Object.assign(new Error('账号不存在'), { status: 404 });
	const signature = identity(before);
	const pendingKey = id + ':' + createHash('sha256').update(signature).digest('hex');
	if (pendingReads.has(pendingKey)) return pendingReads.get(pendingKey);
	const operation = (async () => {
		await refreshAccount(before, { signal });
		signal?.throwIfAborted();
		const latest = readAccounts();
		const current = latest.accounts.find((a) => a.id === id);
		if (!current || identity(current) !== signature) return current ?? null;
		current.snapshot = before.snapshot;
		// Snapshot updates do not invalidate configuration revisions.
		atomicJson(ACCOUNTS_PATH, latest);
		return current;
	})();
	pendingReads.set(pendingKey, operation);
	try { return await operation; } finally { pendingReads.delete(pendingKey); }
}

export async function refreshAllAccounts(options = {}) {
	const ids = readAccounts().accounts.filter((a) => a.polling !== false).map((a) => a.id);
	for (let i = 0; i < ids.length; i += 2) {
		(options.signal ?? runtime.signal)?.throwIfAborted();
		await Promise.allSettled(ids.slice(i, i + 2).map((id) => refreshSavedAccount(id, options)));
	}
}

export async function testAccount(provider, key, account = {}) {
	const adapter = Object.hasOwn(ADAPTERS, provider) ? ADAPTERS[provider] : null;
	if (!adapter) throw new Error('未知厂商');
	return queryScope.run({ signal: runtime.signal }, () => adapter.query(key, account));
}

/**
 * 预警判定:两种类型共用 warnBelow 一个阈值——余额型单位 ¥,看 primary 条目
 * 剩余是否跌破;套餐型单位 %(未设置时默认 10),看任一档位剩余百分比。
 * 返回触发预警的条目,无则 null。
 */
export function accountAlarm(account) {
	const snapshot = account.snapshot;
	if (snapshot?.status !== 'ok' || !Array.isArray(snapshot.items)) return null;
	const kind = ADAPTERS[account.provider]?.kind ?? 'balance';
	if (kind === 'plan') {
		const threshold = typeof account.warnBelow === 'number' && account.warnBelow > 0 ? account.warnBelow : 10;
		return snapshot.items.find((item) => item.unit === '%' && typeof item.remaining === 'number' && item.remaining < threshold) ?? null;
	}
	if (typeof account.warnBelow !== 'number' || account.warnBelow <= 0) return null;
	const primary = snapshot.items.find((item) => item.primary) ?? snapshot.items[0];
	return primary && typeof primary.remaining === 'number' && Number.isFinite(primary.remaining) && primary.remaining < account.warnBelow ? primary : null;
}
