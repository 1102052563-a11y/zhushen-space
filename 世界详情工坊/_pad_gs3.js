const fs = require("fs");
const path = require("path");
const dir = "产出/批次49";
let md = fs.readFileSync(path.join(dir, "原神.md"), "utf8");
const extra = `
**【港城声音与战后账本】**
警报解除后，璃月港最先恢复的不是庆祝，而是算账：沉船清单、货损、渔民抚恤、千岩军伤亡、归终机损耗、群玉阁残骸打捞权归属。北国银行的汇兑记录会被七星反复核对，任何异常拨款都可能指向愚人众的下一手。仙人要的是「魔神不再出」，商人要的是「船期恢复」，军人以「再动员能力」衡量胜利。契约者若在战后入世，比参战更赚钱也更危险的工作是审计、护送账册与保护证人——因为账本能杀死的人，有时比漩涡更多。
`;
if (!md.includes("港城声音与战后账本")) {
  md = md.replace("\n## 阶位切入点", extra + "\n## 阶位切入点");
  fs.writeFileSync(path.join(dir, "原神.md"), md, "utf8");
}
console.log("plot", md.split("## 阶位切入点")[0].replace(/\s/g,"").length);
