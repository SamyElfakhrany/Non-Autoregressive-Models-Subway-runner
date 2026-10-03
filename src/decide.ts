import { appendFile, mkdir } from 'node:fs/promises';
import { askJev, type Cfg as JevCfg } from './jev';
import { askGemini, type GeminiCfg } from './gemini';
import { judge, clearLanes } from './oracle';
import type { Act, DecideReq, Provider } from './schemas';

export type DecideCfg = { jev: JevCfg; gemini: GeminiCfg };
type Counts = { asked: number; answered: number; safe: number; clear: number; lowConf: number; errors: number; late: number; latencySum: number };
const fresh = (): Counts => ({ asked: 0, answered: 0, safe: 0, clear: 0, lowConf: 0, errors: 0, late: 0, latencySum: 0 });
const counts = new Map<string, Counts>();
const notedLate = new Set<string>();
const key = (runId: string, provider: Provider) => `${runId}\u0000${provider}`;
const counter = (runId: string, provider: Provider) => {
  const k = key(runId, provider);
  let c = counts.get(k);
  if (!c) { c = fresh(); counts.set(k, c); }
  return c;
};
export const stats = (runId: string, provider: Provider) => {
  const c = counter(runId, provider);
  return { ...c, avgLatencyMs: c.answered ? Math.round(c.latencySum / c.answered) : 0 };
};

let ready: Promise<unknown> | undefined;
async function log(entry: object) {
  ready ??= mkdir('logs', { recursive: true });
  await ready;
  const day = new Date().toISOString().slice(0, 10);
  await appendFile(`logs/runner-${day}.jsonl`, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n').catch(() => {});
}

export async function noteLate(req: { provider: Provider; runId: string; rowId: number }) {
  const k = `${key(req.runId, req.provider)}\u0000${req.rowId}`;
  if (notedLate.has(k)) return;
  notedLate.add(k);
  counter(req.runId, req.provider).late++;
  await log({ event: 'late', ...req });
}

/** Ask the requested model, normalize its action, and score the choice against the same oracle. */
export async function decide(req: DecideReq, cfg: DecideCfg) {
  const c = counter(req.runId, req.provider);
  c.asked++;
  try {
    const response = req.provider === 'jev' ? await askJev(req, cfg.jev) : await askGemini(req, cfg.gemini);
    const isJev = req.provider === 'jev';
    const lane = isJev ? (response as Awaited<ReturnType<typeof askJev>>).answers.lane.choice : (response as Awaited<ReturnType<typeof askGemini>>).answer.lane;
    const jump = isJev ? (response as Awaited<ReturnType<typeof askJev>>).answers.jump.noul >= 0.5 : (response as Awaited<ReturnType<typeof askGemini>>).answer.jump;
    const slide = isJev ? (response as Awaited<ReturnType<typeof askJev>>).answers.slide.noul >= 0.5 : (response as Awaited<ReturnType<typeof askGemini>>).answer.slide;
    const confidence = isJev ? (response as Awaited<ReturnType<typeof askJev>>).answers.lane.confidence : undefined;
    const act: Act = lane === req.runnerLane ? (jump ? 'jump' : slide ? 'slide' : 'none') : 'none';
    const verdict = judge(req.row, lane, act);
    const lowConf = isJev && confidence !== undefined && confidence < cfg.jev.confMin;
    c.answered++;
    c.latencySum += response.latencyMs;
    if (verdict.survives) c.safe++;
    if (verdict.clear) c.clear++;
    if (lowConf) c.lowConf++;
    const out = {
      ok: !lowConf, reason: lowConf ? 'low-confidence' : undefined, lane, act, confidence,
      latencyMs: response.latencyMs, retried: response.retried, mock: response.mock,
      survives: verdict.survives, clear: verdict.clear, stats: stats(req.runId, req.provider),
    };
    await log({ event: 'decision', provider: req.provider, runId: req.runId, req, answers: isJev ? (response as Awaited<ReturnType<typeof askJev>>).answers : (response as Awaited<ReturnType<typeof askGemini>>).raw, model: response.model, ...out });
    return out;
  } catch (e) {
    c.errors++;
    const out = { ok: false, reason: 'error', error: String(e instanceof Error ? e.message : e), stats: stats(req.runId, req.provider) };
    await log({ event: 'error', provider: req.provider, runId: req.runId, req, clearLanes: clearLanes(req.row), ...out });
    return out;
  }
}
