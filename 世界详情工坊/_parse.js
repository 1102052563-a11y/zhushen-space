const fs=require('fs');
function strip(h){return h.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')}
for(const f of ['_egc.html','_gsc.html','_eroge.html','_gsr.html']){
  if(!fs.existsSync(f)) continue;
  const t=strip(fs.readFileSync(f,'utf8'));
  console.log('====',f,t.length);
  const i=t.indexOf('Characters');
  console.log(t.slice(Math.max(0,i), i+2500));
}
