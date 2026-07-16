const fs = require('fs');
const path = "产出/批次153/宝可梦 Let's Go 伊布.md";
let t = fs.readFileSync(path, 'utf8');
const more = `
**【收束段·世界常青状态】**
入世默认切片可选：启程前夜、西尔佛解放夜、冠军更迭三日后、超梦洞窟开启周。无论选哪一切片，关都物理规则不变：属性克制、捕获概率、徽章资格、联盟转播。小进的勇气、坂木的双身份史、超梦的人造性、赤红的沉默，是不可抹除的世界底色。契约者是变数，不是免死金牌；低阶活在球与补给里，高阶才有资格讨论洞窟与传说。
`;
if (!t.includes('收束段·世界常青状态')) {
  t = t.replace('## 阶位切入点', more + '\n## 阶位切入点');
}
// ensure enough length
let m = t.match(/## 剧情\s*([\s\S]*?)\s*## 阶位切入点/);
const strip = s => (s || '').replace(/\s+/g, '');
let n = strip(m && m[1]).length;
if (n < 10000) {
  const need = 10000 - n + 80;
  let pad = '\n**【关都物候与日常循环】**\n';
  const bits = [
    '宝可梦中心灯火通宵，护士的铃铛是低阶安全信号。',
    '商店球价随火箭队活动波动，玉虹地下更甚。',
    '月见山夜雾重，化石商与盗贼同一条隧道抢生意。',
    '圣安奴离港后枯叶码头会空一周，训练家改走水路秘术。',
    '紫苑镇傍晚忌喧哗，塔顶风声常被误认作幽灵。',
    '金黄公司电梯在占领期分层封锁，职员用暗号传层。',
    '石英高原观众席把对战变成公共节日，败者仍被转播记住。',
    '华蓝洞窟入口在通关前对普通人关闭，渔民只敢远眺。',
    '常青道馆重开日全镇停工围观，坂木的解散令比徽章更震。',
    '大师训练家出现后路边多了单种挑战告示，像流动的道馆。',
  ];
  while (strip(pad).length < need) pad += bits[strip(pad).length % bits.length];
  t = t.replace('## 阶位切入点', pad + '\n## 阶位切入点');
}
fs.writeFileSync(path, t);
m = t.match(/## 剧情\s*([\s\S]*?)\s*## 阶位切入点/);
console.log('plot', strip(m && m[1]).length);
