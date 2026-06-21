// 内置表情包（大贴纸）—— 纯原创 inline SVG，自包含、零外链、零依赖，渲染成 <img src=dataURI>。
// 思路同 pixelPals / dicebearAvatar：发送时**只广播 {pack,id} 引用**，各端从这里本地解析出图
// （沿用「绝不广播大图」铁则，零图片传输、离线可用、$0）。
// 三种来源并存：① 内置 SVG（svg）② 文件夹直投 public/stickers/<包名>/（url）③ 用户云端上传 R2（hash·见下方 cloud 区）。

import { mpBase } from './mpConfig';
import { chatToken } from './chatIdentity';

export interface StickerDef { id: string; label: string; svg?: string; url?: string; hash?: string }   // 内置=svg；文件夹直投=url；云端上传=hash
export interface StickerPack { id: string; label: string; emoji: string; stickers: StickerDef[] }

// 聊天里随消息传的小引用（只有这点东西过 WS）。pack+id=内置；url/hash 预留给路线②③。
export interface StickerRef { pack?: string; id?: string; url?: string; hash?: string; w?: number; h?: number }

const F = "font-family='PingFang SC,Microsoft YaHei,sans-serif'";
// 圆角方块底 + 表情画面(inner) + 底部半透明文字带。单引号写 SVG 属性，便于直接进 data URI。
function tile(bg: string, inner: string, caption: string): string {
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'><rect width='96' height='96' rx='20' fill='${bg}'/>${inner}<rect y='72' width='96' height='24' fill='#000' fill-opacity='0.18'/><text x='48' y='89' ${F} font-size='15' font-weight='700' fill='#fff' text-anchor='middle'>${caption}</text></svg>`;
}
const D = '#2c2622';  // 表情线条/眼睛的统一深色（在任何底色上都清楚）

const BUILTIN_PACKS: StickerPack[] = [
  {
    id: 'mood', label: '表情', emoji: '😀', stickers: [
      { id: 'zan', label: '赞', svg: tile('#37b24d',
        `<circle cx='34' cy='34' r='5' fill='${D}'/><circle cx='62' cy='34' r='5' fill='${D}'/><path d='M30 47 q18 16 36 0' stroke='${D}' stroke-width='4.5' fill='none' stroke-linecap='round'/><path d='M78 16 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 z' fill='#fff'/>`, '赞') },
      { id: 'haha', label: '哈哈', svg: tile('#fab005',
        `<path d='M26 37 q7 -9 14 0' stroke='${D}' stroke-width='4' fill='none' stroke-linecap='round'/><path d='M56 37 q7 -9 14 0' stroke='${D}' stroke-width='4' fill='none' stroke-linecap='round'/><path d='M32 49 q16 19 32 0 z' fill='${D}'/><path d='M35 50 q13 9 26 0' fill='#ff6b6b'/><circle cx='19' cy='44' r='3.5' fill='#74c0fc'/><circle cx='77' cy='44' r='3.5' fill='#74c0fc'/>`, '哈哈') },
      { id: 'wuyu', label: '无语', svg: tile('#adb5bd',
        `<rect x='26' y='34' width='15' height='4' rx='2' fill='${D}'/><rect x='55' y='34' width='15' height='4' rx='2' fill='${D}'/><rect x='34' y='52' width='28' height='4' rx='2' fill='${D}'/><path d='M76 28 q5 9 0 13 q-5 -4 0 -13' fill='#74c0fc'/>`, '无语') },
      { id: 'bixin', label: '比心', svg: tile('#f06595',
        `<path d='M48 13 c-5 -7 -16 -2 -11 7 c2 6 11 10 11 10 c0 0 9 -4 11 -10 c5 -9 -6 -14 -11 -7 z' fill='#fff'/><circle cx='34' cy='40' r='5' fill='${D}'/><circle cx='62' cy='40' r='5' fill='${D}'/><path d='M36 54 q12 9 24 0' stroke='${D}' stroke-width='3.5' fill='none' stroke-linecap='round'/>`, '比心') },
      { id: 'leiben', label: '泪奔', svg: tile('#4dabf7',
        `<circle cx='34' cy='33' r='5' fill='${D}'/><circle cx='62' cy='33' r='5' fill='${D}'/><path d='M30 40 q3 14 -1 22' stroke='#d0ebff' stroke-width='5' fill='none' stroke-linecap='round'/><path d='M66 40 q-3 14 1 22' stroke='#d0ebff' stroke-width='5' fill='none' stroke-linecap='round'/><path d='M36 58 q6 -7 12 0 q6 7 12 0' stroke='${D}' stroke-width='3.5' fill='none' stroke-linecap='round'/>`, '泪奔') },
      { id: 'jingen', label: '震惊', svg: tile('#ff922b',
        `<circle cx='34' cy='33' r='8' fill='#fff'/><circle cx='35' cy='34' r='4' fill='${D}'/><circle cx='62' cy='33' r='8' fill='#fff'/><circle cx='61' cy='34' r='4' fill='${D}'/><ellipse cx='48' cy='56' rx='8' ry='10' fill='${D}'/>`, '震惊') },
      { id: 'sikao', label: '思考', svg: tile('#845ef7',
        `<circle cx='34' cy='34' r='5' fill='${D}'/><circle cx='62' cy='34' r='5' fill='${D}'/><path d='M40 54 q8 -5 16 0' stroke='${D}' stroke-width='3.5' fill='none' stroke-linecap='round'/><text x='73' y='32' ${F} font-size='24' font-weight='800' fill='#fff'>?</text>`, '思考') },
      { id: 'shoudao', label: '收到', svg: tile('#20c997',
        `<circle cx='34' cy='36' r='5' fill='${D}'/><circle cx='62' cy='36' r='5' fill='${D}'/><path d='M30 49 q18 14 36 0' stroke='${D}' stroke-width='4' fill='none' stroke-linecap='round'/><path d='M66 20 l6 8 l13 -16' stroke='#fff' stroke-width='5' fill='none' stroke-linecap='round' stroke-linejoin='round'/>`, '收到') },
      { id: 'jiayou', label: '加油', svg: tile('#f03e3e',
        `<rect x='25' y='27' width='15' height='4' rx='2' fill='${D}' transform='rotate(14 32 29)'/><rect x='56' y='27' width='15' height='4' rx='2' fill='${D}' transform='rotate(-14 64 29)'/><circle cx='34' cy='39' r='4.5' fill='${D}'/><circle cx='62' cy='39' r='4.5' fill='${D}'/><ellipse cx='48' cy='55' rx='9' ry='7' fill='${D}'/>`, '加油') },
    ],
  },
  {
    id: 'pet', label: '萌宠', emoji: '🐾', stickers: [
      { id: 'gou', label: '狗头', svg: tile('#e8a87c',
        `<path d='M19 16 l13 16 l-16 5 z' fill='#a86d4a'/><path d='M77 16 l-13 16 l16 5 z' fill='#a86d4a'/><circle cx='36' cy='37' r='4.5' fill='#3b2a1f'/><circle cx='60' cy='37' r='4.5' fill='#3b2a1f'/><ellipse cx='48' cy='53' rx='13' ry='9' fill='#fff'/><ellipse cx='48' cy='48' rx='4' ry='3' fill='#3b2a1f'/><path d='M40 55 q8 8 16 0' stroke='#3b2a1f' stroke-width='2.5' fill='none' stroke-linecap='round'/>`, '狗头') },
      { id: 'mao', label: '喵', svg: tile('#ffa94d',
        `<path d='M22 14 l4 18 l-12 -6 z' fill='#e8830c'/><path d='M74 14 l-4 18 l12 -6 z' fill='#e8830c'/><circle cx='35' cy='37' r='4.5' fill='${D}'/><circle cx='61' cy='37' r='4.5' fill='${D}'/><ellipse cx='48' cy='47' rx='3' ry='2.4' fill='#d6336c'/><path d='M48 49 v4 M48 53 q-5 4 -9 1 M48 53 q5 4 9 1' stroke='${D}' stroke-width='2' fill='none' stroke-linecap='round'/><path d='M12 44 h16 M12 50 h16 M68 44 h16 M68 50 h16' stroke='#fff' stroke-width='1.6' stroke-linecap='round'/>`, '喵') },
      { id: 'tu', label: '兔兔', svg: tile('#f7c5d9',
        `<rect x='30' y='8' width='9' height='28' rx='4.5' fill='#fff'/><rect x='57' y='8' width='9' height='28' rx='4.5' fill='#fff'/><rect x='32' y='12' width='5' height='18' rx='2.5' fill='#ffa8c5'/><rect x='59' y='12' width='5' height='18' rx='2.5' fill='#ffa8c5'/><circle cx='36' cy='46' r='4.5' fill='${D}'/><circle cx='60' cy='46' r='4.5' fill='${D}'/><circle cx='48' cy='55' r='3' fill='#d6336c'/>`, '兔兔') },
      { id: 'xiong', label: '熊', svg: tile('#b08968',
        `<circle cx='26' cy='22' r='9' fill='#8c6b50'/><circle cx='70' cy='22' r='9' fill='#8c6b50'/><circle cx='36' cy='38' r='4.5' fill='${D}'/><circle cx='60' cy='38' r='4.5' fill='${D}'/><ellipse cx='48' cy='52' rx='14' ry='10' fill='#e6d3bf'/><ellipse cx='48' cy='48' rx='4' ry='3' fill='${D}'/><path d='M41 54 q7 7 14 0' stroke='${D}' stroke-width='2.5' fill='none' stroke-linecap='round'/>`, '熊') },
      { id: 'qie', label: '企鹅', svg: tile('#4dabf7',
        `<ellipse cx='48' cy='48' rx='20' ry='24' fill='#fff'/><circle cx='40' cy='34' r='4' fill='${D}'/><circle cx='56' cy='34' r='4' fill='${D}'/><path d='M44 40 l8 0 l-4 6 z' fill='#ffa94d'/><path d='M48 50 q-4 8 4 14 q8 -6 4 -14' fill='#cfe3f5'/>`, '企鹅') },
      { id: 'wa', label: '蛙', svg: tile('#51cf66',
        `<circle cx='32' cy='24' r='11' fill='#69db7c'/><circle cx='64' cy='24' r='11' fill='#69db7c'/><circle cx='32' cy='24' r='5' fill='#fff'/><circle cx='33' cy='25' r='3' fill='${D}'/><circle cx='64' cy='24' r='5' fill='#fff'/><circle cx='63' cy='25' r='3' fill='${D}'/><path d='M28 48 q20 14 40 0' stroke='${D}' stroke-width='4' fill='none' stroke-linecap='round'/>`, '蛙') },
    ],
  },
];

// ── 文件夹直投的表情包（把 gif/png/webp 丢进 public/stickers/<包名>/，vite 插件扫描成 /stickers/manifest.json）──
// 运行时 fetch 合并进 stickerPacks()。图片是公开静态资源(动图由 <img> 自动播放)；发送仍只广播 {pack,id} 引用，
// 各端用自己 build 里的同一份 manifest 解析出 URL（不走 WS 传图）。素材版权由放置者自负。
let filePacks: StickerPack[] = [];
let cloudPack: StickerPack | null = null;   // 「我的」云端上传（登录后 loadMyCloudStickers 拉取）
let _loaded = false;
let _loading: Promise<void> | null = null;

/** 全部表情包 = 内置 SVG 两套 + 文件夹直投的若干套 + 「我的」云端上传一套（各需对应 load 才出现）。 */
export function stickerPacks(): StickerPack[] {
  const out = [...BUILTIN_PACKS, ...filePacks];
  if (cloudPack && cloudPack.stickers.length) out.unshift(cloudPack);   // 「我的」放最前，常用
  return out;
}
export function stickerPacksLoaded(): boolean { return _loaded; }

/** 拉取 /stickers/manifest.json 合并文件包。幂等；失败(无 manifest/离线)则只用内置。 */
export function loadStickerPacks(): Promise<void> {
  if (_loaded) return Promise.resolve();
  if (_loading) return _loading;
  _loading = (async () => {
    try {
      const res = await fetch('/stickers/manifest.json', { cache: 'no-cache' });
      if (res.ok) {
        const raw = await res.json();
        filePacks = (Array.isArray(raw) ? raw : []).map((p: any): StickerPack => ({
          id: String(p.id), label: String(p.label || p.id), emoji: '🖼',
          stickers: (Array.isArray(p.stickers) ? p.stickers : []).map((s: any): StickerDef => ({
            id: String(s.id), label: String(s.label || s.id), url: '/stickers/' + String(s.file),
          })),
        })).filter((p) => p.stickers.length);
      }
    } catch { /* 无 manifest / 离线 → 只用内置 */ }
    _loaded = true;
  })();
  return _loading;
}

export function findSticker(pack?: string, id?: string): StickerDef | null {
  if (!pack || !id) return null;
  const p = stickerPacks().find((x) => x.id === pack);
  return p?.stickers.find((s) => s.id === id) || null;
}

/** 云端上传贴纸的取图地址（按内容哈希走 worker 公开端点·长缓存）。 */
export function stickerServeUrl(hash: string): string { return `${mpBase()}/api/chat/sticker/${hash}`; }

// 解析一条 StickerRef → 可直接塞 <img src> 的地址。内置=SVG dataURI；文件包=URL；云端=按 hash 取 worker 端点。
export function stickerSrc(ref?: StickerRef): string {
  if (!ref) return '';
  if (ref.url) return ref.url;
  if (ref.hash) return stickerServeUrl(ref.hash);
  const s = findSticker(ref.pack, ref.id);
  if (!s) return '';
  if (s.hash) return stickerServeUrl(s.hash);
  if (s.url) return s.url;
  return s.svg ? `data:image/svg+xml,${encodeURIComponent(s.svg)}` : '';
}

/** 选择器里一个贴纸格的显示地址。 */
export function stickerDefSrc(def: StickerDef): string {
  if (def.hash) return stickerServeUrl(def.hash);
  if (def.url) return def.url;
  return def.svg ? `data:image/svg+xml,${encodeURIComponent(def.svg)}` : '';
}

/** 点一个贴纸格 → 要发出去的引用（云端只发 hash；内置/文件发 pack+id）。 */
export function refForDef(packId: string, def: StickerDef): StickerRef {
  return def.hash ? { hash: def.hash } : { pack: packId, id: def.id };
}

// ── 「我的」云端上传（R2，复用云存档桶 CLOUD_BUCKET）：列出 / 上传 / 删除。需 Discord 登录(chatToken)。──
const CLOUD_PACK_ID = 'mine';
function setCloudPack(items: { hash: string; name?: string }[]) {
  cloudPack = {
    id: CLOUD_PACK_ID, label: '我的', emoji: '⭐',
    stickers: items.map((it): StickerDef => ({ id: it.hash, label: it.name || '贴纸', hash: it.hash })),
  };
}

/** 拉取「我的」云端贴纸；未登录/失败则不显示「我的」包。 */
export async function loadMyCloudStickers(): Promise<void> {
  const tok = chatToken();
  if (!tok) { cloudPack = null; return; }
  try {
    const res = await fetch(`${mpBase()}/api/chat/stickers`, { headers: { Authorization: 'Bearer ' + tok } });
    if (res.ok) { const j = await res.json(); setCloudPack(Array.isArray(j.stickers) ? j.stickers : []); }
  } catch { /* 离线 / 后端未部署 → 不显示「我的」 */ }
}

/** 上传一张到云端（成功后并入「我的」并返回其 ref 供立即发送）。 */
export async function uploadCloudSticker(file: File, name?: string): Promise<StickerRef> {
  const tok = chatToken();
  if (!tok) throw new Error('请先登录聊天室');
  const nm = name || file.name.replace(/\.[^.]+$/, '') || '贴纸';
  const res = await fetch(`${mpBase()}/api/chat/sticker?name=${encodeURIComponent(nm)}`, {
    method: 'POST', headers: { 'Content-Type': file.type, Authorization: 'Bearer ' + tok }, body: file,
  });
  const j = await res.json().catch(() => ({} as any));
  if (!res.ok) throw new Error(j.error || '上传失败');
  const cur = (cloudPack?.stickers || []).filter((s) => s.hash !== j.hash).map((s) => ({ hash: s.hash!, name: s.label }));
  setCloudPack([{ hash: j.hash, name: j.name }, ...cur]);   // 去重置顶
  return { hash: j.hash };
}

/** 从「我的」删除一张云端贴纸。 */
export async function deleteMyCloudSticker(hash: string): Promise<void> {
  const tok = chatToken();
  if (!tok) return;
  try { await fetch(`${mpBase()}/api/chat/sticker/${hash}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } }); } catch { /* */ }
  if (cloudPack) cloudPack = { ...cloudPack, stickers: cloudPack.stickers.filter((s) => s.hash !== hash) };
}
