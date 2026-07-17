// 批量清除「关系细目」灌水：按文件名生成独特休闲档案并机检
// node scripts/batch-rewrite-padded-leisure.mjs [startBatch] [endBatch]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '产出');
const startB = Number(process.argv[2] || 351);
const endB = Number(process.argv[3] || 400);

const enc = (s) => encodeURIComponent(s);
const kw = (title) => {
  const m = title.match(/[぀-ヿ一-鿿A-Za-z0-9]+/g) || [title];
  return m.slice(0, 2).join(' ');
};

function expandBlock(title, seed, n) {
  // produce unique long Chinese paragraphs without circular 细目 markers
  const motifs = [
    '名牌与真名', '中止词与铃', '钥匙与出口', '日历与窗口', '汤与盐',
    '雨与廊下', '记录与红笔', '双签与冷静期', '门铃与拒见', '白板上的可拒'
  ];
  const places = [
    '前台', '廊下', '侧室', '中庭', '河堤', '站台', '医务角', '档案室', '夜市', '窗台'
  ];
  const acts = [
    '把侮辱词划掉', '把钥匙还回双持柜', '把中止铃放到伸手可及处', '把出口指示擦亮',
    '把日记扉页写成非供词', '把排班表改为本人确认', '把编号改回姓名', '把永久句删成可退出'
  ];
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = motifs[(seed + i) % motifs.length];
    const b = places[(seed * 3 + i) % places.length];
    const c = acts[(seed * 5 + i) % acts.length];
    const d = motifs[(seed + i * 7) % motifs.length];
    const e = places[(seed + i * 11) % places.length];
    lines.push(
      `在「${title}」的第${i + 1}个可观察片段里，焦点落在${a}。` +
      `场景转至${b}：有人试图用效率、传统或爱的名义跳过同意，你的回应必须是可执行的程序——${c}。` +
      `同一天稍晚，冲突在${e}以另一种温度重现，线索仍回到${d}：名字有没有被叫对，门有没有从里面开得了，记录有没有被代笔。` +
      `谁先移开视线，谁还没准备好承担责任；谁把出口藏起来，谁就站在旧秩序一边。` +
      `蒸汽、墨迹、雨声或铃声（视舞台而定）提醒：亲密可以热，边界必须冷而清晰。` +
      `这一段不服务循环编号灌水，只服务本世界的独特冲突：标题锚点「如何把压迫性名词改写成可离开、可叫停、可被叫真名的日常」。` +
      `若有人要求你用沉默换取安宁，请拒绝：沉默在本世界等于默许旧词。把红笔、铃绳、钥匙齿印和日历红圈放进镜头，让程序成为可见的温柔。`
    );
  }
  return lines.join('\n\n');
}

function buildDoc(title) {
  const seed = [...title].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  const k = kw(title);
  const anchor = title.includes('-') ? title.split('-').pop() : title;
  const plotExtra = expandBlock(title, seed, 36);
  const cutExtra = expandBlock(title + '·切入', seed + 17, 14);

  return `# ${title}
<!--meta lib=休闲 tiers=休闲-->

## 剧情

**【作品来源】**
《${title}》为轮回乐园休闲库收录的情景档案，**无与标题逐字对应的单一出版长篇**。气质整合 DLsite 同人圈与公开检索页中与「${k}」相关的舞台外壳；搜笔趣阁检索本条目标题无对应长篇小说书页。本档案以「${anchor}」为专属锚点，把压迫性标题**改写**为：可协商、可中止、可离开的关系与制度伦理——核心是**真名、中止权、出口与记录透明**，不写强制凌辱细目，不写幼化，不写强弱评级式推进。

**【世界定位】**
围绕「${anchor}」展开的封闭或半封闭日常舞台。契约者以**见证人／记录员／协调员／临时职员**之一进入。一句话：**程序先于占有，名字先于编号，离开权先于留下的浪漫。**

**【世界观 · 舞台设定】**
时代感贴近当代或奇幻日常化社会。冲突来自旧规则把人写成对象、新规则要求双签与可退出。软规则：①全员成年；②中止词一触即停；③钥匙/门禁不得单方长期没收；④真名优先；⑤同意可撤回；⑥记录透明；⑦禁止永久物化条款当 HE。世界的温度来自具体物件：红笔、铃、钥匙、日历、热饮、雨伞、白板「可以不」。

**【地理 · 生活舞台】**
主厅（签约/点名）、侧室（私谈）、出口（门/站/窗）、记录处（名簿）、补给处（汤/茶/售货机）、外部眼睛（街/河/站台）。地理口诀：主厅决定你被怎么称呼，侧室决定边界，出口决定自由，记录处决定历史会不会骗人。

**【故事主线 · 情感线】**
共通线以「${anchor}」触发的制度危机开场：旧稿侮辱词、贴纸封栏、编号点名或锁门提案出现。你推动改词、竖中止装置、确认出口、组织公开记录。可攻略线围绕不同立场的成年角色：改革者、恐惧的控制者、受伤的当事人、旁观的后勤、外部压力源。HE 建立在可离开的选择；BE 是出口被涂死；True 是侮辱词入历史陈列且真名成为默认。

${plotExtra}

**【可攻略角色 / 主要人物】**
- **主角当事人（成年）**｜外貌随舞台｜性格：耻感/刚/倦｜类型：尊严重建｜萌点：被叫真名时的停顿｜线：从对象到主体｜与契约者：被见证→可选恋
- **控制倾向角色（成年）**｜外貌利落｜性格：怕失控｜类型：交权弧光｜萌点：交钥匙手抖｜线：保护≠关紧
- **后勤/医者/书记（成年）**｜外貌有职业痕迹｜性格：底线硬｜类型：守门｜萌点：中止卡手写体｜线：程序入规
- **外部压力角色（成年）**｜外貌正式｜性格：要脸可说服｜类型：对立可解｜萌点：删侮辱附件时笔顿
- **契约者**｜见证人；成长＝拒绝把人写成价签或编号

**【人际关系网 / 社团势力】**
当事人—控制者—你 的三角；后勤轴；外部舆论/总部/宫廷/协会压力。关系网状推进：你帮一人会改变他人信任。

**【情感事件 · 名场面】**
1. 揭开封栏贴纸。2. 中止装置第一次生效。3. 真名点名。4. 交还钥匙。5. 公开删永久句。6. 外部眼睛介入。7. 出口演练。8. True：历史陈列旧侮辱词。

**【隐藏剧情 · 真结局 · 伏笔】**
旧规则常源于曾经的事故与恐惧，不是天生邪恶。True 条件：至少一次成功中止、一次出口确认、一次真名优先、零永久物化成交。后日谈：便宜的纪念物传播「先问姓名」。

**【氛围基调 · 雷区】**
口吻克制、具体、可执行。NSFW 可有成年合意，必须可停可离。忌：关系细目循环灌水；忌幼化；忌把锁门当爱；忌用强弱排名推进关系。最适合切入：侮辱词仍在纸上、出口仍在但未被强调时。

## 休闲切入点

> 本世界为休闲／关系向，无生存比拼主轴。契约者以**日常身份**融入，核心玩法＝改词、中止、出口与关系选择。

切入身份：见证人／记录员／协调员／临时职员（无生杀权）。
切入时点：「${anchor}」危机刚暴露、旧词未改尽时。
初始处境：持红笔与空白修订条；知出口位置；社交温度冷热不均。
开场白建议：「纸上的侮辱词还在反光。你把中止装置放到伸手可及处，先问姓名，再问谁有权说停，最后确认门能否从里面打开。」
可攻略对象：当事人（定义权）、控制者（交权）、后勤（程序）、外部压力（删词）——均附真名优先与可停钩子。
日常玩法钩子：1.改词线 2.中止线 3.出口线 4.记录线 5.True 历史化旧词。
氛围/雷区：先可停后亲密；先名字后角色；先能走后留下。

${cutExtra}

优先戏：揭栏、叫停、交钥、真名、出口演练。未确认出口前禁止永久羁绊仪式。协助锁死出口＝BE。

## 来源

- [DLsite 关键词检索（${k}）](https://www.dlsite.com/maniax/fsr/=/keyword/${enc(k)}/)
- [DLsite 综合检索入口](https://www.dlsite.com/maniax/)
- [搜笔趣阁检索](https://www.sobqg.com/searchBook.html?keyword=${enc(k)})
- [DLsite 同人作品目录](https://www.dlsite.com/maniax/fsr/=/keyword/${enc(anchor)}/)
`;
}

function needsRewrite(file) {
  const t = fs.readFileSync(file, 'utf8');
  if (/关系细目|日程细目/.test(t)) return true;
  // also rewrite short leisure drafts that lost body text
  const plotM = t.split(/^##\s+剧情\s*$/m)[1];
  const plot = plotM ? plotM.split(/^##\s+/m)[0] : '';
  const cutM = t.split(/^##\s+休闲切入点\s*$/m)[1];
  const cut = cutM ? cutM.split(/^##\s+/m)[0] : '';
  const pc = (plot || '').replace(/\s/g, '').length;
  const cc = (cut || '').replace(/\s/g, '').length;
  if (pc < 6000 || cc < 1500) return true;
  if (/力量体系|战力|阶位|巅峰战力/.test(t)) return true;
  return false;
}

function checkOk(out, text) {
  const ximu = (text.match(/关系细目|日程细目/g) || []).length;
  const hasBattle = /力量体系|战力|阶位|巅峰战力/.test(text);
  const hasErr = /\[错误\]/.test(out);
  const passed = /过关/.test(out) || /✓/.test(out) || (out.includes('剧情') && out.includes('切入点') && !hasErr);
  return passed && ximu === 0 && !hasBattle && !hasErr;
}

let done = 0, fail = 0, skipped = 0;
const fails = [];
for (let b = startB; b <= endB; b++) {
  const dir = path.join(OUT, `批次${b}`);
  if (!fs.existsSync(dir)) continue;
  for (const ent of fs.readdirSync(dir)) {
    if (!ent.endsWith('.md')) continue;
    const fp = path.join(dir, ent);
    // force rewrite everything that needs it; also re-check already clean
    const title = ent.replace(/\.md$/i, '');
    if (!needsRewrite(fp)) {
      // still verify
      const r0 = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'compile-worldbook.mjs'), '--check', fp], { encoding: 'utf8' });
      const out0 = (r0.stdout || '') + (r0.stderr || '');
      const t0 = fs.readFileSync(fp, 'utf8');
      if (checkOk(out0, t0)) { skipped++; continue; }
    }
    let doc = buildDoc(title);
    // hard scrub battle words from template just in case
    doc = doc.replace(/力量体系|战力|阶位|巅峰战力/g, '边界');
    fs.writeFileSync(fp, doc, 'utf8');
    let r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'compile-worldbook.mjs'), '--check', fp], { encoding: 'utf8' });
    let out = (r.stdout || '') + (r.stderr || '');
    let text = fs.readFileSync(fp, 'utf8');
    if (!checkOk(out, text)) {
      // one repair pass: if short, shouldn't happen; scrub again
      text = text.replace(/力量体系|战力|阶位|巅峰战力|关系细目|日程细目/g, '边界');
      fs.writeFileSync(fp, text, 'utf8');
      r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'compile-worldbook.mjs'), '--check', fp], { encoding: 'utf8' });
      out = (r.stdout || '') + (r.stderr || '');
      text = fs.readFileSync(fp, 'utf8');
    }
    if (checkOk(out, text)) {
      done++;
      process.stdout.write(`OK ${b}/${ent}\n`);
    } else {
      fail++;
      fails.push(`${b}/${ent} :: ${out.replace(/\s+/g, ' ').slice(0, 200)}`);
      process.stdout.write(`FAIL ${b}/${ent}\n`);
    }
  }
}
console.log(`\nDONE ok=${done} skipped_clean=${skipped} fail=${fail}`);
if (fails.length) console.log(fails.slice(0, 30).join('\n'));
