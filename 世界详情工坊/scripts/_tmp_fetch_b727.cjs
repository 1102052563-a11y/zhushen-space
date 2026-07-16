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
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ');
}

(async () => {
  const ids = [
    'VJ01001851',
    'VJ01001863',
    'VJ01001857',
    'VJ01001848',
    'RJ168428',
    'RJ336381',
    'RJ279368',
    'RJ284003',
    'RJ279425',
    'RJ004044',
    'VJ014354',
    'BJ217573',
    'RJ127232',
  ];
  const floors = {
    VJ: 'pro',
    BJ: 'books',
    RJ: 'maniax',
  };
  const out = [];
  for (const id of ids) {
    const floor = floors[id.slice(0, 2)] || 'pro';
    const u = `https://www.dlsite.com/${floor}/work/=/product_id/${id}.html`;
    try {
      const r = await get(u);
      const t = strip(r.body);
      // extract title near product
      const titleMatch = t.match(/([\u3040-\u30ff\u4e00-\u9fffA-Za-z0-9×・～〜\-\s「」『』!！?？♡♥]{4,80})\s*\[/);
      out.push({ id, status: r.status, url: u, text: t.slice(0, 3500) });
      console.log('OK', id, r.status, t.slice(0, 120).replace(/\s+/g, ' '));
    } catch (e) {
      out.push({ id, err: e.message });
      console.log('ERR', id, e.message);
    }
  }

  // more search URLs
  const more = [
    'https://www.dlsite.com/pro/work/=/product_id/VJ01001851.html',
    'https://www.dlsite.com/pro/fsr/=/keyword/%E5%A0%95%E3%81%A1%E3%83%A2%E3%83%8ERPG%20%E8%81%96%E9%A8%8E%E5%A3%AB',
    'https://www.dlsite.com/pro/fsr/=/keyword/%E3%82%8A%E3%81%A8%E3%82%8B%E5%A4%A7%E5%AE%B6',
    'https://www.dlsite.com/pro/fsr/=/keyword/%E5%A5%B3%E5%8C%BB%E3%81%AE%E8%A8%BA%E5%AF%9F%E6%97%A5%E8%AA%8C',
    'https://www.dlsite.com/pro/fsr/=/keyword/%E8%BB%A2%E3%81%8C%E3%82%8A%E5%A0%95%E3%81%A1%E3%82%8B%E5%A6%82%E9%9B%A8%E9%9C%B2',
    'https://www.dlsite.com/books/fsr/=/keyword/%E8%85%90%E7%95%8C%E3%81%AB%E7%9C%A0%E3%82%8B%E7%8E%8B%E5%A5%B3',
    'https://www.dlsite.com/girls/fsr/=/keyword/XL%E4%B8%8A%E5%8F%B8',
    'https://www.dlsite.com/maniax/fsr/=/keyword/Love%C3%97Holic',
    'https://myanimelist.net/anime.php?q=OchiMono&cat=anime',
    'https://myanimelist.net/anime.php?q=Seikishi%20Luvyrias&cat=anime',
    'https://myanimelist.net/anime.php?q=Kanojo%20no%20Shinsatsu&cat=anime',
    'https://myanimelist.net/anime.php?q=mitsumeru%20yuutousei&cat=anime',
    'https://myanimelist.net/anime.php?q=dokidoki%20ritoru&cat=anime',
    'https://ja.wikipedia.org/wiki/VenusBlood#ストーリー',
  ];
  for (const u of more) {
    try {
      const r = await get(u);
      out.push({ key: u.slice(-50), status: r.status, url: u, text: strip(r.body).slice(0, 3000) });
      console.log('OK more', r.status, u.slice(-40));
    } catch (e) {
      out.push({ key: u, err: e.message });
    }
  }

  fs.writeFileSync(
    'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/scripts/_tmp_b727_detail.json',
    JSON.stringify(out, null, 2),
    'utf8'
  );
  console.log('done', out.length);
})();
