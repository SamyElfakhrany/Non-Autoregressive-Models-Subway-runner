import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DecideReq, LateReq } from './schemas';
import { loadCfg } from './jev';
import { loadGeminiCfg } from './gemini';
import { decide, noteLate, stats } from './decide';

const cfg = { jev: loadCfg(), gemini: loadGeminiCfg() };
const port = Number(process.env.PORT ?? 3000);
const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const send = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readJson = (req: IncomingMessage) =>
  new Promise<unknown>((ok, no) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 10_000) { no(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { no(e); } });
  });

createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return void res.end(await readFile(join(pub, 'index.html')));
    }
    if (req.method === 'GET' && (req.url === '/game.js' || req.url === '/course.js')) {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return void res.end(await readFile(join(pub, req.url.slice(1))));
    }
    if (req.method === 'GET' && req.url?.startsWith('/api/stats')) {
      const url = new URL(req.url, `http://localhost:${port}`);
      const runId = url.searchParams.get('runId');
      if (!runId) return send(res, 400, { error: 'runId is required' });
      return send(res, 200, { jev: stats(runId, 'jev'), gemini: stats(runId, 'gemini') });
    }
    if (req.method === 'POST' && req.url === '/api/decide') {
      const p = DecideReq.safeParse(await readJson(req));
      if (!p.success) return send(res, 400, { ok: false, reason: 'bad-request', error: p.error.message });
      const selected = cfg[p.data.provider];
      if (!selected.mock && !selected.apiKey) return send(res, 503, { ok: false, reason: 'no-key', error: p.data.provider === 'jev' ? 'OPENROUTER_API_KEY is not set' : 'GOOGLE_API_KEY is not set' });
      return send(res, 200, await decide(p.data, cfg));
    }
    if (req.method === 'POST' && req.url === '/api/late') {
      const p = LateReq.safeParse(await readJson(req));
      if (p.success) await noteLate(p.data);
      return send(res, 200, { ok: p.success });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { ok: false, reason: 'server', error: String(e) });
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Jev vs Gemini: http://localhost:${port}  Jev=${cfg.jev.model} (${cfg.jev.mock ? 'mock' : cfg.jev.apiKey ? 'live' : 'no key'})  Gemini=${cfg.gemini.model} (${cfg.gemini.mock ? 'mock' : cfg.gemini.apiKey ? 'live' : 'no key'})`);
});
