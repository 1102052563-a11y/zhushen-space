const https = require('https');
const fs = require('fs');

function get(u) {
  return new Promise((res, rej) => {
    https
      .get(
        u,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'ja,en;q=0.9',
          },
        },
        (r) => {
          let d = '';
          r.on('data', (c) => (d += c));
          r.on('end', () => res({ status: r.statusCode, body: d, url: u }));
        }
      )
      .on('error', rej);
  });
}

function strip(h) {
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}

function extractDlsite(html) {
  const titles = [];
  let m;
  const re = /class="work_name"[^>]*>\s*<a[^>]*>([^<]+)/g;
  while ((m = re.exec(html))) titles.push(m[1].trim());
  const re2 = /n_workname[^>]*>\s*<a[^>]*>([^<]+)/g;
  while ((m = re2.exec(html))) titles.push(m[1].trim());
  const ids = [];
  const re3 = /product_id\/(VJ\d+|BJ\d+|RJ\d+)/g;
  while ((m = re3.exec(html))) ids.push(m[1]);
  return {
    titles: [...new Set(titles)].slice(0, 12),
    ids: [...new Set(ids)].slice(0, 12),
  };
}

(async () => {
  const out = [];
  const jobs = [
    ['mal-mei', 'https://myanimelist.net/anime/37223/Ore_ga_Kanojo_wo_su_Wake'],
    ['mal-mei-ch', 'https://myanimelist.net/anime/37223/Ore_ga_Kanojo_wo_su_Wake/characters'],
    ['mal-mei-ep', 'https://myanimelist.net/anime/37223/Ore_ga_Kanojo_wo_su_Wake/episode'],
    ['mal-search-doki', 'https://myanimelist.net/anime.php?q=Dokidoki%20Little%20Ooyasan&cat=anime'],
    ['mal-search-ochi', 'https://myanimelist.net/anime.php?q=Ochi%20Mono%20RPG&cat=anime'],
    ['mal-search-loveholic', 'https://myanimelist.net/anime.php?q=Love%20Holic&cat=anime'],
    ['mal-search-kisu', 'https://myanimelist.net/anime.php?q=%E3%82%AD%E3%82%B9%E3%83%8F%E3%82%B0&cat=anime'],
    ['mal-search-xl', 'https://myanimelist.net/manga.php?q=XL%E4%B8%8A%E5%8F%B8&cat=manga'],
    ['mal-search-jyi', 'https://myanimelist.net/anime.php?q=%E5%A5%B3%E5%8C%BB%E3%81%AE%E8%A8%BA%E5%AF%9F&cat=anime'],
    ['mal-search-kaede', 'https://myanimelist.net/anime.php?q=%E5%84%AA%E7%AD%89%E7%94%9F%20%E6%A5%93&cat=anime'],
    ['mal-search-abaddon', 'https://myanimelist.net/manga.php?q=ABADDON&cat=manga'],
    ['wiki-vb', 'https://ja.wikipedia.org/wiki/VenusBlood'],
    ['dl-luvi', 'https://www.dlsite.com/pro/fsr/=/keyword/%E8%81%96%E9%A8%8E%E5%A3%AB%E3%83%AB%E3%83%B4%E3%82%A3%E3%83%AA%E3%82%A2%E3%82%B9'],
    ['dl-xl', 'https://www.dlsite.com/books/fsr/=/keyword/XL%E4%B8%8A%E5%8F%B8'],
    ['dl-abad', 'https://www.dlsite.com/books/fsr/=/keyword/%E8%85%90%E7%95%8C%20ABADDON'],
    ['dl-jyi', 'https://www.dlsite.com/pro/fsr/=/keyword/%E8%A8%BA%E5%AF%9F%E6%97%A5%E8%AA%8C'],
    ['dl-kaede', 'https://www.dlsite.com/pro/fsr/=/keyword/%E5%84%AA%E7%AD%89%E7%94%9F%E3%83%BB%E6%A5%93'],
    ['dl-vb', 'https://www.dlsite.com/pro/fsr/=/keyword/VenusBlood%20BRAVE'],
    ['dl-love', 'https://www.dlsite.com/pro/fsr/=/keyword/LoveHolic'],
    ['dl-kiss', 'https://www.dlsite.com/pro/work/=/product_id/VJ014354.html'],
    ['dl-kiss-comic', 'https://www.dlsite.com/books/work/=/product_id/BJ217573.html'],
  ];

  for (const [k, u] of jobs) {
    try {
      const r = await get(u);
      const t = strip(r.body);
      let extra = '';
      if (u.includes('dlsite')) {
        extra = JSON.stringify(extractDlsite(r.body));
      }
      out.push({
        key: k,
        status: r.status,
        url: u,
        text: t.slice(0, 2500),
        extra,
      });
      console.log('OK', k, r.status, t.length);
    } catch (e) {
      out.push({ key: k, err: e.message, url: u });
      console.log('ERR', k, e.message);
    }
  }

  fs.writeFileSync(
    'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/scripts/_tmp_b727_search.json',
    JSON.stringify(out, null, 2),
    'utf8'
  );
  console.log('wrote', out.length);
})();
