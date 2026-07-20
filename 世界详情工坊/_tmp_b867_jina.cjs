const https = require("https");
const fs = require("fs");
const path = require("path");
function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,text/plain,*/*"
      },
      timeout: 30000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location.startsWith("http") ? res.headers.location : new URL(res.headers.location, url).href;
        return get(loc).then(resolve, reject);
      }
      let d = "";
      res.setEncoding("utf8");
      res.on("data", c => d += c);
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}
(async () => {
  const outDir = "C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/_tmp_b867_research";
  const urls = [
    ["jina_moni", "https://r.jina.ai/http://baike.baidu.com/item/%E6%88%91%E7%9A%84%E6%A8%A1%E6%8B%9F%E9%95%BF%E7%94%9F%E8%B7%AF/64128600"],
    ["jina_gm", "https://r.jina.ai/http://baike.baidu.com/item/%E5%85%89%E6%98%8E%E7%BA%AA%E5%85%83/69712"],
    ["jina_mofa", "https://r.jina.ai/http://baike.baidu.com/item/%E9%AD%94%E6%B3%95%E5%AD%A6%E5%BE%92"],
    ["jina_shuilian", "https://r.jina.ai/http://www.qidian.com/book/1033298769/"],
    ["jina_moni_qd", "https://r.jina.ai/http://www.qidian.com/book/1033422902/"],
    ["jina_gm_qd", "https://r.jina.ai/http://www.qidian.com/book/2311686/"],
    ["jina_dalong", "https://r.jina.ai/http://www.qidian.com/search?kw=%E5%A4%A7%E9%BE%99%E6%8C%82%E4%BA%86"],
    ["jina_zh_shuilian", "https://r.jina.ai/http://www.zhihu.com/search?type=content&q=%E8%B0%81%E8%AE%A9%E4%BB%96%E4%BF%AE%E4%BB%99%E7%9A%84%20%E9%99%86%E9%98%B3"],
  ];
  for (const [name, url] of urls) {
    try {
      const r = await get(url);
      fs.writeFileSync(path.join(outDir, name + ".txt"), `status=${r.status}\nurl=${url}\n\n` + r.body.slice(0, 20000), "utf8");
      console.log(name, r.status, r.body.slice(0, 200).replace(/\s+/g, " "));
    } catch (e) {
      console.log(name, "ERR", e.message);
    }
  }
})();