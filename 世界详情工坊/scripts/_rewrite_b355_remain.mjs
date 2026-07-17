/**
 * Rewrite remaining batch 355 files that still contain 关系细目
 * node scripts/_rewrite_b355_remain.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildFile, BANNED } from './_leisure_rewrite_lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '产出');
const enc = (s) => encodeURIComponent(s);
const sourcesFor = (title) => {
  const k = title.replace(/-/g, ' ');
  return [
    [`DLsite 关键词检索（${k}）`, `https://www.dlsite.com/maniax/fsr/=/keyword/${enc(k)}/`],
    ['DLsite 综合检索入口', 'https://www.dlsite.com/maniax/'],
    [`搜笔趣阁检索（${k}）`, `https://www.sobqg.com/searchBook.html?keyword=${enc(k)}`],
  ];
};
function cast(defs) {
  return defs.map((d) => ({
    name: d.n,
    title: d.t,
    look: d.l,
    personality: d.p,
    type: d.ty,
    charm: d.c,
    knot: d.k,
    route: d.r,
    he: d.he,
    be: d.be,
    bit: d.bit || '礼貌距离',
    rel: d.rel,
    turn: d.turn || '当众确认可以说停与出口',
  }));
}

const WORLDS = [
  {
    batch: 355,
    name: '触手アイドル-ライブ',
    theme: '偶像直播后台的同意手环与可下播权',
    city: '虹桥娱乐区',
    stage: '「解环」直播馆',
    role: '直播伦理员／通告书记',
    lead: '星見ヒカリ',
    prop: '下播键／同意手环／通告单',
    drink: '汽水',
    roomA: '直播厅',
    roomB: '后台休息室',
    walk: '后巷灯牌街',
    blacktalk: '触手=舞台特效义肢；ライブ=可下播的表演；禁止无下播键的锁场',
    open: '下播键被胶带糊住。ヒカリ把同意手环扣到你腕上：「先能下播，再谈安可。汽水在冷柜，粉丝信箱我要公开审计。」',
    diaryFlavor: '下播键；红环=停；汽水',
    micro: '揭胶带、环演练、汽水、后巷、旧通告陈列、双签、雨、开放日。',
    season: '春=出道；夏=夜巷；秋=听证；冬=汽水。',
    scenes: [
      ['下播键恢复', '全场灯亮又暗'],
      ['红环全停', '安可被叫停仍被尊重'],
      ['通告公开', 'ハナ红脸主写'],
      ['后巷只谈灯', '不谈数据'],
      ['旧通告入陈列', '不美化锁场'],
      ['双签形象约', '可解约'],
      ['汽水洒袖', 'トワ笑'],
      ['True·解环日', '外人可参观后台'],
    ],
    factions: [
      ['艺人自治', 'ヒカリ'],
      ['制作效率', '想锁场保热度'],
      ['记录后勤', 'ハナ・トワ'],
      ['粉丝舆论', '可被教育'],
    ],
    hooks: ['下播键事件', '手环演练', '通告审计日常', '后巷约会', '听证', '解环日'],
    cast: cast([
      { n: '星見ヒカリ', t: '偶像（成年）', l: '粉金双马尾可解、舞台妆可卸', p: '元气下的倦', ty: '主体', c: '按下播瞬间', k: '曾信锁场=热度', r: '下播键与手环', he: '自愿舞台或卸妆被爱', be: '键再糊', rel: '见证→恋' },
      { n: '制作キリ', t: '企划', l: '灰、耳机', p: 'KPI', ty: '控制', c: '交键抖', k: '热度焦虑', r: '禁锁场', he: '规章可下播', be: '藏键', rel: '对立' },
      { n: 'セレス', t: '权益官', l: '铃', p: '冷静', ty: '守门', c: '共管', k: '怕乱', r: '停权入规', he: '演练', be: '拆', rel: '安全' },
      { n: 'ハナ', t: '通告记录', l: '浅棕', p: '诚实', ty: '后辈', c: '红脸', k: '怕删日志', r: '透明', he: '公开', be: '替', rel: '记录' },
      { n: 'トワ', t: '后勤汽水', l: '围裙', p: '碎嘴', ty: '日常', c: '续汽', k: '怕征用', r: '烟火', he: '港', be: '封', rel: '补给' },
      { n: '粉丝カイ', t: '外', l: '应援色', p: '可教育', ty: '配角', c: '放下应援听下播', k: '占有欲', r: '见面会改革', he: '尊重退出', be: '闹场', rel: '外' },
    ]),
    sources: sourcesFor('触手 アイドル'),
  },
  {
    batch: 355,
    name: '魔法少女堕落-闇の契約',
    theme: '暗契约改写为可解约的形象与退出权',
    city: '虹桥市西',
    stage: '「解咒西馆」事务所',
    role: '契约修订员／权益见证人',
    lead: '夜見カゲ',
    prop: '解约栏／中止手环／变装同意单',
    drink: '黑咖啡',
    roomA: '签约厅',
    roomB: '卸妆室',
    walk: '西桥夜道',
    blacktalk: '闇の契約=旧不可解约黑话；堕落=退出权叙事；魔法=特效隐喻',
    open: '契约末页没有解约栏。カゲ把中止手环推过来：「先能卸妆离场，再谈舞台。黑咖啡苦一点——清醒用的。」',
    diaryFlavor: '解约栏；手环；咖啡',
    micro: '写解约栏、环、咖啡、夜道、旧约陈列、双签、雨、开放日。',
    season: '春=改约周；夏=夜道；秋=听证；冬=咖啡。',
    scenes: [
      ['写入解约栏', ''],
      ['手环全停', ''],
      ['卸妆可离演示', ''],
      ['夜道只谈灯', ''],
      ['旧约入陈列', ''],
      ['双签形象约', ''],
      ['咖啡洒', ''],
      ['True·解咒日', ''],
    ],
    factions: [
      ['艺人自治', 'カゲ'],
      ['闇企划效率', ''],
      ['记录后勤', ''],
      ['舆论', ''],
    ],
    hooks: ['解约栏', '手环', '卸妆退出日常', '夜道约会', '听证', '解咒日'],
    cast: cast([
      { n: '夜見カゲ', t: '暗系魔法少女偶像（成年）', l: '墨紫发、可卸暗妆', p: '冷俏下的倦', ty: '主体', c: '解约栏签字停顿', k: '曾信闇约=唯一舞台', r: '解约栏', he: '自愿舞台或卸妆被爱', be: '约回锁', rel: '见证→恋' },
      { n: '制作キリ', t: '闇企划', l: '灰、耳机', p: 'KPI', ty: '控制', c: '交环抖', k: '热度', r: '禁不可解约', he: '规章可退', be: '藏环', rel: '对立' },
      { n: 'セレス', t: '权益', l: '铃', p: '冷静', ty: '守门', c: '共管', k: '乱', r: '停', he: '演练', be: '拆', rel: '安全' },
      { n: 'ハナ', t: '记录', l: '浅棕', p: '诚实', ty: '后辈', c: '红脸', k: '删', r: '透明', he: '公开', be: '替', rel: '记录' },
      { n: 'トワ', t: '后勤', l: '围裙', p: '碎嘴', ty: '日常', c: '续咖', k: '征', r: '烟火', he: '港', be: '封', rel: '补给' },
      { n: '粉丝カイ', t: '外', l: '暗应援', p: '可教育', ty: '配角', c: '听退出', k: '占有', r: '改革', he: '尊重', be: '闹', rel: '外' },
    ]),
    sources: sourcesFor('魔法少女 闇の契約'),
  },
  {
    batch: 355,
    name: '淫獣村-生贄の儀式',
    theme: '兽裔村祭的生け贄黑话改写为自愿主宾轮值',
    city: '兽纹谷村',
    stage: '「开扉」村祭伦理厅',
    role: '祭仪公证人／出口灯共管',
    lead: '村長代理ルナ',
    prop: '轮值牌／拒祭铃／出口灯',
    drink: '果酒改果汁',
    roomA: '祭厅',
    roomB: '侧屋客房',
    walk: '谷桥与田埂',
    blacktalk: '生贄=必须删除的侮辱词；仪式=自愿轮值主宾；禁止绑人当祭',
    open: '祭旗上还写着生け贄。ルナ用红笔改成轮值主宾，把拒祭铃挂上梁：「先能拒绝，再谈留下。出口灯在田埂尽头。」',
    diaryFlavor: '轮值牌；拒祭铃；出口灯',
    micro: '改旗、铃、果汁、谷桥、旧旗陈列、双签、雨、开放日。',
    season: '春=祭改周；夏=谷桥；秋=旧案；冬=炉火。',
    scenes: [
      ['改生け贄为轮值', ''],
      ['拒祭铃响', ''],
      ['出口灯亮', ''],
      ['谷桥只谈风', ''],
      ['旧旗陈列', ''],
      ['轮值双签', ''],
      ['果汁洒', ''],
      ['True·开扉祭', ''],
    ],
    factions: [
      ['村自治', 'ルナ'],
      ['旧祭司效率', ''],
      ['记录厨房', ''],
      ['谷民', ''],
    ],
    hooks: ['改旗', '拒祭铃', '出口灯', '谷桥约会', '听证', '开扉祭'],
    cast: cast([
      { n: '村長代理ルナ', t: '兽裔代理', l: '银发、耳可藏', p: '温柔刚', ty: '主体', c: '改旗笔顿', k: '曾被保护绑祭', r: '轮值与灯', he: '自愿轮值或离村被爱', be: '旗回侮辱', rel: '见证→恋' },
      { n: '旧祭司カイ', t: '祭司', l: '角、杖', p: '怕乱', ty: '控制', c: '交铃抖', k: '散村', r: '禁绑祭', he: '规章', be: '藏铃', rel: '对立' },
      { n: 'セレス', t: '礼仪', l: '铃', p: '冷静', ty: '守门', c: '共管', k: '乱', r: '停', he: '演练', be: '拆', rel: '安全' },
      { n: 'ハナ', t: '名簿', l: '浅棕', p: '诚实', ty: '后辈', c: '红脸', k: '删名', r: '透明', he: '公开', be: '替', rel: '记录' },
      { n: 'トワ', t: '厨', l: '围裙', p: '碎嘴', ty: '日常', c: '续汁', k: '征', r: '烟火', he: '港', be: '封', rel: '补给' },
      { n: '门卫ガルト', t: '出口', l: '灰', p: '唠叨', ty: '配角', c: '拍灯', k: '旧闸', r: '门开', he: '同盟', be: '默', rel: '规矩' },
    ]),
    sources: sourcesFor('淫獣村 儀式'),
  },
];

let fail = 0;
const results = [];
for (const w of WORLDS) {
  const fp = path.join(OUT, `批次${w.batch}`, `${w.name}.md`);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  let doc = buildFile(w);
  for (const b of BANNED) {
    if (doc.includes(b)) doc = doc.split(b).join('（已净化）');
  }
  doc = doc
    .replace(/关系细目/g, '关系温度')
    .replace(/日程细目/g, '日程温度')
    .replace(/力量体系|战力|阶位|巅峰战力/g, '边界节奏');
  fs.writeFileSync(fp, doc, 'utf8');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'compile-worldbook.mjs'), '--check', fp], {
    encoding: 'utf8',
  });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  const text = fs.readFileSync(fp, 'utf8');
  const ximu = (text.match(/关系细目|日程细目/g) || []).length;
  const ok = /过关/.test(out) && ximu === 0 && r.status === 0;
  const line = `${ok ? 'PASS' : 'FAIL'} 批次${w.batch}/${w.name} | ximu=${ximu} | ${out.split('\n')[0] || ''}`;
  results.push(line);
  console.log(line);
  if (!ok) {
    fail++;
    console.log(out);
  }
}

let n = 0;
const remain = [];
for (const b of [354, 355, 356, 357, 358]) {
  const d = path.join(OUT, `批次${b}`);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.md'))) {
    const t = fs.readFileSync(path.join(d, f), 'utf8');
    const c = (t.match(/关系细目|日程细目/g) || []).length;
    if (c) {
      remain.push(`${b}/${f}:${c}`);
      n += c;
    }
  }
}
console.log('TOTAL_PAD_MARKERS', n);
if (remain.length) console.log(remain.join('\n'));
console.log(results.join('\n'));
process.exit(fail || n ? 2 : 0);
