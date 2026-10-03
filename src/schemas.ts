import { z } from 'zod';

export const LANES = ['left', 'middle', 'right'] as const;
export const CELLS = ['empty', 'coins', 'train', 'barrier', 'beam'] as const;
export const Lane = z.enum(LANES);
export const Cell = z.enum(CELLS);
export type Lane = z.infer<typeof Lane>;
export type Cell = z.infer<typeof Cell>;
export type Act = 'none' | 'jump' | 'slide';
export const Provider = z.enum(['jev', 'gemini']);
export type Provider = z.infer<typeof Provider>;

/** What the game sends for one obstacle row. */
export const DecideReq = z.object({
  provider: Provider,
  runId: z.string().min(1).max(100),
  rowId: z.number().int().nonnegative(),
  runnerLane: Lane,
  speed: z.number(),
  row: z.object({ left: Cell, middle: Cell, right: Cell }),
  safetyNet: z.boolean().optional(),
});
export type DecideReq = z.infer<typeof DecideReq>;
export const LateReq = z.object({ provider: Provider, runId: z.string().min(1).max(100), rowId: z.number().int().nonnegative() });

/** What Jev must return (TypeSafe System One shape). Anything else is rejected. */
const Choice = z.object({
  type: z.literal('choice'),
  choice: Lane,
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number().min(0).max(1),
});
const Noul = z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) });
export const JevResp = z.object({
  model: z.string(),
  answers: z.object({ lane: Choice, jump: Noul, slide: Noul }),
});

export const GeminiDecision = z.object({ lane: Lane, jump: z.boolean(), slide: z.boolean() });
