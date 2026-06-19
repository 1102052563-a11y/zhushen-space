/* 赌坊荷官：内置名册 + 立绘清单（public/casino-dealers/manifest.json，由 vite 插件 syncCasinoDealers 生成）。
   manifest 结构：{ "<荷官文件夹>": [相对路径...] }，served 于 /casino-dealers/ 下。
   无图时前端回退到 emoji 头像。设计见记忆 casino-feature。*/

export interface DealerDef {
  id: string;
  name: string;
  gender: string;        // 男/女/非人型…（喂给吐槽 AI）
  race: string;          // 种族
  persona: string;       // 喂给吐槽 AI 的人设
  emoji: string;         // 无立绘时的头像
  portraitFolder: string;
  vip?: boolean;         // 魂币贵宾厅专属荷官
}

export const DEFAULT_DEALERS: DealerDef[] = [
  { id: 'd_xuan', name: '玄夜', gender: '女', race: '兔族', emoji: '🐰', portraitFolder: '玄夜', persona: '兔族兔女郎荷官，长耳软尾、媚态天成又精于算计；笑眯眯地撒娇哄你加注，输光了也凑近你、眨着泛红的眼睛软声道「别走嘛，再来一把~」。' },
  { id: 'd_qiao', name: '巧姐', gender: '女', race: '魂族', emoji: '👻', portraitFolder: '巧姐', persona: '魂族老荷官，半透明的身形飘忽不定、声音空灵，阅尽生死而看淡输赢；慢悠悠点你两句因果命数，话尾却总不动声色地藏着勾你下注的钩子。' },
  { id: 'd_li', name: '老李', gender: '男', race: '魔鬼族', emoji: '😈', portraitFolder: '老李', persona: '魔鬼族荷官，西装革履、犄角油亮、笑容温文，巧舌如簧最擅蛊惑人心；总彬彬有礼地劝你「押大的」，仿佛在与你签一纸甜蜜的契约。' },
  { id: 'd_mo', name: '魔笼', gender: '非人型', race: '器灵·赌笼', emoji: '⛓️', portraitFolder: '魔笼', persona: '一具会说话的古老赌笼（非人型器物），通体玄铁锈蚀、笼中幽火明灭，沙哑声音自铁条缝隙间渗出；阴恻恻地诱你把更多筹码、乃至魂魄「投进笼里」——赌注越大，笼内的火就烧得越旺。', vip: true },
];

export type DealerManifest = Record<string, string[]>;

let _manifest: DealerManifest | null = null;
let _loading: Promise<DealerManifest> | null = null;

export async function loadDealerManifest(): Promise<DealerManifest> {
  if (_manifest) return _manifest;
  if (_loading) return _loading;
  _loading = fetch('/casino-dealers/manifest.json')
    .then((r) => (r.ok ? r.json() : {}))
    .then((m) => { _manifest = ((m && typeof m === 'object') ? m : {}) as DealerManifest; return _manifest!; })
    .catch(() => { _manifest = {}; return _manifest!; });
  return _loading;
}

function toUrl(rel: string): string {
  return '/casino-dealers/' + rel.split('/').map(encodeURIComponent).join('/');
}

/** 取某荷官文件夹的一张随机立绘 URL；无图返回 null（前端回退 emoji）。 */
export function pickDealerPortrait(manifest: DealerManifest | null, folder?: string): string | null {
  if (!manifest || !folder) return null;
  const arr = manifest[folder];
  if (!arr || !arr.length) return null;
  return toUrl(arr[Math.floor(Math.random() * arr.length)]);
}

/* 无 AI 接口时的兜底吐槽（按输赢氛围随机一句，保证气泡不空）。 */
const FALLBACK_WIN = ['手气正旺啊，要不要再来一把？', '漂亮！钱可不嫌多。', '哟，今天财神附体了？', '赢了别急着走，好戏在后头。'];
const FALLBACK_LOSE = ['唉，就差那么一点。回个本？', '别灰心，下一把准回来。', '手气这东西，越赌越顺嘛。', '输了？正常正常，加注翻盘啊。'];
const FALLBACK_IDLE = ['来都来了，押一把？', '客官，今儿想玩点什么？', '坐下歇歇，顺便试试手气？', '赌场不留隔夜运，趁热下注。'];
export function fallbackBanter(mood: 'win' | 'lose' | 'idle'): string {
  const pool = mood === 'win' ? FALLBACK_WIN : mood === 'lose' ? FALLBACK_LOSE : FALLBACK_IDLE;
  return pool[Math.floor(Math.random() * pool.length)];
}
