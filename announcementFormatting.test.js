const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatAnnouncement } = require('./announcementFormatting');

test('markers style paragraphs and preserve multiline body and blank lines', () => {
  const source = "[h]NFT Show Today\n[p]We are starting at 8:00 UTC. Don't forget to join us.\nBeaniWorld Tournament after.\n[i]Miro";
  const formatted = formatAnnouncement(source);
  assert.equal(formatted.text, "<b>NFT Show Today</b>\n\nWe are starting at 8:00 UTC. Don't forget to join us.\nBeaniWorld Tournament after.\n\n<i>Miro</i>");
  assert.deepEqual(formatted.options, { parse_mode: 'HTML' });
  assert.equal(formatAnnouncement('[h]First\n\nStill bold[p]Normal[i]Italic[p]Normal again').text,
    '<b>First\n\nStill bold</b>\n\nNormal\n\n<i>Italic</i>\n\nNormal again');
});
test('literal text, HTML characters, emoji and empty markers are handled safely', () => {
  const literal = '<b>Literal</b> & **stars**\n\nUnknown [x]marker';
  assert.deepEqual(formatAnnouncement(literal), { text: literal, plainText: literal, options: {} });
  assert.equal(formatAnnouncement('Intro[h]🌮 <Show> & Friends[p]<i>normal</i>').text,
    'Intro\n\n<b>🌮 &lt;Show&gt; &amp; Friends</b>\n\n&lt;i&gt;normal&lt;/i&gt;');
  assert.equal(formatAnnouncement('[h]\n[p]  [i]').plainText, '');
});
