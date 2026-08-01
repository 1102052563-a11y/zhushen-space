/* Agent 正文模式 · 工具注册表（schema + 本地实现）
   - workspace 系：内存虚拟 FS（agentWorkspace）+ commit/finish 控制工具
   - 游戏数据系（只读）：楼层搜读 / 世界书激活快照 / 向量资料库检索 / 主角卡 / NPC 卡 / 骰子
   错误一律软回喂（{error:{code,message}}），由运行时决定致命性（仅未知工具与 finish 后调用致命）。 */
import { AgentWorkspace, MAIN_ARTIFACT_PATH, normalizePath } from './agentWorkspace';
import type { AgentRunInputs, AgentToolResult, AgentToolSpec } from './agentTypes';
import { retrieveNovel } from '../novelVec';
import { serializePlayerCard, serializeNpcCard, serializeFactionsSection } from '../structuredRecall';
import { buildQuestInjection } from '../promptInjections';
import { agentSqlQuery, listSqliteTables } from '../tableSqlite';
import { usePlayer } from '../../store/playerStore';
import { useGame } from '../../store/gameStore';
import { useNpc } from '../../store/npcStore';
import { useCharacters } from '../../store/characterStore';
import { useItems } from '../../store/itemStore';
import { useFaction } from '../../store/factionStore';

const MAX_CHAT_HITS = 30;
const MAX_CHAT_READ_MSGS = 10;
const MAX_MSG_CHARS = 8000;
const MAX_CHAT_TOTAL = 12000;
const MAX_WI_ENTRY = 8000;
const MAX_WI_TOTAL = 20000;

function err(code: string, message: string): AgentToolResult {
  return { ok: false, content: message, structured: { error: { code, message } }, errorCode: code };
}
const OBJ = (props: Record<string, unknown>, required: string[] = []): Record<string, unknown> =>
  ({ type: 'object', additionalProperties: false, properties: props, ...(required.length ? { required } : {}) });

/** 极简公式骰：NdM+K / 纯数字 N=1dN（确定性由调用方 rng 注入，默认 Math.random） */
export function rollDiceFormula(formula: string, rng: () => number = Math.random): { text: string; structured: Record<string, unknown> } | null {
  const s = String(formula || '').trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d*)d(\d+)([+-]\d+)?$/.exec(/^\d+$/.test(s) ? `1d${s}` : s);
  if (!m) return null;
  const n = Math.min(100, Math.max(1, Number(m[1] || 1)));
  const sides = Math.min(1000000, Math.max(2, Number(m[2])));
  const mod = Math.max(-1000000, Math.min(1000000, Number(m[3] || 0)));
  const rolls: number[] = [];
  for (let i = 0; i < n; i++) rolls.push(1 + Math.floor(rng() * sides));
  const total = rolls.reduce((a, b) => a + b, 0) + mod;
  const detail = n === 1 && !mod ? `${total}` : `${rolls.join(' + ')}${mod ? ` ${mod > 0 ? '+' : '-'} ${Math.abs(mod)}` : ''} = ${total}`;
  return { text: `Rolled ${n}d${sides}${mod ? (mod > 0 ? `+${mod}` : String(mod)) : ''}: ${detail}.`, structured: { formula: `${n}d${sides}${mod ? (mod > 0 ? `+${mod}` : String(mod)) : ''}`, rolls, modifier: mod, total } };
}

export interface AgentToolCtx {
  ws: AgentWorkspace;
  inputs: AgentRunInputs;
}

/** 组装全部工具（toggles: modelName→bool，缺省启用；dice_roll 缺省关由 AGENT_DEFAULTS 兜） */
export function buildAgentTools(ctx: AgentToolCtx, toggles: Record<string, boolean>): AgentToolSpec[] {
  const { ws, inputs } = ctx;
  const all: AgentToolSpec[] = [];
  const add = (t: AgentToolSpec) => { if (toggles[t.modelName] !== false) all.push(t); };

  /* ── workspace 系 ── */
  add({
    name: 'workspace.list_files', modelName: 'workspace_list_files',
    description: '列出工作区文件（根目录：output/ scratch/ plan/）。',
    parameters: OBJ({ path: { type: 'string', description: '可选：只列该前缀下的文件' } }),
    run: (a) => ws.listFiles(a.path),
  });
  add({
    name: 'workspace.search_files', modelName: 'workspace_search_files',
    description: '在工作区文件里全文搜索，返回 路径:行号:该行内容。',
    parameters: OBJ({ query: { type: 'string' }, limit: { type: 'integer', description: '默认 10，最大 20' } }, ['query']),
    run: (a) => ws.searchFiles(a.query, a.limit),
  });
  add({
    name: 'workspace.read_file', modelName: 'workspace_read_file',
    description: '读工作区文件。返回首行元数据 + 带行号正文（行号仅供定位，写回时绝不要带行号前缀）。修改已有文件前必须先读。',
    parameters: OBJ({
      path: { type: 'string' },
      start_line: { type: 'integer', description: '1 起始；与 start_char 二选一' },
      line_count: { type: 'integer' },
      start_char: { type: 'integer', description: '0 起始' },
      max_chars: { type: 'integer', description: '最大 30000' },
    }, ['path']),
    run: (a) => ws.readFile(a),
  });
  add({
    name: 'workspace.write_file', modelName: 'workspace_write_file',
    description: '写工作区文件（创建 / append 追加 / replace 整写；replace 已存在文件须先读过）。只回摘要不回全文。',
    parameters: OBJ({ path: { type: 'string' }, content: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append'], description: '默认 replace' } }, ['path', 'content']),
    run: (a) => ws.writeFile(a),
  });
  add({
    name: 'workspace.apply_patch', modelName: 'workspace_apply_patch',
    description: '对已有文件做精确替换。old_string 必须与文件当前内容完全一致且唯一（否则给更多上下文或 replace_all=true）；失败后须整读文件再试。',
    parameters: OBJ({ path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, ['path', 'old_string', 'new_string']),
    run: (a) => ws.applyPatch(a),
  });
  add({
    name: 'workspace.commit', modelName: 'workspace_commit',
    description: `把工作区文件发布为本回合的聊天正文楼层。不带参数=用 ${MAIN_ARTIFACT_PATH} 整体替换本次运行的楼层；mode=append 在同一楼层后追加。可多次 commit 反复修订。`,
    parameters: OBJ({ path: { type: 'string', description: `默认 ${MAIN_ARTIFACT_PATH}` }, mode: { type: 'string', enum: ['replace', 'append'] }, reason: { type: 'string' } }),
    run: (a) => {
      const path = a.path == null || a.path === '' ? MAIN_ARTIFACT_PATH : normalizePath(a.path);
      if (!path) return err('workspace.invalid_path', `invalid workspace path: ${String(a.path ?? '')}`);
      const txt = ws.files.get(path);
      if (txt === undefined) return err('workspace.file_not_found', `${path} does not exist`);
      if (!txt.trim()) return err('workspace.required_artifact_empty', `${path} is empty`);
      const mode = a.mode === 'append' ? 'append' : 'replace';
      return {
        ok: true, effect: 'commit', commit: { path, mode, text: txt },
        content: `Committed ${path} to the current chat message with mode ${mode}. You may continue editing and commit again if needed. When all intended commits are complete, call workspace_finish to end the run. Do not use plain text as the final answer; the run must finish through workspace_finish.`,
        structured: { path, mode, chars: txt.length },
      };
    },
  });
  add({
    name: 'workspace.finish', modelName: 'workspace_finish',
    description: '结束本次 Agent 运行。必须先成功 workspace_commit 至少一次才能 finish。',
    parameters: OBJ({ reason: { type: 'string' } }),
    run: () => ({ ok: true, effect: 'finish', content: 'Finished the Agent run.', structured: {} }),
  });

  /* ── 上下文/游戏数据系（只读）── */
  add({
    name: 'chat.search', modelName: 'chat_search',
    description: '在全部历史楼层里按关键词搜索（当前提示词窗口之外的更早剧情也能搜到），返回楼层号+片段。',
    parameters: OBJ({
      query: { type: 'string' },
      limit: { type: 'integer', description: `默认 10，最大 ${MAX_CHAT_HITS}` },
      role: { type: 'string', enum: ['user', 'assistant'] },
    }, ['query']),
    run: (a) => {
      const q = String(a.query ?? '').trim();
      if (!q) return err('tool.invalid_arguments', 'query is required');
      const limit = Math.max(1, Math.min(MAX_CHAT_HITS, Number(a.limit) || 10));
      const terms = Array.from(new Set([q, ...q.split(/[\s,，、；;]+/).filter((t) => t.length >= 2)])).map((t) => t.toLowerCase());
      const hits: { index: number; role: string; score: number; snippet: string; chars: number }[] = [];
      inputs.history.forEach((msg, index) => {
        if (a.role && msg.role !== a.role) return;
        const lower = (msg.content || '').toLowerCase();
        let score = 0; let first = -1;
        for (const t of terms) { let i = lower.indexOf(t); while (i >= 0) { score++; if (first < 0) first = i; i = lower.indexOf(t, i + t.length); } }
        if (score > 0) hits.push({ index, role: msg.role, score, chars: msg.content.length, snippet: msg.content.slice(Math.max(0, first - 40), Math.max(0, first - 40) + 160).replace(/\s+/g, ' ') });
      });
      hits.sort((x, y) => y.score - x.score);
      const top = hits.slice(0, limit);
      return {
        ok: true,
        content: top.length ? top.map((h) => `#${h.index} [${h.role}] (score ${h.score}, ${h.chars} chars) …${h.snippet}…`).join('\n') : `No messages matched "${q}".`,
        structured: { query: q, hits: top },
      };
    },
  });
  add({
    name: 'chat.read_messages', modelName: 'chat_read_messages',
    description: `按楼层号读历史消息原文（配合 chat_search 的 #号）。长楼层用 start_char/max_chars 分段读；单次最多 ${MAX_CHAT_READ_MSGS} 条。`,
    parameters: OBJ({
      messages: {
        type: 'array', minItems: 1,
        items: OBJ({ index: { type: 'integer' }, start_char: { type: 'integer' }, max_chars: { type: 'integer', description: `最大 ${MAX_MSG_CHARS}` } }, ['index']),
      },
    }, ['messages']),
    run: (a) => {
      const list = Array.isArray(a.messages) ? a.messages.slice(0, MAX_CHAT_READ_MSGS) : null;
      if (!list || !list.length) return err('tool.invalid_arguments', 'messages must be a non-empty array of {index}');
      let total = 0; const parts: string[] = [];
      for (const it of list as Array<Record<string, unknown>>) {
        const index = Math.floor(Number(it?.index));
        const msg = inputs.history[index];
        if (!msg) { parts.push(`#${index}: (not found; valid range 0-${inputs.history.length - 1})`); continue; }
        const start = Math.max(0, Math.floor(Number(it?.start_char) || 0));
        const maxC = Math.max(1, Math.min(MAX_MSG_CHARS, Number(it?.max_chars) || MAX_MSG_CHARS));
        let slice = msg.content.slice(start, start + maxC);
        if (total + slice.length > MAX_CHAT_TOTAL) slice = slice.slice(0, Math.max(0, MAX_CHAT_TOTAL - total));
        total += slice.length;
        parts.push(`#${index} [${msg.role}] chars ${start}-${start + slice.length} of ${msg.content.length}:\n${slice}`);
        if (total >= MAX_CHAT_TOTAL) { parts.push('(total read budget reached)'); break; }
      }
      return { ok: true, content: parts.join('\n\n'), structured: { count: parts.length } };
    },
  });
  add({
    name: 'worldinfo.read_activated', modelName: 'worldinfo_read_activated',
    description: '读本回合已激活的世界书条目。不带参数=只列索引（ref/名称/字数）；要正文就传 entries:[{ref}]。',
    parameters: OBJ({
      entries: {
        type: 'array', minItems: 1,
        items: OBJ({ ref: { type: 'string', description: '形如 wi#0' }, start_char: { type: 'integer' }, max_chars: { type: 'integer', description: `最大 ${MAX_WI_ENTRY}` } }, ['ref']),
      },
    }),
    run: (a) => {
      const hitsList = inputs.wbHits;
      if (!Array.isArray(a.entries)) {
        const rows = hitsList.map((e, i) => `wi#${i}  ${e.name}${e.constant ? '（常驻）' : ''}  (${e.content.length} chars)`);
        return { ok: true, content: rows.length ? rows.join('\n') : '本回合无已激活的世界书条目。', structured: { count: rows.length } };
      }
      let total = 0; const parts: string[] = [];
      for (const it of (a.entries as Array<Record<string, unknown>>).slice(0, 20)) {
        const m = /^wi#(\d+)$/.exec(String(it?.ref ?? '').trim());
        const e = m ? hitsList[Number(m[1])] : undefined;
        if (!e) { parts.push(`${String(it?.ref)}: (not found)`); continue; }
        const start = Math.max(0, Math.floor(Number(it?.start_char) || 0));
        const maxC = Math.max(1, Math.min(MAX_WI_ENTRY, Number(it?.max_chars) || MAX_WI_ENTRY));
        let slice = e.content.slice(start, start + maxC);
        if (total + slice.length > MAX_WI_TOTAL) slice = slice.slice(0, Math.max(0, MAX_WI_TOTAL - total));
        total += slice.length;
        parts.push(`[${e.name}]\n${slice}`);
        if (total >= MAX_WI_TOTAL) break;
      }
      return { ok: true, content: parts.join('\n\n'), structured: { count: parts.length } };
    },
  });
  add({
    name: 'lore.search', modelName: 'lore_search',
    description: '语义检索向量资料库（原著小说+世界书）——查设定、桥段、人物往事。未建库时返回空。',
    parameters: OBJ({ query: { type: 'string' }, limit: { type: 'integer', description: '默认 5，最大 8' } }, ['query']),
    run: async (a) => {
      const q = String(a.query ?? '').trim();
      if (!q) return err('tool.invalid_arguments', 'query is required');
      try {
        const hits = await retrieveNovel(q);
        const top = hits.slice(0, Math.max(1, Math.min(8, Number(a.limit) || 5)));
        return {
          ok: true,
          content: top.length ? top.map((h) => `〔${h.source}·${(h as { chap?: string; vol?: string }).chap || (h as { vol?: string }).vol || ''}〕${h.text.slice(0, 1200)}`).join('\n\n') : `资料库无相关命中（或未建库）。`,
          structured: { count: top.length },
        };
      } catch (e) { return err('lore.search_failed', `检索失败：${String((e as Error)?.message ?? e)}`); }
    },
  });
  add({
    name: 'player.get', modelName: 'player_get',
    description: '读主角完整档案卡：身份/阶位/六维/HP/EP/技能/天赋/称号/副职业/全部物品（含效果）/货币。',
    parameters: OBJ({}),
    run: () => {
      try {
        const P = usePlayer.getState();
        const game = useGame.getState().player;
        const b1 = useCharacters.getState().characters['B1'];
        const card = serializePlayerCard(
          P.profile, game, b1?.skills ?? [], b1?.traits ?? [], useItems.getState().items,
          { maxNpcs: 0, maxSkills: 99, maxItems: 99, maxSubProfs: 99 },
          b1?.titles, b1?.subProfessions, useItems.getState().currency,
          undefined, undefined, undefined, false, true,
        );
        return { ok: true, content: card, structured: { chars: card.length } };
      } catch (e) { return err('player.read_failed', `读取主角档案失败：${String((e as Error)?.message ?? e)}`); }
    },
  });
  add({
    name: 'npc.list', modelName: 'npc_list',
    description: '列 NPC 名册（在场优先）：名字/阶位/在场与否。要详情用 npc_get。',
    parameters: OBJ({ on_scene_only: { type: 'boolean', description: 'true=只列在场' } }),
    run: (a) => {
      try {
        const npcs = Object.values(useNpc.getState().npcs) as Array<Record<string, any>>;
        const rows = npcs
          .filter((n) => !n.isDead && (!a.on_scene_only || n.onScene))
          .sort((x, y) => Number(!!y.onScene) - Number(!!x.onScene))
          .slice(0, 60)
          .map((n) => `${n.name}${n.realm ? `（${n.realm}）` : ''}${n.onScene ? ' ·在场' : ''}`);
        return { ok: true, content: rows.length ? rows.join('\n') : '当前没有 NPC 档案。', structured: { count: rows.length } };
      } catch (e) { return err('npc.read_failed', `读取名册失败：${String((e as Error)?.message ?? e)}`); }
    },
  });
  add({
    name: 'npc.get', modelName: 'npc_get',
    description: '按名字读单个 NPC 的完整档案卡（六维/技能/装备/关系/动机等）。',
    parameters: OBJ({ name: { type: 'string' } }, ['name']),
    run: (a) => {
      const want = String(a.name ?? '').trim();
      if (!want) return err('tool.invalid_arguments', 'name is required');
      try {
        const npcs = Object.values(useNpc.getState().npcs) as Array<Record<string, any>>;
        const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
        const npc = npcs.find((n) => norm(String(n.name || '')) === norm(want))
          ?? npcs.find((n) => norm(String(n.name || '')).includes(norm(want)) || norm(want).includes(norm(String(n.name || ''))));
        if (!npc) return err('npc.not_found', `没有名为「${want}」的 NPC 档案（用 npc_list 查看名册）`);
        const cd = useCharacters.getState().characters[String(npc.id)];
        const card = serializeNpcCard(npc as never, cd?.skills ?? [], cd?.traits ?? [], cd?.titles, undefined,
          { maxNpcs: 0, maxSkills: 99, maxItems: 99, maxSubProfs: 99 });
        return { ok: true, content: card, structured: { name: npc.name } };
      } catch (e) { return err('npc.read_failed', `读取档案失败：${String((e as Error)?.message ?? e)}`); }
    },
  });
  add({
    name: 'quest.get', modelName: 'quest_get',
    description: '读当前任务态势：主线路线图/进行中任务/结算规则（与正文注入同源，运行中可随时复查）。',
    parameters: OBJ({}),
    run: () => {
      try {
        const blocks = buildQuestInjection(false);
        const content = blocks.map((b) => b.content).join('\n\n').trim();
        return { ok: true, content: content || '当前没有任务数据（可能不在任务世界，或任务系统未启用）。', structured: { chars: content.length } };
      } catch (e) { return err('quest.read_failed', `读取任务失败：${String((e as Error)?.message ?? e)}`); }
    },
  });
  add({
    name: 'faction.get', modelName: 'faction_get',
    description: '读势力档案汇总：各势力对主角态度/规模/目标/关系（写势力戏前查一眼保持一致）。',
    parameters: OBJ({ limit: { type: 'integer', description: '最多几个势力，默认 12' } }),
    run: (a) => {
      try {
        const list = Object.values(useFaction.getState().factions ?? {});
        if (!list.length) return { ok: true, content: '当前没有势力档案。', structured: { count: 0 } };
        const max = Math.max(1, Math.min(30, Number(a.limit) || 12));
        const content = serializeFactionsSection(list as never, max);
        return { ok: true, content: content || '当前没有势力档案。', structured: { count: Math.min(list.length, max) } };
      } catch (e) { return err('faction.read_failed', `读取势力失败：${String((e as Error)?.message ?? e)}`); }
    },
  });
  add({
    name: 'db.query', modelName: 'db_query',
    description: '对游戏状态表（主角/背包/NPC/纪要/伏笔等 20 张镜像表·中文表名列名）执行只读 SELECT。不带 sql=列出全部表名；先 SELECT * FROM "表名" LIMIT 3 看列，再精确查询。未写 LIMIT 自动补 LIMIT 50。',
    parameters: OBJ({ sql: { type: 'string', description: '单条 SELECT；表名/列名是中文，须用双引号包裹，如 SELECT * FROM "重要物品表" LIMIT 5' } }),
    run: async (a) => {
      try {
        const sql = String(a.sql ?? '').trim();
        if (!sql) {
          const r = await agentSqlQuery('SELECT 1');   // 先确保镜像已建
          if (!r.ok) return err('db.unavailable', r.error || '表镜像不可用');
          const tables = listSqliteTables();
          return { ok: true, content: tables.length ? `可查询的表（${tables.length}）：\n${tables.map((t) => `"${t}"`).join('\n')}` : '镜像里没有表。', structured: { tables } };
        }
        const r = await agentSqlQuery(sql);
        if (!r.ok) return err('db.query_failed', r.error || '查询失败');
        const cols = r.columns ?? []; const rows = r.values ?? [];
        const cell = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').slice(0, 80);
        let content = rows.length
          ? `${cols.join(' | ')}\n${rows.map((row) => row.map(cell).join(' | ')).join('\n')}`
          : '（查询成功，0 行结果）';
        if (content.length > 6000) content = content.slice(0, 6000) + '\n…(截断，请加 WHERE/LIMIT 缩小范围)';
        return { ok: true, content, structured: { columns: cols, rowCount: rows.length } };
      } catch (e) { return err('db.query_failed', `查询异常：${String((e as Error)?.message ?? e)}`); }
    },
  });
  add({
    name: 'dice.roll', modelName: 'dice_roll',
    description: '掷公式骰（如 1d20、3d6+4）。只在剧情确需随机检定时用，绝不虚构结果。',
    parameters: OBJ({ formula: { type: 'string' } }, ['formula']),
    run: (a) => {
      const r = rollDiceFormula(String(a.formula ?? ''));
      if (!r) return err('dice.invalid_formula', `invalid dice formula: ${String(a.formula ?? '')}（格式如 1d20 / 3d6+4）`);
      return { ok: true, content: r.text, structured: r.structured };
    },
  });

  return all;
}
