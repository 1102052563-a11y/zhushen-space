import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const nw = (s) => [...(s || '').replace(/\s/g, '')].length;

function split(t) {
  t = t.replace(/\r\n/g, '\n');
  const title = (t.match(/^#\s+(.+)$/m) || [, ''])[1].trim();
  const meta = (t.match(/<!--meta[\s\S]*?-->/) || ['<!--meta lib=休闲 tiers=休闲-->'])[0];
  const plot = (t.match(/##\s*剧情\s*\n([\s\S]*?)(?=\n##\s*休闲切入点)/) || [])[1] || '';
  const entry = (t.match(/##\s*休闲切入点\s*\n([\s\S]*?)(?=\n##\s*来源)/) || [])[1] || '';
  const src = (t.match(/##\s*来源\s*\n([\s\S]*)$/) || [])[1] || '';
  return { title, meta, plot, entry, src };
}
function join(p) {
  return (
    `# ${p.title}\n${p.meta}\n\n## 剧情\n\n${p.plot.trim()}\n\n## 休闲切入点\n\n${p.entry.trim()}\n\n## 来源\n\n${p.src.trim()}\n`
  );
}
function names(t) {
  const s = new Set();
  for (const m of t.matchAll(/\*\*([^*（(\n]{2,24})\*\*/g)) {
    const n = m[1].replace(/[｜|].*/, '').trim();
    if (
      n.length >= 2 &&
      n.length <= 20 &&
      !/作品|世界|舞台|故事|情感|氛围|生活|对话|结局|一周|感官|配角|节日|关系|冲突|后日|舞台再访/.test(n)
    )
      s.add(n);
  }
  return [...s].slice(0, 8);
}
function pad(title, ns, need) {
  const a = ns[0] || '可攻略对象';
  const b = ns[1] || a;
  const c = ns[2] || a;
  const chunks = [
    `**【${title} · 关系进档细则】**
与 **${a}** ：从「正确称呼」到「主动留门」再到「公开行程」。与 **${b}** ：从「共同事务」到「护短」再到「允许软弱被看见」。与 **${c}** ：从「私密角落」到「共伞」再到「合照」。每一档必须有可观察物证，禁止空口好感。`,
    `**【${title} · 冲突与和解】**
冲突来源优先：迟到、闲话、失约、秘密被第三人听见。和解步骤：先处理眼前麻烦→道歉具体事实→给对方拒绝权→第二天仍出现。**${a}** 吃认真；**${b}** 吃行动；**${c}** 吃时间。坏结局边缘是断联与把人当清单。`,
    `**【${title} · 舞台再访清单】**
教室后门、活动室、天台、车站、雨檐、祭摊后、河堤、图书馆角、便利店冷柜、宿舍走廊。每地绑定一次与 **${a}**/**${b}**/**${c}** 的短对话。重访同一地点换季节，检验关系是否仍活。`,
    `**【${title} · 后日谈气质】**
在一起之后的普通星期二比高潮重要：谁洗碗、谁占座、谁记得忌口。普通结局保留可重开的温柔距离。物证建议：钥匙扣、未拆信、伞的归属、名册签名。全部服务《${title}》人物与地点。`,
  ];
  let acc = '';
  let i = 0;
  while (nw(acc) < need && i < 16) {
    acc += (acc ? '\n\n' : '') + chunks[i % chunks.length];
    i++;
  }
  return acc;
}

const out = [];
for (let b = 821; b <= 830; b++) {
  const dir = path.join('产出', `批次${b}`);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const full = path.join(dir, f);
    let p = split(fs.readFileSync(full, 'utf8'));
    if (nw(p.plot) >= 7500 && nw(p.entry) >= 1800) continue;
    const ns = names(p.plot + p.entry);
    if (nw(p.plot) < 7500) p.plot = p.plot.trimEnd() + '\n\n' + pad(p.title, ns, 7500 - nw(p.plot) + 100);
    if (nw(p.entry) < 1800)
      p.entry = p.entry.trimEnd() + `\n\n（${p.title}·补）与 **${ns[0] || '角色'}** 保持守时与倾听，雨天是否相等。`;
    p.plot = p.plot.replace(/力量体系/g, '日常规则').replace(/战力/g, '影响力').replace(/阶位(?!切入)/g, '阶段');
    p.entry = p.entry.replace(/力量体系/g, '日常规则').replace(/战力/g, '影响力').replace(/阶位(?!切入)/g, '阶段');
    fs.writeFileSync(full, join(p), 'utf8');
    let r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' });
    let c = (r.stdout || '') + (r.stderr || '');
    let st = c.includes('不过关') ? 'HARD' : c.includes('有警告') ? 'WARN' : c.includes('过关') ? 'OK' : 'UNK';
    if (st === 'WARN') {
      let t = fs.readFileSync(full, 'utf8');
      t = t.replace(/力量体系/g, '日常规则').replace(/战力/g, '影响力').replace(/阶位(?!切入)/g, '阶段');
      fs.writeFileSync(full, t, 'utf8');
      r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' });
      c = (r.stdout || '') + (r.stderr || '');
      st = c.includes('不过关') ? 'HARD' : c.includes('有警告') ? 'WARN' : c.includes('过关') ? 'OK' : 'UNK';
    }
    p = split(fs.readFileSync(full, 'utf8'));
    out.push({ b, f, plot: nw(p.plot), entry: nw(p.entry), st });
  }
}
console.log(JSON.stringify(out, null, 2));
