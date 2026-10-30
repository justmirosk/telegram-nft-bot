const TRIBES = ['Avarai', 'Polarim', 'Binarai', 'Solarim', 'All Four Tribes'];
const baseUrl = (process.env.BEANISCROLLS_URL || 'https://beaniscrolls.site').replace(/\/$/, '');

async function getTribeLine(tokenId, fetcher = fetch) {
  if (Number(tokenId) === 99) return '🚩 Tribe: Hidden\n💎 Gem: Hidden';
  try {
    const response = await fetcher(baseUrl + '/api/nft-affinities', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Lookup failed');
    const data = await response.json();
    if (!data.affinities || typeof data.affinities !== 'object' || Array.isArray(data.affinities)) throw new Error('Invalid response');
    if (!Object.prototype.hasOwnProperty.call(data.affinities, String(tokenId))) return '🚩 Tribe: Not yet revealed\n💎 Gem: Not claimed yet';
    const gem = data.affinities[String(tokenId)];
    if (!Number.isInteger(gem) || !TRIBES[gem]) throw new Error('Invalid tribe');
    return '🚩 Tribe: ' + TRIBES[gem] + '\n💎 Gem: Claimed';
  } catch {
    return '🚩 Tribe: Temporarily unavailable\n💎 Gem: Temporarily unavailable';
  }
}
function detailUrl(tokenId) {
  return baseUrl + '/nft/' + encodeURIComponent(tokenId);
}
module.exports = { getTribeLine, detailUrl };
