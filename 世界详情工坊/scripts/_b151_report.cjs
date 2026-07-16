const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dir = path.join(__dirname, '..', '产出', '批次151');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
const bad = ['跨媒介流行作品', '可被契约者切入的完整任务世界', '资源牙人', '原作主角（若已登场）', '炼气/凝气/后天'];
const rows = [];
for (const f of files) {
  const p = path.join(dir, f);
  const t = fs.readFileSync(p, 'utf8');
  const plot = (t.match(/## 剧情\s*([\s\S]*?)(?=## 阶位切入点)/) || [])[1] || '';
  const entry = (t.match(/## 阶位切入点\s*([\s\S]*?)(?=## 来源)/) || [])[1] || '';
  const src = (t.match(/## 来源\s*([\s\S]*?)$/) || [])[1] || '';
  const links = (src.match(/\]\(https?:\/\/[^)]+\)/g) || []).length;
  const hits = bad.filter((b) => t.includes(b));
  const r = spawnSync(process.execPath, [path.join(__dirname, 'compile-worldbook.mjs'), '--check', p], {
    encoding: 'utf8',
  });
  rows.push({
    文件: f,
    剧情字: plot.replace(/\s/g, '').length,
    切入点字: entry.replace(/\s/g, '').length,
    来源链: links,
    套话: hits.length ? hits.join('|') : '无',
    机检: r.status === 0 ? '✓' : '✗',
  });
}
console.table(rows);
