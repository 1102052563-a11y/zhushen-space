/**
 * 萌娘百科文字抓取（MediaWiki API，避免整页 HTML / JS 门槛）
 *
 * 用法:
 *   node _fetch_moegirl.cjs "夏日重现"
 *   node _fetch_moegirl.cjs "https://zh.moegirl.org.cn/夏日重现"
 *   node _fetch_moegirl.cjs "夏日重现" "棕色尘埃" -o ../_tmp_moegirl
 *   node _fetch_moegirl.cjs --file titles.txt -o out_dir
 *
 * 输出: <out>/<slug>.txt  （标题 + 纯文本正文）
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const API = 'https://zh.moegirl.org.cn/api.php';
const UA = 'ZhushenSpaceResearchBot/1.0 (local offline research; +https://localhost)';
const DELAY_MS = 800; // 礼貌间隔，避免打爆站点

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        timeout: 30000,
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const loc = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          getJson(loc).then(resolve, reject);
          return;
        }
        let d = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            reject(new Error('JSON parse fail: ' + d.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

/** URL 或标题 → 条目标题 */
function toTitle(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      // /wiki/Title 或 /Title
      let p = u.pathname.replace(/^\/wiki\//, '/').replace(/^\//, '');
      p = decodeURIComponent(p.replace(/_/g, ' '));
      return p;
    } catch {
      return s;
    }
  }
  return s.replace(/_/g, ' ');
}

function safeSlug(title) {
  return title
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
}

/** 萌娘封了 list=search，用 opensearch 纠名 */
async function searchTitle(query) {
  // 去掉括号消歧义后缀再搜，提升命中
  const q = query.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim() || query;
  const params = new URLSearchParams({
    action: 'opensearch',
    search: q,
    limit: '8',
    namespace: '0',
    format: 'json',
  });
  const data = await getJson(`${API}?${params}`);
  // opensearch: [query, [titles], [descs], [urls]]
  return Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
}

function normalizeColon(s) {
  // 全角冒号/分号 → 半角（Re：从零… 常见写法差）
  return s.replace(/：/g, ':').replace(/；/g, ';');
}

async function fetchExtractOnce(title) {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts|info',
    explaintext: '1',
    exsectionformat: 'plain',
    redirects: '1',
    titles: title,
    inprop: 'url',
    format: 'json',
    formatversion: '2',
  });
  const data = await getJson(`${API}?${params}`);
  const page = data?.query?.pages?.[0];
  if (!page) throw new Error('empty query.pages');
  if (page.missing) return null;
  return {
    pageid: page.pageid,
    title: page.title,
    url: page.fullurl || `https://zh.moegirl.org.cn/${encodeURIComponent(page.title)}`,
    extract: (page.extract || '').trim(),
  };
}

async function fetchExtract(title) {
  const candidates = [title];
  const alt = normalizeColon(title);
  if (alt !== title) candidates.push(alt);
  const bare = title.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();
  if (bare && bare !== title) candidates.push(bare);

  for (const c of candidates) {
    const hit = await fetchExtractOnce(c);
    if (hit) return c === title ? hit : { ...hit, resolvedFrom: title, searchHits: candidates };
  }

  const hits = await searchTitle(title);
  if (!hits.length) throw new Error('missing page: ' + title);
  const key = bare.replace(/\s/g, '').slice(0, 4);
  const pick =
    hits.find((h) => h === bare || h === alt) ||
    hits.find((h) => key && h.replace(/\s/g, '').includes(key)) ||
    hits[0];
  const hit = await fetchExtractOnce(pick);
  if (!hit) throw new Error('missing page: ' + title + ' (search→' + pick + ')');
  return { ...hit, resolvedFrom: title, searchHits: hits };
}

function parseArgs(argv) {
  const titles = [];
  let outDir = path.join(__dirname, '..', '_tmp_moegirl');
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') {
      outDir = argv[++i];
    } else if (a === '--file' || a === '-f') {
      file = argv[++i];
    } else if (a === '-h' || a === '--help') {
      console.log(`用法:
  node _fetch_moegirl.cjs <标题|URL> [更多...] [-o 输出目录]
  node _fetch_moegirl.cjs -f titles.txt -o out_dir`);
      process.exit(0);
    } else if (!a.startsWith('-')) {
      titles.push(a);
    }
  }
  if (file) {
    const lines = fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, '').trim())
      .filter(Boolean);
    titles.push(...lines);
  }
  return { titles, outDir };
}

(async () => {
  const { titles: raw, outDir } = parseArgs(process.argv.slice(2));
  if (!raw.length) {
    console.error('请提供至少一个标题或 URL。用 -h 看帮助。');
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const titles = [...new Set(raw.map(toTitle).filter(Boolean))];
  console.log(`共 ${titles.length} 条 → ${outDir}`);

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < titles.length; i++) {
    const t = titles[i];
    process.stdout.write(`[${i + 1}/${titles.length}] ${t} ... `);
    try {
      const r = await fetchExtract(t);
      const via = r.resolvedFrom ? ` (via search←${r.resolvedFrom})` : '';
      const body =
        `# ${r.title}\n` +
        `url: ${r.url}\n` +
        `pageid: ${r.pageid}\n` +
        `chars: ${r.extract.length}\n` +
        (r.resolvedFrom ? `query: ${r.resolvedFrom}\n` : '') +
        (r.searchHits ? `search_hits: ${r.searchHits.join(' | ')}\n` : '') +
        `\n` +
        r.extract +
        `\n`;
      const fp = path.join(outDir, safeSlug(r.title) + '.txt');
      fs.writeFileSync(fp, body, 'utf8');
      console.log(`OK ${r.extract.length}字 → ${path.basename(fp)}${via}`);
      ok++;
    } catch (e) {
      console.log('ERR', e.message);
      fail++;
    }
    if (i < titles.length - 1) await sleep(DELAY_MS);
  }
  console.log(`\n完成: ok=${ok} fail=${fail} out=${outDir}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
