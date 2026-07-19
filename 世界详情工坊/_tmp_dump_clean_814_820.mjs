import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/产出';
const outDir = 'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/_tmp_b814_820_clean';
fs.mkdirSync(outDir, { recursive: true });

function extract(t) {
  const name = (t.match(/^#\s+(.+)$/m) || [])[1];
  let plot = (t.match(/##\s*剧情\s*\n([\s\S]*?)(?=\n##\s*(?:休闲切入点|阶位切入点|来源)\s*$)/m) || [])[1] || '';
  let entry = (t.match(/##\s*休闲切入点\s*\n([\s\S]*?)(?=\n##\s*来源\s*$)/m) || [])[1] || '';
  const src = (t.match(/##\s*来源\s*\n([\s\S]*)$/m) || [])[1] || '';
  const dirtyRe = /\n*\*\*【[^】]*·(独有卷宗|补)[^】]*】\*\*[\s\S]*?(?=\n\*\*【|\n##|$)/g;
  plot = plot
    .replace(dirtyRe, '')
    .replace(/只写《[^》]+》的人物、地点与因果[\s\S]*?账本数字锚定。/g, '')
    .replace(/本作品独有场景：真名角色、具体地点、情感选择。/g, '')
    .replace(/补充切入（[a-f0-9]+）：[^\n]*/g, '')
    .replace(/\*\*【记忆碎片[\s\S]*?禁止复读同一句空话。/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  entry = entry
    .replace(/补充切入（[a-f0-9]+）：[^\n]*/g, '')
    .replace(/> 本世界为休闲\/恋爱向。契约者以日常身份融入[\s\S]*$/m, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { name, plot, entry, src: src.trim() };
}

let n = 0;
for (let b = 814; b <= 820; b++) {
  const dir = path.join(ROOT, `批次${b}`);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    const c = extract(t);
    const key = `${b}_${String(n).padStart(2, '0')}`;
    fs.writeFileSync(
      path.join(outDir, `${key}.json`),
      JSON.stringify(
        {
          b,
          f,
          ...c,
          plotN: c.plot.replace(/\s/g, '').length,
          entryN: c.entry.replace(/\s/g, '').length,
        },
        null,
        2,
      ),
      'utf8',
    );
    n++;
  }
}
console.log('dumped', n);
