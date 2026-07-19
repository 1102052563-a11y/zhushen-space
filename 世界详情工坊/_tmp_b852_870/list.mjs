import fs from 'fs';
import path from 'path';

const man = JSON.parse(fs.readFileSync('清单/manifest.json', 'utf8'));
const by = new Map(man.worlds.map((w) => [w.name, w]));
const out = [];

for (let b = 852; b <= 870; b++) {
  const dir = path.join('产出', `批次${b}`);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
    if (!raw.includes('lib=主库') && !raw.includes('## 阶位切入点')) continue;
    const nameM = raw.match(/^#\s+(.+?)\s*$/m);
    const name = (nameM ? nameM[1] : f.replace(/\.md$/, '')).trim();
    const w = by.get(name);
    const junkHits = ['场记', '卷宗', '补阶细节', '场景锚', '专属扮演场', '阶段一 · 立足'].filter((k) =>
      raw.includes(k),
    );
    const src = (raw.match(/【作品来源】[\s\S]*?(?=\n【)/) || [''])[0].replace(/\s+/g, ' ').slice(0, 400);
    const loc = (raw.match(/【世界定位】[\s\S]*?(?=\n【)/) || [''])[0].replace(/\s+/g, ' ').slice(0, 300);
    const pow = (raw.match(/【世界观 · 力量体系】[\s\S]*?(?=\n【)/) || [''])[0].replace(/\s+/g, ' ').slice(0, 400);
    const people = (raw.match(/【主要人物】[\s\S]*?(?=\n【)/) || [''])[0].replace(/\s+/g, ' ').slice(0, 400);
    const mapLine = (raw.match(/乐园阶位映射[^\n]*/) || [''])[0];
    const plot = (raw.match(/## 剧情\s*([\s\S]*?)(?=\n## )/) || [, ''])[1];
    const entry = (raw.match(/## 阶位切入点\s*([\s\S]*?)(?=\n## )/) || [, ''])[1];
    out.push({
      b,
      name,
      file: f,
      path: path.join(dir, f),
      tiers: w?.tiers || [],
      inManifest: !!w,
      maxTier: w?.maxTier,
      peakBeyond: !!w?.peakBeyond,
      blurb: w?.blurb || '',
      junkHits,
      src,
      loc,
      pow,
      people,
      mapLine,
      plotN: (plot || '').replace(/\s/g, '').length,
      entryN: (entry || '').replace(/\s/g, '').length,
    });
  }
}

fs.writeFileSync('_tmp_b852_870/list.json', JSON.stringify(out, null, 2));
console.log('count', out.length, 'miss', out.filter((x) => !x.inManifest).length);
console.log(
  'junk场记卷宗',
  out.filter((x) => x.junkHits.some((h) => h === '场记' || h === '卷宗')).length,
);
console.log(out.map((x) => `${x.b}|${x.name}|${x.tiers.join('、')}|${x.junkHits.join(',')}`).join('\n'));
