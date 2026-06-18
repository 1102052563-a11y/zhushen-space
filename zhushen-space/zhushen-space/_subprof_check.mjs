function normNm(s){ return (s||"").replace(/[\s·•・\-—_,，.。、|｜()（）【】\[\]:：]/g,"").trim().toLowerCase(); }
function nameEq(a,b){ const x=normNm(a),y=normNm(b); return !!x&&!!y&&x===y; }
const PROF_ALIAS={ alchemy:"炼金术", alchemist:"炼金术", "炼金":"炼金术", "炼金学":"炼金术", "炼金术士":"炼金术", "炼金师":"炼金术", forging:"锻造", blacksmith:"锻造", "铁匠":"锻造" };
const CJK_RE=/[㐀-鿿豈-﫿]/;
function profHasCJK(n){ return CJK_RE.test(n||""); }
function canonProfName(n){ const raw=(n||"").trim(); if(!raw) return raw; return PROF_ALIAS[normNm(raw)] ?? raw; }
function sameProf(a,b){ return nameEq(canonProfName(a),canonProfName(b)); }
const ACQ=/(拜师|拜入|师从|师承|入门|出师|入行|习得|学会|学成|学得|学到|修习|研习|钻研|领悟|顿悟|觉醒|开启|开通|点亮|解锁|转职|授予|传授|教授|传承|衣钵|收徒|收为徒|拜.{0,4}为师|成(为|了)(一名)?\S{0,6}(师|匠|学徒))/;
function showsAcq(narrative, prof){
  const text=narrative||""; if(!text.trim()) return true;
  const names=new Set();
  for(const n of [canonProfName(prof),prof]){ const t=(n||"").trim(); if(!t)continue; names.add(t);
    const cjk=t.replace(/[^㐀-鿿]/g,""); for(let i=0;i+2<=cjk.length;i++) names.add(cjk.slice(i,i+2)); }
  for(const sent of text.split(/[。！？!?\n；;]+/)){ if(!ACQ.test(sent))continue;
    for(const nm of names) if(nm.length>=2 && sent.includes(nm)) return true; }
  return false;
}
let fails=0;
function chk(label, got, want){ const ok=got===want; if(!ok)fails++; console.log((ok?"PASS":"**FAIL**")+"  "+label+"  => "+JSON.stringify(got)); }
console.log("--- dedup/canon ---");
chk("canon(Alchemy)==炼金术", canonProfName("Alchemy"), "炼金术");
chk("canon(炼金)==炼金术", canonProfName("炼金"), "炼金术");
chk("sameProf(炼金术,alchemy)", sameProf("炼金术","alchemy"), true);
chk("sameProf(炼金术,锻造)=false", sameProf("炼金术","锻造"), false);
chk("alchemy->含中文(可建)", profHasCJK(canonProfName("alchemy")), true);
chk("tactics->纯英文(拒建)", profHasCJK(canonProfName("tactics")), false);
console.log("--- mention != learn ---");
chk("她是炼金术师->no", showsAcq("她是个炼金术师，名声在外。", "炼金术"), false);
chk("桌上摆着炼金术典籍->no", showsAcq("桌上摆着一本炼金术典籍。", "炼金术"), false);
chk("听说过炼金术->no", showsAcq("你听说过炼金术这门手艺。", "炼金术"), false);
chk("没提->no", showsAcq("你走进了一片漆黑的森林。", "炼金术"), false);
console.log("--- real learn -> yes ---");
chk("拜入习得炼金术->yes", showsAcq("你正式拜入炼金阁，习得了基础炼金术。", "炼金术"), true);
chk("开启炼金术副职业->yes", showsAcq("系统提示：你开启了炼金术副职业。", "炼金术"), true);
chk("成为一名炼金师->yes", showsAcq("经过考核，你成为了一名炼金师。", "炼金术"), true);
chk("词根 习得禁忌炼金->yes", showsAcq("你顿悟，习得了禁忌炼金之法。", "禁忌炼金学徒"), true);
console.log(fails===0 ? "ALL PASS" : (fails+" FAILED"));
