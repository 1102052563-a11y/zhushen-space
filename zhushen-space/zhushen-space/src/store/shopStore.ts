import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getAllImg, putImg, delImg } from '../systems/imageDb';
import type { JoyGirl } from './joyStore';
import type { BossDef } from '../systems/enhanceEngine';

/* ════════════════════════════════════════════
   玩家产业 store（drpg-shop）—— 一个 store 装三种店，全对标 joyStore / craftStore。
   - shops = 玩家开的店（店招 / 掌柜 / 货架 or 娼妇 or 铁匠）。属「配置+经营进度」混合：
       店铺「定义」随存档快照、新游戏保留；「经营进度」(earnings/visits) 由 clearShopRun 在新游戏清空
       （照 craftStore「配置/图鉴保留，会话清空」口径）。
   - 立绘大图 partialize 出 localStorage → 存 IndexedDB（防 5MB 爆配额）：
       店招  shop-sign:<shopId>   商品 shop-good:<goodId>
       娼妇  shop-girl:<girlId>   铁匠 shop-smith:<shopId>
   - 娼馆复用 JoyGirl（性格/四阶段/立绘），铁匠铺复用 enhanceEngine 的 BossDef（参数玩家自填）。
   - 联机上传(published)+托管由 systems/shopClient.ts + ShopDO 负责；本 store 只存本地真相。
════════════════════════════════════════════ */

export type ShopType = 'store' | 'brothel' | 'smithy';

export const SHOP_TYPE_META: Record<ShopType, { label: string; emoji: string; blurb: string }> = {
  store:   { label: '商店',   emoji: '🏪', blurb: '售卖商品 / 随从 / 装备，自定义分类与定价' },
  brothel: { label: '娼馆',   emoji: '💗', blurb: '自编娼妇性格与立绘，套用欢愉宫演绎' },
  smithy:  { label: '铁匠铺', emoji: '⚒️', blurb: '替客人强化装备，铁匠人设与参数自定义' },
};

/** 一件商品（商店货架）。image 为运行时字段（大图存 IndexedDB）。 */
export interface ShopGood {
  id: string;
  kind?: 'item' | 'npc';  // 货物类型：物品(buy→addItem 入背包) / 随从(buy→createCompanion 建档入队)；缺省=item
  category: string;      // 自定义分类：商品 / 随从 / 装备 / 材料 / 消耗品…
  name: string;
  price: number;
  desc?: string;
  image?: string;        // 货品立绘·封面 = images[0]（运行时·派生·兼容旧单图读取点）
  images?: string[];     // 货品立绘图集（运行时·可多张·逛店自动轮播·JSON 数组存 shop-good:<id>）
  stock?: number;        // 库存；缺省 / <0 = 无限
  payload?: any;         // 可选真实物品结构（买入进背包；AI 生成货品填此）
  aiGen?: boolean;       // 是否 AI 生成
}

/** 铁匠铺配置：复用 enhanceEngine 的 BossDef（铁匠人设/立绘/参数），价表用默认 + 可调倍率。 */
export interface ShopSmith {
  boss: BossDef;         // 铁匠：name/persona/banterPreset/portrait(=portraits[0] 封面)/costMul/rateAdd/displayLie/critJump
  portraits?: string[];  // 铁匠立绘图集（运行时·可多张·进铺自动轮播·JSON 数组存 shop-smith:<shopId>）
  feeMul?: number;       // 店主附加费用倍率（叠在 boss.costMul 之上，默认 1）
}

export interface ShopEntity {
  id: string;
  type: ShopType;
  name: string;
  tagline?: string;      // 招牌语（一句话）
  intro?: string;        // 店铺简介（多行·逛店/上传展示；AI 生成货品也参考此定位）
  ownerPersona?: string; // 掌柜 / 老板性格（进店叙事注入）
  sign?: string;         // 店招立绘·封面 = signs[0]（运行时·派生·保留供旧单图读取点/联机封面兼容）
  signs?: string[];      // 店招立绘图集（运行时·可多张·逛店自动轮播·JSON 数组存 shop-sign:<id>）
  currency: string;      // '乐园币' | '魂币'（自由填）
  entryFee?: number;     // 进店门票（按 currency 结算·0/缺省=免费·主要给娼馆·进他人店时扣付）
  world?: string;        // 所属世界 / 乐园（空 = 通用）
  createdAt: number;
  published?: boolean;   // 已上传到商城（联机）
  remote?: boolean;      // 逛商城时物化进来的「别人的店」（运行时·不持久化·从"我的产业"隐藏·visit modal 直接复用）
  ownerName?: string;    // 远程店主名（remote 时展示）
  marketId?: string;     // 远程店在 ShopDO 里的 id（visit / 下架用）
  goods?: ShopGood[];    // store
  girls?: JoyGirl[];     // brothel（复用 JoyGirl）
  smith?: ShopSmith;     // smithy
}

const signKey  = (id: string) => `shop-sign:${id}`;
const goodKey  = (id: string) => `shop-good:${id}`;
const girlKey  = (id: string) => `shop-girl:${id}`;
const smithKey = (id: string) => `shop-smith:${id}`;

export const MAX_GALLERY = 100;   // 单个图集上限（店招 / 货品 / 娼妇 / 铁匠通用·防 IndexedDB 单值过大）

/** 解析 IndexedDB 里的店招值：新格式 = JSON 数组字符串；旧格式 = 单张 dataURL → 包成 [url]。 */
function parseSigns(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  if (raw[0] === '[') { try { const a = JSON.parse(raw); return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : []; } catch { return []; } }
  return [raw];   // 旧：单张 dataURL
}

/** 营收归一为「货币→额」映射，兼容旧版扁平数值（旧值默认按乐园币）。收益只以 乐园币/灵魂钱币 两种钱币计。 */
export function shopEarnMap(raw: unknown): Record<string, number> {
  if (typeof raw === 'number') return raw > 0 ? { 乐园币: Math.round(raw) } : {};
  if (raw && typeof raw === 'object') {
    const o: Record<string, number> = {};
    for (const k of Object.keys(raw as any)) { const n = Math.round(Number((raw as any)[k]) || 0); if (n > 0) o[k] = n; }
    return o;
  }
  return {};
}

let _seq = Date.now();

/** 铁匠铺默认铁匠（明面率=实际率、无套路，玩家再自行编辑人设/参数）。 */
function newSmithBoss(shopId: string): BossDef {
  return { id: `smith_${shopId}`, name: '铁匠', gender: '', persona: '', costMul: 1, rateAdd: 0, displayLie: 0, critJump: 0 };
}

interface ShopState {
  shops: ShopEntity[];
  earnings: Record<string, Record<string, number>>;   // shopId → { 货币 → 累计营收 }（乐园币/灵魂钱币 分别记账·收件箱·经营进度）
  visits: Record<string, number>;     // shopId → 客流计数

  createShop: (type: ShopType, name?: string) => string;
  upsertShop: (shop: ShopEntity) => void;
  patchShop: (id: string, patch: Partial<ShopEntity>) => void;
  removeShop: (id: string) => void;
  setShopSign: (id: string, dataUrl: string | undefined) => void;   // 兼容：设为单张封面（清空则删图集）
  setShopSigns: (id: string, urls: string[]) => void;               // 整组覆盖立绘图集
  addShopSign: (id: string, dataUrl: string) => void;               // 追加一张（≤ MAX_GALLERY）
  removeShopSign: (id: string, index: number) => void;              // 删第 index 张

  // 商店货架
  upsertGood: (shopId: string, good: ShopGood) => string;
  removeGood: (shopId: string, goodId: string) => void;
  setGoodImage: (shopId: string, goodId: string, dataUrl: string | undefined) => void;   // 兼容：单张封面
  setGoodImages: (shopId: string, goodId: string, urls: string[]) => void;
  addGoodImage: (shopId: string, goodId: string, dataUrl: string) => void;
  removeGoodImage: (shopId: string, goodId: string, index: number) => void;
  addGoods: (shopId: string, goods: ShopGood[]) => void;   // AI 批量生成入货架

  // 娼馆（复用 JoyGirl）
  upsertShopGirl: (shopId: string, girl: JoyGirl) => string;
  removeShopGirl: (shopId: string, girlId: string) => void;
  setShopGirlPortrait: (shopId: string, girlId: string, dataUrl: string | undefined) => void;   // 兼容：单张封面
  setShopGirlImages: (shopId: string, girlId: string, urls: string[]) => void;
  addShopGirlImage: (shopId: string, girlId: string, dataUrl: string) => void;
  removeShopGirlImage: (shopId: string, girlId: string, index: number) => void;

  // 铁匠铺
  setShopSmith: (shopId: string, smith: ShopSmith) => void;
  setShopSmithPortrait: (shopId: string, dataUrl: string | undefined) => void;   // 兼容：单张封面
  setShopSmithImages: (shopId: string, urls: string[]) => void;
  addShopSmithImage: (shopId: string, dataUrl: string) => void;
  removeShopSmithImage: (shopId: string, index: number) => void;

  // 经营进度
  earn: (shopId: string, amount: number, currency: string) => void;   // 按货币计入营收（乐园币/灵魂钱币）
  collectEarnings: (shopId: string) => Record<string, number>;   // 取走全部收益并清零，返回 { 货币 → 取走额 }
  bumpVisit: (shopId: string) => void;
  clearShopRun: () => void;                       // 新游戏：清经营进度，保留店铺定义
}

/** 从 shops 里定位一间店，返回 [下标, 店]；找不到返回 [-1, undefined]。 */
function locate(shops: ShopEntity[], id: string): [number, ShopEntity | undefined] {
  const i = shops.findIndex((s) => s.id === id);
  return [i, i >= 0 ? shops[i] : undefined];
}

/** 不可变地替换 shops[id] 为 patch 后的新店。 */
function replaceShop(shops: ShopEntity[], id: string, fn: (s: ShopEntity) => ShopEntity): ShopEntity[] {
  return shops.map((s) => (s.id === id ? fn(s) : s));
}

export const useShop = create<ShopState>()(
  persist(
    (set, get): ShopState => ({
      shops: [],
      earnings: {},
      visits: {},

      createShop: (type, name) => {
        const id = `shop_${++_seq}`;
        const base: ShopEntity = {
          id, type,
          name: name?.trim() || SHOP_TYPE_META[type].label,
          currency: '乐园币',
          createdAt: Date.now(),
        };
        if (type === 'store') base.goods = [];
        if (type === 'brothel') base.girls = [];
        if (type === 'smithy') base.smith = { boss: newSmithBoss(id), feeMul: 1 };
        set((s) => ({ shops: [...s.shops, base] }));
        return id;
      },

      upsertShop: (shop) =>
        set((s) => {
          const exists = s.shops.some((x) => x.id === shop.id);
          return { shops: exists ? s.shops.map((x) => (x.id === shop.id ? shop : x)) : [...s.shops, shop] };
        }),

      patchShop: (id, patch) =>
        set((s) => ({ shops: replaceShop(s.shops, id, (x) => ({ ...x, ...patch })) })),

      removeShop: (id) =>
        set((s) => {
          const [, shop] = locate(s.shops, id);
          if (shop) {
            delImg(signKey(id));
            delImg(smithKey(id));
            for (const g of shop.goods ?? []) delImg(goodKey(g.id));
            for (const g of shop.girls ?? []) delImg(girlKey(g.id));
          }
          const earnings = { ...s.earnings }; delete earnings[id];
          const visits = { ...s.visits }; delete visits[id];
          return { shops: s.shops.filter((x) => x.id !== id), earnings, visits };
        }),

      setShopSigns: (id, urls) => {
        const arr = (urls ?? []).filter(Boolean).slice(0, MAX_GALLERY);
        if (arr.length) putImg(signKey(id), JSON.stringify(arr)); else delImg(signKey(id));
        set((s) => ({ shops: replaceShop(s.shops, id, (x) => ({ ...x, signs: arr, sign: arr[0] })) }));
      },
      setShopSign: (id, dataUrl) => get().setShopSigns(id, dataUrl ? [dataUrl] : []),
      addShopSign: (id, dataUrl) => {
        if (!dataUrl) return;
        const [, sh] = locate(get().shops, id);
        const cur = sh?.signs ?? (sh?.sign ? [sh.sign] : []);
        get().setShopSigns(id, [...cur, dataUrl]);
      },
      removeShopSign: (id, index) => {
        const [, sh] = locate(get().shops, id);
        const cur = sh?.signs ?? (sh?.sign ? [sh.sign] : []);
        get().setShopSigns(id, cur.filter((_, i) => i !== index));
      },

      // ── 商店货架 ──
      upsertGood: (shopId, good) => {
        const id = good.id || `good_${++_seq}`;
        set((s) => ({
          shops: replaceShop(s.shops, shopId, (x) => {
            const goods = x.goods ?? [];
            const exists = goods.some((g) => g.id === id);
            const next = exists ? goods.map((g) => (g.id === id ? { ...g, ...good, id } : g)) : [...goods, { ...good, id }];
            return { ...x, goods: next };
          }),
        }));
        return id;
      },

      removeGood: (shopId, goodId) => {
        delImg(goodKey(goodId));
        set((s) => ({ shops: replaceShop(s.shops, shopId, (x) => ({ ...x, goods: (x.goods ?? []).filter((g) => g.id !== goodId) })) }));
      },

      setGoodImages: (shopId, goodId, urls) => {
        const arr = (urls ?? []).filter(Boolean).slice(0, MAX_GALLERY);
        if (arr.length) putImg(goodKey(goodId), JSON.stringify(arr)); else delImg(goodKey(goodId));
        set((s) => ({ shops: replaceShop(s.shops, shopId, (x) => ({ ...x, goods: (x.goods ?? []).map((g) => (g.id === goodId ? { ...g, images: arr, image: arr[0] } : g)) })) }));
      },
      setGoodImage: (shopId, goodId, dataUrl) => get().setGoodImages(shopId, goodId, dataUrl ? [dataUrl] : []),
      addGoodImage: (shopId, goodId, dataUrl) => {
        if (!dataUrl) return;
        const g = get().shops.find((x) => x.id === shopId)?.goods?.find((x) => x.id === goodId);
        const cur = g?.images ?? (g?.image ? [g.image] : []);
        get().setGoodImages(shopId, goodId, [...cur, dataUrl]);
      },
      removeGoodImage: (shopId, goodId, index) => {
        const g = get().shops.find((x) => x.id === shopId)?.goods?.find((x) => x.id === goodId);
        const cur = g?.images ?? (g?.image ? [g.image] : []);
        get().setGoodImages(shopId, goodId, cur.filter((_, i) => i !== index));
      },

      addGoods: (shopId, goods) =>
        set((s) => ({
          shops: replaceShop(s.shops, shopId, (x) => ({
            ...x,
            goods: [...(x.goods ?? []), ...goods.map((g) => ({ ...g, id: g.id || `good_${++_seq}` }))],
          })),
        })),

      // ── 娼馆（复用 JoyGirl）──
      upsertShopGirl: (shopId, girl) => {
        const id = girl.id || `sgirl_${++_seq}`;
        set((s) => ({
          shops: replaceShop(s.shops, shopId, (x) => {
            const girls = x.girls ?? [];
            const exists = girls.some((g) => g.id === id);
            const next = exists ? girls.map((g) => (g.id === id ? { ...g, ...girl, id } : g)) : [...girls, { ...girl, id }];
            return { ...x, girls: next };
          }),
        }));
        return id;
      },

      removeShopGirl: (shopId, girlId) => {
        delImg(girlKey(girlId));
        set((s) => ({ shops: replaceShop(s.shops, shopId, (x) => ({ ...x, girls: (x.girls ?? []).filter((g) => g.id !== girlId) })) }));
      },

      setShopGirlImages: (shopId, girlId, urls) => {
        const arr = (urls ?? []).filter(Boolean).slice(0, MAX_GALLERY);
        if (arr.length) putImg(girlKey(girlId), JSON.stringify(arr)); else delImg(girlKey(girlId));
        set((s) => ({ shops: replaceShop(s.shops, shopId, (x) => ({ ...x, girls: (x.girls ?? []).map((g) => (g.id === girlId ? { ...g, images: arr, portrait: arr[0] } : g)) })) }));
      },
      setShopGirlPortrait: (shopId, girlId, dataUrl) => get().setShopGirlImages(shopId, girlId, dataUrl ? [dataUrl] : []),
      addShopGirlImage: (shopId, girlId, dataUrl) => {
        if (!dataUrl) return;
        const g = get().shops.find((x) => x.id === shopId)?.girls?.find((x) => x.id === girlId);
        const cur = g?.images ?? (g?.portrait ? [g.portrait] : []);
        get().setShopGirlImages(shopId, girlId, [...cur, dataUrl]);
      },
      removeShopGirlImage: (shopId, girlId, index) => {
        const g = get().shops.find((x) => x.id === shopId)?.girls?.find((x) => x.id === girlId);
        const cur = g?.images ?? (g?.portrait ? [g.portrait] : []);
        get().setShopGirlImages(shopId, girlId, cur.filter((_, i) => i !== index));
      },

      // ── 铁匠铺 ──
      setShopSmith: (shopId, smith) =>
        set((s) => ({ shops: replaceShop(s.shops, shopId, (x) => ({ ...x, smith })) })),

      setShopSmithImages: (shopId, urls) => {
        const arr = (urls ?? []).filter(Boolean).slice(0, MAX_GALLERY);
        if (arr.length) putImg(smithKey(shopId), JSON.stringify(arr)); else delImg(smithKey(shopId));
        set((s) => ({
          shops: replaceShop(s.shops, shopId, (x) =>
            x.smith ? { ...x, smith: { ...x.smith, portraits: arr, boss: { ...x.smith.boss, portrait: arr[0] } } } : x),
        }));
      },
      setShopSmithPortrait: (shopId, dataUrl) => get().setShopSmithImages(shopId, dataUrl ? [dataUrl] : []),
      addShopSmithImage: (shopId, dataUrl) => {
        if (!dataUrl) return;
        const sm = get().shops.find((x) => x.id === shopId)?.smith;
        const cur = sm?.portraits ?? (sm?.boss.portrait ? [sm.boss.portrait] : []);
        get().setShopSmithImages(shopId, [...cur, dataUrl]);
      },
      removeShopSmithImage: (shopId, index) => {
        const sm = get().shops.find((x) => x.id === shopId)?.smith;
        const cur = sm?.portraits ?? (sm?.boss.portrait ? [sm.boss.portrait] : []);
        get().setShopSmithImages(shopId, cur.filter((_, i) => i !== index));
      },

      // ── 经营进度 ──
      earn: (shopId, amount, currency) => {
        const amt = Math.max(0, Math.round(amount)); if (!amt) return;
        const cur = currency || '乐园币';
        set((s) => {
          const m = shopEarnMap(s.earnings[shopId]);
          m[cur] = (m[cur] || 0) + amt;
          return { earnings: { ...s.earnings, [shopId]: m } };
        });
      },

      collectEarnings: (shopId) => {
        const m = shopEarnMap(get().earnings[shopId]);
        if (Object.keys(m).length) set((s) => ({ earnings: { ...s.earnings, [shopId]: {} } }));
        return m;
      },

      bumpVisit: (shopId) =>
        set((s) => ({ visits: { ...s.visits, [shopId]: (s.visits[shopId] ?? 0) + 1 } })),

      clearShopRun: () => set({ earnings: {}, visits: {} }),
    }),
    {
      name: 'drpg-shop',
      // 持久化：店铺定义（剥立绘大图）+ 经营进度；立绘由 hydrateShopImages 从 IndexedDB 回填。
      partialize: (s: any) => ({
        shops: (s.shops ?? []).filter((sh: ShopEntity) => !sh.remote).map((sh: ShopEntity) => ({
          ...sh,
          sign: undefined,
          signs: undefined,
          goods: (sh.goods ?? []).map((g) => ({ ...g, image: undefined, images: undefined })),
          girls: (sh.girls ?? []).map((g) => ({ ...g, portrait: undefined, images: undefined })),
          smith: sh.smith ? { ...sh.smith, portraits: undefined, boss: { ...sh.smith.boss, portrait: undefined } } : undefined,
        })),
        earnings: s.earnings ?? {},
        visits: s.visits ?? {},
      }),
      merge: (persisted: any, current) => ({
        ...current,
        ...persisted,
        shops: Array.isArray(persisted?.shops) ? persisted.shops : [],
        earnings: persisted?.earnings ?? {},
        visits: persisted?.visits ?? {},
      }),
    },
  ),
);

/** 启动 / 面板挂载时从 IndexedDB 回填全部产业立绘（店招 / 商品 / 娼妇 / 铁匠）。 */
export async function hydrateShopImages(): Promise<void> {
  try {
    const all = await getAllImg();
    if (!all || !Object.keys(all).length) return;
    useShop.setState((s) => ({
      shops: s.shops.map((sh) => {
        const signs = parseSigns(all[signKey(sh.id)]);
        return {
        ...sh,
        signs: signs.length ? signs : sh.signs,
        sign: signs[0] ?? sh.sign,
        goods: (sh.goods ?? []).map((g) => { const im = parseSigns(all[goodKey(g.id)]); return { ...g, images: im.length ? im : g.images, image: im[0] ?? g.image }; }),
        girls: (sh.girls ?? []).map((g) => { const im = parseSigns(all[girlKey(g.id)]); return { ...g, images: im.length ? im : g.images, portrait: im[0] ?? g.portrait }; }),
        smith: sh.smith ? (() => { const im = parseSigns(all[smithKey(sh.id)]); return { ...sh.smith!, portraits: im.length ? im : sh.smith!.portraits, boss: { ...sh.smith!.boss, portrait: im[0] ?? sh.smith!.boss.portrait } }; })() : sh.smith,
        };
      }),
    }));
  } catch { /* ignore */ }
}

/** 供 saveManager.clearProgress 调用：清经营进度，保留店铺定义（照 craftStore 口径）。 */
export function clearShopRun(): void {
  useShop.getState().clearShopRun();
}
