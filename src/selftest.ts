import assert from 'node:assert/strict';
import { CELLS, LANES, type DecideReq } from './schemas';
import { decide, S } from './decide';
import { judge, needs } from './oracle';
import { buildBody, type Cfg } from './jev';

const cfg: Cfg = { baseUrl: 'http://x', model: 'jev-1.13', timeoutMs: 1000, confMin: 0.5, mock: true };
const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

// oracle basics
assert.equal(needs('barrier'), 'jump');
assert.equal(judge({ left: 'train', middle: 'empty', right: 'beam' }, 'left', 'none').survives, false);
assert.equal(judge({ left: 'train', middle: 'empty', right: 'beam' }, 'right', 'slide').survives, true);
assert.equal(judge({ left: 'train', middle: 'empty', right: 'beam' }, 'middle', 'none').clear, true);

// request shape matches the System One format
const b = buildBody({ rowId: 1, runnerLane: 'middle', speed: 20, row: { left: 'train', middle: 'empty', right: 'coins' } }, 'jev-1.13');
assert.deepEqual(Object.keys(b.questions), ['lane', 'jump', 'slide']);
assert.equal(b.questions.lane.type, 'choice');
assert.equal(b.questions.jump.type, 'noul');

// mock pipeline: always survives when a lane is clear
for (let i = 0; i < 40; i++) {
  const row = { left: pick(CELLS), middle: pick(CELLS), right: pick(CELLS) };
  if (!LANES.some((l) => row[l] === 'empty' || row[l] === 'coins')) row.middle = 'empty';
  const req: DecideReq = { rowId: i, runnerLane: pick(LANES), speed: 20, row };
  const d = await decide(req, cfg);
  assert.equal(d.ok, true);
  assert.equal((d as { survives: boolean }).survives, true);
}
assert.equal(S.safe, 40);

// malformed reply from the model is rejected, retried once, then reported as an error
let calls = 0;
globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ model: 'x', answers: { lane: { type: 'choice', choice: 'up' } } })); }) as typeof fetch;
const bad = await decide({ rowId: 99, runnerLane: 'left', speed: 20, row: { left: 'empty', middle: 'empty', right: 'empty' } }, { ...cfg, mock: false, apiKey: 'k' });
assert.equal(bad.ok, false);
assert.equal(calls, 2);

// 401 is not retried
calls = 0;
globalThis.fetch = (async () => { calls++; return new Response('nope', { status: 401 }); }) as typeof fetch;
await decide({ rowId: 100, runnerLane: 'left', speed: 20, row: { left: 'empty', middle: 'empty', right: 'empty' } }, { ...cfg, mock: false, apiKey: 'k' });
assert.equal(calls, 1);
console.log('selftest passed');
