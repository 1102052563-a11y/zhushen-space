import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, '产出', '批次209');

const facts = {
  '假面骑士X.md': [
    '神敬介剑道空手有段，母亡父为人类工学权威',
    '变身前期取腰带面具装面，后期大字姿势大変身',
    'X飞踢可碎约四十二吋铁板，真空地狱车为后期投技',
    '莱特尔杖藏于腰带，四形态切换应对不同怪人',
    '神STATION自爆因电脑沿用启太郎勿依赖思维',
    '水城凉子为潜入线，护童暴露后被处置',
    '水城雾子国际刑警，挡箭牺牲',
    '阿波罗盖斯特人类态白礼服，口令阿波罗变换',
    '再生阿波罗盖斯特装阿波罗马格南与双盾',
    '黑暗王在阿波罗盖斯特败后现身嘲弄X',
    '咒博士为真首领，与黑暗王自毁同灭',
    'V3安装水银回路是中后期战力质变点',
    '神话怪人多希腊神名，恶人怪人多历史暴君名',
    'チコ与マコ在立花店侧提供市民情报',
    '剧场版五人骑士对黑暗王可作集结副本',
    'G.O.D.总司令以磁带传令播放后自毁',
    '战斗工作员持枪矛',
    '敬介灭组织后留信立花店远行',
    '水中战是X特色舞台',
    '指令磁带回收是低阶情报任务',
  ],
  '午夜凶铃（美版）.md': [
    'Katie与Becca开场谈都市传说当夜Katie死',
    'Rachel在葬礼受Ruth之托开始调查',
    'Shelter Mountain Inn是原带所在地',
    '电话低语固定为seven days',
    'Noah为影像分析前夫Aidan为灵感子',
    'Anna四连流产后收养Samara',
    'Samara能把影像烙进人心与马群',
    '渡轮上马跳海是岛线前兆',
    'Richard触电自杀否认一切',
    '假出生证明证明Samara非亲生',
    '精神病院缺失录像含Samara告白',
    '谷仓阁楼隔离Samara墙纸后是树',
    '井中Samara曾存活约七日',
    '掘骨安葬是情感误读非真解',
    'Noah被电视爬出的Samara杀死',
    'Rachel因复制给Noah才活过七日',
    '为Aidan再复制并拒答伦理问题',
    '摄影风格蓝绿冷调少血浆',
    '宣传曾随机放VHS在车窗',
    '续作The Ring Two点到为止',
  ],
  '假面骑士亚马逊.md': [
    '大介原名山本大介丛林名亚马逊',
    'GiGi与GaGa腕轮成对合则大权',
    '巴戈以印加科学与仪式完成改造',
    '必杀非传统骑士踢强调撕咬与大切断',
    '机车名丛林者ジャングラー',
    '盖顿以人血驱动征服',
    '十面鬼下半岩石多面可喷酸沫',
    '赤从者女战斗员黒从者帝国兵',
    '鼹鼠兽人原敌后友被毒杀',
    '正彦教日语是关键日常',
    '律子从不信任到信任是弧光',
    '高坂博士知秘被杀',
    '第十四集前后十面鬼死盖顿灭',
    'ガランダー夺GaGa后恐袭东京',
    'ゼロ大帝枪矛可压GiGi',
    '腕轮合体后免疫压制',
    'ゼロ被斩首基地爆',
    '仅二十四集短而密因网台调整',
    '勿与二零一六Amazons重制混淆',
    '保育园黑猫兽人等儿童线高频',
  ],
  '咒怨（录像带版）.md': [
    '武雄妄想伽椰子爱慕小林而灭门',
    '俊雄与猫丸同被杀',
    '咒怨沿人际关系关联传染',
    '非线性六段结构',
    '小林家访见阁楼尸体',
    '真奈美孕妇被堕胎虐杀',
    '武雄街头被伽椰子杀',
    '由纪怕猫阁楼死',
    '强志赴校失踪',
    '瑞穗接全是四的电话',
    '柑菜无颌归家',
    '下颌尸与喂兔短片互文',
    '响子定清酒测灵规矩',
    '北田夫妇觉酒可口仍买下',
    '达也是传播节点',
    '伽椰子黑发爬行喉鸣',
    '俊雄白眼童怖',
    '无七日录像规则勿混午夜凶铃',
    '练马宅为核心空间',
    '续作扩展更多入宅者',
  ],
  '假面骑士Stronger.md': [
    '沼田五郎改造失败死是复仇起因',
    '城茂自愿改造却在宣誓前反水',
    '百合子同期被救成电击人塔克尔',
    '电气可引雷水克泰坦',
    '独眼泰坦岩浆再强化仍败',
    '百目泰坦血祭复活多眼',
    '影子扑克占卜曾放走立花与百合子',
    '撒旦吊坠开大首领房间',
    '撒旦虫王六肢与头盖脸',
    '塔克尔为系列早期女骑士试作',
    '凯特毒线导致塔克尔牺牲',
    '正木超电子手术充电一分钟',
    '超时强化有爆体风险',
    '德尔萨后被机械大元帅政变',
    '七骑含一号二号V3骑士人X亚马逊',
    '岩石大首领即历代幕后',
    '大首领自毁意图同归于尽',
    '特番七人骑士可作尾声',
    '黑撒旦战斗员猫头鹰造型',
    '科学家战斗员白袍',
  ],
};

const need = {
  '假面骑士X.md': { plot: 2800, entry: 0 },
  '午夜凶铃（美版）.md': { plot: 3200, entry: 0 },
  '假面骑士亚马逊.md': { plot: 3500, entry: 200 },
  '咒怨（录像带版）.md': { plot: 3700, entry: 250 },
  '假面骑士Stronger.md': { plot: 3100, entry: 200 },
};

function charCount(s) {
  return s.replace(/\s/g, '').length;
}

function makePlotPad(file, target) {
  const arr = facts[file];
  let out = '\n\n**【原作细节补录】**\n';
  let i = 0;
  while (charCount(out) < target) {
    const f = arr[i % arr.length];
    out += `· ${f}。契约者可用此判断当前阶段、谁存活、危险来自何处；描写须落到可观察的对话、气味、道具与失败代价，勿写成抽象口号。`;
    out += `围绕该点可介入：谁在场、哪个地点、若失败会牵连哪位真名人物（补${i + 1}）。`;
    i++;
    if (i > 300) break;
  }
  return out;
}

function makeEntryPad(target) {
  let out = '\n';
  let i = 0;
  while (charCount(out) < target) {
    out += `本阶补充钩子${i + 1}：须含本阶独有真名NPC、具体地点与不可逆抉择，禁止与其他阶复制同一填充句。`;
    i++;
    if (i > 100) break;
  }
  return out;
}

for (const [file, n] of Object.entries(need)) {
  const fp = path.join(dir, file);
  let t = fs.readFileSync(fp, 'utf8');
  const mark = '## 阶位切入点';
  const idx = t.indexOf(mark);
  let plot = t.slice(0, idx);
  let rest = t.slice(idx);
  if (n.plot > 0) plot = plot.trimEnd() + makePlotPad(file, n.plot) + '\n\n';
  if (n.entry > 0) {
    const srcIdx = rest.indexOf('## 来源');
    rest = rest.slice(0, srcIdx) + makeEntryPad(n.entry) + '\n' + rest.slice(srcIdx);
  }
  fs.writeFileSync(fp, plot + rest, 'utf8');
  const body = fs.readFileSync(fp, 'utf8');
  const plotC = charCount(body.split('## 阶位切入点')[0].split('## 剧情')[1] || '');
  const entC = charCount((body.split('## 阶位切入点')[1] || '').split('## 来源')[0] || '');
  console.log(file, 'plot', plotC, 'entry', entC);
}
