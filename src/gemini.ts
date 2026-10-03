import { GeminiDecision, LANES, type DecideReq } from './schemas';
import { clearLanes } from './oracle';

export type GeminiCfg = { apiKey?: string; model: string; timeoutMs: number; mock: boolean };

export const loadGeminiCfg = (): GeminiCfg => ({
  apiKey: process.env.GOOGLE_API_KEY,
  model: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash',
  timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS ?? 6000),
  mock: process.argv.includes('--mock') || process.env.GEMINI_MOCK === '1',
});

const schema = {
  type: 'object',
  properties: {
    lane: { type: 'string', enum: [...LANES] },
    jump: { type: 'boolean' },
    slide: { type: 'boolean' },
  },
  required: ['lane', 'jump', 'slide'],
};

export const buildGeminiBody = (r: DecideReq) => ({
  contents: [{ parts: [{ text: [
    'You control a three-lane runner. Return only the requested JSON decision.',
    'Each row cell is empty, coins (safe), train (fatal), barrier (jump), or beam (slide).',
    'Choose a lane with no train. Prefer coins, then empty, then an obstacle needing an action. Prefer a nearby lane.',
    'Jump and slide describe the CURRENT runner lane. If you change lanes, both should be false.',
    `State: ${JSON.stringify({ runnerLane: r.runnerLane, speed: r.speed, row: r.row })}`,
  ].join('\n') }] }],
  generationConfig: {
    thinkingConfig: { thinkingLevel: 'low' },
    responseFormat: { text: { mimeType: 'application/json', schema } },
  },
});

class Fatal extends Error {}
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function mockAnswer(r: DecideReq) {
  await sleep(300 + Math.random() * 600);
  const index = (l: string) => LANES.indexOf(l as (typeof LANES)[number]);
  const clear = clearLanes(r.row).sort((a, b) => Math.abs(index(a) - index(r.runnerLane)) - Math.abs(index(b) - index(r.runnerLane)));
  const lane = clear[0] ?? r.runnerLane;
  const cell = r.row[r.runnerLane];
  return { lane, jump: lane === r.runnerLane && cell === 'barrier', slide: lane === r.runnerLane && cell === 'beam' };
}

/** Google Gemini API generateContent, with one retry for transient or invalid replies. */
export async function askGemini(r: DecideReq, cfg: GeminiCfg) {
  const t0 = performance.now();
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      let raw: unknown;
      if (cfg.mock) raw = await mockAnswer(r);
      else {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': cfg.apiKey ?? '', 'content-type': 'application/json' },
          body: JSON.stringify(buildGeminiBody(r)),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });
        if (!res.ok) {
          const msg = `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
          if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new Fatal(msg);
          throw new Error(msg);
        }
        const payload = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
        const responseText = payload.candidates?.[0]?.content?.parts?.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
        if (!responseText) throw new Error('Gemini returned no text');
        raw = JSON.parse(responseText);
      }
      const answer = GeminiDecision.parse(raw);
      return { answer, raw, model: cfg.mock ? 'mock' : cfg.model, latencyMs: performance.now() - t0, retried: attempt > 0, mock: cfg.mock };
    } catch (e) {
      last = e;
      if (e instanceof Fatal) break;
    }
  }
  throw last;
}
