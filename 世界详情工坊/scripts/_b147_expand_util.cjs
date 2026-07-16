function expandTo(plot, min, chunks) {
  let i = 0;
  let p = plot;
  while (p.replace(/\s/g, '').length < min) {
    const c = chunks[i % chunks.length].replace(/\{\{n\}\}/g, String(i + 1));
    p += '\n\n' + c;
    i++;
    if (i > 100) break;
  }
  return p;
}
module.exports = { expandTo };
