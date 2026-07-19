import fs from 'fs'
function strip(h) {
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
}
for (const f of ['_tmp_jzdh_m.html', '_tmp_xhzz_m.html']) {
  const t = strip(fs.readFileSync(f, 'utf8'))
  console.log('====', f, t.length)
  for (const key of ['简介', '作者', '丁松言', '方羽', '山海', '宵明', '目录', '最新章节']) {
    const i = t.indexOf(key)
    if (i >= 0) console.log(key, '->', t.slice(Math.max(0, i - 20), i + 400))
  }
  console.log(t.slice(0, 2000))
}
