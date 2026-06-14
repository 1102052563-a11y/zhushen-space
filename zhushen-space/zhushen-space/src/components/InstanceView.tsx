import { useGame } from '../store/gameStore';
import { getInstance } from '../data/instances';

export default function InstanceView() {
  const instId = useGame((s) => s.runInstanceId);
  const nodeIndex = useGame((s) => s.nodeIndex);
  const inst = instId ? getInstance(instId) : null;
  if (!inst) return null;

  return (
    <div className="space-y-4 fade-in">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-100">{inst.name}</h2>
        <ProgressDots total={inst.nodes.length} current={nodeIndex} />
      </div>
      <EventPanel />
      <CombatPanel />
    </div>
  );
}

function ProgressDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`w-2 h-2 rounded-full ${
            i < current ? 'bg-god' : i === current ? 'bg-god/50 ring-2 ring-god/30' : 'bg-edge'
          }`}
        />
      ))}
    </div>
  );
}

function EventPanel() {
  const ev = useGame((s) => s.currentEvent);
  const eventResult = useGame((s) => s.eventResult);
  const choose = useGame((s) => s.chooseOption);
  const cont = useGame((s) => s.continueAfterEvent);

  if (eventResult) {
    return (
      <div className="bg-panel border border-edge rounded-xl p-5 fade-in">
        <p className="text-slate-300 mb-4 leading-relaxed">{eventResult}</p>
        <button
          onClick={cont}
          className="font-mono text-sm px-4 py-2 rounded-lg border border-god/50 text-god hover:bg-god/10"
        >继续深入 →</button>
      </div>
    );
  }

  if (!ev) return null;
  return (
    <div className="bg-panel border border-edge rounded-xl p-5 fade-in">
      <h3 className="font-bold text-god god-glow mb-2">{ev.title}</h3>
      <p className="text-slate-300 mb-5 leading-relaxed">{ev.text}</p>
      <div className="space-y-2">
        {ev.options.map((o, i) => (
          <button
            key={i}
            onClick={() => choose(i)}
            className="block w-full text-left bg-void hover:bg-panel2 border border-edge hover:border-god/50 rounded-lg px-4 py-3 text-slate-200 transition-colors"
          >{o.label}</button>
        ))}
      </div>
    </div>
  );
}

function CombatPanel() {
  const combat = useGame((s) => s.combat);
  const attack = useGame((s) => s.attack);
  const defend = useGame((s) => s.defend);
  const cont = useGame((s) => s.continueAfterCombat);
  if (!combat) return null;

  const { monster, enemyHp, log, over } = combat;
  const pct = Math.max(0, (enemyHp / monster.hp) * 100);

  return (
    <div className="bg-panel border border-edge rounded-xl p-5 fade-in">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className={`font-bold ${monster.boss ? 'text-blood god-glow' : 'text-slate-100'}`}>
            {monster.boss && '【首领】'}{monster.name}
          </h3>
          <p className="text-sm text-dim mt-0.5 max-w-md">{monster.desc}</p>
        </div>
        <span className="font-mono text-sm text-dim">
          {monster.atk}/{monster.def}{monster.sanAtk ? ` ·神${monster.sanAtk}` : ''}
        </span>
      </div>

      <div className="h-2 my-3 rounded-full bg-void overflow-hidden border border-edge">
        <div className="h-full bg-blood transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>

      <div className="bg-void border border-edge rounded-lg p-3 h-28 overflow-y-auto text-sm space-y-1 font-mono mb-4">
        {log.slice(-8).map((line, i) => (
          <div key={i} className="text-dim">{line}</div>
        ))}
      </div>

      {over ? (
        <button
          onClick={cont}
          className="w-full font-mono text-sm py-3 rounded-lg border border-god/50 text-god hover:bg-god/10"
        >继续深入 →</button>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={attack}
            className="flex-1 font-mono text-sm py-3 rounded-lg border border-blood/50 text-blood hover:bg-blood/10"
          >攻击</button>
          <button
            onClick={defend}
            className="flex-1 font-mono text-sm py-3 rounded-lg border border-edge text-slate-300 hover:border-god/50"
          >格挡（减伤 60%）</button>
        </div>
      )}
    </div>
  );
}
