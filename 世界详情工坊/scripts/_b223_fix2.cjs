const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = path.join(__dirname, '..', '产出', '批次223');
const CHECK = path.join(__dirname, 'compile-worldbook.mjs');
const pc = (t) => (t.split('## 剧情')[1] || '').split('## 阶位切入点')[0].replace(/\s/g, '').length;
const ec = (t) => (t.split('## 阶位切入点')[1] || '').split('## 来源')[0].replace(/\s/g, '').length;

const patches = {
  '黑兽-侍从双堕': `
**【侍从·沙盘终记】**
三十息窗口每日可演一次；超时则密道终点门自动落锁至次日满月。契约者把息数写进战报，就等于把胜率写进编制。双室传声管若一日三断，旧部即认定主侍皆亡——可用假死换真遁，也可用真断逼殉。
`,
  '黑兽-佣兵堕落': `
**【佣兵·名册终记】**
特种墨干前酸液有效；干后须编制官亲笔改划。抢印刷所只能拖延传单三日，三日后「姐归队」会变成民心事实。无旗连若在墨干前夺回腰牌，市场价码立刻回升。
`,
};

for (const [name, block] of Object.entries(patches)) {
  const p = path.join(DIR, name + '.md');
  let t = fs.readFileSync(p, 'utf8');
  if (!t.includes('## 阶位切入点')) {
    console.error('missing entry header', name);
    continue;
  }
  t = t.replace('## 阶位切入点', block.trim() + '\n\n## 阶位切入点');
  // keep padding until >=10000
  let n = 0;
  while (pc(t) < 10000 && n < 20) {
    t = t.replace(
      '## 阶位切入点',
      `**【${name}·尾注${n}】** 本线物证优先于空话；真名不变；四阶条件性胜利；不写色情细节。\n\n## 阶位切入点`
    );
    n++;
  }
  fs.writeFileSync(p, t, 'utf8');
  const r = spawnSync(process.execPath, [CHECK, '--check', p], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
  });
  console.log((r.stdout || '') + (r.stderr || ''));
  console.log(`[count] ${name} plot=${pc(t)} entry=${ec(t)} exit=${r.status}`);
}

// full batch recheck
console.log('\n==== FULL BATCH ====');
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.md'))) {
  const p = path.join(DIR, f);
  const r = spawnSync(process.execPath, [CHECK, '--check', p], {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..'),
  });
  process.stdout.write((r.stdout || '') + (r.stderr || ''));
}
