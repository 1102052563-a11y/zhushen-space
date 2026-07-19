import fs from 'node:fs';
import path from 'node:path';

const badStarts = [
  '**【故事主线 · 情感线 · 补全',
  '**【可攻略角色 · 字段补全】',
  '**关系推进节点（本世界独有顺序）**',
  '**【日常切片 ·',
  '**【情感事件 · 名场面补】**',
  '**【隐藏剧情 · 真结局 · 伏笔】**\nTrue/FD',
  '**【氛围基调 · 雷区】**\n保持 ',
];

const files = [];
for (let i = 831; i <= 839; i++) {
  const dir = path.join('产出', `批次${i}`);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    files.push(path.join(dir, f));
  }
}

let n = 0;
for (const fp of files) {
  let t = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!/按原作|独有卷宗|字段补全|日常切片 ·|标记 [0-9a-f]{6}/.test(t)) continue;

  const entryMatch = t.match(/\n## (?:休闲切入点|阶位切入点)/);
  if (!entryMatch) continue;
  const entryIdx = entryMatch.index;
  const head = t.slice(0, entryIdx);
  const tail = t.slice(entryIdx);

  let cut = head.length;
  for (const m of badStarts) {
    const i = head.indexOf(m);
    if (i >= 0 && i < cut) cut = i;
  }
  const patterns = [
    /\n\*\*【[^\n]*独有卷宗/,
    /\n[^\n]+｜外貌：按原作/,
    /\n\*\*【可攻略角色 · 字段补全】/,
    /\n\*\*【故事主线 · 情感线 · 补全/,
  ];
  for (const re of patterns) {
    const m = head.match(re);
    if (m && m.index != null && m.index < cut) cut = m.index;
  }

  // if still no cut but has 按原作 in pad-only tail of head, try find first 按原作 line that is pure placeholder
  if (cut >= head.length) {
    const m = head.match(/\n[^\n]*按原作[^\n]*\n/);
    if (m && m.index != null) {
      // only cut if surrounding is factory pad
      const around = head.slice(Math.max(0, m.index - 80), m.index + 40);
      if (/字段补全|标记 |外貌：按原作/.test(around)) cut = m.index;
    }
  }

  if (cut >= head.length) {
    console.log('skip-no-cut', path.basename(fp));
    continue;
  }

  // don't cut legitimate early content: require cut after core sections
  if (cut < 1500) {
    console.log('skip-too-early', path.basename(fp), cut);
    continue;
  }

  const cleaned = head.slice(0, cut).replace(/\s+$/, '') + '\n' + tail;
  fs.writeFileSync(fp, cleaned, 'utf8');
  const plot = cleaned.split(/\n## (?:休闲切入点|阶位切入点)/)[0] || '';
  const pc = [...plot.replace(/<!--[\s\S]*?-->/g, '')].filter((c) => !/\s/.test(c)).length;
  console.log('stripped', path.basename(fp), 'plot', pc, 'cut@', cut);
  n++;
}
console.log('done', n);
