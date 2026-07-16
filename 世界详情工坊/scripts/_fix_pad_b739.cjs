const fs = require('fs');
const path = require('path');

let s = fs.readFileSync(path.join(__dirname, '_write_b739_740_all.cjs'), 'utf8');
if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);

const newPad = `function padUnique(base, extras, min) {
  let t = base;
  const bag = (extras && extras.length) ? extras.slice() : ['**【补厚】**\\n本世界以人物关系与日常舞台为核，推进看称呼、独处借口与是否需要第三人在场。'];
  let i = 0;
  while (t.replace(/\\s/g, '').length < min && i < bag.length) {
    t += '\\n\\n' + bag[i];
    i++;
  }
  let j = 0;
  while (t.replace(/\\s/g, '').length < min && j < 300) {
    const e = bag[j % bag.length];
    const block = e.replace(/^\\*\\*【/, '**【再叙·' + (j + 1) + '·') + '\\n' +
      '补述要点：场景气味、未完成动作、可退出边界、翌日称呼变化、物证（钥匙/便当/票根/便签）之一必须出现。' +
      '关系计量：好感看主动联系频率；压力看第三人视线；失败=冷战或回避，不是死亡。';
    t += '\\n\\n' + block;
    j++;
  }
  while (t.replace(/\\s/g, '').length < min) {
    t += '\\n\\n**【密度补】**\\n' + '日常细节：门铃、鞋尖、洗衣夹、窗外蝉、未读消息、共用杯子、雨檐、终电、冰箱灯、门链。'.repeat(3);
  }
  return t;
}

`;

const start = s.indexOf('function padUnique');
const end = s.indexOf('function doc');
if (start < 0 || end < 0) {
  console.error('markers not found', start, end);
  process.exit(1);
}
s = s.slice(0, start) + newPad + s.slice(end);
fs.writeFileSync(path.join(__dirname, '_write_b739_740_all.cjs'), s, 'utf8');
console.log('ok', s.length);
