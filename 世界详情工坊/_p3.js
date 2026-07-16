const fs=require('fs');
for(const f of ['_s2id.html','_s2id2.html','_s2id3.html','_hd.html']){
  if(!fs.existsSync(f)) continue;
  const h=fs.readFileSync(f,'utf8');
  const ids=[...h.matchAll(/\/v([0-9]{2,5})/g)].map(x=>x[1]);
  console.log(f, [...new Set(ids)].slice(0,8).join(','));
  console.log(h.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,1800));
}
