const fs=require('fs');
const p='产出/批次146/银翼杀手：2036 复制人黎明.md';
let t=fs.readFileSync(p,'utf8');
const i=t.indexOf('## 阶位切入点');
const pad=`

**【收束】**2036的黎明不是阳光，是听证室冷光打在刀刃上的白。复制人黎明若到来，世界会更整齐，也更不可宽恕。契约者能做的，是让整齐晚一点到来，或让不可宽恕被更多人看见。公开资料以维基词条与宣发短片为准，禁止编造未出场的正片主角线细节。
`;
t=t.slice(0,i)+pad+'\n'+t.slice(i);
fs.writeFileSync(p,t);
console.log(t.split('## 阶位切入点')[0].replace(/^[\s\S]*?## 剧情\s*/,'').replace(/\s/g,'').length);
