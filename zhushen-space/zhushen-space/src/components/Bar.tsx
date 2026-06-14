interface BarProps {
  value: number;
  max: number;
  color: string; // tailwind bg color class
  label: string;
}

export default function Bar({ value, max, color, label }: BarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1 text-dim font-mono">
        <span>{label}</span>
        <span>{Math.max(0, Math.round(value))} / {max}</span>
      </div>
      <div className="h-2 rounded-full bg-void overflow-hidden border border-edge">
        <div
          className={`h-full ${color} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
