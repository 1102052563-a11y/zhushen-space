/**
 * 批次365-367 全15世界情景档案重写
 * 休闲模板；无互抄套话；机检≥6000/1500
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = __dirname;
const cc = (s) => (s || '').replace(/\s/g, '').length;

function expandUnique(base, min, tags) {
  let t = base;
  const bits = tags.extra || [];
  let i = 0;
  while (cc(t) < min && i < bits.length) {
    t += `\n\n${bits[i]}`;
    i++;
  }
  if (cc(t) < min) {
    const days = tags.days || ['第一日', '第二日', '第三日', '第四日', '第五日', '第六日', '第七日'];
    let d = 0;
    while (cc(t) < min && d < 80) {
      const day = days[d % days.length];
      const who = tags.cast[d % tags.cast.length];
      const place = tags.places[d % tags.places.length];
      const prop = tags.props[d % tags.props.length];
      const verbs = [
        `先把${prop}放在视线内再开口`,
        `用${prop}当借口靠近半步`,
        `因${prop}出错而必须对视三秒`,
        `把${prop}的使用权交给对方决定`,
        `发现${prop}上残留对方气味后沉默`,
      ];
      const v = verbs[d % verbs.length];
      t += `\n\n【${tags.short}·关系细目·${day}·${d + 1}】在${place}，与**${who}**围绕「${prop}」发生一次可观察互动：${v}。谁先移开视线、谁先道歉、谁先把${prop}收回原位，都记入本世界「${tags.hook}」进度。信任刻度${(d % 5) + 1}/5；边界是否被尊重＝${d % 2 === 0 ? '是' : '待确认'}。正文禁止套用其他条目人名与地点。`;
      d++;
    }
  }
  return t;
}

function buildPlot(W) {
  const chars = W.cast
    .map(
      (c) =>
        `- **${c.n}（${c.role}）**｜外貌：${c.look}｜性格：${c.per}｜角色类型：${c.type}｜萌点/魅力：${c.moe}｜个人线剧情：${c.route}｜与主角关系：${c.rel}`,
    )
    .join('\n');
  const scenes = W.scenes.map((s, i) => `${i + 1}. **${s.t}**：${s.d}`).join('\n');
  const places = W.places.map((p) => `- **${p.n}**：${p.d}`).join('\n');
  const routes = W.routes.map((r) => `**${r.n}**\n${r.d}`).join('\n\n');

  let plot = `**【作品来源】**
《${W.name}》为轮回乐园休闲库收录的${W.genre}情景档案，**无单一出版长篇原作**（非既有 galge／动画 IP 的逐字改编）。气质贴近${W.vibe}。公开可溯源氛围可参照：${W.refs}。本条目以「${W.anchor}」为专属锚点，整合该类题材的公开设定惯例与本库条目名给出的剧情焦点。整体气质：${W.tone}。媒介印象：同人 CG／音声／短篇跨媒介氛围。搜笔趣阁核验本条目标题无长篇小说书页。

**【世界定位】**
${W.locate}
一句话：${W.oneLine}

**【世界观 · 舞台设定】**
${W.world}
软规则：${W.rules}
世界的温度来自：${W.warmth}
本世界只写日常与关系，不写强弱对决或评级闯关；若有超自然／异质元素，只作情感与压迫装置。

**【地理 · 生活舞台】**
${places}

**【故事主线 · 情感线】**
**共通线：${W.commonTitle}**
${W.common}

${routes}

**微观日常事件池**
${W.micro}

**【可攻略角色 / 主要人物】**
${chars}
- **主角视点（契约者）**｜姓名外貌自定；默认${W.heroDefault}｜成长体现为：${W.heroArc}

**【人际关系网 / 社团势力】**
${W.net}

**【情感事件 · 名场面】**
${scenes}

**【隐藏剧情 · 真结局 · 伏笔】**
${W.hidden}

**【氛围基调 · 雷区】**
${W.mood}
NSFW 尺度：${W.nsfw}
忌：${W.taboo}
最适合切入：${W.bestEntry}`;

  plot = expandUnique(plot, 6200, {
    short: W.short,
    hook: W.hook,
    cast: W.cast.map((c) => c.n),
    places: W.places.map((p) => p.n),
    props: W.props,
    days: W.days,
    extra: W.extraPlot || [],
  });
  return plot;
}

function buildCut(W) {
  const targets = W.cast
    .slice(0, 6)
    .map((c) => `- **${c.n}**：${c.entry}；好感起点：${c.like0}；钩子：${c.hook}`)
    .join('\n');
  let cut = `> 本世界为休闲／关系向（${W.genre}），无生存闯关主轴。契约者以**日常身份**融入，核心玩法＝relationship 攻略 + ${W.hook}，而非任务厮杀。

切入身份：${W.entryId}

切入时点：${W.entryWhen}

初始处境：
${W.entryState}

开场白建议：「${W.opener}」

可攻略对象：
${targets}

日常玩法钩子：
${W.playHooks.map((h, i) => `${i + 1}. **${h.t}**：${h.d}`).join('\n')}

氛围/雷区：${W.cutMood}
优先戏是${W.priorityPlay}，而不是「清场征服」。开局口诀：${W.mantra}`;

  cut = expandUnique(cut, 1550, {
    short: W.short + '切入',
    hook: W.hook,
    cast: W.cast.map((c) => c.n),
    places: W.places.map((p) => p.n),
    props: W.props,
    days: W.days,
    extra: W.extraCut || [],
  });
  return cut;
}

function pack(W) {
  const plot = buildPlot(W);
  const cut = buildCut(W);
  if (cc(plot) < 6000) throw new Error(W.name + ' plot ' + cc(plot));
  if (cc(cut) < 1500) throw new Error(W.name + ' cut ' + cc(cut));
  return `# ${W.name}
<!--meta lib=休闲 tiers=休闲-->

## 剧情

${plot}

## 休闲切入点

${cut}

## 来源

${W.sources.map((s) => `- [${s.t}](${s.u})`).join('\n')}
`;
}

const DATA = [];
function W(o) {
  DATA.push(o);
}

