import { LANES, type Act, type Cell, type Lane } from './schemas';

export type Row = Record<Lane, Cell>;
export const needs = (c: Cell): Act => (c === 'barrier' ? 'jump' : c === 'beam' ? 'slide' : 'none');
export const survives = (c: Cell, a: Act) => c !== 'train' && needs(c) === a;
export const clearLanes = (row: Row) => LANES.filter((l) => row[l] === 'empty' || row[l] === 'coins');

/** Ground truth for one decision: would the runner live, and did it pick a clear lane? */
export function judge(row: Row, lane: Lane, act: Act) {
  return { survives: survives(row[lane], act), clear: clearLanes(row).includes(lane), clearLanes: clearLanes(row) };
}
