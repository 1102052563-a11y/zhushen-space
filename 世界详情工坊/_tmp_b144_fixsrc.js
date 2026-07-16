const fs = require("fs");

function fix(f, sources) {
  let md = fs.readFileSync(f, "utf8");
  // collapse literal \n sequences introduced by bad writes
  while (md.includes("\\n")) {
    md = md.replace(/\\n/g, "\n");
  }
  // replace 来源 section entirely
  const head = md.split("## 来源")[0];
  const body = "## 来源\n\n" + sources.map((s) => `- ${s}`).join("\n") + "\n";
  fs.writeFileSync(f, head + body, "utf8");
  const src = body;
  const https = (src.match(/https:\/\//g) || []).length;
  console.log(f, "https", https);
}

fix("产出/批次144/宝可梦 钻石.md", [
  "[搜笔趣阁检索·宝可梦钻石（无网文全本收录，已尝试）](https://www.sobqg.com/searchBook.html?keyword=%E5%AE%9D%E5%8F%AF%E6%A2%A6%20%E9%92%BB%E7%9F%B3)",
  "[宝可梦 钻石／珍珠 - 神奇宝贝百科](https://wiki.52poke.com/wiki/%E5%AF%B6%E5%8F%AF%E5%A4%A2_%E9%91%BD%E7%9F%B3%EF%BC%8F%E7%8F%8D%E7%8F%A0)",
  "[Pokémon Diamond and Pearl Versions - Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_Diamond_and_Pearl_Versions)",
  "[寶可夢 鑽石／珍珠 - 维基百科](https://zh.wikipedia.org/wiki/%E5%AF%B6%E5%8F%AF%E5%A4%A2_%E9%91%BD%E7%9F%B3%EF%BC%8F%E7%8F%8D%E7%8F%A0)",
]);

fix("产出/批次144/攻壳机动队：2045 第二季.md", [
  "[搜笔趣阁检索·攻壳机动队（无网文全本收录，已尝试）](https://www.sobqg.com/searchBook.html?keyword=%E6%94%BB%E5%A3%B3%E6%9C%BA%E5%8A%A8%E9%98%9F)",
  "[攻壳机动队：SAC_2045 - 维基百科](https://zh.wikipedia.org/wiki/%E6%94%BB%E5%A3%B3%E6%9C%BA%E5%8A%A8%E9%98%9F%EF%BC%9ASAC_2045)",
  "[Ghost in the Shell: SAC_2045 - Wikipedia](https://en.wikipedia.org/wiki/Ghost_in_the_Shell:_SAC_2045)",
  "[List of Ghost in the Shell: SAC 2045 episodes - Wikipedia](https://en.wikipedia.org/wiki/List_of_Ghost_in_the_Shell:_SAC_2045_episodes)",
  "[Ghost in the Shell: SAC_2045 (ONA) - Anime News Network](https://www.animenewsnetwork.com/encyclopedia/anime.php?id=21672)",
]);
