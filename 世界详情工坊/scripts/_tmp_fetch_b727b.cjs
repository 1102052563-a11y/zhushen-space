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
    .replace(/\s+/g, ' ');
}

(async () => {
  const urls = [
    'https://www.dlsite.com/pro/work/=/product_id/VJ01001863.html',
    'https://www.dlsite.com/pro/work/=/product_id/VJ01001848.html',
    'https://www.dlsite.com/pro/work/=/product_id/VJ01001851.html',
    'https://www.dlsite.com/pro/work/=/product_id/VJ01001857.html',
    'https://www.dlsite.com/pro/fsr/=/keyword/%E3%82%8A%E3%81%A8%E3%82%8B%E5%A4%A7%E5%AE%B6%E3%81%95%E3%82%93',
    'https://www.dlsite.com/pro/fsr/=/keyword/%E5%A5%B3%E5%8C%BB',
    'https://www.dlsite.com/pro/fsr/=/keyword/%E5%84%AA%E7%AD%89%E7%94%9F',
    'https://www.dlsite.com/pro/fsr/=/keyword/Love%20%C3%97%20Holic',
    'https://www.dlsite.com/pro/fsr/=/keyword/Love%C3%97Holic',
    'https://www.dlsite.com/maniax/fsr/=/keyword/Love%C3%97Holic',
    'https://www.dlsite.com/girls/fsr/=/keyword/XL%E4%B8%8A%E5%8F%B8%E3%80%82',
    'https://www.dlsite.com/books/fsr/=/keyword/%E8%85%90%E7%95%8C%E3%81%AB%E7%9C%A0%E3%82%8B',
    'https://www.dlsite.com/maniax/fsr/=/keyword/ABADDON',
    'https://myanimelist.net/anime/37223/Ore_ga_Kanojo_wo_su_Wake',
    'https://myanimelist.net/anime/37223/Ore_ga_Kanojo_wo_su_Wake/characters',
    'https://api.jikan.moe/v4/anime/37223/full',
    'https://api.jikan.moe/v4/anime/37223/characters',
    'https://api.jikan.moe/v4/anime/37223/episodes',
    'https://api.jikan.moe/v4/anime?q=Dokidoki%20Little%20Ooyasan&sfw=false',
    'https://api.jikan.moe/v4/anime?q=Ochi%20Mono%20RPG&sfw=false',
    'https://api.jikan.moe/v4/anime?q=Kiss%20Hug&sfw=false',
    'https://api.jikan.moe/v4/anime?q=Love%20Holic&sfw=false',
    'https://api.jikan.moe/v4/anime?q=Kanojo%20no%20Shinsatsu&sfw=false',
    'https://api.jikan.moe/v4/anime?q=Yuutousei%20Kaede&sfw=false',
    'https://api.jikan.moe/v4/anime?q=Venus%20Blood%20BRAVE&sfw=false',
    'https://api.jikan.moe/v4/manga?q=XL%E4%B8%8A%E5%8F%B8&sfw=false',
    'https://api.jikan.moe/v4/manga?q=ABADDON&sfw=false',
  ];
  const out = [];
  for (const u of urls) {
    try {
      const r = await get(u);
      const isJson = u.includes('jikan') || u.includes('api.');
      out.push({
        url: u,
        status: r.status,
        text: isJson ? r.body.slice(0, 8000) : strip(r.body).slice(0, 4000),
      });
      console.log('OK', r.status, u.slice(-50));
    } catch (e) {
      out.push({ url: u, err: e.message });
      console.log('ERR', e.message, u.slice(-40));
    }
  }
  fs.writeFileSync(
    'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/scripts/_tmp_b727_detail2.json',
    JSON.stringify(out, null, 2),
    'utf8'
  );
  console.log('done');
})();
