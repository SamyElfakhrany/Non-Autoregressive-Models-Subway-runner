import { JevResp, LANES, type DecideReq } from './schemas';
import { clearLanes } from './oracle';

export type Cfg = { apiKey?: string; baseUrl: string; model: string; timeoutMs: number; confMin: number; mock: boolean };
export const loadCfg = (): Cfg => ({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api',
  model: process.env.JEV_MODEL ?? 'jev-1.13',
  timeoutMs: Number(process.env.JEV_TIMEOUT_MS ?? 6000),
  confMin: Number(process.env.JEV_CONF_MIN ?? 0.5),
  mock: process.argv.includes('--mock') || process.env.JEV_MOCK === '1',
});

const LEGEND = {
  empty: 'nothing in the lane',
  coins: 'coins to collect, safe',
  train: 'solid train, fatal to hit',
  barrier: 'low barrier, must jump over it',
  beam: 'overhead beam, must slide under it',
};

/** TypeSafe System One request: one shared state, three typed questions. */
export const buildBody = (r: DecideReq, model: string) => ({
  model,
  state: { runnerLane: r.runnerLane, speed: r.speed, row: r.row, legend: LEGEND },
  questions: {
    lane: {
      type: 'choice',
      instructions:
        'Choose the lane the runner should be in when this row arrives. Never choose a lane with a train. Prefer lanes with coins, then empty lanes, then lanes that need a jump or slide. Prefer lanes close to runnerLane.',
      criteria: { left: 'the left lane', middle: 'the middle lane', right: 'the right lane' },
    },
    jump: {
      type: 'noul',
      instructions: "Is the runner's current lane (runnerLane) blocked by a low barrier that the runner must jump over?",
    },
    slide: {
      type: 'noul',
      instructions: "Is the runner's current lane (runnerLane) blocked by an overhead beam that the runner must slide under?",
    },
  },
});

class Fatal extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Offline stand-in with the same wire shape, used by --mock and the self-test. */
async function mockAnswer(r: DecideReq) {
  await sleep(300 + Math.random() * 600);
  const idx = (l: string) => LANES.indexOf(l as (typeof LANES)[number]);
  const clear = clearLanes(r.row).sort((a, b) => Math.abs(idx(a) - idx(r.runnerLane)) - Math.abs(idx(b) - idx(r.runnerLane)));
  const choice = clear[0] ?? r.runnerLane;
  const probabilities = Object.fromEntries(LANES.map((l) => [l, l === choice ? 0.9 : 0.05]));
  const here = r.row[r.runnerLane];
  return {
    model: 'mock',
    answers: {
      lane: { type: 'choice', choice, probabilities, confidence: 0.9 },
      jump: { type: 'noul', noul: here === 'barrier' ? 0.97 : 0.02 },
      slide: { type: 'noul', noul: here === 'beam' ? 0.97 : 0.02 },
    },
  };
}

/** Calls Jev through OpenRouter (POST /v1/systemone). Validates the reply; retries once. */
export async function askJev(r: DecideReq, cfg: Cfg) {
  const body = buildBody(r, cfg.model);
  const t0 = performance.now();
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let json: unknown;
      if (cfg.mock) json = await mockAnswer(r);
      else {
        const res = await fetch(cfg.baseUrl + '/v1/systemone', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + cfg.apiKey, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });
        if (!res.ok) {
          const msg = `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
          if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new Fatal(msg);
          throw new Error(msg);
        }
        json = await res.json();
      }
      const p = JevResp.parse(json);
      return { answers: p.answers, model: p.model, latencyMs: performance.now() - t0, retried: attempt > 0, mock: cfg.mock };
    } catch (e) {
      last = e;
      if (e instanceof Fatal) break;
    }
  }
  throw last;
}
