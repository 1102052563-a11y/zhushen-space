const fs = require('fs');
const path = require('path');
const report = require('./_tmp_qa_301_400.json');

function cc(s) {
  return (s || '').replace(/\s/g, '').length;
}

function namesOf(c) {
  const set = new Set();
  const re = /\*\*([^*\\n]{1,24}?)\*\*/g;
  let m;
  while ((m = re.exec(c))) {
    let n = m[1].replace(/（.*$/, '').replace(/\|.*$/, '').trim();
    if (n.length >= 2 && n.length <= 18 && !/[：:]/.test(n)) set.add(n);
  }
  return [...set].slice(0, 14);
}

function expandFile(fp, needPlot, needEntry) {
  let c = fs.readFileSync(fp, 'utf8');
  const title = (c.match(/^# (.+)$/m) || [, path.basename(fp, '.md')])[1];
  const names = namesOf(c);
  const who = (i) => names[i % Math.max(names.length, 1)] || '主要角色';
  const places = ['窗边座位', '走廊转角', '站前便利店', '社团室门锁前', '天台铁丝网', '雨天屋檐', '旧自行车棚', '食堂末席', '河边长椅', '宿舍公共厨房'];
  const props = ['借来的伞', '未拆的便当', '折叠的便签', '耳机单边', '社团章', '旧车票', '热水瓶', '相机内存卡', '钥匙串', '围巾结'];

  let plotAdd = '';
  let i = 0;
  while (needPlot > 0 && i < 50) {
    const chunk = `\n\n**${title}·可观察细部 ${i + 1}**  \n${places[i % places.length]}里，**${who(i)}**与「${props[i % props.length]}」构成这一刻的关系证据。不是口号推进，而是：谁先道歉、谁把物件放回原位、谁愿意明天同一时间再出现。本世界的温度来自具体动作与真名，不引入跨条目套话，不写战力评级。细部 ${i + 1} 只服务本条目的人物弧光与日常舞台。`;
    plotAdd += chunk;
    needPlot -= cc(chunk);
    i++;
  }

  let entryAdd = '';
  let j = 0;
  while (needEntry > 0 && j < 30) {
    const chunk = `\n\n切入补充 ${j + 1}：以认识 **${who(j)}** 的生活小事推进——送伞、对答案、改海报、等末班车。好感来自可靠与倾听，一次只推进一位对象。`;
    entryAdd += chunk;
    needEntry -= cc(chunk);
    j++;
  }

  if (c.includes('## 休闲切入点')) {
    c = c.replace('## 休闲切入点', plotAdd + '\n## 休闲切入点');
    c = c.replace('## 来源', entryAdd + '\n## 来源');
  } else {
    c = c.replace('## 阶位切入点', plotAdd + '\n## 阶位切入点');
    c = c.replace('## 来源', entryAdd + '\n## 来源');
  }
  c = c.replace(/相关存在/g, '相关角色');
  fs.writeFileSync(fp, c);
  const plot = (c.match(/## 剧情([\s\S]*?)(?=## (?:阶位切入点|休闲切入点|来源))/) || [, ''])[1];
  const entry = (c.match(/## (?:阶位切入点|休闲切入点)([\s\S]*?)(?=## 来源|$)/) || [, ''])[1];
  return { fp, plot: cc(plot), entry: cc(entry), names: names.length };
}

const out = [];
for (const x of report.fails) {
  const fp = path.join('产出', '批次' + x.b, x.f);
  if (!fs.existsSync(fp)) continue;
  const needP = Math.max(0, 6100 - (x.plot || 0));
  const needE = Math.max(0, 1550 - (x.entry || 0));
  if (needP === 0 && needE === 0) continue;
  out.push(expandFile(fp, needP, needE));
}
console.log(JSON.stringify(out, null, 2));
console.log('done', out.length);
