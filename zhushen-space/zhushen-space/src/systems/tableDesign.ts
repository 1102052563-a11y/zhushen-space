/* 🤖 AI 建表助手（借鉴 ACU「AI 改表助手」+《自定义表建表指南》的契约分层）：
   玩家一句话描述想记什么 → 便宜模型产出 {表名/列/维护规则/单行?} → 机械校验（指南的"必须契约"）→ 回填新建表单预览。
   只产设计稿不直接建表——玩家过目确认才 upsertSheet（uid 冲突检查在 CustomTableModal.create 原路径）。
   接口走填表路由 featureKey 'table'（只吐一小段 JSON·便宜模型即可）；失败抛错由弹层显示。 */
import { useSettings, resolveApiChain } from '../store/settingsStore';
import { apiChatFallback } from './apiChat';
import { lenientJsonParse } from './stateParser';

export interface TableDesign { name: string; headers: string[]; note: string; single: boolean }

/** 机械校验（指南「必须契约」下沉）：不满足直接打回，绝不带病回填表单。 */
export function validateTableDesign(d: unknown): { ok: true; design: TableDesign } | { ok: false; error: string } {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, error: '不是 JSON 对象' };
  const o = d as Record<string, unknown>;
  const name = String(o.name ?? '').trim();
  if (!name) return { ok: false, error: '表名为空' };
  if (name.length > 16) return { ok: false, error: `表名过长（${name.length} 字）` };
  const rawHeaders = Array.isArray(o.headers) ? o.headers : [];
  const headers = rawHeaders.map((h) => String(h ?? '').trim()).filter(Boolean);
  if (headers.length < 1) return { ok: false, error: '没有可用的列' };
  if (headers.length > 12) return { ok: false, error: `列太多（${headers.length}>12）——精简到真正要跨回合追踪的字段` };
  if (new Set(headers).size !== headers.length) return { ok: false, error: '列名有重复' };
  if (headers.some((h) => h.length > 12)) return { ok: false, error: '有列名过长（>12 字）' };
  const note = String(o.note ?? '').trim();
  if (!note) return { ok: false, error: '维护规则(note)为空——那是 AI 维护这张表的唯一依据' };
  return { ok: true, design: { name, headers, note, single: !!o.single } };
}

/** 从模型回复里抠出第一个完整 JSON 对象（容忍前后废话/代码围栏），宽松解析。 */
export function extractDesignJson(reply: string): unknown {
  const s = String(reply ?? '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return undefined;
  return lenientJsonParse(s.slice(a, b + 1));
}

/** 设计提示词：把《建表指南》的必须契约+推荐项压成生成规则（枚举全列出/排除词/单行表纪律）。 */
const DESIGN_RULE = `你是"自定义表设计助手"。玩家会描述一个想在跑团/RPG 剧情里持续追踪的东西，你为它设计**一张** AI 每回合自动维护的表。

只输出一个 JSON 对象，不写任何其他文字：
{"name":"表名","headers":["列1","列2"],"note":"维护规则","single":false}

设计契约（必须遵守）：
- name：名词短语、以「表」结尾（如「好感度表」「悬赏令表」），≤10 字。
- headers：2~8 个简短中文列名（≤6 字），互不重复；多行表第一列是业务主键（角色名/物品名/据点名这类唯一标识）。**不要**加 row_id/编号列（引擎自带）。
- single：这东西全局只有一份（如"主角心情""队伍粮草总量"）→ true；一条一行（每个角色/每张悬赏各一行）→ false。
- note 是 AI 维护这张表的唯一依据，按此结构写成一段（换行用 \\n）：
  ① 第一句：这张表记什么、一行代表什么；单行表必须写明「此表有且仅有一行」。
  ② 逐列说明：- 列名：含义；有枚举值的**把所有可选值列全**（如 状态：潜伏/追捕中/已了结）；数值列写范围与增减幅度约定；存多个值的列声明分隔符（如「用分号分隔」）。
  ③ 新增：什么情况 insertRow、什么情况**不**新增（用"未记录过""全新"这类排除词防重复建行）；单行表写「禁止新增」。
  ④ 更新：什么情况 updateRow 改哪些列、什么情况不改（如"临时波动不记"）。
  ⑤ 删除：什么情况可删、什么情况不删（默认写「一般改状态保留，不删除」——可追溯优先）。
- 全部用中文；note ≤ 400 字；忠于玩家描述，别自作主张扩需求。`;

/** 调 AI 生成设计稿（走填表路由 'table'·回退正文 API）。校验不过=抛错（带原始回复片段便于排查）。 */
export async function generateTableDesign(wish: string): Promise<TableDesign> {
  const w = wish.trim();
  if (!w) throw new Error('先用一句话描述想记什么');
  const ss = useSettings.getState();
  const legacy = ss.textUseSharedApi ? ss.api : ss.textApi;
  const chain = resolveApiChain('table', legacy);
  if (!chain[0]?.baseUrl || !chain[0]?.apiKey) throw new Error('未配置 AI 接口（填表路由与正文 API 都空）——先去 设置→正文生成 配接口');
  const { content } = await apiChatFallback(chain, [
    { role: 'system', content: DESIGN_RULE },
    { role: 'user', content: `玩家想追踪的东西：${w.slice(0, 500)}\n\n现在输出设计 JSON：` },
  ], { label: 'AI 建表助手', timeoutMs: 90000, rawLang: true });
  const parsed = extractDesignJson(String(content ?? ''));
  const v = validateTableDesign(parsed);
  if (!v.ok) throw new Error(`AI 设计稿不合规（${v.error}）——可再点一次重试，或换个说法描述`);
  return v.design;
}
