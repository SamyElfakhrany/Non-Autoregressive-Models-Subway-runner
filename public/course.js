/** Shared, deterministic row sequence for both players in one run. */
export class Course {
  constructor(seed = 1) { this.reset(seed); }
  reset(seed) {
    this.seed = seed >>> 0 || 1;
    this.rows = [];
    this.previousFree = 1;
  }
  random() {
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }
  get(index) {
    while (this.rows.length <= index) {
      const adjacent = [0, 1, 2].filter(i => Math.abs(i - this.previousFree) <= 1);
      const free = adjacent[Math.floor(this.random() * adjacent.length)];
      this.previousFree = free;
      const other = [0, 1, 2].filter(i => i !== free);
      const blocked = this.random() < .5 ? other : [other[Math.floor(this.random() * other.length)]];
      const cells = ['empty', 'empty', 'empty'];
      for (const i of blocked) {
        const r = this.random();
        cells[i] = r < .4 ? 'train' : r < .7 ? 'barrier' : 'beam';
      }
      const coins = this.random() < .7;
      if (coins) cells[free] = 'coins';
      this.rows.push(Object.freeze({ id: this.rows.length, cells: Object.freeze(cells), free, coins, gap: 26 + this.random() * 12 }));
    }
    return this.rows[index];
  }
}
