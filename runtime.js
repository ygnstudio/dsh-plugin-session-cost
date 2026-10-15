import { mkdirSync, existsSync, readFileSync, copyFileSync, chmodSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export const dataDir = (name) => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'plugin-data', name);

/** Copy legacy state once; never delete the user's original files. */
export function prepareData(name, legacyDir, files) {
	const dir = dataDir(name);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	chmodSync(dir, 0o700);
	const marker = join(dir, '.migration-v1.json');
	if (existsSync(marker)) return;
	for (const file of files) {
		const target = join(dir, file);
		if (!existsSync(target) && existsSync(join(legacyDir, file))) {
			copyFileSync(join(legacyDir, file), target, 1);
			chmodSync(target, 0o600);
		}
	}
	atomicJson(marker, { version: 1, files });
}

export function atomicJson(path, value) {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
		renameSync(temporary, path);
	} finally {
		if (existsSync(temporary)) unlinkSync(temporary);
	}
}

/** Use the same admission contract as DSH's shared /api bridge. */
export function protectedRoute(ctx, route, signal) {
	return ctx.webServer.register({ ...route, handler: async (req, res) => {
		const reject = (status, error) => {
			res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
			res.end(JSON.stringify({ ok: false, error }));
		};
		if (signal?.aborted || typeof ctx.connection?.admit !== 'function') return reject(503, '插件暂不可用');
		const admission = ctx.connection.admit(req);
		if ('rejection' in admission) return reject(admission.rejection, '请在 DSH 中打开此页面');
		if (['PUT', 'POST', 'PATCH'].includes(req.method)
			&& req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
			return reject(415, '请求必须是 JSON');
		}
		try { await route.handler(req, res); }
		catch (error) {
			if (!res.headersSent && !res.destroyed) reject(error.status || 500, error.status ? error.message : '操作失败，请重试');
			else if (!res.writableEnded) res.end();
		}
	} });
}

export function readJsonBody(req, limit = 65_536) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		const finish = (error, value) => {
			clearTimeout(timer);
			req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', aborted);
			if (error) { req.resume(); reject(error); } else resolve(value);
		};
		const fail = (error) => finish(error);
		const aborted = () => finish(Object.assign(new Error('请求已取消'), { status: 400 }));
		const data = (chunk) => {
			size += chunk.length;
			if (size > limit) return finish(Object.assign(new Error('请求内容过大'), { status: 413 }));
			chunks.push(chunk);
		};
		const end = () => {
			try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
			catch { finish(Object.assign(new Error('JSON 格式错误'), { status: 400 })); }
		};
		const timer = setTimeout(() => finish(Object.assign(new Error('请求超时'), { status: 408 })), 10_000);
		timer.unref?.();
		req.on('data', data); req.on('end', end); req.on('error', fail); req.on('aborted', aborted);
	});
}
