import { useEffect, useRef, useState } from 'react';
import { useJoy, hydrateJoyPortraits, hydrateJoyWorldBooks, DEFAULT_GIRLS, JOY_PRIVATE_COLS, type JoyGirl } from '../store/joyStore';
import type { WorldBook, WorldBookEntry } from '../store/settingsStore';
import { shrinkDataUrl } from '../systems/imageGen';
import ApiRoutePicker from './ApiRoutePicker';

/* 欢愉宫配置：美女名册（含看板娘）—— 立绘/人设/迎宾词/对话预设/四阶段递进/初始私密 + 独立 API。
   挂在 设置→变量管理→欢愉宫。属全局配置（走 configExport，立绘存 IndexedDB；情欲值/聊天进度不导出）。*/

const inputCls = 'bg-void border border-edge rounded px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-pink-400/40';
const RACE_EMOJI = (race = ''): string =>
  /蛇/.test(race) ? '🐍' : /火|法师|魔法/.test(race) ? '🔥' : /魅魔|梦魔/.test(race) ? '😈' : /精灵/.test(race) ? '🧝‍♀️'
  : /青楼|花魁|古/.test(race) ? '🏮' : '💋';

function GirlCard({ girl, onEditPreset }: { girl: JoyGirl; onEditPreset: () => void }) {
  const upsertGirl = useJoy((s) => s.upsertGirl);
  const removeGirl = useJoy((s) => s.removeGirl);
  const setGirlPortrait = useJoy((s) => s.setGirlPortrait);
  const girlCount = useJoy((s) => s.settings.girls.length);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = (p: Partial<JoyGirl>) => upsertGirl({ ...girl, ...p });

  const onFile = async (f: File | null) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try { const shrunk = await shrinkDataUrl(String(reader.result), 1280, 0.85); setGirlPortrait(girl.id, shrunk); }
      catch { setGirlPortrait(girl.id, String(reader.result)); }
    };
    reader.readAsDataURL(f);
  };

  return (
    <div className="rounded-xl border border-pink-500/20 bg-panel p-3 flex max-lg:flex-col gap-3">
      <div className="shrink-0 w-24 flex flex-col gap-1.5">
        <div className="w-24 h-32 rounded-lg border border-edge bg-void overflow-hidden flex items-center justify-center">
          {girl.portrait
            ? <img src={girl.portrait} alt={girl.name} className="w-full h-full object-cover" />
            : <span className="text-4xl text-pink-300/30">{RACE_EMOJI(girl.race)}</span>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        <button onClick={() => fileRef.current?.click()} className="text-[11px] font-mono py-1 rounded border border-edge text-dim hover:text-pink-100 hover:border-pink-400/40">上传立绘</button>
        {girl.portrait && <button onClick={() => setGirlPortrait(girl.id, undefined)} className="text-[11px] font-mono py-0.5 rounded text-blood/60 hover:text-blood">清除</button>}
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <input value={girl.name} onChange={(e) => patch({ name: e.target.value })} placeholder="芳名" className={`${inputCls} flex-1 font-semibold min-w-0`} />
          <input value={girl.race} onChange={(e) => patch({ race: e.target.value })} placeholder="种族" className={`${inputCls} w-24`} />
          {girlCount > 1 && <button onClick={() => removeGirl(girl.id)} className="text-blood/60 hover:text-blood text-sm px-1 shrink-0" title="删除">✕</button>}
        </div>
        <div className="flex items-center gap-2">
          <input value={girl.title ?? ''} onChange={(e) => patch({ title: e.target.value.trim() || undefined })} placeholder="头衔（花魁/女主人…可空）" className={`${inputCls} flex-1 min-w-0`} />
          <label className="flex items-center gap-1.5 text-[12px] text-pink-200/80 cursor-pointer shrink-0 px-1">
            <input type="checkbox" checked={!!girl.isMadam} onChange={(e) => patch({ isMadam: e.target.checked })} className="accent-pink-500" />
            看板娘
          </label>
        </div>
        <textarea value={girl.persona} onChange={(e) => patch({ persona: e.target.value })} rows={2}
          placeholder="性格简介（一句话 · 卡片摘要；详细性格/经历/外观点下方编辑）" className={`${inputCls} w-full resize-none leading-snug`} />
        <button onClick={onEditPreset}
          className="w-full text-left text-[12px] font-mono px-2 py-1.5 rounded-lg border border-pink-500/30 text-pink-200/90 bg-pink-500/5 hover:bg-pink-500/10 transition-colors">
          ✎ 迎宾词 · 对话预设 · 四阶段递进 · 初始私密（点击编辑）
        </button>
        <input value={girl.portraitFolder ?? ''} onChange={(e) => patch({ portraitFolder: e.target.value.trim() || undefined })}
          placeholder="分阶段立绘文件夹名（仓库根 欢愉宫图片/<此名>/阶段1..4/）— 留空用上方单张立绘"
          className={`${inputCls} w-full font-mono text-[12px]`} />
      </div>
    </div>
  );
}

function PresetModal({ girl, onClose }: { girl: JoyGirl; onClose: () => void }) {
  const upsertGirl = useJoy((s) => s.upsertGirl);
  const [personality, setPersonality] = useState(girl.personality ?? '');
  const [background, setBackground] = useState(girl.background ?? '');
  const [appearance, setAppearance] = useState(girl.appearance ?? '');
  const [appellation, setAppellation] = useState(girl.appellation ?? '');
  const [greeting, setGreeting] = useState(girl.greetingPreset ?? '');
  const [chat, setChat] = useState(girl.chatPreset ?? '');
  const [s1, setS1] = useState(girl.stageDesc?.['1'] ?? '');
  const [s2, setS2] = useState(girl.stageDesc?.['2'] ?? '');
  const [s3, setS3] = useState(girl.stageDesc?.['3'] ?? '');
  const [s4, setS4] = useState(girl.stageDesc?.['4'] ?? '');
  const [priv, setPriv] = useState(
    Object.entries(girl.initPrivacy ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'),
  );
  const dflt = DEFAULT_GIRLS.find((d) => d.id === girl.id);

  const save = () => {
    const initPrivacy: Record<string, string> = {};
    for (const line of priv.split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0) { const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim(); if (k && v) initPrivacy[k] = v; }
    }
    upsertGirl({
      ...girl,
      personality: personality.trim() || undefined,
      background: background.trim() || undefined,
      appearance: appearance.trim() || undefined,
      appellation: appellation.trim() || undefined,
      greetingPreset: greeting.trim() || undefined,
      chatPreset: chat.trim() || undefined,
      stageDesc: { '1': s1.trim(), '2': s2.trim(), '3': s3.trim(), '4': s4.trim() },
      initPrivacy: Object.keys(initPrivacy).length ? initPrivacy : undefined,
    });
    onClose();
  };

  const ta = 'w-full bg-void border border-edge rounded-lg px-3 py-2 text-[13px] text-slate-200 leading-relaxed resize-y focus:outline-none focus:border-pink-400/40';

  return (
    <div className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl rounded-2xl border border-pink-500/30 bg-void shadow-[0_0_50px_rgba(0,0,0,0.85)] flex flex-col max-h-[90dvh]">
        <header className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-pink-500/20 bg-panel">
          <span className="text-base">✎</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-pink-100 truncate">{girl.name} · 预设编辑</div>
            <div className="text-[11px] font-mono text-pink-300/50">迎宾词 / 对话风格 / 四阶段递进 / 初始私密</div>
          </div>
          <button onClick={onClose} className="text-dim/50 hover:text-blood text-lg">✕</button>
        </header>
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          <div className="text-[12px] font-mono text-pink-300/55">人物档案</div>
          <Field label="性格（详细 · AI 优先采用，留空则用卡片上的性格简介）">
            <textarea value={personality} onChange={(e) => setPersonality(e.target.value)} rows={3} className={ta} />
          </Field>
          <Field label="个人经历 / 身世">
            <textarea value={background} onChange={(e) => setBackground(e.target.value)} rows={3} className={ta} />
          </Field>
          <Field label="外观（容貌 · 身段 · 衣着）">
            <textarea value={appearance} onChange={(e) => setAppearance(e.target.value)} rows={3} className={ta} />
          </Field>
          <Field label="初始称谓（她一开始怎么称呼你；之后随好感度自动演变）">
            <input value={appellation} onChange={(e) => setAppellation(e.target.value)} className={`${inputCls} w-full`} placeholder="如：公子 / 客人 / 小可怜 / 你" />
          </Field>
          <div className="text-[12px] font-mono text-pink-300/55 pt-1">台词 · 演绎</div>
          <Field label="迎宾词（看板娘在大厅的固定招呼）">
            <textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={2} className={ta} placeholder="（仅当她是看板娘时用于大厅迎宾）" />
          </Field>
          <Field label="对话/演绎预设（她在包间陪侍时的口吻与风格）">
            <textarea value={chat} onChange={(e) => setChat(e.target.value)} rows={4} className={`${ta} font-mono`} />
          </Field>
          <div className="text-[12px] font-mono text-pink-300/55 pt-1">四阶段递进（按情欲值注入·语言变化 + 身体变化）</div>
          <Field label="① 25% 以下"><textarea value={s1} onChange={(e) => setS1(e.target.value)} rows={2} className={ta} /></Field>
          <Field label="② 25–50%"><textarea value={s2} onChange={(e) => setS2(e.target.value)} rows={2} className={ta} /></Field>
          <Field label="③ 50–75%"><textarea value={s3} onChange={(e) => setS3(e.target.value)} rows={2} className={ta} /></Field>
          <Field label="④ 75–100%"><textarea value={s4} onChange={(e) => setS4(e.target.value)} rows={2} className={ta} /></Field>
          <Field label={`初始私密字段（每行「字段=值」，可用字段：${JOY_PRIVATE_COLS.map((c) => c.label).join('、')}）`}>
            <textarea value={priv} onChange={(e) => setPriv(e.target.value)} rows={4} className={`${ta} font-mono`} placeholder={'性经验=一片空白\n敏感部位=耳后、腰窝'} />
          </Field>
        </div>
        <footer className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-pink-500/20 bg-panel">
          {dflt && <button onClick={() => { setPersonality(dflt.personality ?? ''); setBackground(dflt.background ?? ''); setAppearance(dflt.appearance ?? ''); setAppellation(dflt.appellation ?? ''); setGreeting(dflt.greetingPreset ?? ''); setChat(dflt.chatPreset ?? ''); setS1(dflt.stageDesc?.['1'] ?? ''); setS2(dflt.stageDesc?.['2'] ?? ''); setS3(dflt.stageDesc?.['3'] ?? ''); setS4(dflt.stageDesc?.['4'] ?? ''); setPriv(Object.entries(dflt.initPrivacy ?? {}).map(([k, v]) => `${k}=${v}`).join('\n')); }}
            className="text-[12px] font-mono py-1.5 px-3 rounded-lg border border-edge text-dim hover:text-slate-100">恢复默认</button>}
          <div className="flex-1" />
          <button onClick={onClose} className="text-[12px] font-mono py-1.5 px-3 rounded-lg border border-edge text-dim hover:text-slate-100">取消</button>
          <button onClick={save} className="text-[13px] font-mono py-1.5 px-4 rounded-lg border border-pink-400/50 text-pink-100 bg-pink-500/15 hover:bg-pink-500/25">保存</button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-mono text-dim/55">{label}</span>
      {children}
    </label>
  );
}

/* ── 欢愉宫世界书：导入 / 逐条开关·编辑 / 导出（蓝灯常驻 + 绿灯关键词，注入每轮包间对话） ── */
function JoyLamp({ entry }: { entry: WorldBookEntry }) {
  if (!entry.enabled) return <span className="w-2 h-2 rounded-full bg-dim/30 shrink-0" title="已禁用" />;
  if (entry.constant) return <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0 shadow-[0_0_4px_#38bdf8]" title="蓝灯：常驻，每轮都注入" />;
  if (entry.selective) return <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_4px_#34d399]" title="绿灯：命中关键词才注入" />;
  return <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" title="关键词触发" />;
}

// 导出为 SillyTavern 兼容 JSON（entries 数字键对象，可被本应用 / 酒馆再导入）
function downloadJoyWb(book: WorldBook) {
  const entries: Record<string, any> = {};
  book.entries.forEach((e, i) => {
    entries[i] = {
      uid: e.uid ?? i, key: e.key ?? [], keysecondary: e.keysecondary ?? [],
      comment: e.comment ?? '', content: e.content ?? '',
      constant: !!e.constant, selective: !!e.selective, disable: e.enabled === false,
      order: e.order ?? 100, position: e.position ?? 0,
    };
  });
  const blob = new Blob([JSON.stringify({ name: book.name, entries }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${(book.name || '世界书').replace(/[\\/:*?"<>|]/g, '_')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const switchCls = (on: boolean) => `shrink-0 rounded-full border transition-colors ${on ? 'bg-pink-500/40 border-pink-400/50' : 'bg-void border-edge'}`;

function JoyWbEntryRow({ bookId, entry }: { bookId: string; entry: WorldBookEntry }) {
  const toggleEntry = useJoy((s) => s.toggleJoyWbEntry);
  const updateEntry = useJoy((s) => s.updateJoyWbEntry);
  const removeEntry = useJoy((s) => s.removeJoyWbEntry);
  const [open, setOpen] = useState(false);
  return (
    <div className={`px-2.5 py-1.5 ${!entry.enabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2">
        <JoyLamp entry={entry} />
        <button onClick={() => toggleEntry(bookId, entry.uid)} title={entry.enabled ? '点击禁用' : '点击启用'} className={`${switchCls(entry.enabled)} w-7 h-4`}>
          <div className="w-2.5 h-2.5 rounded-full bg-white mx-0.5 transition-all" style={{ transform: entry.enabled ? 'translateX(12px)' : 'none' }} />
        </button>
        <span className="flex-1 min-w-0 text-[13px] text-slate-300 truncate">{entry.comment || '(无标题)'}</span>
        <button onClick={() => setOpen(!open)} className="text-[11px] font-mono text-dim hover:text-pink-200 px-1 shrink-0">{open ? '收起' : '编辑'}</button>
        <button onClick={() => removeEntry(bookId, entry.uid)} className="text-blood/50 hover:text-blood text-[12px] px-1 shrink-0">✕</button>
      </div>
      {open && (
        <div className="mt-2 space-y-1.5 pl-4">
          <input value={entry.comment} onChange={(e) => updateEntry(bookId, entry.uid, { comment: e.target.value })} placeholder="标题"
            className="w-full bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-200 focus:outline-none focus:border-pink-400/40" />
          <input value={entry.key.join(', ')} onChange={(e) => updateEntry(bookId, entry.uid, { key: e.target.value.split(/[,，]/).map((k) => k.trim()).filter(Boolean) })}
            placeholder="关键词（逗号分隔；绿灯靠它命中你的输入）"
            className="w-full bg-void border border-edge rounded px-2 py-1 text-[12px] text-emerald-200/80 font-mono focus:outline-none focus:border-emerald-400/40" />
          <textarea value={entry.content} onChange={(e) => updateEntry(bookId, entry.uid, { content: e.target.value })} rows={3} placeholder="内容"
            className="w-full bg-void border border-edge rounded px-2 py-1 text-[12px] text-slate-200 leading-snug resize-y focus:outline-none focus:border-pink-400/40" />
          <div className="flex items-center gap-4 text-[11px] font-mono">
            <label className="flex items-center gap-1 cursor-pointer text-sky-300/80">
              <input type="checkbox" checked={entry.constant} onChange={() => updateEntry(bookId, entry.uid, { constant: !entry.constant })} className="accent-sky-500" />蓝灯·常驻
            </label>
            <label className="flex items-center gap-1 cursor-pointer text-emerald-300/80">
              <input type="checkbox" checked={entry.selective} onChange={() => updateEntry(bookId, entry.uid, { selective: !entry.selective })} className="accent-emerald-500" />绿灯·关键词
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function JoyWbCard({ book }: { book: WorldBook }) {
  const toggleWb = useJoy((s) => s.toggleJoyWorldBook);
  const removeWb = useJoy((s) => s.removeJoyWorldBook);
  const addEntry = useJoy((s) => s.addJoyWbEntry);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const enabledCount = book.entries.filter((e) => e.enabled).length;
  const sorted = [...book.entries].sort((a, b) => a.order - b.order);
  const filtered = q.trim()
    ? sorted.filter((e) => { const s = q.toLowerCase(); return e.comment.toLowerCase().includes(s) || e.content.toLowerCase().includes(s) || e.key.some((k) => k.toLowerCase().includes(s)); })
    : sorted;
  return (
    <div className={`rounded-lg border overflow-hidden ${book.enabled ? 'border-edge' : 'border-edge/40 opacity-60'}`}>
      <div className="flex items-center gap-2 px-3 py-2 bg-panel2/50">
        <button onClick={() => toggleWb(book.id)} title={book.enabled ? '整本停用' : '整本启用'} className={`${switchCls(book.enabled)} w-9 h-5`}>
          <div className="w-3 h-3 rounded-full bg-white mx-1 transition-all" style={{ transform: book.enabled ? 'translateX(16px)' : 'none' }} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-slate-200 truncate">{book.name}{book.builtin && <span className="ml-1.5 text-[10px] font-mono text-pink-300/50">内置</span>}</div>
          <div className="text-[11px] font-mono text-dim/55">{enabledCount} / {book.entries.length} 条启用</div>
        </div>
        <button onClick={() => setOpen(!open)} className="text-[12px] font-mono text-dim hover:text-pink-200 px-1.5 shrink-0">{open ? '收起 ∧' : '展开 ∨'}</button>
        <button onClick={() => downloadJoyWb(book)} className="text-[12px] font-mono text-dim hover:text-pink-200 px-1.5 shrink-0" title="导出为 JSON（可再导入）">导出</button>
        <button onClick={() => { if (confirm(`删除世界书「${book.name}」？`)) removeWb(book.id); }} className="text-blood/55 hover:text-blood text-[12px] px-1 shrink-0">删除</button>
      </div>
      {open && (
        <div className="border-t border-edge">
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-void/50 border-b border-edge/50">
            <span className="flex items-center gap-1 text-[10px] font-mono text-dim shrink-0"><span className="w-2 h-2 rounded-full bg-sky-400 inline-block" />蓝<span className="w-2 h-2 rounded-full bg-emerald-400 inline-block ml-1.5" />绿</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索标题 / 内容 / 关键词…" className="flex-1 bg-void border border-edge/60 rounded px-2 py-0.5 text-[12px] text-slate-300 font-mono focus:outline-none focus:border-pink-400/40" />
            <button onClick={() => addEntry(book.id)} className="shrink-0 text-[12px] font-mono text-pink-300 border border-pink-400/30 px-2 py-0.5 rounded hover:bg-pink-500/10">+ 新建</button>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-edge/40">
            {filtered.length === 0 && <div className="px-3 py-3 text-[12px] text-dim/50">{book.entries.length ? '无匹配条目' : '空世界书'}</div>}
            {filtered.map((e) => <JoyWbEntryRow key={e.uid} bookId={book.id} entry={e} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function JoyWorldBookSection() {
  const worldBooks = useJoy((s) => s.worldBooks);
  const importWb = useJoy((s) => s.importJoyWorldBook);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => { hydrateJoyWorldBooks(); }, []);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const out: string[] = [];
    for (const f of Array.from(files)) {
      try { out.push(importWb(await f.text(), f.name).message); }
      catch { out.push(`${f.name}：读取失败`); }
    }
    setMsg(out.join('；'));
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-2.5 rounded-xl border border-pink-500/20 bg-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-200">欢愉宫世界书（{worldBooks.length}）</span>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".json,application/json" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} className="text-[12px] font-mono py-1 px-2.5 rounded-lg border border-pink-400/40 text-pink-200 hover:bg-pink-500/10">+ 导入</button>
        </div>
      </div>
      <p className="text-[11px] font-mono text-dim/55 leading-snug">
        每轮包间对话自动注入：<span className="text-sky-300/80">蓝灯</span>条目常驻必注入；<span className="text-emerald-300/80">绿灯</span>条目按你的输入命中关键词才注入。兼容 SillyTavern 世界书 JSON，可逐条编辑 / 开关 / 导出再分享。其中「姿势」「BDSM」两本的条目标题还会出现在包间的快捷按钮里。
      </p>
      {msg && <div className="text-[12px] font-mono text-pink-200/80">{msg}</div>}
      {worldBooks.length === 0
        ? <div className="text-[12px] text-dim/45 py-2">尚无世界书（内置 5 本含 BDSM / 姿势 会自动加载，也可导入自己的）。</div>
        : <div className="space-y-2">{worldBooks.map((b) => <JoyWbCard key={b.id} book={b} />)}</div>}
    </div>
  );
}

export default function JoyManager() {
  const settings = useJoy((s) => s.settings);
  const setSettings = useJoy((s) => s.setSettings);
  const upsertGirl = useJoy((s) => s.upsertGirl);
  const resetGirls = useJoy((s) => s.resetGirls);

  const joyApi = useJoy((s) => s.joyApi);
  const useShared = useJoy((s) => s.joyUseSharedApi);
  const setApi = useJoy((s) => s.setJoyApi);
  const setShared = useJoy((s) => s.setJoyUseSharedApi);
  const models = useJoy((s) => s.joyAvailableModels);
  const modelsLoading = useJoy((s) => s.joyModelsLoading);
  const modelsError = useJoy((s) => s.joyModelsError);
  const fetchModels = useJoy((s) => s.fetchJoyModels);

  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => { hydrateJoyPortraits(); }, []);

  const addGirl = () => {
    const id = `girl_${Date.now()}`;
    upsertGirl({ id, name: '新姑娘', race: '人类', persona: '', stageDesc: {} });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h3 className="text-lg font-bold text-pink-100">💗 欢愉宫</h3>
        <p className="text-[13px] text-dim/60 mt-1 leading-relaxed">
          成人向角色互动（角色均为成年奇幻种族）。在这里管理「美女 / 看板娘」名册：人设、迎宾词、对话预设、<strong>四阶段递进</strong>（按情欲值变化语言与身体）、初始私密、立绘。
          <br />立绘可<strong>分阶段</strong>：把图（标准 1215×832）放进仓库根 <code className="text-pink-300/80">欢愉宫图片/&lt;美女名/文件夹名&gt;/阶段1~4/</code>，情欲值 &lt;25 用阶段1、&lt;50 阶段2、&lt;75 阶段3、≥75 阶段4，每次对话随机换一张（build/启动自动同步，空阶段就近回退）。
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-pink-500/20 bg-panel px-3 py-2.5">
        <div>
          <div className="text-sm text-slate-200">启用欢愉宫</div>
          <div className="text-[12px] text-dim/55 mt-0.5">关闭后右导航「💗 欢愉宫」入口隐藏</div>
        </div>
        <button onClick={() => setSettings({ enabled: !settings.enabled })}
          className={`shrink-0 w-9 h-5 rounded-full border transition-colors ${settings.enabled ? 'bg-pink-500/40 border-pink-400/50' : 'bg-void border-edge'}`}>
          <div className="w-3 h-3 rounded-full bg-white mx-1 transition-all" style={{ transform: settings.enabled ? 'translateX(16px)' : 'none' }} />
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-200">美女 / 看板娘（{settings.girls.length}）</span>
          <div className="flex items-center gap-2">
            <button onClick={addGirl} className="text-[12px] font-mono py-1 px-2.5 rounded-lg border border-pink-400/40 text-pink-200 hover:bg-pink-500/10">+ 新增</button>
            <button onClick={() => { if (confirm('恢复为 4 位内置看板娘？自定义的美女将被移除（情欲值/聊天进度不动）。')) resetGirls(); }}
              className="text-[12px] font-mono py-1 px-2.5 rounded-lg border border-edge text-dim hover:text-slate-100">恢复默认</button>
          </div>
        </div>
        {settings.girls.map((g) => <GirlCard key={g.id} girl={g} onEditPreset={() => setEditId(g.id)} />)}
      </div>

      <JoyWorldBookSection />

      <div className="space-y-2.5 rounded-xl border border-pink-500/20 bg-panel p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-200">欢愉宫 AI 接口</span>
        </div>
        <ApiRoutePicker routeKey="joy" />
        <p className="text-[11px] font-mono text-dim/50">↑ 选「API 接口库」里的接口（多选·按优先级轮流·失败自动切下一条）。留空则用下方兜底配置。建议选一个尺度宽松的模型。</p>
        <div className="text-[11px] font-mono text-dim/40 leading-snug">用于包间对话与看板娘迎宾。每轮对话独立调用，不影响正文生成。</div>
      </div>

      {editId && (() => {
        const g = settings.girls.find((x) => x.id === editId);
        return g ? <PresetModal girl={g} onClose={() => setEditId(null)} /> : null;
      })()}
    </div>
  );
}
