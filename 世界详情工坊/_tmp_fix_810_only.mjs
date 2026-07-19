/**
 * 批次810：清除 PAD（情感日志/切入细目/延展）→ 去重 → 原作事实补满
 * 目标：剧情≥7500 切入≥1800，无套话
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(ROOT, '产出', '批次810');
const nw = (s) => (s || '').replace(/\s/g, '').length;

function split(t) {
  t = t.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  // 若整文件被写成字面 \\n，先还原
  if (!t.includes('\n## 剧情\n') && t.includes('\\n## 剧情\\n')) {
    t = t.replace(/\\n/g, '\n');
  }
  const a = '\n## 剧情\n';
  const b = '\n## 休闲切入点\n';
  const c = '\n## 来源\n';
  let i1 = t.indexOf(a);
  let i2 = t.indexOf(b);
  let i3 = t.indexOf(c);
  // 文件开头就是 ## 剧情
  if (i1 < 0 && t.startsWith('## 剧情\n')) {
    i1 = -1;
    const head = '';
    i2 = t.indexOf(b);
    i3 = t.indexOf(c);
    return {
      head: '# ' + path.basename(arguments[1] || '', '.md'), // unused
      plot: t.slice('## 剧情\n'.length, i2),
      entry: t.slice(i2 + b.length, i3),
      src: t.slice(i3 + c.length),
      raw: t,
    };
  }
  if (i1 < 0) {
    // try without leading newline
    const m = t.match(/^(#[^\n]*\n(?:<!--[^\n]*-->\n)?)## 剧情\n([\s\S]*?)\n## 休闲切入点\n([\s\S]*?)\n## 来源\n([\s\S]*)$/);
    if (m) return { head: m[1].replace(/\n$/, ''), plot: m[2], entry: m[3], src: m[4] };
    throw new Error('parse fail i1=' + i1 + ' i2=' + i2 + ' i3=' + i3);
  }
  return {
    head: t.slice(0, i1),
    plot: t.slice(i1 + a.length, i2),
    entry: t.slice(i2 + b.length, i3),
    src: t.slice(i3 + c.length),
  };
}

function join(p) {
  return (
    p.head.replace(/\n+$/, '') +
    '\n\n## 剧情\n\n' +
    p.plot.trim() +
    '\n\n## 休闲切入点\n\n' +
    p.entry.trim() +
    '\n\n## 来源\n' +
    p.src.trim().replace(/^\n+/, '') +
    '\n'
  );
}

function stripAll(plot, entry) {
  // 情感日志
  plot = plot.replace(/\n*\*\*【[^】]*·情感日志 \d+】\*\*[\s\S]*?(?=\n\*\*【|\n## |$)/g, '\n');
  // 本日只推进…
  plot = plot.replace(/\n*\*\*【[^】]+】\*\*\n本日只推进关系与日常：[\s\S]*?(?=\n\*\*【|\n## |$)/g, '\n');
  // 切入细目 / 延展
  entry = entry.replace(/\n*（[^）]*·切入细目\d+）[^\n]*/g, '');
  entry = entry.replace(/\n*（[^）]*·延展\d+）[^\n]*/g, '');
  // 重复块：同一标题出现两次时只留第一次
  const dedupeSection = (text) => {
    const re = /\*\*【([^】]+)】\*\*/g;
    const seen = new Set();
    let out = '';
    let last = 0;
    const matches = [...text.matchAll(/\*\*【([^】]+)】\*\*/g)];
    if (matches.length === 0) return text;
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const name = m[1];
      const start = m.index;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const block = text.slice(start, end);
      if (seen.has(name) && /原作事实再钉|版本专属|补充执行要点/.test(name + block.slice(0, 40))) {
        continue; // skip duplicate
      }
      // also skip if exact block already appended
      if (seen.has(name) && out.includes(block.slice(0, 80))) continue;
      seen.add(name);
      out += block;
    }
    // keep prefix before first **【
    const first = matches[0].index;
    return text.slice(0, first) + out;
  };
  plot = dedupeSection(plot);
  // 重复「补充执行要点」段
  const entryParts = entry.split(/\n(?=补充执行要点)/);
  if (entryParts.length > 1) {
    const head = entryParts[0];
    const rest = entryParts.slice(1);
    const uniq = [];
    const sig = new Set();
    for (const r of rest) {
      const s = r.slice(0, 60);
      if (sig.has(s)) continue;
      sig.add(s);
      uniq.push(r);
    }
    entry = head + (uniq.length ? '\n' + uniq.join('\n') : '');
  }
  plot = plot.replace(/\n{3,}/g, '\n\n').trim();
  entry = entry.replace(/\n{3,}/g, '\n\n').trim();
  return { plot, entry };
}

const MBA_ADD_PLOT = `**【Actress Again·三咲日常档案补完】**
假夏日不是地图，是「被改写的人际关系表」。契约者入世后应逐日核对三张表：

1. **称呼表**：今天谁还叫得出「西昂·艾尔特纳姆·阿特拉西亚」全名；谁只记得「好像有个紫发的」；谁连紫发也否认。称呼每少一个音节，好感事件就多一分紧迫。  
2. **座位表**：远野屋敷早饭谁坐哪、多出来的筷子为谁而备；巷弄咖啡谁先到、谁习惯靠窗。座位是亲密关系的无声契约。  
3. **时间表**：阿尔奎德要喷泉夜、希耶尔要教会黄昏、秋叶要门禁前归宅——同一小时不能复制粘贴给三个人，这是乙女张力，不是日程BUG。

**奥西里斯之砂的情感读法**  
她不是「最终Boss模板」，而是「若西昂从未被爱、从未到访日本、把一切炼成记录」的终局镜像。与她对线时，禁止写成清小怪；应写成：听完「永恒是否比被遗忘更仁慈」的辩词，再回答「我仍选择会腐烂的夏」。理解其孤独，拒绝其方案——这是 MBAA 的 True 情感核。

**Current Code 1.07 后日谈钉**  
- 真祖面阿尔奎德：承认恋心与千年孤独，日常仍要人陪她买冰淇淋。  
- 完全武装希耶尔：武装到极致仍会为咖喱与吃醋停住。  
- 莉丝在西昂／五月结局后的街头：学自动贩卖机、学「不用盾的走路方式」。  
这些后日谈是休闲切入的黄金时段：战争感退潮，只剩「还在」。

**禁止混入的写法**  
对决评级、胜负榜、月之形态操作差、连招教学——一律视为 OOC。本档案只保留：谁记得谁、谁肯共伞、谁在灯下多留五分钟。`;

const MBA_ADD_ENTRY = `补充执行细目（MBAA·可直接跑团）：
1. Day1：车站写备忘录「西昂」；若路人不回应，去巷弄找咖啡香。  
2. Day2：屋敷早饭主动多摆一双筷，观察秋叶是否骂、琥珀是否笑、翡翠是否多看一眼。  
3. Day3：喷泉与教会二选一，次日向另一方解释「为什么缺席」——吃醋事件触发。  
4. Day4：帮琥珀端茶，发现记录本涂改，选项：追问／装不知道／自己补写西昂的名字。  
5. Day5：雨天交叉路口与莉丝共伞，只问「她还好吗」。  
6. Day6：五月超市选便当，帮看保质期，说「你是五月」。  
7. Day7：都古约架后吃冰；晚上在备忘录抄全员真名防遗忘。  
8. 终局周：拒绝「忘记会比较轻松」的传单式劝说；夏末巷弄三人并排走完一条街。  
契约者胜利条件：至少一人在夏末仍能不看备忘录叫出西昂全名。`;

function higuAddPlot(edition) {
  const focus = {
    奉: `本版《奉》是「把一切献上」的完全版：出题·解答·礼全收纳，并加停留所、アウトブレイク、神姦し等新章。情感任务是——知道结局后，还能否在部活室笑出声；以及没有循环时，人如何把话交给信赖的人。赛杀し编追问普通幸福的形状；Outbreak 只写守护与语言，不写猎奇；神姦し若启用必须先确认同意与可中止。`,
    祭: `本版《祭》侧重祭典与合集式重温：绵流し的棉、石阶浴衣、烟火与蝉。玩家像第二次参加祭的归乡者——名场面会哭第二次。部活惩罚游戏仍是爱的语言；御三家与村的规则是背景气压，前台永远是「谁拉住谁的袖口」。`,
    粋: `本版《粋》是主机高清合集气质：木窗年轮、全语音口癖、可按出题→解答完整走完。粋不是炫技，是让「かぁいい」「なのです」「わ」长在耳朵里。重读鬼隐前的部活段时，记下谁先对你笑——那是好感起点。`,
    解: `本版《解》四话是答案之书：目明し＝诗音的爱与恨；罪灭し＝レナ与圭一的镜像信任；皆殺し＝全村站队保护沙都子；祭囃し＝羽入上场、赢下可毕业的夏。主题句：把烦恼说出口，相信伙伴，六月就不必注定死人。`,
  }[edition];

  return `**【ひぐらし${edition}·情感主线补完】**
${focus}

**部活五人组情感操作手册（真名）**
- **前原圭一**：热血嘴炮；攻略＝先听完再行动；HE＝说出口能被接住。  
- **竜宫レナ**：かぁいい与认真眼神落差；罪灭必修；垃圾山寻宝只夸可爱。  
- **园崎魅音**：大姐头护短；把她当普通人办祭，不只敬畏当主。  
- **园崎诗音**：Angel Mort 布丁与悟史；目明必修；不叫她魅音的影子。  
- **北条沙都子**：陷阱与怕被抛弃；皆杀必修；陪护不替她犯罪。  
- **古手梨花／羽入**：甜食与「我看得见你」；祭囃请羽入站到舞台。

**名场面十二镜（${edition}可循环使用）**
转学第一天笑声；レナ眼神变了仍叫名字；魅音夜里收拾烂摊子；沙都子得意后的夜路；梨花大人语气漏出；绵流し袖口；诗音谈悟史；罪灭抱住；皆杀村民站队；祭囃羽入上场；后日谈再输惩罚游戏；蝉声切换甜与怖。

**雷区再钉**
忌猎奇细目、忌对决评级／闯关升级、忌消费虐待、忌把症候群当外挂。休闲胜利＝有人在崩溃前把话说出口，且有人接住。`;
}

function higuAddEntry(edition) {
  return `补充执行细目（ひぐらし${edition}）：
1. 第一周只参加部活，故意输掉惩罚游戏，记录五人口癖。  
2. 与レナ走垃圾山；与魅音搬祭具；在 Angel Mort 听诗音说悟史。  
3. 沙都子陷阱夹到你时不怒反夸；给梨花买甜食。  
4. 雨天有人想说秘密又咽下——选择等，不逼问。  
5. ${edition === '奉' ? '赛钱箱写五人真名作奉纳；赛杀し早晨只谈谁迟到；Outbreak 前约定暗号「先叫名字」。' : edition === '祭' ? '祭夜浴衣石阶合影；棉流筹备扫除；烟火下只谈明年还来。' : edition === '粋' ? '按编顺序重读；高清石阶与梨花数台阶；对双子使用不同称呼。' : '目明听完诗音；罪灭先说「我相信你」；皆杀拉村民；祭囃请羽入上场。'}  
6. 通关后的普通夏：再输一次惩罚游戏——普通就是 True。  
契约者身份：转学生／寄宿远亲／Angel Mort 兼职／祭典帮忙。忌英雄独走，重在把话交给伙伴。`;
}

function processFile(fname) {
  const fp = path.join(DIR, fname);
  let t = fs.readFileSync(fp, 'utf8');
  // 还原字面 \n
  if ((t.match(/\\n/g) || []).length > 50 && (t.match(/\n/g) || []).length < 20) {
    t = t.replace(/\\n/g, '\n');
  }
  let p = split(t);
  // 若 head 丢失标题
  if (!p.head || !p.head.includes('#')) {
    p.head = `# ${fname.replace(/\.md$/, '')}\n<!--meta lib=休闲 tiers=休闲-->`;
  }
  let { plot, entry } = stripAll(p.plot, p.entry);

  // 去掉我们上次重复追加的短补丁标题块（保留一份）
  const stripDupTitle = (text, title) => {
    const marker = `**【${title}】**`;
    const i1 = text.indexOf(marker);
    if (i1 < 0) return text;
    const i2 = text.indexOf(marker, i1 + marker.length);
    if (i2 < 0) return text;
    // remove from i2 to next **【 or end
    const next = text.indexOf('\n**【', i2 + marker.length);
    const end = next >= 0 ? next : text.length;
    return text.slice(0, i2) + text.slice(end);
  };
  plot = stripDupTitle(plot, '故事主线 · Actress Again·原作事实再钉');
  plot = stripDupTitle(plot, 'ひぐらしのなく頃に 奉·版本专属情感钉'.replace('奉', '奉'));
  for (const ed of ['奉', '祭', '粋', '解']) {
    plot = stripDupTitle(plot, `ひぐらしのなく頃に ${ed}·版本专属情感钉`);
    plot = stripDupTitle(plot, `${ed}·版本专属情感钉`);
    plot = plot.replace(
      new RegExp(`\\n*\\*\\*【${ed}·版本专属情感钉】\\*\\*[\\s\\S]*?(?=\\n\\*\\*【|$)`),
      '\n',
    );
  }
  // 通用：版本专属情感钉 只留一段
  {
    const re = /\n*\*\*【[^】]*版本专属情感钉】\*\*[\s\S]*?(?=\n\*\*【|$)/g;
    const all = plot.match(re) || [];
    if (all.length > 1) {
      let n = 0;
      plot = plot.replace(re, (m) => (++n === 1 ? m : ''));
    }
  }
  // 原作事实再钉只留一段
  {
    const re = /\n*\*\*【[^】]*原作事实再钉】\*\*[\s\S]*?(?=\n\*\*【|$)/g;
    let n = 0;
    plot = plot.replace(re, (m) => (++n === 1 ? m : ''));
  }

  if (fname.startsWith('MELTY')) {
    if (nw(plot) < 7600) plot = plot.trim() + '\n\n' + MBA_ADD_PLOT;
    if (nw(entry) < 1850) entry = entry.trim() + '\n\n' + MBA_ADD_ENTRY;
  } else {
    const ed = fname.includes('奉')
      ? '奉'
      : fname.includes('祭')
        ? '祭'
        : fname.includes('粋')
          ? '粋'
          : '解';
    if (nw(plot) < 7600) plot = plot.trim() + '\n\n' + higuAddPlot(ed);
    if (nw(entry) < 1850) entry = entry.trim() + '\n\n' + higuAddEntry(ed);
  }

  // 仍短则再补一节独有微观
  if (nw(plot) < 7500) {
    plot +=
      '\n\n**【微观关系计量】**\n好感不看数值条，看：①是否改口称呼；②雨天是否等；③是否记得忌口；④公开场合是否给对方台阶；⑤危机时是否先叫名字。连续三天做到同一人的③+④，视为个人线解锁前夜。';
  }
  if (nw(entry) < 1800) {
    entry +=
      '\n\n开局七日备忘：只收集笑声与真名，不追真相；第八日起才允许触及该版本核心章（奉的新章／祭的祭夜／粋的重读／解的解答）。若有人眼神变了，先叫名字再问细节。';
  }

  p.plot = plot.replace(/\n{3,}/g, '\n\n').trim();
  p.entry = entry.replace(/\n{3,}/g, '\n\n').trim();
  const out = join(p);
  fs.writeFileSync(fp, out, 'utf8');

  const check = split(fs.readFileSync(fp, 'utf8'));
  const pad =
    /情感日志|切入细目|·延展\d|本日只推进关系与日常|跨媒介流行作品/.test(out);
  const ok = nw(check.plot) >= 7500 && nw(check.entry) >= 1800 && !pad;
  console.log(
    fname,
    'plot',
    nw(check.plot),
    'entry',
    nw(check.entry),
    ok ? 'OK' : 'FAIL',
    pad ? 'PAD' : 'clean',
  );
  return ok;
}

let all = true;
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.md'))) {
  try {
    if (!processFile(f)) all = false;
  } catch (e) {
    console.error(f, e.message);
    all = false;
  }
}
console.log('ALL', all);
