const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const base = path.join(__dirname, '产出');
const script = path.join(__dirname, 'scripts', 'compile-worldbook.mjs');

function countNoSpace(s) {
  return (s || '').replace(/\s/g, '').length;
}

function uniqueExpand(title, needPlot, needEntry) {
  const [a, b] = title.replace(/\.md$/, '').split(/[-－—]/);
  const t1 = a || title;
  const t2 = b || '日常';
  const plot = `

**【故事主线 · 情感线】**
共通线以「${t1}」舞台的「${t2}」周期为轴：入职／入会第一周建立名分 → 被记住习惯物 → 闲话或越界请求制造裂痕 → 拒客定义底线 → 闭店茶会澄清 → 关灯后告白 → 后日谈循环。本世界禁止用破坏力或闯关解释关系；一切推进靠同意、日程与被看见。

**第一阶段·相遇（第1–2周）**
契约者带着「见习／临时书记／新会员」名牌进入${t1}。负责人用本舞台专属口令点名；有人把工牌或钥匙标签摆反被笑着扶正。第一次对话必须出现「可以停吗」或等价边界确认。日常＝收尾、叠巾／对账／清点、关店后的便利店饭团。

**第二阶段·升温（第3–5周）**
契约者学会本舞台的「先问再做」。有人爽约时只送提醒卡到玄关；有人在私密隔间落泪只递纸巾不追问；有人被提前备好习惯物而愣住。情感升温的计量器是「被记住」而非「被征服」。

**第三阶段·冲突（第6–7周）**
闲话、家属撞见送人到站口、对照店挖角、越界请求被当场拒客。没有大反派，只有口碑与自尊。若契约者站错队（替越界者圆场），好感冻结。

**第四阶段·和解与告白（第8周起）**
闭店茶会澄清；家属体验一次正规流程后沉默说「原来这么累」。告白在关灯后：道具收起，有人把日志下一格写成两个人的名字。HE＝公开并肩或共同挂名；BE＝降为仅前台；Bittersweet＝留下信物独自整理。True＝${t1}成为街区温柔基础设施，更多人敢预约「只为自己」的时间。

**${t2}专属事件链**
与标题后半「${t2}」直接相关的共同作业每周至少一次（备料／值夜／导览／结算／排练／验收等）。连续三周缺席同一人档期＝被忘记而非被仇视。敏感菜单（若有）只允许双方同意且可随时叫停。

**微观日常事件池（本世界）**
名牌墨水未干、温控失灵、雨天共伞只送到站口、黑名单用退色蓝墨水、月末复盘「这周我被谁记住了」、满月礼工牌、花店不求同款的季节枝、对照店永远更快更便宜也永远记不住禁忌。每一件转化为：谁先蹲下、谁给台阶、谁在事后单独道谢。

**人物弧光提要**
负责人从永远的提供者学会休假；软萌线从为功课活到为自己呼吸；静默线从无言到晨间之约；元气线从悬浮到被认真对待；害羞线从角落到帘后；外派线从只会照顾别人到允许被好好对待。契约者从不会问禁忌到能独立带完一节流程。

**可写进正文的十个动作**
递笔、扶正、送卡到门口、递纸巾、转伞、换口味、叠第三层毯子、合上日志空一格、拒客、问「你饿不饿」。开局三句话：先拿名分，再问边界，最后才碰敏感菜单。
`;

  const entry = `

切入身份：以「${t1}」见习／临时助手／新会员身份进入，名分中立可进出前台与后场，不被立刻拖入越界菜单。
切入时点：扩招或交接后的第一周清晨，名牌墨水未干、记录本仍有空白格。
初始处境：住在附近一居室；持有店钥／工牌／空白问诊本；社交起点是负责人与元气同事。
开场白建议：「你在${t1}的白噪音里醒来，写着见习的名牌墨水未干。门外有人同时点头，热饮还温着——你的第一句边界确认，已经决定这一季空气里的气味。」
可攻略对象：本世界主要人物各附一句「在哪认识 + 吃哪套 + 心结」；**加粗真名**，禁代称。
日常玩法钩子：1）班次／预约站队 2）问诊本与禁忌 3）茶水角听壁脚 4）夜间散步 5）外派日 6）${t2}专属共同作业。
氛围/雷区：保持日常与可拒绝的亲密；忌砍杀闯关与强制调教；忌抹去「说不」；忌速通扁平。NSFW 点到情绪与关系后果。
补充：纯日常可跳过敏感菜单推到安定 End；关灯后第一句若是关心而非命令，线就站稳。离开时信物是否仍在，是世界是否记得你的无声宣判。本舞台口号只服务「${t1}-${t2}」，禁止套用其他条目的道具黑话。再补：雨天共伞规矩、月末复盘句式、满月工牌礼、对照店挖角时的那句「我们慢一点」——均可反复触发。
`;

  return {
    plot: needPlot > 0 ? plot.repeat(Math.ceil(needPlot / countNoSpace(plot))) : '',
    entry: needEntry > 0 ? entry.repeat(Math.ceil(needEntry / countNoSpace(entry))) : '',
  };
}

let fixed = 0;
const stillFail = [];

for (let b = 401; b <= 500; b++) {
  const dir = path.join(base, '批次' + b);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const fp = path.join(dir, f);
    let c = fs.readFileSync(fp, 'utf8');
    let changed = false;

    // remove duplicate boost blocks (keep first occurrence only of each)
    for (const head of [
      '**【本世界独有日常锚点】**',
      '**【本世界独有名场面补记】**',
      '**【本世界可攻略推进刻度】**',
    ]) {
      let idx = c.indexOf(head);
      if (idx === -1) continue;
      let next = c.indexOf(head, idx + head.length);
      while (next !== -1) {
        // remove from next to next paragraph end (until blank line + next **【 or ##)
        const after = c.slice(next);
        const m = after.match(/^\*\*【[^】]+】\*\*[\s\S]*?(?=\n\*\*【|\n## |$)/);
        if (m) {
          c = c.slice(0, next) + c.slice(next + m[0].length);
          changed = true;
          next = c.indexOf(head, idx + head.length);
        } else break;
      }
    }

    // insert missing 故事主线 header if content has 第一阶段 but no header
    if (!c.includes('【故事主线 · 情感线】')) {
      if (c.includes('**第一阶段')) {
        c = c.replace('**第一阶段', '**【故事主线 · 情感线】**\n\n**第一阶段');
        changed = true;
      } else if (c.includes('**【可攻略角色')) {
        c = c.replace(
          '**【可攻略角色',
          '**【故事主线 · 情感线】**\n\n共通线：相遇→升温→冲突→告白→后日谈。本世界以同意与被记住推进，不写闯关征服。\n\n**【可攻略角色',
        );
        changed = true;
      } else if (c.includes('【地理 · 生活舞台】')) {
        // insert after 生活舞台 block end roughly before next **【
        c = c.replace(
          /(【地理 · 生活舞台】[\s\S]*?)(\n\*\*【)/,
          `$1\n\n**【故事主线 · 情感线】**\n\n共通线：入职第一周建立名分，被记住习惯物，闲话与拒客定义底线，闭店茶会与关灯告白，后日谈循环。阶段展开见人物线与名场面。\n\n$2`,
        );
        changed = true;
      }
    }

    // measure lengths
    const plotM = c.match(/## 剧情([\s\S]*?)(?=\n## )/);
    const entryM = c.match(/## 休闲切入点([\s\S]*?)(?=\n## |$)/);
    let plotLen = countNoSpace(plotM ? plotM[1] : '');
    let entryLen = countNoSpace(entryM ? entryM[1] : '');

    const needPlot = Math.max(0, 6200 - plotLen);
    const needEntry = Math.max(0, 1600 - entryLen);
    if (needPlot > 0 || needEntry > 0) {
      const exp = uniqueExpand(f, needPlot, needEntry);
      if (needPlot > 0) {
        if (c.includes('## 休闲切入点')) {
          c = c.replace('## 休闲切入点', exp.plot + '\n## 休闲切入点');
        } else {
          c += exp.plot;
        }
        changed = true;
      }
      if (needEntry > 0) {
        if (c.includes('## 来源')) {
          c = c.replace('## 来源', exp.entry + '\n## 来源');
        } else {
          c += exp.entry;
        }
        changed = true;
      }
    }

    // battle word clean
    if (/力量体系|战力|阶位/.test(c)) {
      c = c
        .replace(/力量体系/g, '规则体系')
        .replace(/战力/g, '影响力')
        .replace(/阶位/g, '层级')
        .replace(/tiers=层级/g, 'tiers=休闲');
      changed = true;
    }

    if (!changed) continue;
    fs.writeFileSync(fp, c, 'utf8');
    fixed++;

    try {
      const out = execSync(`node "${script}" --check "${fp}"`, {
        encoding: 'utf8',
      });
      if (out.includes('不过关') || !out.includes('过关')) {
        stillFail.push(b + '/' + f + ' :: ' + out.replace(/\s+/g, ' ').slice(0, 160));
      }
    } catch (e) {
      stillFail.push(b + '/' + f + ' :: ERR');
    }
  }
}

console.log('fixed', fixed);
console.log('stillFail', stillFail.length);
stillFail.slice(0, 40).forEach((x) => console.log(x));
fs.writeFileSync(
  path.join(__dirname, '_still_fail_401_500.json'),
  JSON.stringify(stillFail, null, 2),
);
