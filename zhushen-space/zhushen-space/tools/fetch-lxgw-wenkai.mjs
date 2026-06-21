// 把霞鹜文楷(LXGW WenKai)分块 webfont 下载到 public/ 内置（不再依赖 jsdelivr CDN，离线可用）。
// 源：lxgw-wenkai-webfont（regular 权重，分块 woff2 + unicode-range，仅渲染到的字形会被浏览器下载）。
// 用法：node tools/fetch-lxgw-wenkai.mjs   （Node 18+，自带 fetch）
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PKG  = process.env.LXGW_PKG || 'lxgw-wenkai-webfont';
const BASE = `https://cdn.jsdelivr.net/npm/${PKG}`;
const CSS_NAME = 'lxgwwenkai-regular.css';
const OUT = 'C:\\Users\\Administrator\\Desktop\\前端卡\\files\\zhushen-space\\zhushen-space\\public\\fonts\\lxgw-wenkai';

const log = (...a) => console.log(...a);

async function main() {
  log('① 拉取字体 CSS：', `${BASE}/${CSS_NAME}`);
  const cssRes = await fetch(`${BASE}/${CSS_NAME}`);
  if (!cssRes.ok) throw new Error(`CSS HTTP ${cssRes.status}`);
  const css = await cssRes.text();

  // 解析所有 url('./files/xxx.woff2') / url(files/xxx.woff2)
  const rels = [...css.matchAll(/url\(\s*['"]?\.?\/?(files\/[^'")]+\.woff2)['"]?\s*\)/g)].map((m) => m[1]);
  const uniq = [...new Set(rels)];
  log(`② CSS 内引用 woff2 分块：${uniq.length} 个`);
  if (!uniq.length) throw new Error('未解析到 woff2，CSS 结构可能变了');

  await mkdir(join(OUT, 'files'), { recursive: true });
  await writeFile(join(OUT, CSS_NAME), css, 'utf8');
  log('③ 已保存 CSS →', join(OUT, CSS_NAME));

  let total = 0, done = 0;
  const BATCH = 12;
  for (let i = 0; i < uniq.length; i += BATCH) {
    const slice = uniq.slice(i, i + BATCH);
    await Promise.all(slice.map(async (rel) => {
      const r = await fetch(`${BASE}/${rel}`);
      if (!r.ok) throw new Error(`${rel} HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      total += buf.length;
      await writeFile(join(OUT, rel), buf);
      done++;
    }));
    log(`   下载中… ${done}/${uniq.length}`);
  }
  log(`✓ 完成：${done} 个文件，合计 ${(total / 1048576).toFixed(2)} MB → ${OUT}`);
}
main().catch((e) => { console.error('✗ 失败：', e.message); process.exit(1); });
