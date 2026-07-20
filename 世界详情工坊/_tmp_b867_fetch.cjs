const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9"
      },
      timeout: 25000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith("http") ? res.headers.location : new URL(res.headers.location, url).href;
        return get(loc).then(resolve, reject);
      }
      let d = "";
      res.setEncoding("utf8");
      res.on("data", c => d += c);
      res.on("end", () => resolve({ status: res.statusCode, len: d.length, body: d }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}
function strip(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ").trim();
}
(async () => {
  const outDir = "C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/_tmp_b867_research";
  fs.mkdirSync(outDir, { recursive: true });
  const queries = [
    ["shuilian", "https://www.sobqg.com/searchBook.html?keyword=%E8%B0%81%E8%AE%A9%E4%BB%96%E4%BF%AE%E4%BB%99%E7%9A%84"],
    ["moni", "https://www.sobqg.com/searchBook.html?keyword=%E6%88%91%E7%9A%84%E6%A8%A1%E6%8B%9F%E9%95%BF%E7%94%9F%E8%B7%AF"],
    ["guangming", "https://www.sobqg.com/searchBook.html?keyword=%E5%85%89%E6%98%8E%E7%BA%AA%E5%85%83"],
    ["mofa", "https://www.sobqg.com/searchBook.html?keyword=%E9%AD%94%E6%B3%95%E5%AD%A6%E5%BE%92"],
    ["dalong", "https://www.sobqg.com/searchBook.html?keyword=%E5%A4%A7%E9%BE%99%E6%8C%82%E4%BA%86"],
    ["dacheng", "https://www.sobqg.com/searchBook.html?keyword=%E5%A4%A7%E4%B9%98%E6%9C%9F%E6%89%8D%E6%9C%89%E9%80%86%E8%A2%AD%E7%B3%BB%E7%BB%9F"],
    ["huoren", "https://www.sobqg.com/searchBook.html?keyword=%E6%B4%BB%E4%BA%BA%E6%B7%B1%E5%A4%84"],
    ["zhenyao", "https://www.sobqg.com/searchBook.html?keyword=%E9%95%87%E5%A6%96%E5%8D%9A%E7%89%A9%E9%A6%86"],
    ["guaitan", "https://www.sobqg.com/searchBook.html?keyword=%E6%80%AA%E8%B0%88%E6%B8%B8%E6%88%8F%E8%AE%BE%E8%AE%A1%E5%B8%88"],
    ["quanqiu", "https://www.sobqg.com/searchBook.html?keyword=%E5%85%A8%E7%90%83%E5%B4%A9%E5%9D%8F"],
    ["emeng", "https://www.sobqg.com/searchBook.html?keyword=%E5%99%A9%E6%A2%A6%E6%83%8A%E8%A2%AD"],
    ["zhqun", "https://www.sobqg.com/searchBook.html?keyword=%E6%88%98%E9%94%A4%E7%BE%A4%E6%98%9F%E4%B8%8E%E8%9D%BC%E8%9A%81"],
    ["zhhuang", "https://www.sobqg.com/searchBook.html?keyword=%E6%88%98%E9%94%A4%E6%88%91%E4%B9%9F%E8%A6%81%E5%9D%90%E9%BB%84%E9%87%91%E7%8E%8B%E5%BA%A7"],
    ["shimei", "https://www.sobqg.com/searchBook.html?keyword=%E5%B8%88%E5%A6%B9%E6%88%91%E7%9C%9F%E5%BE%97%E6%8E%A7%E5%88%B6%E4%BD%A0%E4%BA%86"],
    ["douluo", "https://www.sobqg.com/searchBook.html?keyword=%E6%96%97%E7%BD%97%E7%BB%9D%E4%B8%96%E5%A4%9A%E6%83%85%E5%89%91%E5%AE%A2"],
    ["witch", "https://www.sobqg.com/searchBook.html?keyword=%E4%BC%9F%E5%A4%A7%E8%8C%9C%E5%A5%B32077"],
  ];
  for (const [name, url] of queries) {
    try {
      const r = await get(url);
      const links = [...r.body.matchAll(/href="(\/book\/[^"]+\.html)"/g)].map(m => m[1]);
      const text = strip(r.body).slice(0, 4000);
      fs.writeFileSync(path.join(outDir, name + "_search.txt"), `status=${r.status}\nlinks=\n${links.slice(0,15).join("\n")}\n\n${text}`, "utf8");
      console.log(name, r.status, "links", links.slice(0,6).join(" | "));
      if (links[0]) {
        const br = await get("https://www.sobqg.com" + links[0]);
        const bt = strip(br.body).slice(0, 6000);
        fs.writeFileSync(path.join(outDir, name + "_book.txt"), `url=https://www.sobqg.com${links[0]}\nstatus=${br.status}\n\n${bt}`, "utf8");
        console.log("  book", links[0], br.status, bt.slice(0, 150).replace(/\s+/g," "));
      }
    } catch (e) {
      console.log(name, "ERR", e.message);
    }
  }
  // qidian pages
  const qd = [
    ["qd_shuilian", "https://www.qidian.com/book/1033298769/"],
    ["qd_moni", "https://www.qidian.com/book/1033422902/"],
    ["qd_gm", "https://www.qidian.com/book/2311686/"],
  ];
  for (const [name, url] of qd) {
    try {
      const r = await get(url);
      fs.writeFileSync(path.join(outDir, name + ".txt"), `status=${r.status}\nurl=${url}\n\n` + strip(r.body).slice(0, 5000), "utf8");
      console.log(name, r.status, strip(r.body).slice(0,120));
    } catch(e) { console.log(name, e.message); }
  }
})();