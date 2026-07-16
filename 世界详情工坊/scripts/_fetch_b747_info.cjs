const https = require('https');
const fs = require('fs');

function get(u) {
  return new Promise((res, rej) => {
    https
      .get(
        u,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'text/html,application/xhtml+xml',
          },
        },
        (r) => {
          let d = '';
          r.on('data', (c) => (d += c));
          r.on('end', () => res({ status: r.statusCode, body: d, headers: r.headers }));
        }
      )
      .on('error', rej);
  });
}

function clean(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchWork(id, floor = 'pro') {
  const u = `https://www.dlsite.com/${floor}/work/=/product_id/${id}.html`;
  const r = await get(u);
  const b = r.body;
  const title = (b.match(/<title[^>]*>([^<]+)/) || [])[1] || '';
  const og = (b.match(/property="og:description"\s+content="([^"]*)"/) || [])[1] || '';
  const outlineMatch = b.match(/id="work_outline"[\s\S]*?<\/table>/i);
  const outline = outlineMatch ? clean(outlineMatch[0]).slice(0, 1200) : '';
  const storyMatch =
    b.match(/作品内容[\s\S]*?<div[^>]*class="work_parts"[^>]*>([\s\S]*?)<\/div>/i) ||
    b.match(/class="work_story"[\s\S]*?>([\s\S]*?)<\/div>/i) ||
    b.match(/itemprop="description"[^>]*>([\s\S]*?)<\/div>/i);
  const story = storyMatch ? clean(storyMatch[1] || storyMatch[0]).slice(0, 2000) : '';
  const makers = [...b.matchAll(/maker_name[\s\S]*?<a[^>]*>([^<]+)/g)].map((m) => m[1].trim());
  const genres = [...b.matchAll(/work\.genre[^>]*>([^<]+)/g)].map((m) => m[1].trim());
  return {
    id,
    floor,
    status: r.status,
    title: clean(title),
    og: clean(og),
    outline,
    story,
    makers: makers.slice(0, 5),
    genres: genres.slice(0, 20),
    url: u,
  };
}

async function search(keyword, floor = 'pro') {
  const u = `https://www.dlsite.com/${floor}/fsr/=/language/jp/keyword/${encodeURIComponent(
    keyword
  )}`;
  const r = await get(u);
  const ids = [...r.body.matchAll(/product_id\/([A-Z0-9]+)\.html/g)].map((m) => m[1]);
  const uniq = [...new Set(ids)].slice(0, 8);
  const names = [
    ...r.body.matchAll(/class="work_name"[\s\S]*?<a[^>]*>([^<]+)/g),
  ].map((m) => clean(m[1]));
  return { keyword, floor, status: r.status, ids: uniq, names: names.slice(0, 8), url: u };
}

(async () => {
  const out = { searches: [], works: [] };
  const searches = [
    ['琥珀色のHUNTER', 'pro'],
    ['琥珀色のHUNTER', 'maniax'],
    ['Knight of Erin', 'pro'],
    ['Knight of Erin', 'maniax'],
    ['背徳の境界', 'pro'],
    ['遠い君に、僕は届かない', 'pro'],
    ['遠い君に、僕は届かない', 'maniax'],
    ['S家に嫁いだM嬢', 'pro'],
    ['S家に嫁いだM嬢', 'maniax'],
    ['トイレの花子さんVS屈強退魔師', 'pro'],
    ['トイレの花子さんVS屈強退魔師', 'maniax'],
    ['自宅警備員2 詩絵里', 'pro'],
    ['自宅警備員2 詩絵里', 'maniax'],
  ];
  for (const [k, f] of searches) {
    try {
      const s = await search(k, f);
      out.searches.push(s);
      console.log('search', k, f, s.ids.join(','), s.names[0] || '');
    } catch (e) {
      out.searches.push({ keyword: k, floor: f, error: e.message });
      console.log('search err', k, e.message);
    }
  }
  const workIds = [
    ['VJ01001904', 'pro'],
    ['RJ220370', 'maniax'],
    ['RJ319725', 'maniax'],
    ['RJ320930', 'maniax'],
    ['RJ228459', 'maniax'],
  ];
  // add first ids from searches
  for (const s of out.searches) {
    if (s.ids && s.ids[0]) {
      const floor = s.floor || 'pro';
      const id = s.ids[0];
      if (!workIds.some((w) => w[0] === id)) workIds.push([id, floor]);
    }
  }
  for (const [id, floor] of workIds.slice(0, 20)) {
    try {
      const w = await fetchWork(id, floor);
      out.works.push(w);
      console.log('work', id, w.title.slice(0, 60), 'story', w.story.slice(0, 80));
    } catch (e) {
      out.works.push({ id, floor, error: e.message });
      console.log('work err', id, e.message);
    }
  }
  const path = 'C:/Users/Administrator/Desktop/前端卡/files/世界详情工坊/_tmp_b747_info.json';
  fs.writeFileSync(path, JSON.stringify(out, null, 2), 'utf8');
  console.log('wrote', path);
})();
