// node 测试环境补一个内存版 Web Storage：部分 zustand+persist 的 store 在被 import 时
// 就会读 localStorage 来 hydrate，node 里没有这个全局会直接抛错。仅供测试，不进生产包。
class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
}
const g = globalThis as unknown as { localStorage?: unknown; sessionStorage?: unknown };
if (!g.localStorage) g.localStorage = new MemStorage();
if (!g.sessionStorage) g.sessionStorage = new MemStorage();
