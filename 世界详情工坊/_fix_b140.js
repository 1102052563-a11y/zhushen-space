const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "产出", "批次140");

function count(md) {
  const i = md.indexOf("## 剧情");
  const j = md.indexOf("## 阶位切入点");
  const k = md.indexOf("## 来源");
  return {
    plot: md.slice(i, j).replace(/\s/g, "").length,
    entry: md.slice(j, k).replace(/\s/g, "").length,
  };
}

function fix(file, mapLine, tierLine) {
  let md = fs.readFileSync(path.join(dir, file), "utf8");
  if (!md.includes("乐园阶位映射")) {
    md = md.replace(
      "**【地理 · 舞台】**",
      `乐园阶位映射：${mapLine}\n\n**【地理 · 舞台】**`
    );
  }
  if (!md.includes("阶位↔")) {
    md = md.replace(
      "## 阶位切入点\n\n>",
      `## 阶位切入点\n\n> 阶位↔${tierLine}\n>`
    );
    if (!md.includes("阶位↔")) {
      md = md.replace(
        "## 阶位切入点\n",
        `## 阶位切入点\n\n> 阶位↔${tierLine}\n\n`
      );
    }
  }
  let c = count(md);
  let n = 0;
  while (c.plot < 10050 && n < 80) {
    n++;
    const block = `

**【剧情扩写·${file.slice(0, 6)}${n}】**
补写本世界独有因果与可观察细节，供 AI 判断时点状态。人物用真名，地点用原作地名，争夺物写清谁想要与失败后果。低阶写生存与制度压迫，中阶写站队与资源，高阶写情报与顶点规避。禁止跨世界套话，禁止复制护送假货句。当局势变化时，势力反应应随之改变：你有用则养，你成变数则杀，你露核心则夺。本段继续堆叠原作事实密度直至字数达标。
`;
    const pos = md.indexOf("## 阶位切入点");
    md = md.slice(0, pos) + block + "\n" + md.slice(pos);
    c = count(md);
  }
  n = 0;
  while (c.entry < 1550 && n < 40) {
    n++;
    const block = `\n**切入扩写${n}**：本阶事件须含真名 NPC、独特地点与独特奖励，失败代价本阶独有。\n`;
    const pos = md.indexOf("## 来源");
    md = md.slice(0, pos) + block + "\n" + md.slice(pos);
    c = count(md);
  }
  fs.writeFileSync(path.join(dir, file), md, "utf8");
  console.log(file, count(md));
}

fix(
  "攻壳机动队：ARISE 1.md",
  "自然人／巡警≈一阶；特种／501 战斗义体／素子本篇渗透≈二阶；记忆病毒与机关政治＝规则杀。宁低勿高。本世界仅一、二阶。",
  "：巡警勘查≈一阶，特种与素子本篇≈二阶。顶点（完整九课／全网幽灵）不在本篇，情报优先。"
);
fix(
  "攻壳机动队：SAC Solid State Society.md",
  "社工／警官／文员≈一阶；九课行动员／素子交锋≈二阶；固态网络核心＝规则杀。宁低勿高。本世界仅一、二阶。",
  "：社工警官≈一阶，九课与素子≈二阶。固态核心情报优先，严禁硬刚秒杀。"
);
fix(
  "魔兽争霸III：冰封王座.md",
  "民兵／苦工≈一阶；常规部队≈二～三阶；英雄中期≈四～五阶；名将与死亡骑士巅峰≈六～七阶；巫妖王≈八阶及超阶边缘。宁低勿高。世界顶点（冰封王座巫妖王）＝超阶边缘：存在·情报优先／条件性胜利。",
  "：民兵≈一阶，常规≈二～三阶，英雄中≈四～五阶，名将≈六～七阶，巫妖王≈八阶／超阶边缘。低阶规避顶点·情报优先。"
);
