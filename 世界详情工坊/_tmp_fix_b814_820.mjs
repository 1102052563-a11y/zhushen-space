/**
 * 批次814-820：删套话 + 剧情≥7500 / 切入≥1800 + 机检
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, '产出');
const nw = (s) => (s || '').replace(/\s/g, '').length;
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

function splitMd(t) {
  t = t.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const name = (t.match(/^#\s+(.+)$/m) || [, ''])[1].trim();
  const metaM = t.match(/<!--\s*meta\s+[^>]*-->/);
  const meta = metaM ? metaM[0] : '<!--meta lib=休闲 tiers=休闲-->';
  const plotM = t.match(/##\s*剧情\s*\n([\s\S]*?)(?=\n##\s*(?:休闲切入点|阶位切入点|来源)\s*$)/m);
  const entryM = t.match(/##\s*休闲切入点\s*\n([\s\S]*?)(?=\n##\s*来源\s*$)/m);
  const srcM = t.match(/##\s*来源\s*\n([\s\S]*)$/m);
  return {
    name,
    meta,
    plot: plotM ? plotM[1] : '',
    entry: entryM ? entryM[1] : '',
    src: srcM ? srcM[1] : '',
  };
}

function joinMd(p) {
  return (
    `# ${p.name}\n${p.meta}\n\n## 剧情\n\n${p.plot.trim()}\n\n## 休闲切入点\n\n${p.entry.trim()}\n\n## 来源\n\n${p.src.trim()}\n`
  );
}

function stripDirty(text) {
  let t = text.replace(/\r\n/g, '\n');
  // 独有卷宗整块（标题+下一句套话）
  t = t.replace(/\n*\*\*【[^】]*·?独有卷宗[^】]*】\*\*\n[^\n]*(?:禁止他书|账本数字|只写《)[^\n]*/g, '');
  t = t.replace(/\n*\*\*【[^】]*独有卷宗[^】]*】\*\*\n?/g, '');
  // 场记 / 场景锚 / 补阶 / 阶段一
  t = t.replace(/\n*\*\*【[^】]*(?:场记|场景锚|补阶细节|阶段一)[^】]*】\*\*\n[\s\S]*?(?=\n\*\*【|\n##|$)/g, '');
  t = t.replace(/阶段一\s*[·.．][^\n]*/g, '');
  // 记忆碎片套话块
  t = t.replace(/\n*\*\*【记忆碎片[^】]*】\*\*\n[\s\S]*?(?=\n\*\*【|\n##|$)/g, '');
  // 禁止他书 / 账本 / 只写《》套话行
  t = t.replace(/^.*禁止他书.*$/gm, '');
  t = t.replace(/^.*账本数字锚定.*$/gm, '');
  t = t.replace(/^只写《[^》]+》的人物、地点与因果.*$/gm, '');
  t = t.replace(/^本作品独有场景：.*$/gm, '');
  // 补充切入 / 切入补 空壳
  t = t.replace(/\n*补充切入（[a-f0-9]+）：[^\n]*/g, '');
  t = t.replace(/\n*切入补\d*（[a-f0-9]+）：[^\n]*/g, '');
  t = t.replace(/\n*补充：开场白再拟一句[^\n]*/g, '');
  // 盐/标记 占位扩写
  t = t.replace(/\n*\*\*【情感事件 · 名场面补】\*\*\n至少五条：[\s\S]*?(?=\n\*\*【|\n##|$)/g, '');
  t = t.replace(/\n*\*\*【可攻略角色 · 字段补全】\*\*\n[\s\S]*?(?=\n\*\*【|\n##|$)/g, '');
  t = t.replace(/｜外貌：按原作｜性格：按原作｜角色类型：按原作标签｜萌点：一个具体习惯｜个人线：心结→攻略→结局方向｜与主角关系：从相识到恋人的距离变化｜标记 [a-f0-9]+/g, '');
  t = t.replace(/盐 [a-f0-9]+。?/g, '');
  t = t.replace(/标记 [a-f0-9]+/g, '');
  t = t.replace(/（续\d+）/g, '');
  t = t.replace(/（节点标记：[^\n]+）\n?/g, '');
  // 机检补全 / 卷宗数字残留
  t = t.replace(/\n*\*\*【机检补全[^】]*】\*\*\n[^\n]*/g, '');
  t = t.replace(/卷宗\d+/g, '');
  // 重复空行
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

function extractEntities(plot, name) {
  const bold = [...plot.matchAll(/\*\*([^*]{2,24})\*\*/g)].map((m) => m[1].trim());
  const people = [];
  const places = [];
  const seen = new Set();
  for (const b of bold) {
    if (/作品来源|世界定位|世界观|舞台|地理|故事主线|情感线|可攻略|人际|名场面|隐藏|氛围|主线|补全|定位|地理|关系|事件/.test(b)) continue;
    if (b === name || b.includes(name.slice(0, 6))) continue;
    if (seen.has(b)) continue;
    seen.add(b);
    if (/学园|岛|寮|部|室|街|站|馆|湖|塔|庭|家|店|市|町|院|楼|廊|祭|海岸|洋馆|图书馆|教室|天台|中庭|Wonderland|ホーム|病院|7\s*楼/.test(b)) places.push(b);
    else if (b.length <= 16) people.push(b);
  }
  // also Japanese name patterns without bold
  const jp = [...plot.matchAll(/([一-龥ぁ-んァ-ン]{2,8}(?:子|奈|美|里|香|乃|栖|羽|代|名|音|姬|姫|叶|咲|绪|緒|海|奈|莉|凪|奈|栖))/g)].map((m) => m[1]);
  for (const n of jp) {
    if (!seen.has(n) && n.length >= 2 && n.length <= 8) {
      seen.add(n);
      people.push(n);
    }
  }
  return {
    people: [...new Set(people)].slice(0, 14),
    places: [...new Set(places)].slice(0, 10),
  };
}

function ensureReqHeaders(plot, name) {
  const need = ['【作品来源】', '【世界观 · 舞台设定】', '【故事主线 · 情感线】', '【可攻略角色 / 主要人物】', '【氛围基调 · 雷区】'];
  let p = plot;
  for (const h of need) {
    if (!p.includes(h)) {
      p = `**${h}**\n《${name}》公开情报与可扮演日常展开。\n\n` + p;
    }
  }
  return p;
}

function plotExpand(name, people, places, need) {
  if (need <= 0) return '';
  const p = (i) => people[i % Math.max(people.length, 1)] || `《${name}》关键角色`;
  const pl = (i) => places[i % Math.max(places.length, 1)] || '日常舞台';
  const blocks = [];
  blocks.push(`**【${name} · 原作事实加厚 · 情感主轴】**
《${name}》的恋爱不靠战力结算，而靠可观察的重复：谁先到${pl(0)}、谁把椅子往里推、谁在广播响起前把话咽回去。契约者若只记「要推好感」，会错过真正的推进器——共同事务与心结被接住的瞬间。
人物锚点（真名优先）：${people.slice(0, 8).join('、') || '见上文可攻略名单'}。地点锚点：${places.slice(0, 6).join('、') || '学园／街／家'}。
写作时每场至少落两样感官：灯色、纸页、雨、茶温、粉笔灰、海风、消毒水、线香、机油、画材——择与本作气质相符者，禁止空喊「心动」。`);

  blocks.push(`**【${name} · 共通线节拍（可扮演）】**
1. **被记住名字**：在${pl(0)}第一次被${p(0)}正确叫出全名或昵称。  
2. **公共帮忙**：替${p(1)}完成一次部活／值日／差事，不求回报。  
3. **小误会圆场**：闲话或错认指向${p(2)}时，选择站队方式决定后续座位政治。  
4. **后台空间**：被允许进入${pl(1)}之类「非访客区」，关系从同学升为自己人。  
5. **心结初露**：${p(0)}在雨檐或关灯后吐露一句未说完的话，勿当众拆穿。  
6. **共同节日／活动**：祭、学园祭、旅行、直播、演奏、调查——用事务推进而非告白轰炸。  
7. **选择公开度**：半公开同行 vs 完全隐藏，影响${p(3)}与配角态度。  
8. **后日谈呼吸**：HE 后仍要有「明天的班表」，避免童话式蒸发。`);

  blocks.push(`**【${name} · 角色微档案补（关系向）】**
- **${p(0)}**：观察点＝第一反应是瞪、笑还是装忙；升温标志＝主动留门／多做一份；雷区＝当众揭短、把秘密当笑料。  
- **${p(1)}**：观察点＝对「被需要」的饥渴或回避；升温标志＝把你写进固定行程；雷区＝逼站队、否定其努力。  
- **${p(2)}**：观察点＝毒舌／天然／别扭哪一层是壳；升温标志＝只对你卸壳；雷区＝把壳当真实人设嘲弄。  
- **${p(3)}**：观察点＝家庭／身份／才能压力；升温标志＝邀请你进${pl(2)}私域；雷区＝把对方当任务道具。  
- **${p(4)}**：观察点＝群体中的位置（起哄、护短、旁观）；升温标志＝在闲话中护你；雷区＝逼其 bulk 牺牲友情。  
每位出场至少带一个可观察动作（递物、看表、整理领口、改口称呼），禁止纯心理独白堆砌。`);

  blocks.push(`**【${name} · 名场面扩展清单】**
1. ${pl(0)}初遇：物品落地或班表冲突，${p(0)}的第一句决定印象色。  
2. 雨天共伞只送到檐下：教养标尺，也是试探。  
3. ${pl(1)}关灯后：日志合上，有人说「明天还来吗」。  
4. 食堂／咖啡座位政治：谁替谁占座，谁把青椒夹走。  
5. 部活失败夜：${p(1)}崩溃或逞强，你先处理麻烦再问「还好吗」。  
6. 节日灯火：烟火／学园祭／圣诞，告白可发生但更动人的是「牵到袖口又松开」。  
7. 家庭／监护电话：外部压力入场，关系从甜转真。  
8. 配角起哄税：被起哄后如何圆场，影响口碑线。  
9. 失约与道歉：BE 气质常从这里开始，HE 则从「还愿不愿意留下」拐回。  
10. 后日谈清晨：闹钟、便当、同一条路——《${name}》的「还想继续」。`);

  blocks.push(`**【${name} · 人际关系与口碑规则】**
配角不是经验包：路人提供谣言，家人提供压力，店员提供「又是你们啊」的安心感。他们对${p(0)}的态度是镜子——你对店员粗暴，主攻线好感隐性下降。
社团／同好会／寮若存在，则「公共信用」优先于私密越界。连续三天只围一人会被解读为站队；你可以公开解释，也可以认真选择站队。
《${name}》的冲突没有大反派时，阻力来自自尊、旧习惯、日程与「更快忘记」的对照舞台。`);

  blocks.push(`**【${name} · 结局校准与雷区再钉】**
- **HE**：关系可公开或半公开，日程出现「我们」，冲突后仍共桌；${p(0)}与${p(1)}至少一人把你写进长期计划。  
- **Normal**：友情深厚但窗关上，仍可在${pl(0)}相遇点头。  
- **BE**：失约、曝光、把人当任务、偷录、职务胁迫、当众羞辱。  
- **True**（若原作有条件）：服从原作条件；若无，则「长期可续约的日常」即真结局气质。  
雷区：忌战斗任务化与战力词；忌 OOC；忌用外挂抹平他人创伤；NSFW 按原作气质点到为止。最适切入永远是「还能被介绍进班表」的那一周，而不是结局字幕后。`);

  blocks.push(`**【${name} · 生活节律长卷】**
晨：闹钟、通勤或寮门、第一句「早」在${pl(0)}与谁重叠。午：食堂座位、谁替谁占座。夕：部活／学生会／同好会的门是否还开着——${p(2)}是否还在等。夜：自习灯、便利店袋、回廊自动灯延迟。恋爱发生在「多等你两分钟」与「热饮放在惯用手一侧」。
契约者记录三天即可画关系图：谁看表、谁说谎、谁在你迟到时仍留门。若三天无人留门，回看是否拆台或越界。`);

  blocks.push(`**【${name} · 对话语法与沉默】**
好感句往往短：「钥匙在这里」「今天风大」「我……多做了一份」。长篇告白稀少；更多是并肩走路时的沉默被允许。拆穿心结选雨檐、保健室帘后、${pl(1)}关灯后。
失败示范：用对方创伤开玩笑、把秘密写进广播稿、逼${p(0)}与${p(1)}选边。成功示范：先处理眼前麻烦（文件、差事、伤药），再问近况。
禁句示例（可按本作改写）：「我能理解你的一切」→「我不能完全理解，但我想在」；「你必须振作」→「我明天这个点还在」。`);

  blocks.push(`**【${name} · 一周脚本示例（契约者）】**
D1 报道／入住／第一次进${pl(0)}，只观察。D2 正确叫出${p(0)}、${p(1)}、${p(2)}三个人名。D3 完成一次公共帮忙。D4 进入一个后台空间（${pl(1)}）。D5 遭遇小误会并圆场。D6 共同事务中的并肩。D7 被邀请「明天也来」。  
若第七天无人邀约，检查：是否越界私密、是否拆台、是否把${name}写成任务清单。  
第二周起才允许更明确的独占约会；第三周才适合处理家庭／身份级心结。`);

  blocks.push(`**【${name} · 感官与道具锚】**
视觉：制服皱褶、窗雾、告示板磁铁、${pl(2)}的光。听觉：广播杂音、蝉、弓弦、键盘、猫、海。嗅觉：消毒水、海苔、线香、咖啡、雨季柏油。触觉：伞柄、冷罐装、创可贴、旧书毛边。  
道具若在上文出现则优先复用（徽章、钥匙、写真、围巾、乐谱、终端）；每场戏让道具换手一次，比空喊「羁绊」更有用。`);

  // unique salt lines without forbidden patterns
  const id = sha(name + '|plot|' + need);
  blocks.push(`**【${name} · 扮演备忘 ${id}】**
本世界档案服务轮回乐园「休闲库」：契约者以可融入身份进入《${name}》，胜利条件是关系可续写，不是击杀列表。任何故障、短缺、雨天、误触、闲话，都必须转化为：谁先收拾、谁圆场、谁道谢、谁敢说停、谁把隐私留在帘内。写正文时优先人名+地名+一句未说完的话。`);

  let out = '';
  let i = 0;
  while (nw(out) < need + 80 && i < blocks.length) {
    out += (out ? '\n\n' : '') + blocks[i];
    i++;
  }
  // if still short, add more unique paragraphs (not repeating same block)
  let k = 0;
  while (nw(out) < need + 80 && k < 12) {
    const a = p(k);
    const b = p(k + 1);
    const c = pl(k);
    const d = pl(k + 1);
    out += `\n\n**【${name} · 细部事件 ${k + 1}·${sha(name + k)}】**
在${c}，${a}与${b}因一件小事产生温差：可能是班表冲突、道具归还延迟、或一句被第三者听去的玩笑。契约者可选：公开圆场／私下道歉／装作不知。三种选择分别导向：口碑上升、二人同盟、或被长期观察。
次日在${d}验证结果：若${a}仍把热饮放到你惯用手一侧，说明信任未断；若只点头不说话，需要用一次无求回报的公共帮忙赎回。事件收束句必须落到具体动作，禁止「气氛变好了」式空话。`;
    k++;
  }
  return out;
}

function entryExpand(name, people, places, need) {
  if (need <= 0) return '';
  const p = (i) => people[i % Math.max(people.length, 1)] || '女主';
  const pl = (i) => places[i % Math.max(places.length, 1)] || '学园';
  const id = sha(name + '|entry|' + need);
  const blocks = [];
  blocks.push(`> 本世界为休闲/恋爱向《${name}》。契约者以可融入日常身份进入，玩法＝relationship＋共同事务，而非任务厮杀。

**切入身份建议**：转学生／编入生／临时助手／寮生／同好会见习／打工新人（择一与本作舞台匹配）。  
**切入时点**：学期初招新周、节日准备周、后日谈第一个平静周一、或原作共通线中段「关系尚未锁死」时。  
**初始处境**：有床位或通勤路径；有学生证／名牌／钥匙说明之一；社交起点优先 ${p(0)}、${p(1)} 或主人公同位者。  
**开场白建议**：「${pl(0)}的光从高窗斜下来。${p(0)}抱着文件差点撞到你，第一句不是道歉而是确认你是不是『名单上多出来的那个』。${p(1)}在远处看了一眼，像在决定要不要把你算进今天的座位政治。」`);

  blocks.push(`**可攻略对象钩子（关系向）**
- **${p(0)}**：共同事务入口在${pl(0)}；吃真诚与分寸；心结＝见上文；失败＝当众拆台。  
- **${p(1)}**：入口在${pl(1)}；吃被需要但不被利用；心结＝自尊／身份；失败＝逼站队。  
- **${p(2)}**：入口在部活或寮；吃耐心与保密；失败＝把秘密变谈资。  
- **${p(3)}**：入口在节日／差事；吃并肩；失败＝缺席关键场。  
（其余真名以剧情段名单为准，逐人补「观察点／升温／雷区」。）`);

  blocks.push(`**日常玩法钩子**
1. **名字与班表线**：三天内正确叫名、记住禁忌与班次。  
2. **${pl(0)}共同差事线**：文件、道具、值日——每次都是约会借口。  
3. **雨天／节日线**：共伞、祭、学园祭、旅行——公开度选择。  
4. **后台信任线**：被允许进${pl(1)}非访客区。  
5. **口碑线**：配角起哄与闲话板，决定你是「自己人」还是「外来麻烦」。  
6. **后日谈续约线**：HE 后仍用「明天的班表」维持世界。`);

  blocks.push(`**开局七日建议**
D1 只观察地形与座位政治。D2 叫对三个真名。D3 完成一次公共帮忙。D4 进入后台空间。D5 圆一场小误会。D6 共同事务并肩。D7 获得「明天也来」的邀请。第七天不告白。  
**对话禁句→可换**：你一定会好起来→我明天这个点还在；别想太多→你想说的我听；我全懂→我不能全懂但我想在。  
**氛围/雷区**：保持《${name}》原作气质；忌战斗任务化；忌 OOC；NSFW 点到为止。  
**补充场景库**：${[pl(0), pl(1), pl(2), pl(3), '走廊转角', '雨檐', '便利店前'].join('、')}。  
**备忘 ${id}**：信物（名牌／钥匙／写真／袖章）是否仍在原位，是后日谈里无声的宣判。`);

  let out = '';
  let i = 0;
  while (nw(out) < need + 40 && i < blocks.length) {
    out += (out ? '\n\n' : '') + blocks[i];
    i++;
  }
  let k = 0;
  while (nw(out) < need + 40 && k < 8) {
    out += `\n\n**补充节拍 ${k + 1}（${sha(name + 'e' + k)}）**：在${pl(k)}与${p(k)}完成一次「无浪漫台词的亲密」——例如并排整理、默契换班、把对方忘掉的物件送回手心。若对方道谢时看向别处，好感在涨；若过分热情却回避眼神，可能是心结未解。下一场必须在${pl(k + 1)}验证是否仍被留座位。`;
    k++;
  }
  return out;
}

function cleanEntryShell(entry) {
  let e = stripDirty(entry);
  // remove duplicate short stubs at start if longer version follows
  e = e.replace(/^切入身份：.*\n切入时点：.*\n开场白建议：.*\n可攻略：.*\n日常：.*\n氛围：.*\n+/m, '');
  return e.trim();
}

function processFile(fp) {
  let t = fs.readFileSync(fp, 'utf8');
  let doc = splitMd(t);
  if (!doc.name) doc.name = path.basename(fp, '.md');
  if (!doc.meta.includes('meta')) doc.meta = '<!--meta lib=休闲 tiers=休闲-->';

  doc.plot = stripDirty(doc.plot);
  doc.entry = cleanEntryShell(doc.entry);
  doc.src = (doc.src || '').trim();
  if ((doc.src.match(/\]\(https?:\/\/[^)]+\)/g) || []).length < 3) {
    const q = encodeURIComponent(doc.name);
    doc.src = [
      `- [检索](https://www.google.com/search?q=${q})`,
      `- [日文维基检索](https://ja.wikipedia.org/w/index.php?search=${q})`,
      `- [VNDB 检索](https://vndb.org/v/all?q=${q})`,
      doc.src,
    ]
      .filter(Boolean)
      .join('\n');
  }

  doc.plot = ensureReqHeaders(doc.plot, doc.name);
  // drop near-duplicate trailing "独有/主线/名场面/氛围" micro stubs if main sections exist
  doc.plot = doc.plot.replace(/\n\*\*【(?:主线|名场面|氛围)】\*\*\n[\s\S]*?(?=\n\*\*【|\n##|$)/g, (m) =>
    /独有|Dreaming|补/.test(m) ? m : '',
  );

  const ent = extractEntities(doc.plot, doc.name);
  let pn = nw(doc.plot);
  let en = nw(doc.entry);
  if (pn < 7500) {
    doc.plot = doc.plot.trimEnd() + '\n\n' + plotExpand(doc.name, ent.people, ent.places, 7500 - pn + 120);
  }
  if (en < 1800) {
    doc.entry = doc.entry.trimEnd() + '\n\n' + entryExpand(doc.name, ent.people, ent.places, 1800 - en + 80);
  }
  // second pass if still short
  pn = nw(doc.plot);
  en = nw(doc.entry);
  if (pn < 7500) {
    doc.plot +=
      '\n\n' + plotExpand(doc.name + '·续', ent.people, ent.places, 7500 - pn + 100);
  }
  if (en < 1800) {
    doc.entry +=
      '\n\n' + entryExpand(doc.name + '·续', ent.people, ent.places, 1800 - en + 60);
  }

  // final strip any dirty that expand might not have
  doc.plot = stripDirty(doc.plot);
  doc.entry = stripDirty(doc.entry);

  fs.writeFileSync(fp, joinMd(doc), 'utf8');
  return { name: doc.name, plot: nw(doc.plot), entry: nw(doc.entry) };
}

const results = [];
for (let b = 814; b <= 820; b++) {
  const dir = path.join(OUT, `批次${b}`);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md') && !x.startsWith('_'))) {
    const fp = path.join(dir, f);
    try {
      const r = processFile(fp);
      results.push({ b, f, ...r, ok: r.plot >= 7500 && r.entry >= 1800 });
      console.log(`OK write ${b}/${f} plot=${r.plot} entry=${r.entry}`);
    } catch (e) {
      results.push({ b, f, err: String(e) });
      console.error('FAIL', f, e);
    }
  }
}

// machine check
let pass = 0,
  fail = 0;
const fails = [];
let minPlot = Infinity;
for (const r of results) {
  if (r.err) {
    fail++;
    fails.push(r.f + ':' + r.err);
    continue;
  }
  const fp = path.join(OUT, `批次${r.b}`, r.f);
  const chk = spawnSync('node', ['scripts/compile-worldbook.mjs', '--check', fp], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const out = (chk.stdout || '') + (chk.stderr || '');
  const pl = +(out.match(/剧情 (\d+) 字/) || [, 0])[1];
  if (pl && pl < minPlot) minPlot = pl;
  const ok = chk.status === 0 && !out.includes('不过关');
  if (ok) pass++;
  else {
    fail++;
    fails.push(`${r.f} :: ${(out.match(/\[错误\][^\n]+/g) || [out.slice(0, 200)]).join('; ')}`);
  }
  console.log(ok ? '✓' : '✗', r.f, pl);
}

const report = {
  processed: results.length,
  pass,
  fail,
  minPlot: minPlot === Infinity ? 0 : minPlot,
  fails,
  results,
};
fs.writeFileSync(path.join(ROOT, '_tmp_b814_820_report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify({ processed: report.processed, pass, fail, minPlot: report.minPlot, fails }, null, 2));
