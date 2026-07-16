const fs = require('fs');
function parse(f) {
  const h = fs.readFileSync(f, 'utf8');
  const title = (h.match(/<title>([^<]+)/) || [])[1] || '';
  const og = (h.match(/property="og:title" content="([^"]+)/) || [])[1] || '';
  const desc = (h.match(/name="description" content="([^"]+)/) || [])[1] || '';
  const text = h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 2500);
  console.log('FILE', f);
  console.log('TITLE', title);
  console.log('OG', og);
  console.log('DESC', desc.slice(0, 300));
  console.log('TEXT', text.slice(0, 800));
  console.log('---');
}
for (const f of process.argv.slice(2)) parse(f);
