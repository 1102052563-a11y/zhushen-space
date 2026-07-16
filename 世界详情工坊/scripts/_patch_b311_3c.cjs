const fs = require("fs");
const p = "产出/批次311/晓之护卫 (Akatsuki no Goei).md";
let t = fs.readFileSync(p, "utf8");
t = t.replace(/等级战力榜/g, "等级排行榜");
const add = `
**主题曲与氛围锚点**
OP「Together」强调并走的守护；ED「パーソナルスペース」直指私人空间被踏入却不讨厌的主题——与尊德吐槽海斗「不把私人空间当回事」的台词互文。正文若要定调，用「门廊的袖口」与「廊下的脚步声」两个声音意象即可，不必上冲突场面。

`;
t = t.replace("**【氛围基调 · 雷区】**", add + "**【氛围基调 · 雷区】**");
fs.writeFileSync(p, t, "utf8");
