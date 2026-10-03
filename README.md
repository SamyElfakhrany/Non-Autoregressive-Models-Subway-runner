# Jev Runner

The Neon Rail Runner game, played by **Jev** (TypeSafe's System One model) through **OpenRouter**.

## First run

1. Install Node 20.6+ and run `npm install`.
2. Copy `.env.example` to `.env` and paste your OpenRouter key (`OPENROUTER_API_KEY`).
3. Offline check, no key needed: `npm test` (schemas, oracle, retry rules) then `npm run mock` and open http://localhost:3000.
4. Live: `npm run dev`, open http://localhost:3000, press **Mode: Human** once to switch to **Jev**, then **Start run**.
5. Watch the panel (bottom left): lane and action, confidence, latency, `safe x/y`, low-conf, errors, late.
6. Every decision is appended to `logs/jev-YYYY-MM-DD.jsonl` (state, Jev's raw answers, confidence, latency, correct or not).

## If the first live call fails

- `HTTP 401`: wrong key. `HTTP 402`: no OpenRouter credits.
- `HTTP 404/400`: try `JEV_MODEL=jev-latest`, or check the model id at https://openrouter.ai/typesafe.
- Every reply is checked against `src/schemas.ts`; a shape mismatch shows as an error in the panel and the log.

## How it works

- Each obstacle row is sent to Jev as soon as it is visible (about 110 units ahead). The answer is applied when the row reaches the runner. Late answers are ignored and counted as `late`.
- Questions (System One format): `lane` (choice), `jump` and `slide` (noul = yes/no).
- One retry on malformed replies or 5xx/429. Lane confidence under `JEV_CONF_MIN` (default 0.5) counts as a failure.
- Failures keep the current lane. The **Safety net** checkbox lets a simple rule take over instead (off by default).
- `oracle.ts` knows the right answer for each row, which gives the `safe` score.
- Jev mode caps speed at 36 so the lane the runner is in stays in step with Jev's latency.
- The server listens on 127.0.0.1 only, and the key never reaches the browser.
