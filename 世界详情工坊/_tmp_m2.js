const fs=require('fs');
const m=JSON.parse(fs.readFileSync(String.raw`C:\Users\Administrator\Desktop\前端卡\files\世界详情工坊\清单\manifest.json`,'utf8'));
const need = [
'卒業○○電車 四輌目',
'Knight of Erin -Erin and Nihgthawk- 1st',
'とろみつ',
'しこやか',
'White Blue',
'母ちゃんの友達',
'図書室ノ彼女',
'支配の教壇 無垢',
'対魔忍アサギ 〜捕らわれ',
'優等生綾香のウラオモテ 第1話'
];
for(const k of need){
  const hits=m.worlds.filter(w=>w.name.includes(k));
  console.log('---',k);
  hits.forEach(h=>console.log(h.name,'|',h.lib));
}