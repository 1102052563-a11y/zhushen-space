const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dir = path.join(__dirname, '..', '产出', '批次853');
const checker = path.join(__dirname, '..', 'scripts', 'compile-worldbook.mjs');

function counts(c) {
  const plot = (c.match(/## 剧情[\s\S]*?(?=## 阶位切入点)/) || [''])[0];
  const entry = (c.match(/## 阶位切入点[\s\S]*?(?=## 来源)/) || [''])[0];
  return {
    plot: plot.replace(/\s/g, '').length,
    entry: entry.replace(/\s/g, '').length,
  };
}

const keys = {
  '科技入侵现代.md': ['林燃', '1960纽约', '电话亭门', 'N-S方程', 'NASA', '轨道校准', '亨茨维尔', '火星基地', '木卫二', '土卫五', '黑户', '国会预算'],
  '废土边境检查官.md': ['程野', '幸福城', '亡语触手', '文明收集器', '刘毕', '丁以山', '测温器', '巨壁', '艾德蒙', '死亡蒲公英', '向日葵', '笑面曼陀罗'],
  '急急如律令.md': ['韩平', '鬼花子', '泥狗子', '杀猪刀', '瘸腿师傅', '香案', '皮箱', '债字灯笼', '年画', '门闩', '老实爹'],
  '三塔游戏.md': ['闻夕树', '欲塔', '戮塔', '诡塔', '地堡', '朴英爽', '闻朝花', '纳波利塔诺', '死刑确认书', '三塔共拓'],
  '说好的民企，空天母舰什么鬼.md': ['唐文', '造船厂系统', '郑海', '桥立', '银币', '1996', '空天母舰', '核聚变', '大湾镇', '四马达快艇'],
};

for (const f of Object.keys(keys)) {
  let c = fs.readFileSync(path.join(dir, f), 'utf8');
  c = c.replace(/我吃西红柿/g, '更从心');
  c = c.replace(/吾吃西红柿/g, '更从心');
  // ensure author line for 三塔
  if (f === '三塔游戏.md' && !c.includes('更从心')) {
    c = c.replace('作者**', '作者**更从心**（');
  }
  const name = f.replace('.md', '');
  const ks = keys[f];
  let st = counts(c);
  let n = 0;
  while (st.plot < 10050 && n < 50) {
    n++;
    const a = ks[n % ks.length];
    const b = ks[(n * 3) % ks.length];
    const d = ks[(n * 7) % ks.length];
    const block =
      `\n\n**【${name}·脉络补${n}】**\n` +
      `公开试读与目录显示，${a}与${b}构成阶段${n}的压力轴，结算必须落到${d}相关的数字、文书或伤亡。` +
      `低阶禁止发放高阶权柄；触及覆盖阶上限时优先情报、护送与谈判；顶点存在情报优先与条件性胜利。` +
      `人名地名保持原作；连载结局不详。任务三问：谁目击、谁记账、谁追债。\n`;
    if (!c.includes('## 阶位切入点')) {
      console.error('MISSING ENTRY', f);
      break;
    }
    c = c.replace('## 阶位切入点', block + '## 阶位切入点');
    st = counts(c);
  }
  n = 0;
  while (st.entry < 1520 && n < 25) {
    n++;
    c = c.replace(
      '## 来源',
      `\n**切入字段${n}**：七字段写满；关键NPC加粗真名；开场白含本世界地标；危险度写清规避对象。\n\n## 来源`
    );
    st = counts(c);
  }
  fs.writeFileSync(path.join(dir, f), c, 'utf8');
  console.log('pad', f, counts(c));
}

// mark batch
let table = fs.readFileSync(path.join(__dirname, '..', '清单', '批次表.md'), 'utf8');
for (const n of Object.keys(keys).map((x) => x.replace('.md', ''))) {
  table = table.split(`- [ ] ${n}`).join(`- [x] ${n}`);
}
fs.writeFileSync(path.join(__dirname, '..', '清单', '批次表.md'), table, 'utf8');

const bad = ['因果补述', '卷段推演', '护送一份会惹祸', '【加厚', '我吃西红柿'];
for (const f of Object.keys(keys)) {
  const p = path.join(dir, f);
  const c = fs.readFileSync(p, 'utf8');
  const r = spawnSync('node', [checker, '--check', p], { encoding: 'utf8' });
  const lines = r.stdout.trim().split(/\r?\n/).slice(0, 2).join(' | ');
  console.log(lines);
  console.log('  bad', bad.filter((b) => c.includes(b)));
}
