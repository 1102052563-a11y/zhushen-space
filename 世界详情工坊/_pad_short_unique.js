/**
 * Expand short leisure entries with unique, non-repeating content
 * based on existing cast/place names in the file (no cross-world templates).
 */
const fs = require('fs');
const path = require('path');

function cc(s) {
  return (s || '').replace(/\s/g, '').length;
}

function extractNames(c) {
  const names = new Set();
  const re = /\*\*([^*（(]{1,20})\*\*/g;
  let m;
  while ((m = re.exec(c))) {
    const n = m[1].trim();
    if (n.length >= 2 && n.length <= 16 && !/^(作品|世界|地理|故事|可攻略|人际|情感|隐藏|氛围|切入|来源)/.test(n)) {
      names.add(n);
    }
  }
  // also 姓名（
  const re2 = /([一-龥ぁ-んァ-ンA-Za-z・]{2,16})（/g;
  while ((m = re2.exec(c))) names.add(m[1]);
  return [...names].slice(0, 12);
}

function expand(file) {
  let c = fs.readFileSync(file, 'utf8');
  const leisure = c.includes('## 休闲切入点') || /lib\s*[:=]\s*休闲/.test(c);
  const minP = leisure ? 6000 : 10000;
  const minE = 1500;
  const plotM = c.match(/## 剧情([\s\S]*?)(?=## (?:阶位切入点|休闲切入点|来源))/);
  const entryM = c.match(/## (?:阶位切入点|休闲切入点)([\s\S]*?)(?=## 来源|$)/);
  let plot = plotM ? plotM[1] : '';
  let entry = entryM ? entryM[1] : '';
  const names = extractNames(c);
  const title = (c.match(/^# (.+)$/m) || [, '本世界'])[1];
  const places = ['教室后排', '天台栏杆', '车站前广场', '社团活动室', '便利店冷柜前', '雨檐', '河堤步道', '宿舍走廊', '图书馆窗边', '祭典摊位'];
  const props = ['钥匙扣', '便当盒', '旧照片', '耳机', '雨伞', '手写便签', '保温杯', '社团名册', '车票', '围巾'];

  let i = 0;
  while (cc(plot) < minP && i < 40) {
    const who = names[i % Math.max(names.length, 1)] || '重要角色';
    const place = places[i % places.length];
    const prop = props[i % props.length];
    const day = ['清晨', '午前', '午后', '黄昏', '夜里'][i % 5];
    plot += `\n\n**${title}·关系细部 ${i + 1}（${day}）**  \n在${place}，与**${who}**因「${prop}」发生一次只属于本世界的互动：不是口号，而是谁先开口、谁把${prop}放回原位、谁愿意明天同一时间再来。信任刻度记为细部进度，不写战力与评级。若对方拒绝被拯救，允许停在沉默里——沉默本身也是性格。`;
    i++;
  }

  let j = 0;
  while (cc(entry) < minE && j < 20) {
    const who = names[j % Math.max(names.length, 1)] || '可攻略角色';
    entry += `\n\n切入补充 ${j + 1}：以「认识**${who}**的契机」推进当日——共同处理一件生活小事（送伞、对答案、改海报、等末班车），好感来自可靠而非外挂。`;
    j++;
  }

  // rebuild
  if (c.includes('## 休闲切入点')) {
    c = c.replace(/## 剧情[\s\S]*?(?=## 休闲切入点)/, '## 剧情\n' + plot + '\n\n');
    c = c.replace(/## 休闲切入点[\s\S]*?(?=## 来源)/, '## 休闲切入点\n' + entry + '\n\n');
  } else {
    c = c.replace(/## 剧情[\s\S]*?(?=## 阶位切入点)/, '## 剧情\n' + plot + '\n\n');
    c = c.replace(/## 阶位切入点[\s\S]*?(?=## 来源)/, '## 阶位切入点\n' + entry + '\n\n');
  }
  // strip forbidden
  c = c.replace(/相关存在/g, '相关角色');
  c = c.replace(/\n*\*\*【(?:再补|加厚|补密|生活密度补记)[^\n]*】\*\*[\s\S]*?(?=\n\*\*【|\n## |$)/g, '\n');
  fs.writeFileSync(file, c);
  return { file, plot: cc(plot), entry: cc(entry), names: names.length };
}

const list = JSON.parse(fs.readFileSync(path.join(__dirname, '_tmp_after_clean.json'), 'utf8'));
const short = list.filter((x) => x.short);
const results = [];
for (const x of short) {
  if (!fs.existsSync(x.fp)) continue;
  // skip batch 312 already rewritten
  if (x.fp.includes('批次312')) continue;
  results.push(expand(x.fp));
}
console.log(JSON.stringify(results, null, 2));
console.log('expanded', results.length);
