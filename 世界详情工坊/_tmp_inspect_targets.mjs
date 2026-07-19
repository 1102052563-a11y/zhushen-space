import fs from 'node:fs';
import path from 'node:path';

function split(t) {
  t = t.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  const i1 = t.indexOf('\n## 剧情\n');
  const i2 = t.indexOf('\n## 休闲切入点\n');
  const i3 = t.indexOf('\n## 来源\n');
  if (i1 < 0 || i2 < 0 || i3 < 0) {
    return { err: true, i1, i2, i3, head: t.slice(0, 80) };
  }
  return {
    head: t.slice(0, i1),
    plot: t.slice(i1 + '\n## 剧情\n'.length, i2),
    entry: t.slice(i2 + '\n## 休闲切入点\n'.length, i3),
    src: t.slice(i3 + '\n## 来源\n'.length),
  };
}

const files = [
  '产出/批次803/遙かなる時空の中で7.md',
  '产出/批次803/金色のコルダ.md',
  '产出/批次803/金色のコルダ3.md',
  '产出/批次805/BROTHERS CONFLICT.md',
  '产出/批次806/Code：Realize ～創世の姫君～.md',
  '产出/批次806/Collar×Malice.md',
  '产出/批次807/BAD APPLE WARS.md',
  '产出/批次807/Starry☆Sky ～in Spring～.md',
  '产出/批次808/Little Busters! Ecstasy.md',
  '产出/批次808/Starry☆Sky ～in Summer～.md',
  '产出/批次809/Fate／EXTRA CCC.md',
];

for (const f of files) {
  const p = split(fs.readFileSync(f, 'utf8'));
  if (p.err) {
    console.log(f, 'FAIL', p);
    continue;
  }
  const nw = (s) => s.replace(/\s/g, '').length;
  console.log('\n====', f, 'plot', nw(p.plot), 'entry', nw(p.entry), '====');
  console.log('PLOT_TAIL:\n' + p.plot.slice(-450));
  console.log('ENTRY_TAIL:\n' + p.entry.slice(-280));
}
