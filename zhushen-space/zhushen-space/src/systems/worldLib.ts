/* 世界库解析 / 抽样（纯函数·零依赖）：
   - parseWorldLib：解析世界书「选择N阶世界 / 休闲世界」条目 → {编号→世界名}（从 WorldSelector 抽出，点名 roll 与频道取材共用）。
   - sampleWorldPoolText：从已启用世界书按阶收集全部世界名并随机抽样一批，返回可直接注入提示词的分组文本
     （公共频道生成用：让帖子谈论的副本世界从整个世界库取材，而非预设里举例的几个热门世界）。 */

export interface WorldLib { ids: number[]; nameById: Map<number, string>; count: number; }

// 解析「世界选择 / 休闲」世界书条目 → {世界书原始编号 id → 世界名}。**编号沿用世界书 id（可不连续），与世界书逐一对应**，
// 不再用「第几个出现」的连续序号（那会因世界库跳号导致 roll 出的编号和世界对不上）。
// 兼容五种格式：① 四~八阶主库散文式「N. **世界名** | **副标题**：描述」(最高优先·N=编号·取首个粗体为名)、
//   ② 带引号 "id|name"、③ 九阶 bold **id|name**、④ 裸行 id|name、⑤ 休闲 YAML id:/name:。
//   ①置首：四~八阶主世界库以此格式承载数百个世界(旧解析器认不出→roll编号对不上世界)，让规范编号(1=我欲封天…与一~三阶一致)胜出；
//   一~三/九阶无此格式故①命中0、行为不变；同编号撞重保留首个 → 主库编号压过误编号为1的「原生世界」小表。
export function parseWorldLib(content: string): WorldLib {
  const nameById = new Map<number, string>();
  const ids: number[] = [];
  const add = (idStr: string, name: string) => {
    const nm = String(name).replace(/\*+/g, '').replace(/^["「\s]+|["」\s]+$/g, '').trim();
    if (!nm) return;
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id) || nameById.has(id)) return;   // 同编号撞重时保留首个，保证编号唯一
    nameById.set(id, nm);
    ids.push(id);
  };
  const patterns = [
    /(?:^|[\r\n])[ \t]*(\d+)[.、]\s*\*\*([^*\n|]+?)\*\*\s*[|｜]/g,
    /"(\d+)\|([^"|]+)"/g,
    /\*\*(\d+)\|([^*|]+)\*\*/g,
    /(?:^|[\r\n])[ \t>*-]*(\d+)\|([^"\n\r*|]+)/g,
    /id:\s*(\d+)\s*[\r\n]+\s*name:\s*"?([^"\n\r]+?)"?\s*(?=[\r\n]|$)/g,
  ];
  for (const re of patterns) { let m: RegExpExecArray | null; while ((m = re.exec(content)) !== null) add(m[1], m[2]); }
  ids.sort((a, b) => a - b);
  return { ids, nameById, count: ids.length };
}

// 结构化鸭子类型：settingsStore 的 WorldBook 天然满足（避免 systems 反向依赖 store 类型）
export interface WorldPoolBook {
  enabled: boolean;
  name?: string;
  builtinKey?: string;
  entries: { enabled: boolean; key?: string[]; content?: string }[];
}

// Fisher-Yates 前 n 个（世界数不足 n 时全取），与 WorldSelector 的 rollPickIds 同算法
function pickN<T>(pool: T[], n: number): T[] {
  const arr = [...pool];
  const take = Math.min(n, arr.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, take);
}

const TIER_CNS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

// 合并多条目世界名（同名去重保首个）
function namesOf(entries: { content?: string }[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const e of entries) {
    const lib = parseWorldLib(e.content || '');
    for (const id of lib.ids) {
      const nm = lib.nameById.get(id)!;
      if (!seen.has(nm)) { seen.add(nm); names.push(nm); }
    }
  }
  return names;
}

/* 从已启用世界书收集「选择一~九阶世界」+「休闲世界」的全部世界名，每阶随机抽 perTier 个（休闲抽一半），
   返回按阶分组的多行文本（如「三阶：进击的巨人、咒术回战、…」）；世界库为空返回 ''（调用方据此跳过注入）。
   每次调用重新抽样 → 频道每次刷新谈论的世界随之轮换。条目定位逻辑与 WorldSelector.worldLib 一致。 */
export function sampleWorldPoolText(books: WorldPoolBook[], perTier = 8): string {
  const enabled = books.filter((b) => b.enabled);
  const lines: string[] = [];
  for (const cn of TIER_CNS) {
    const tierKey = `选择${cn}阶世界`;
    const names = namesOf(enabled.flatMap((b) => b.entries.filter((e) => e.enabled && (e.key || []).some((k) => k.includes(tierKey)))));
    if (names.length) lines.push(`${cn}阶：${pickN(names, perTier).join('、')}`);
  }
  const leisure = namesOf(
    enabled
      .filter((b) => b.builtinKey === 'wb-leisure' || b.name === '休闲世界')
      .flatMap((b) => b.entries.filter((e) => e.enabled)),
  );
  if (leisure.length) lines.push(`休闲（恋爱/日常向）：${pickN(leisure, Math.max(3, Math.floor(perTier / 2))).join('、')}`);
  return lines.join('\n');
}
