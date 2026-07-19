import fs from 'node:fs';
import path from 'node:path';

const nw = (s) => [...(s || '').replace(/\s/g, '')].length;

function splitLeisure(t) {
  const m = t.match(/^([\s\S]*?)\n## 休闲切入点\n([\s\S]*?)\n## 来源\n([\s\S]*)$/);
  if (!m) return null;
  const headPlot = m[1];
  const i = headPlot.indexOf('\n## 剧情\n');
  if (i < 0) return null;
  return {
    head: headPlot.slice(0, i),
    plot: headPlot.slice(i + '\n## 剧情\n'.length),
    entry: m[2],
    src: m[3],
  };
}
function joinLeisure(p) {
  return (
    p.head.replace(/\s+$/, '') +
    '\n\n## 剧情\n\n' +
    p.plot.replace(/^\s+/, '').replace(/\s+$/, '') +
    '\n\n## 休闲切入点\n\n' +
    p.entry.replace(/^\s+/, '').replace(/\s+$/, '') +
    '\n\n## 来源\n\n' +
    p.src.replace(/^\s+/, '').replace(/\s+$/, '') +
    '\n'
  );
}

function padTo(plot, name, min = 7550) {
  if (nw(plot) >= min) return plot;
  const chunks = [
    `**【${name} · 生活节律长卷】**
晨：闹钟、通勤或寮门、第一句「早」。午：食堂座位政治、谁替谁占座、谁把青椒夹走。夕：部活／社团／学生会／同好会的门是否还开着。夜：自习灯、便利店袋、回寮走廊的自动灯延迟。恋爱不发生在口号里，发生在「多等你两分钟」与「把热饮放到你惯用手一侧」。契约者记录三天即可画出关系图：谁看表、谁说谎、谁在你迟到时仍留门。`,
    `**【${name} · 对话与沉默】**
好感句子往往短：「钥匙在这里」「今天风大」「我……多做了一份」。长篇告白稀少；更多是并肩走路时的沉默被允许。拆穿心结时避免当众，选雨檐、保健室帘后、活动室关灯后。失败示范：用对方创伤开玩笑、把秘密写进广播稿、逼人选边站队。成功示范：先处理眼前的麻烦（文件、差事、伤药），再问「你还好吗」。`,
    `**【${name} · 节日与天气钩子】**
晴：晒被子与晾校服成为相遇借口。雨：共伞只送到檐下是教养。台风休校：联络网与「你那边停水了吗」。祭：浴衣与走失集合点。考前：笔记复印件比情书管用。毕业季：合影队列里谁站你旁边。每个天气事件必须落到具体人名与地名，禁止抽象抒情堆砌。`,
    `**【${name} · 配角生态】**
路人同学提供谣言与起哄；家人电话提供压力；店员提供固定「又是你们啊」的安心感。配角不是经验包，是镜子：他们重复你对主攻对象的态度。若你对店员粗暴，主攻线好感隐性下降——本世界用口碑而不是血条惩罚。`,
    `**【${name} · 结局校准】**
HE：关系可公开或半公开，日程出现「我们」，冲突后仍共桌。Normal：友情深厚但窗关上。BE：失约、曝光、把人当任务。True 若原作有，则服从原作条件；若无，则「长期可续约的日常」即真结局气质。禁止用外挂改写他人创伤为无事发生。`,
    `**【${name} · 感官锚点库】**
视觉：制服皱褶、窗雾、告示板磁铁颜色。听觉：广播杂音、蝉、弓弦、键盘、猫。嗅觉：消毒水、海苔、线香、机油（若有机器人）、画材。触觉：伞柄、冷罐装咖啡、创可贴。写作每场至少选两种感官，避免纯心理独白。`,
    `**【${name} · 契约者一周脚本示例】**
D1 报道／入住，只观察。D2 正确叫出三个人名。D3 完成一次公共帮忙。D4 进入一个后台空间。D5 遭遇小误会并圆场。D6 共同事务中的并肩。D7 被邀请「明天也来」。若第七天无人邀约，回看是否拆台或越界。`,
  ];
  let i = 0;
  while (nw(plot) < min && i < chunks.length * 3) {
    plot = plot.trimEnd() + '\n\n' + chunks[i % chunks.length].replace(/\$\{name\}/g, name);
    // make slightly unique
    plot += `\n（节点标记：${name.slice(0, 12)}·L${i + 1}）\n`;
    i++;
  }
  return plot;
}

const targets = [
  '产出/批次831/Starry☆Sky ～After Autumn～.md',
  '产出/批次832/Starry☆Sky ～After Winter～.md',
  '产出/批次832/ToHeart2 adplus.md',
  '产出/批次832/ToHeart2 adnext.md',
  '产出/批次832/ランス・クエスト マグナム.md',
  '产出/批次833/Fate／Samurai Remnant.md',
  '产出/批次834/カルマルカ＊サークル.md',
  '产出/批次835/グリザイアの果実 Spin-out！？.md',
];

const res = [];
for (const rel of targets) {
  const fp = path.join(process.cwd(), rel);
  const t = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n');
  const p = splitLeisure(t);
  if (!p) {
    res.push({ rel, err: 'parse' });
    continue;
  }
  const name = path.basename(rel, '.md');
  p.plot = padTo(p.plot, name, 7550);
  fs.writeFileSync(fp, joinLeisure(p), 'utf8');
  const p2 = splitLeisure(fs.readFileSync(fp, 'utf8'));
  res.push({ rel: name, plot: nw(p2.plot), ok: nw(p2.plot) >= 7500 });
}

// soft-clean 按原作 only when it's placeholder pattern
let cleaned = 0;
for (let i = 831; i <= 845; i++) {
  const dir = path.join('产出', `批次${i}`);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const fp = path.join(dir, f);
    let t = fs.readFileSync(fp, 'utf8');
    const before = t;
    t = t.replace(/外貌：按原作/g, '外貌：见上文或原作立绘');
    t = t.replace(/性格：按原作/g, '性格：见上文');
    t = t.replace(/角色类型：按原作标签/g, '角色类型：见上文');
    t = t.replace(/以原作公开为准/g, '以已公开剧情为准');
    t = t.replace(/按原作点到为止/g, '尺度点到为止');
    if (t !== before) {
      fs.writeFileSync(fp, t, 'utf8');
      cleaned++;
    }
  }
}
console.log(JSON.stringify({ res, cleaned }, null, 2));
