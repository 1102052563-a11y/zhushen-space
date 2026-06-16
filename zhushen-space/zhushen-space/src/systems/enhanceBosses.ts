import { stageFromLevel } from './enhanceEngine';

/* 强化老板分阶段立绘清单（public/enhance-bosses/manifest.json，由 vite 插件 syncEnhanceBosses 生成）。
   结构：{ "<老板文件夹>": { "1": [相对路径...], "2": [...], "3": [...], "4": [...] } }
   相对路径形如 "凯莉/阶段1/xxx.png"，served 于 /enhance-bosses/ 下。*/
export type BossManifest = Record<string, Record<string, string[]>>;

let _manifest: BossManifest | null = null;
let _loading: Promise<BossManifest> | null = null;

export async function loadBossManifest(): Promise<BossManifest> {
  if (_manifest) return _manifest;
  if (_loading) return _loading;
  _loading = fetch('/enhance-bosses/manifest.json')
    .then((r) => (r.ok ? r.json() : {}))
    .then((m) => { _manifest = (m && typeof m === 'object') ? m : {}; return _manifest!; })
    .catch(() => { _manifest = {}; return _manifest!; });
  return _loading;
}

/** 把相对路径转成可用 URL（中文路径段逐段 encode）*/
function toUrl(rel: string): string {
  return '/enhance-bosses/' + rel.split('/').map(encodeURIComponent).join('/');
}

/** 取某老板在某强化等级对应阶段的一张随机立绘 URL；空阶段就近回退（先向低阶段、再向高阶段）。无图返回 null。*/
export function pickStagePortrait(manifest: BossManifest | null, folder: string | undefined, level: number): string | null {
  if (!manifest || !folder) return null;
  const stages = manifest[folder];
  if (!stages) return null;
  const want = stageFromLevel(Math.max(0, level));
  const order = [want, want - 1, want - 2, want - 3, want + 1, want + 2, want + 3].filter((n) => n >= 1 && n <= 4);
  for (const n of order) {
    const arr = stages[String(n)];
    if (arr && arr.length) return toUrl(arr[Math.floor(Math.random() * arr.length)]);
  }
  return null;
}

/** 该老板是否有文件夹立绘（任一阶段有图）*/
export function hasFolderPortraits(manifest: BossManifest | null, folder?: string): boolean {
  if (!manifest || !folder) return false;
  const stages = manifest[folder];
  return !!stages && Object.values(stages).some((a) => a && a.length > 0);
}
