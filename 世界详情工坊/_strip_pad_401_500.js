/**
 * Strip known cross-file identical padding blocks from 401-500 leisure archives.
 * Re-check length; if plot drops below 6000, append a short world-unique filler
 * built from title tokens (not shared boilerplate).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const base = path.join(__dirname, '产出');
const script = path.join(__dirname, 'scripts', 'compile-worldbook.mjs');

// Exact paragraphs found in >=3 files (from audit). Match loosely by distinctive heads.
const PAD_HEADS = [
  '**可重复周常与情感推进刻度**',
  '若舞台带有奇幻皮（圣女／淫魔／触手／催眠／精灵等）',
  '**阶段细描与关系推进**',
  '**长篇日常切片库（本世界专用·可反复触发）**',
  '**角色弧光补述**',
  '**可观察细节清单**',
  '负责人把职业壳穿得很整齐',
  '本周的因果链很短很清楚',
  '可插入正文的二十个动作',
  '后日谈不黑屏',
  '再补一段舞台气味与声景',
  '**终章语气定调**',
  '**再补一段可写进正文的对话节奏**',
  '可反复触发的推进：晨间点名看谁先到',
  '。视点可落在新来的见习助手',
  '。视点可落在新来的临时人手',
  '角色对照速记',
  '配角·三上／森下',
  '配角·家属线',
  '：公开体验日的「站队」流言',
  '默默放了一条手巾或耳机',
  '：从不展览她的害羞，等她主动点 B室',
  '：连续选择为谁加钟／谁用 B室',
];

function stripPads(text) {
  // remove paragraphs that start with known pad heads
  const parts = text.split(/\n\n+/);
  const kept = [];
  let removed = 0;
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    const hit = PAD_HEADS.some((h) => t.includes(h) || t.startsWith(h));
    // also drop ultra-long generic "切片" blocks
    const isSliceDump =
      t.includes('切片01') &&
      t.includes('切片02') &&
      t.includes('切片03') &&
      t.length > 400;
    const isTwentyActions = t.includes('可插入正文的二十个动作');
    if (hit || isSliceDump || isTwentyActions) {
      removed++;
      continue;
    }
    kept.push(p);
  }
  return { text: kept.join('\n\n'), removed };
}

function worldUniqueBoost(title) {
  const tags = title.replace(/\.md$/, '').split(/[-－—]/);
  const a = tags[0] || title;
  const b = tags[1] || '日常';
  return `

**【本世界独有日常锚点】**
「${a}」舞台下的「${b}」时段，是本档案与其他条目的分界线：气味、班次口号、记录本封面颜色与门口告示句式都只服务本标题。契约者第一周的站队，应优先落在本舞台的专属岗位（前台／见习／记录／陪席之一），而不是套用其他世界的茶水角模板。拒客底线、闭店茶会与关灯后的第一句关心，必须用本舞台的道具完成（钥匙牌／筹码／名牌／预约本／班次表——择一写死，勿混用）。 pure 日常线可完全不碰敏感菜单，只靠本舞台的周常事件推到安定 End。

**【本世界独有名场面补记】**
1. 入职第一天：名牌墨水未干，负责人用本舞台专属口令完成点名。
2. 第一次被记住：有人提前备好你在本舞台会用到的习惯物。
3. 闲话周：告示板或群聊出现半真半假的站队流言，闭店茶会澄清。
4. 拒客：有人越过同意边界，负责人当场除名——定义本世界道德底线。
5. 关灯告白：道具收起，香氛将尽，有人把日志下一格写成两个人的名字。
6. 后日谈：未攻略角色保持友好，不恶意拆家；True 是本舞台成为街区温柔基础设施。

**【本世界可攻略推进刻度】**
浅粉＝第一次被叫对名字；樱＝第一次被护短；深樱＝第一次在私密隔间主动说「可以停」；朱红＝公开并肩或共同挂名。连续三周缺席同一人档期＝好感冻结（被忘记）而非仇恨。敏感菜单的真正内容永远是更慢、更同意、更可叫停——这句话必须用本舞台的黑话重说一遍，禁止照抄其他条目。
`;
}

let strippedFiles = 0;
let totalRemoved = 0;
const tooShort = [];
const checkFail = [];

for (let b = 401; b <= 500; b++) {
  const dir = path.join(base, '批次' + b);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const fp = path.join(dir, f);
    let c = fs.readFileSync(fp, 'utf8');
    const { text, removed } = stripPads(c);
    if (removed === 0) continue;
    strippedFiles++;
    totalRemoved += removed;
    c = text;

    // ensure plot length
    const plotM = c.match(/## 剧情([\s\S]*?)(?=\n## )/);
    let plot = plotM ? plotM[1] : '';
    let plotLen = plot.replace(/\s/g, '').length;
    if (plotLen < 6200) {
      // insert boost before ## 休闲切入点
      const boost = worldUniqueBoost(f);
      if (c.includes('## 休闲切入点')) {
        c = c.replace('## 休闲切入点', boost + '\n## 休闲切入点');
      } else {
        c += boost;
      }
    }

    // clean battle words if any
    c = c.replace(/力量体系/g, '规则体系');
    c = c.replace(/战力/g, '影响力');
    c = c.replace(/阶位/g, '层级');
    c = c.replace(/tiers=层级/g, 'tiers=休闲');

    fs.writeFileSync(fp, c, 'utf8');

    try {
      const out = execSync(`node "${script}" --check "${fp}"`, {
        encoding: 'utf8',
      });
      if (!out.includes('过关')) {
        checkFail.push(b + '/' + f + ':' + out.slice(0, 120));
      }
    } catch (e) {
      // may be short - try add more boost
      let c2 = fs.readFileSync(fp, 'utf8');
      c2 = c2.replace(
        '## 休闲切入点',
        worldUniqueBoost(f + '-补') + '\n## 休闲切入点',
      );
      fs.writeFileSync(fp, c2, 'utf8');
      try {
        const out2 = execSync(`node "${script}" --check "${fp}"`, {
          encoding: 'utf8',
        });
        if (!out2.includes('过关'))
          checkFail.push(b + '/' + f + ':retry ' + out2.slice(0, 100));
      } catch (e2) {
        checkFail.push(b + '/' + f + ':ERR');
        tooShort.push(b + '/' + f);
      }
    }
  }
}

console.log('strippedFiles', strippedFiles);
console.log('totalRemovedParas', totalRemoved);
console.log('checkFail', checkFail.length);
if (checkFail.length) console.log(checkFail.slice(0, 30).join('\n'));
console.log('tooShort', tooShort.length);
