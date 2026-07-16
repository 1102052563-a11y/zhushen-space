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
          r.on('end', () => res({ status: r.statusCode, body: d }));
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
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}

(async () => {
  // wait a bit for jikan rate limit
  await new Promise((r) => setTimeout(r, 2000));
  const urls = [
    'https://www.dlsite.com/pro/work/=/product_id/VJ01001863.html',
    'https://www.dlsite.com/books/work/=/product_id/BJ01000000.html',
    'https://www.dlsite.com/maniax/work/=/product_id/RJ010000.html',
    // ABADDON product pages from search snippet
    'https://www.dlsite.com/maniax/fsr/=/keyword/%E8%85%90%E7%95%8C%E3%81%AB%E7%9C%A0%E3%82%8B%E7%8E%8B%E5%A5%B3%E3%81%AE%E3%82%A2%E3%83%90%E3%83%89%E3%83%BC%E3%83%B3',
    'https://www.dlsite.com/pro/fsr/=/keyword/%E3%82%A2%E3%83%90%E3%83%89%E3%83%BC%E3%83%B3',
    'https://www.dlsite.com/pro/fsr/=/keyword/%E3%81%95%E3%81%8F%E3%82%89%E3%81%B7%E3%82%8A%E3%82%93',
    // XL boss - try comic sites / fan wiki style
    'https://www.dlsite.com/girls/fsr/=/keyword/XL',
    'https://www.dlsite.com/girls/fsr/=/keyword/%E3%82%A8%E3%83%83%E3%82%AF%E3%82%B9%E3%82%A8%E3%83%AB%E4%B8%8A%E5%8F%B8',
    // Love×Holic anime possible getchu/fanza
    'https://www.dmm.co.jp/search/=/searchstr=Love%C3%97Holic/',
    // jikan delayed
    'https://api.jikan.moe/v4/anime?q=Ore%20ga%20Kanojo&sfw=false&limit=5',
    'https://api.jikan.moe/v4/anime?q=Dokidoki%20Little&sfw=false&limit=5',
    'https://api.jikan.moe/v4/anime?q=Luvyrias&sfw=false&limit=5',
    'https://api.jikan.moe/v4/anime?q=Abaddon&sfw=false&limit=5',
    'https://api.jikan.moe/v4/anime?q=Kiss%20Hug%20Queen&sfw=false&limit=5',
    'https://api.jikan.moe/v4/manga?q=XL%20Joushi&sfw=false&limit=5',
    'https://api.jikan.moe/v4/manga?q=Abaddon%20princess&sfw=false&limit=5',
    // read existing batch files for character continuity
  ];
  const out = [];
  for (const u of urls) {
    try {
      if (u.includes('jikan')) await new Promise((r) => setTimeout(r, 1200));
      const r = await get(u);
      out.push({ url: u, status: r.status, text: strip(r.body).slice(0, 5000), raw: u.includes('jikan') ? r.body.slice(0, 6000) : undefined });
      console.log('OK', r.status, u.slice(-55));
    } catch (e) {
      out.push({ url: u, err: e.message });
      console.log('ERR', e.message);
    }
  }

  // also extract full story from luvi ch4 already in detail file
  const d2 = JSON.parse(
    fs.readFileSync(
      'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/scripts/_tmp_b727_detail2.json',
      'utf8'
    )
  );
  for (const x of d2) {
    if (x.url && x.url.includes('VJ01001863')) {
      console.log('CH4 STORY\n', x.text.slice(0, 2500));
    }
    if (x.url && x.url.includes('腐界')) {
      console.log('FUKAI\n', x.text.slice(0, 1500));
    }
    if (x.url && x.url.includes('girls') && x.url.includes('XL')) {
      console.log('XL girls\n', x.text.slice(0, 1500));
    }
  }

  fs.writeFileSync(
    'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/scripts/_tmp_b727_detail3.json',
    JSON.stringify(out, null, 2),
    'utf8'
  );
  console.log('done');
})();
