import { useState } from 'react';
import { useGame } from '../store/gameStore';
import { instances } from '../data/instances';
import { enhancements, enhanceCost } from '../data/enhancements';
import { power } from '../systems/combat';
import type { Difficulty } from '../types';

const diffColor: Record<Difficulty, string> = {
  入门: 'text-emerald-400 border-emerald-500/40',
  普通: 'text-sky-400 border-sky-500/40',
  困难: 'text-amber-400 border-amber-500/40',
  噩梦: 'text-blood border-blood/50',
};

export default function Hub() {
  const player = useGame((s) => s.player);
  const enterInstance = useGame((s) => s.enterInstance);
  const myPower = power(player);

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle index="01" title="副本入口" sub="选择一个世界，活着回来" />
        <div className="grid gap-3 sm:grid-cols-2">
          {instances.map((inst) => {
            const cleared = player.cleared.includes(inst.id);
            const risky = myPower < inst.recommend;
            return (
              <button
                key={inst.id}
                onClick={() => enterInstance(inst.id)}
                className="text-left bg-panel hover:bg-panel2 border border-edge hover:border-god/50 rounded-xl p-4 transition-colors group"
              >
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-bold text-slate-100 group-hover:text-god transition-colors">
                    {inst.name}
                    {cleared && <span className="ml-2 text-sm text-god font-mono">已通关</span>}
                  </h3>
                  <span className={`text-sm font-mono px-2 py-0.5 rounded border ${diffColor[inst.difficulty]}`}>
                    {inst.difficulty}
                  </span>
                </div>
                <p className="text-sm text-dim mb-3">{inst.theme}</p>
                <div className="flex justify-between text-sm font-mono text-dim">
                  <span className={risky ? 'text-blood' : ''}>
                    推荐战力 {inst.recommend}{risky && ' ⚠'}
                  </span>
                  <span className="text-gold">奖励 +{inst.reward}</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <Shop />
      <SaveTools />
    </div>
  );
}

function Shop() {
  const player = useGame((s) => s.player);
  const levels = useGame((s) => s.enhanceLevels);
  const buy = useGame((s) => s.buyEnhancement);
  const rest = useGame((s) => s.rest);
  const needRest = player.hp < player.maxHp || player.san < player.maxSan;

  return (
    <section>
      <SectionTitle index="02" title="主神商店" sub="以奖励点换取永久强化" />
      <div className="grid gap-3 sm:grid-cols-2">
        {enhancements.map((e) => {
          const lv = levels[e.id] ?? 0;
          const cost = enhanceCost(e, lv);
          const afford = player.points >= cost;
          return (
            <div key={e.id} className="bg-panel border border-edge rounded-xl p-4 flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-100">
                  {e.name} <span className="text-sm text-dim font-mono">Lv.{lv}</span>
                </div>
                <div className="text-sm text-dim">{e.desc}</div>
              </div>
              <button
                onClick={() => buy(e.id)}
                disabled={!afford}
                className={`shrink-0 font-mono text-sm px-3 py-2 rounded-lg border transition-colors ${
                  afford
                    ? 'border-gold/50 text-gold hover:bg-gold/10'
                    : 'border-edge text-dim cursor-not-allowed'
                }`}
              >
                {cost} 点
              </button>
            </div>
          );
        })}
      </div>
      <button
        onClick={rest}
        disabled={!needRest || player.points < 25}
        className={`mt-3 w-full font-mono text-sm py-3 rounded-xl border transition-colors ${
          needRest && player.points >= 25
            ? 'border-god/50 text-god hover:bg-god/10'
            : 'border-edge text-dim cursor-not-allowed'
        }`}
      >
        修整 · 回满生命与精神（25 点）
      </button>
    </section>
  );
}

function SaveTools() {
  const doExport = useGame((s) => s.doExport);
  const doImport = useGame((s) => s.doImport);
  const hardReset = useGame((s) => s.hardReset);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');

  return (
    <section>
      <SectionTitle index="03" title="存档" sub="进度自动保存在本浏览器" />
      <div className="bg-panel border border-edge rounded-xl p-4 space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="存档码（导出后可复制备份；粘贴他处可导入）"
          className="w-full h-20 bg-void border border-edge rounded-lg p-2 text-sm font-mono text-slate-300 resize-none focus:border-god outline-none"
        />
        <div className="flex flex-wrap gap-2 text-sm">
          <button
            onClick={() => { setText(doExport()); setMsg('已生成存档码，请复制保存。'); }}
            className="font-mono px-3 py-2 rounded-lg border border-edge hover:border-god/50 text-slate-300"
          >导出</button>
          <button
            onClick={() => setMsg(doImport(text) ? '导入成功。' : '存档码无效。')}
            className="font-mono px-3 py-2 rounded-lg border border-edge hover:border-god/50 text-slate-300"
          >导入</button>
          <button
            onClick={() => { if (confirm('确定要清空所有进度？此操作不可撤销。')) { hardReset(); setMsg('已重置。'); } }}
            className="font-mono px-3 py-2 rounded-lg border border-blood/40 text-blood hover:bg-blood/10 ml-auto"
          >重置进度</button>
        </div>
        {msg && <p className="text-sm text-god font-mono">{msg}</p>}
      </div>
    </section>
  );
}

function SectionTitle({ index, title, sub }: { index: string; title: string; sub: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-3">
      <span className="font-mono text-god/60 text-sm">{index}</span>
      <h2 className="text-lg font-bold text-slate-100">{title}</h2>
      <span className="text-sm text-dim">{sub}</span>
    </div>
  );
}
