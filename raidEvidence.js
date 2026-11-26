const PREVIEW_ORIGIN = 'https://gems-testnet.beaniscrolls.site'
const TRIBES = new Set(['avira', 'polaris', 'binara', 'solara'])
const TOKEN_COUNT = 101
const BATCH_SIZE = 8

function createRaidEvidence({ nftService, secret, fetcher = fetch }) {
  async function lookup(path, key, value, headers = {}) {
    const url = new URL(path, PREVIEW_ORIGIN)
    url.searchParams.set(key, value)
    const response = await fetcher(url, {
      headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) throw new Error('BeaniScrolls Preview lookup HTTP ' + response.status)
    return response.json()
  }

  async function linkedWallet(player) {
    const profile = await lookup('/api/connected-accounts/telegram/citizen', 'telegramUserId', player,
      { Authorization: 'Bearer ' + secret })
    if (profile.linked === false) return null
    if (profile.linked !== true || !/^0x[0-9a-f]{40}$/i.test(profile.wallet)) {
      throw new Error('Invalid verified wallet response')
    }
    return profile.wallet.toLowerCase()
  }

  async function representedTribe(wallet) {
    const { representedTribe: tribe } = await lookup('/api/represented-tribe', 'address', wallet)
    if (tribe !== null && !TRIBES.has(tribe)) throw new Error('Invalid Tribe response')
    return tribe
  }

  async function owner(token, block) {
    return (await nftService.getHolderAtBlock(token, block)).toLowerCase()
  }

  return {
    async openingBlock() {
      const block = await nftService.getFinalizedMiniBeanyBlock()
      await owner('0', block)
      return block
    },
    async link(player, username, code) {
      const response = await fetcher(new URL('/api/connected-accounts/telegram', PREVIEW_ORIGIN), {
        method: 'PUT', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret },
        body: JSON.stringify({ code, telegramUserId: player, username }),
      })
      if (!response.ok && ![400, 409].includes(response.status)) throw new Error('Preview linking unavailable')
      return response.ok
    },
    linkedWallet,
    async eligibleTokens(wallet, openingBlock) {
      const current = await nftService.getFinalizedMiniBeanyBlock()
      if (BigInt(current) < BigInt(openingBlock)) throw new Error('Finalized RPC state is stale')
      const owned = []
      for (let start = 0; start < TOKEN_COUNT; start += BATCH_SIZE) {
        const tokens = Array.from({ length: Math.min(BATCH_SIZE, TOKEN_COUNT - start) },
          (_, index) => String(start + index))
        const eligible = await Promise.all(tokens.map(async token => {
          const openedWith = await owner(token, openingBlock)
          return openedWith === wallet && (current === openingBlock || await owner(token, current) === wallet)
        }))
        owned.push(...tokens.filter((_, index) => eligible[index]))
      }
      return owned
    },
    async verify(player, token, openingBlock, wallet, captureTribe) {
      const confirmedBlock = await nftService.getFinalizedMiniBeanyBlock()
      if (BigInt(confirmedBlock) < BigInt(openingBlock)) throw new Error('Finalized RPC state is stale')
      const openingOwner = await owner(token, openingBlock)
      const confirmedOwner = confirmedBlock === openingBlock ? openingOwner : await owner(token, confirmedBlock)
      const tribe = captureTribe && openingOwner === wallet && confirmedOwner === wallet
        ? await representedTribe(wallet)
        : null
      if (await linkedWallet(player) !== wallet) return null
      return { wallet, token, openingOwner, confirmedOwner, openingBlock, confirmedBlock, tribe }
    },
  }
}

module.exports = { createRaidEvidence }
