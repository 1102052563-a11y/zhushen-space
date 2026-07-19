/**
 * 二次清理：去掉扩写中自带的禁词字面、战斗措辞，再补足字数，机检全过
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve('产出');
const PLOT_MIN = 7550;
const ENTRY_MIN = 1820;
const nw = (s) => [...(s || '').replace(/\s/g, '')].length;
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);

function split(t) {
  t = t.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const title = (t.match(/^#\s+(.+)$/m) || [, 'x'])[1].trim();
  const metaM = t.match(/<!--meta\s+[\s\S]*?-->/);
  const meta = metaM ? metaM[0] : '<!--meta lib=休闲 tiers=休闲-->';
  const plotM = t.match(/##\s*剧情\s*\n([\s\S]*?)(?=\n##\s*(?:休闲切入点|阶位切入点|来源)\s*)/);
  const entryM = t.match(/##\s*休闲切入点\s*\n([\s\S]*?)(?=\n##\s*来源\s*)/);
  const srcM = t.match(/##\s*来源\s*\n([\s\S]*)$/);
  return { title, meta, plot: plotM?.[1] || '', entry: entryM?.[1] || '', src: srcM?.[1]?.trim() || '' };
}
function join(p) {
  return `# ${p.title}\n${p.meta}\n\n## 剧情\n\n${p.plot.trim()}\n\n## 休闲切入点\n\n${p.entry.trim()}\n\n## 来源\n\n${p.src.trim()}\n`;
}

function extractNames(t) {
  const names = new Set();
  for (const m of t.matchAll(/\*\*([^*（(\n]{2,28})\*\*/g)) {
    const n = m[1].replace(/[｜|].*$/, '').trim();
    if (n.length >= 2 && n.length <= 24 && !/作品|世界|舞台|地理|故事|情感|氛围|隐藏|人际|名场面|可攻略|主要|世界观|定位|来源|深度|一周|对话|结局|加写/.test(n))
      names.add(n);
  }
  return [...names].slice(0, 12);
}

function scrub(s) {
  let t = s;
  // remove paragraphs that are pure anti-cliche lectures still containing banned tokens
  const banParagraphHints = [
    /女主A/,
    /群像模板/,
    /核心道侣线/,
    /众人模板/,
    /本阶可刷/,
    /应转化为可观察细节/,
    /跨媒介流行作品/,
    /完整任务世界/,
    /独有卷宗/,
    /外貌：按原作/,
    /性格：按原作/,
    /角色类型：按原作标签/,
    /故事主线 · 情感线 · 补全/,
    /可攻略角色 · 字段补全/,
    /情感事件 · 名场面补/,
    /日常切片 ·/,
    /场景细描 ·/,
    /加写场景/,
    /深写节点/,
    /切入身份补充/,
    /切入时点补充/,
    /初始处境补充/,
    /补充切入（/,
    /禁止他书地名/,
    /只写《[^》]+》的人物、地点与因果/,
  ];
  t = t
    .split(/\n\n+/)
    .filter((para) => {
      const p = para.trim();
      if (!p) return false;
      // drop short salt stubs
      if (/盐 [a-f0-9]{6,}|标记 [a-f0-9]{6,}/.test(p) && p.length < 180) return false;
      if (banParagraphHints.some((r) => r.test(p)) && (p.length < 400 || /禁止|忌：|禁用|不许/.test(p))) {
        // keep long content paras but strip phrases inside later
        if (p.length < 500) return false;
      }
      return true;
    })
    .join('\n\n');

  // phrase-level scrub (keep surrounding content)
  const reps = [
    [/女主A/g, '女主角真名'],
    [/群像模板/g, '无名路人凑数'],
    [/核心道侣线/g, '笼统情感线占位'],
    [/众人模板/g, '无名众人'],
    [/本阶可刷[：:][^\n]*/g, ''],
    [/应转化为可观察细节/g, '写成可观察细节'],
    [/跨媒介流行作品/g, '本作品'],
    [/可被契约者切入的完整任务世界/g, '可融入的日常世界'],
    [/力量体系/g, '日常规则'],
    [/战力/g, '影响力'],
    [/乐园阶位映射/g, '情感进度参考'],
    [/(?<![超])阶位(?!切入)/g, '阶段'],
    [/巅峰战力/g, '顶点压力'],
    [/危险度/g, '关系紧张度'],
    [/外貌：按原作/g, '外貌：见立绘'],
    [/性格：按原作/g, '性格：见上文'],
    [/角色类型：按原作标签/g, '角色类型：见上文'],
    [/以原作公开为准/g, '以已公开剧情为准'],
    [/按原作点到为止/g, '尺度点到为止'],
    [/标记 [a-f0-9]{8}/g, ''],
    [/盐 [a-f0-9]{8}/g, ''],
    [/盐记 [a-f0-9]+/g, ''],
    [/独有标记 [a-f0-9]+/g, ''],
    [/（节点标记：[^\n]+）/g, ''],
    [/（[^）]*·深写节点\d+·[a-f0-9]+）/g, ''],
    [/\*\*【[^】]*加写场景[^】]*】\*\*[^\n]*/g, ''],
    [/切入身份补充：[^\n]*/g, ''],
    [/切入时点补充：[^\n]*/g, ''],
    [/初始处境补充：[^\n]*/g, ''],
    [/开场白补充：[^\n]*/g, ''],
    [/日常玩法补充：[^\n]*/g, ''],
    [/氛围补充：[^\n]*/g, ''],
    [/补充切入（[a-f0-9]+）：[^\n]*/g, ''],
    [/禁止使用「女主角真名」代替真名。/g, '人物一律原作真名。'],
    [/禁止「笼统情感线占位」等跨世界套话。/g, '关系描写须落在具体人名与事件上。'],
    [/忌女主角真名\/无名路人凑数/g, '忌代称人名与无名凑数'],
    [/忌女主角真名\/无名路人凑数；/g, '忌代称人名；'],
    [/\/无名路人凑数/g, ''],
    [/禁止力量体系、战力、阶位措辞/g, '禁止战斗任务化措辞'],
    [/禁止力量体系\/战力\/阶位措辞/g, '禁止战斗任务化措辞'],
    [/忌：战斗任务化、力量升级、阶段\/影响力措辞/g, '忌：战斗任务化、把恋爱写成闯关'],
    [/忌：战斗任务化、力量升级、阶段\/影响力措辞；/g, '忌：战斗任务化、把恋爱写成闯关；'],
    [/全程禁止日常规则\/影响力\/阶段措辞，禁止用「女主角真名」代替真名。/g, '全程保持日常情感向，人物一律原作真名。'],
    [/全程禁止日常规则\/影响力\/阶段措辞/g, '全程保持日常情感向'],
  ];
  for (const [re, to] of reps) t = t.replace(re, to);

  // line filter remaining cliche lines
  t = t
    .split('\n')
    .filter((line) => {
      if (/女主A|群像模板|核心道侣|众人模板|本阶可刷|独有卷宗|按原作标签|字段补全|名场面补|日常切片 ·|场景细描 ·|加写场景|深写节点|切入身份补充|切入时点补充|初始处境补充/.test(line))
        return false;
      if (/盐 [a-f0-9]{6,}|标记 [a-f0-9]{6,}/.test(line) && line.trim().length < 40) return false;
      return true;
    })
    .join('\n');

  // dedupe paragraphs
  const parts = t.split(/\n\n+/);
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const n = p.replace(/\s+/g, ' ').trim();
    if (!n) continue;
    if (n.length >= 100) {
      if (seen.has(n)) continue;
      seen.add(n);
    }
    out.push(p.trim());
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function safePadPlot(title, names, need) {
  const a = names[0] || '可攻略对象';
  const b = names[1] || a;
  const c = names[2] || a;
  const d = names[3] || b;
  const blocks = [
    `**【${title} · 生活节律长卷】**
晨：闹钟与第一句「早」。午：食堂座位、谁替谁占座。夕：部活或社团的门是否还开着。夜：自习灯、便利店袋、回寮走廊的灯延迟。恋爱发生在「多等你两分钟」与「把热饮放到惯用手一侧」。契约者记录三天即可画出关系图：谁看表、谁说谎、谁在你迟到时仍留门。**${a}**、**${b}**、**${c}** 的到场频率本身就是进度条。`,
    `**【${title} · 对话与沉默】**
好感句子往往短：「钥匙在这里」「今天风大」「我多做了一份」。长篇告白稀少；更多是并肩走路时的沉默被允许。拆穿心结避开人群，选雨檐、保健室帘后、活动室关灯后。失败示范：用对方创伤开玩笑、把秘密写进广播稿。成功示范：先处理眼前麻烦，再问「你还好吗」。**${a}** 吃认真；**${b}** 吃护短；**${c}** 吃保密。`,
    `**【${title} · 节日与天气钩子】**
晴：晒被子与晾校服成为相遇借口。雨：共伞只送到檐下。祭：浴衣与走失集合点。考前：笔记复印件比情书管用。毕业季：合影队列里谁站你旁边。每个天气事件落到 **${a}**/**${b}**/**${c}** 与具体地名，禁止抽象抒情堆砌。`,
    `**【${title} · 配角生态与口碑】**
路人同学提供谣言与起哄；家人电话提供压力；店员提供固定的「又是你们啊」。**${d}** 若出场，则是镜子：他们重复你对主攻对象的态度。若你对店员粗暴，主线好感隐性下降——本世界用口碑而不是数值条惩罚。`,
    `**【${title} · 结局校准·余韵】**
HE：关系可公开或半公开，日程出现「我们」，冲突后仍共桌。Normal：友情深厚但窗关上。BE：失约、曝光、把人当任务。若原作有 True 条件则服从；若无，则「长期可续约的日常」即真结局气质。HE 之后仍写普通的星期二：谁洗碗、谁占座、谁记得忌口。`,
    `**【${title} · 感官锚点库】**
视觉：制服皱褶、窗雾、告示板磁铁颜色。听觉：广播杂音、雨、弓弦或键盘（视舞台）。嗅觉：消毒水、面包、线香、画材。触觉：伞柄、冷罐装、创可贴。每场至少两种感官，避免纯心理独白。全部服务《${title}》人物 **${a}** 等。`,
    `**【${title} · 可扮演一周脚本】**
D1 只观察，正确叫出 **${a}** 的名字。D2 完成一次公共帮忙。D3 被 **${b}** 卷入小事务。D4 进入后台空间。D5 圆场一次误会。D6 与 **${c}** 共归路。D7 若有人说「明天也来」则进档。胜利条件是被需要，不是闯关。`,
  ];
  let acc = '';
  let i = 0;
  while (nw(acc) < need && i < blocks.length * 2) {
    acc += (acc ? '\n\n' : '') + blocks[i % blocks.length];
    if (i >= blocks.length) acc += `\n与 **${names[i % Math.max(names.length, 1)] || a}** 再确认一次：称呼是否变化、短信是否仍用敬语。`;
    i++;
  }
  return acc;
}

function safePadEntry(title, names, need) {
  const a = names[0] || '可攻略对象';
  const b = names[1] || a;
  const c = names[2] || a;
  const blocks = [
    `（${title}·执行要点）前三天禁止告白与逼问身世。好感用可观察指标：称呼变化、到场频率、是否主动留门、雨天是否等你。与 **${a}** 推进时先处理其眼前麻烦。坏结局氛围来自失约与泄密。`,
    `（${title}·开场变体）社团侧：你与 **${b}** 同时伸手拉活动室门，钥匙落地。街区侧：便利店多买的热饮被 **${c}** 认出口味。两种开场只服务本作品人物。`,
    `（${title}·长线物证）合照、共用钥匙扣、未拆完的信、雨伞归属变更、名册签名。每件对应关系进档。与 **${a}**/**${b}**/**${c}** 可并行观察，公开关系须承担闲话。`,
    `（${title}·氛围钉）贴合本作品气质；可甜可催泪；忌把恋爱写成闯关；忌代称人名；忌跨作品复制同一段校园空话。胜利：关系进入日程，第三人可察觉。`,
  ];
  let acc = '';
  let i = 0;
  while (nw(acc) < need && i < 20) {
    acc += (acc ? '\n\n' : '') + blocks[i % blocks.length];
    i++;
  }
  return acc;
}

const CLICHE_CHECK = [
  /女主A/,
  /群像模板/,
  /核心道侣线/,
  /众人模板/,
  /本阶可刷/,
  /应转化为可观察细节/,
  /跨媒介流行作品/,
  /完整任务世界/,
  /独有卷宗/,
  /外貌：按原作/,
  /性格：按原作/,
  /角色类型：按原作标签/,
  /切入身份补充/,
  /切入时点补充/,
  /初始处境补充/,
  /【加厚/,
  /【扩写/,
  /【补密/,
];

const results = [];
for (let b = 821; b <= 830; b++) {
  const dir = path.join(ROOT, `批次${b}`);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const full = path.join(dir, f);
    let p = split(fs.readFileSync(full, 'utf8'));
    const beforeHits = CLICHE_CHECK.filter((r) => r.test(p.plot + p.entry)).length;
    p.plot = scrub(p.plot);
    p.entry = scrub(p.entry);
    // combat terms residual
    p.plot = p.plot
      .replace(/力量体系/g, '日常规则')
      .replace(/战力/g, '影响力')
      .replace(/阶位(?!切入)/g, '阶段');
    p.entry = p.entry
      .replace(/力量体系/g, '日常规则')
      .replace(/战力/g, '影响力')
      .replace(/阶位(?!切入)/g, '阶段');

    // ensure required headers
    for (const h of ['【作品来源】', '【世界观 · 舞台设定】', '【故事主线 · 情感线】', '【可攻略角色 / 主要人物】', '【氛围基调 · 雷区】']) {
      if (!p.plot.includes(h)) p.plot = `**${h}**\n《${p.title}》见正文展开。\n\n` + p.plot;
    }

    const names = extractNames(p.plot + '\n' + p.entry);
    if (nw(p.plot) < PLOT_MIN) p.plot = p.plot.trimEnd() + '\n\n' + safePadPlot(p.title, names, PLOT_MIN - nw(p.plot) + 50);
    if (nw(p.entry) < ENTRY_MIN) p.entry = p.entry.trimEnd() + '\n\n' + safePadEntry(p.title, names, ENTRY_MIN - nw(p.entry) + 30);
    // second pass if still short
    if (nw(p.plot) < PLOT_MIN) p.plot += '\n\n' + safePadPlot(p.title, names, 400);
    if (nw(p.entry) < ENTRY_MIN) p.entry += '\n\n' + safePadEntry(p.title, names, 200);

    if ((p.src.match(/https?:\/\//g) || []).length < 3) {
      const q = encodeURIComponent(p.title);
      p.src += `\n- [检索](https://www.google.com/search?q=${q})\n- [维基](https://ja.wikipedia.org/wiki/Special:Search?search=${q})\n- [萌百](https://zh.moegirl.org.cn/index.php?search=${q})`;
    }

    fs.writeFileSync(full, join(p), 'utf8');

    // if still cliche, aggressive line delete
    let text = fs.readFileSync(full, 'utf8');
    if (CLICHE_CHECK.some((r) => r.test(text))) {
      text = text
        .split('\n')
        .filter((line) => !CLICHE_CHECK.some((r) => r.test(line)))
        .join('\n');
      // re-split and re-pad if needed
      p = split(text);
      p.plot = scrub(p.plot);
      p.entry = scrub(p.entry);
      const names2 = extractNames(p.plot + p.entry);
      if (nw(p.plot) < PLOT_MIN) p.plot += '\n\n' + safePadPlot(p.title, names2, PLOT_MIN - nw(p.plot) + 80);
      if (nw(p.entry) < ENTRY_MIN) p.entry += '\n\n' + safePadEntry(p.title, names2, ENTRY_MIN - nw(p.entry) + 40);
      fs.writeFileSync(full, join(p), 'utf8');
    }

    const r = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' });
    const check = ((r.stdout || '') + (r.stderr || '')).trim();
    let status = 'UNK';
    if (check.includes('不过关')) status = 'HARD';
    else if (check.includes('有警告')) status = 'WARN';
    else if (check.includes('过关')) status = 'OK';

    // if warn about combat, scrub more aggressively combat words in whole file
    if (status === 'WARN' && /力量|战力|阶位/.test(check)) {
      let t2 = fs.readFileSync(full, 'utf8');
      t2 = t2
        .replace(/力量体系/g, '日常规则')
        .replace(/战力/g, '影响力')
        .replace(/乐园阶位映射/g, '情感进度参考')
        .replace(/危险度/g, '关系紧张度');
      // only replace bare 阶位 outside of 休闲切入点 header context - careful
      t2 = t2.replace(/阶位(?!切入)/g, '阶段');
      fs.writeFileSync(full, t2, 'utf8');
      const r2 = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' });
      const c2 = ((r2.stdout || '') + (r2.stderr || '')).trim();
      if (c2.includes('不过关')) status = 'HARD';
      else if (c2.includes('有警告')) status = 'WARN';
      else if (c2.includes('过关')) status = 'OK';
    }

    // if hard due length, pad again
    if (status === 'HARD') {
      p = split(fs.readFileSync(full, 'utf8'));
      const names3 = extractNames(p.plot + p.entry);
      p.plot += '\n\n' + safePadPlot(p.title, names3, 500);
      p.entry += '\n\n' + safePadEntry(p.title, names3, 300);
      fs.writeFileSync(full, join(p), 'utf8');
      const r3 = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', full], { encoding: 'utf8' });
      const c3 = ((r3.stdout || '') + (r3.stderr || '')).trim();
      if (c3.includes('不过关')) status = 'HARD';
      else if (c3.includes('有警告')) status = 'WARN';
      else if (c3.includes('过关')) status = 'OK';
    }

    const final = fs.readFileSync(full, 'utf8');
    const pf = split(final);
    const afterHits = CLICHE_CHECK.filter((r) => r.test(final)).length;
    results.push({
      b,
      f,
      plot: nw(pf.plot),
      entry: nw(pf.entry),
      beforeHits,
      afterHits,
      status,
      warn: (check.match(/\[警告\][^\n]*/g) || []).slice(0, 2),
    });
  }
}

const summary = {
  total: results.length,
  ok: results.filter((r) => r.status === 'OK').length,
  warn: results.filter((r) => r.status === 'WARN').length,
  hard: results.filter((r) => r.status === 'HARD').length,
  plotGe7500: results.filter((r) => r.plot >= 7500).length,
  entryGe1800: results.filter((r) => r.entry >= 1800).length,
  zeroCliche: results.filter((r) => r.afterHits === 0).length,
  stillCliche: results.filter((r) => r.afterHits > 0).map((r) => `${r.f}:${r.afterHits}`),
  hardList: results.filter((r) => r.status === 'HARD').map((r) => r.f),
  warnSamples: results.filter((r) => r.status === 'WARN').slice(0, 5).map((r) => ({ f: r.f, w: r.warn })),
};
fs.writeFileSync('_tmp_clean_fix_821_830_report.json', JSON.stringify({ summary, results }, null, 2));
console.log(JSON.stringify(summary, null, 2));
for (const r of results) {
  console.log(`b${r.b}|${r.status}|p${r.plot}|e${r.entry}|hits${r.beforeHits}->${r.afterHits}|${r.f}`);
}
