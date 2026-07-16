const fs=require('fs');
const m=JSON.parse(fs.readFileSync(String.raw`C:\Users\Administrator\Desktop\前端卡\files\世界详情工坊\清单\manifest.json`,'utf8'));
const names = Array.isArray(m)? m : (m.worlds||m.list||Object.values(m).flat());
// find structure
const sample = Array.isArray(m) ? m[0] : (m.worlds? m.worlds[0]: null);
console.log('type', Array.isArray(m)?'arr':typeof m, 'keys', !Array.isArray(m)?Object.keys(m).slice(0,20): 'n/a');
if(Array.isArray(m)) console.log('len', m.length, 'sample', JSON.stringify(m[0]).slice(0,200));
else if(m.worlds) console.log('worlds', m.worlds.length, JSON.stringify(m.worlds[0]).slice(0,200));
// search
const all = Array.isArray(m)? m : (m.worlds||[]);
const keys = ['742','シコ','トロみつ','White Blue','Knight of Erin','卒業'];
for(const k of keys){
  const hits = all.filter(x=>{
    const n = typeof x==='string'?x:(x.name||x.title||'');
    return String(n).includes(k) || String(x.batch||'').includes(k);
  }).slice(0,5);
  console.log('KEY',k, hits.map(x=>typeof x==='string'?x:(x.name||JSON.stringify(x).slice(0,120))));
}