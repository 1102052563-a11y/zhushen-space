/* 血条/蓝条皮肤清单（玩家可切换；CSS 在 index.css 的 bf-<id>-hp / -ep）。
   纯展示外观，不碰 hp/ep 数值与 <state> 指令通道。 */
export const BAR_STYLES = [
  { id: 'classic', name: '经典' },
  { id: 'neon', name: '霓虹' },
  { id: 'lava', name: '熔岩' },
  { id: 'frost', name: '冰晶' },
  { id: 'toxic', name: '毒液' },
  { id: 'gold', name: '黄金' },
  { id: 'cyber', name: '赛博' },
  { id: 'bloodmist', name: '血雾' },
  { id: 'galaxy', name: '星河' },
  { id: 'plasma', name: '等离子' },
  { id: 'stripe', name: '条纹' },
  { id: 'wave', name: '波涛' },
  { id: 'cells', name: '格栅' },
  { id: 'charge', name: '聚能' },
  { id: 'aurora', name: '极光' },
  { id: 'verdant', name: '翠盟' },
  { id: 'orb', name: '魔渊' },
  { id: 'arcade', name: '街机' },
  { id: 'souls', name: '魂界' },
  { id: 'ticks', name: '刻度' },
] as const;

interface BarProps {
  value: number;
  max: number;
  color: string;        // tailwind bg color class（未指定 kind 时的旧行为）
  label: string;
  styleId?: string;     // 血条皮肤 id（配合 kind 生效；见 BAR_STYLES）
  kind?: 'hp' | 'ep';   // 该条用 HP 暖色 / EP 冷色调色板
}

export default function Bar({ value, max, color, label, styleId = 'classic', kind }: BarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const styled = !!kind;
  const danger = kind === 'hp' && max > 0 && pct <= 20;   // 血量过低告警：HP ≤ 20% 时转红急促闪烁（覆盖皮肤）
  return (
    <div>
      <div className="flex justify-between text-xs mb-1 text-dim font-mono">
        <span>{label}</span>
        <span>{Math.max(0, Math.round(value))} / {max}</span>
      </div>
      {/* styled 时 track 不裁切（让 fill 辉光外溢），fill 自身 .barfill 裁切流光；非 styled 维持旧结构 */}
      <div className={`h-2 rounded-full bg-void border border-edge ${styled ? '' : 'overflow-hidden'}`}>
        {styled ? (
          <div className={`barfill bf-${styleId}-${kind}${danger ? ' bf-danger' : ''}`} style={{ width: `${pct}%` }} />
        ) : (
          <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  );
}
