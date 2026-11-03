// Markers switch paragraph style until the next marker. Unmarked posts stay literal.
const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function formatAnnouncement(source) {
  const marker = /\[(h|p|i)\]/g;
  if (!marker.test(source)) return { text: source, plainText: source, options: {} };
  marker.lastIndex = 0;
  const blocks = [];
  let style = 'p', start = 0, match;
  const append = end => {
    const text = source.slice(start, end).trim();
    if (text) blocks.push({ style, text });
  };
  while ((match = marker.exec(source))) {
    append(match.index);
    style = match[1]; start = marker.lastIndex;
  }
  append(source.length);
  return {
    plainText: blocks.map(block => block.text).join('\n\n'),
    text: blocks.map(({ style, text }) => {
      const escaped = escapeHtml(text);
      return style === 'h' ? `<b>${escaped}</b>` : style === 'i' ? `<i>${escaped}</i>` : escaped;
    }).join('\n\n'),
    options: { parse_mode: 'HTML' },
  };
}
module.exports = { formatAnnouncement };
