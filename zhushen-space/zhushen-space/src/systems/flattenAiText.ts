/* 把 AI 可能返回的 对象/数组 安全摊平成可读文本，避免写进字段后显示 [object Object] */
export function flattenAiText(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(flattenAiText).filter(Boolean).join('；');
  if (typeof v === 'object') {
    // {target:"张三", relation:"好友"} → "张三:好友"；其它对象拼其值
    const o = v as Record<string, any>;
    const id = o.id ?? o.tid ?? o.target ?? o.name ?? o.who;
    const rel = o.relation ?? o.rel ?? o.relationship ?? o.type ?? o.desc;
    if (id != null && rel != null) return `${flattenAiText(id)}:${flattenAiText(rel)}`;
    return Object.values(o).map(flattenAiText).filter(Boolean).join('·');
  }
  return String(v);
}
