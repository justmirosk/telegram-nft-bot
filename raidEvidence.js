const PREVIEW_ORIGIN = 'https://gems-testnet.beaniscrolls.site'
const TRIBES = new Set(['avira', 'polaris', 'binara', 'solara'])
const PRODUCTION_ORIGINS = new Set(['https://www.beaniscrolls.com', 'https://beaniscrolls.com', 'https://beaniscrolls.site'])
const TOKEN_COUNT = 101
const BATCH_SIZE = 8

function createRaidEvidence({ nftService, secret, accountLookup, profile, fetcher = fetch }) {
  let accountOrigin = PREVIEW_ORIGIN
  let accountSecret = secret
  if (accountLookup) {
    accountOrigin = new URL(accountLookup.url).origin
    if (!PRODUCTION_ORIGINS.has(accountOrigin) || !accountLookup.secret) {
      throw new Error('Invalid shared BeaniScrolls account lookup')
    }
    if (accountOrigin === 'https://beaniscrolls.com') accountOrigin = 'https://www.beaniscrolls.com'
    accountSecret = accountLookup.secret
  }
  async function lookup(path, key, value, headers = {}, origin = PREVIEW_ORIGIN) {
    const url = new URL(path, origin)
    url.searchParams.set(key, value)
    const response = await fetcher(url, {
      headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) throw new Error('BeaniScrolls lookup HTTP ' + response.status)
    return response.json()
  }

  async function linkedWallet(player) {
    const profile = await lookup('/api/connected-accounts/telegram/citizen', 'telegramUserId', player,
      { Authorization: 'Bearer ' + accountSecret }, accountOrigin)
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

  async function victoryFighter(token, wallet) {
    const origin = profile?.live ? accountOrigin : PREVIEW_ORIGIN
    async function read(path, params) {
      try {
        const url = new URL(path, origin)
        url.search = new URLSearchParams(params)
        const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(5000) })
        return response.ok ? await response.json() : null
      } catch {
        return null
      }
    }
    const [metadata, overrides] = await Promise.all([
      read('/api/nfts', { chain: 'bnb', tokenId: token }),
      wallet ? read('/api/minibeany-holder-overrides', { address: wallet }) : null,
    ])
    const entries = Array.isArray(overrides?.overrides) ? overrides.overrides : []
    const nickname = entries.find(entry => String(entry?.token_id) === token)?.nickname
    const cachedUrl = metadata?.nft?.image?.cachedUrl
    const image = typeof cachedUrl === 'string' && /^https:\/\/nft2-cdn\.alchemy\.com\/bnb-mainnet\/[a-z0-9_-]+$/i.test(cachedUrl)
      ? cachedUrl : null
    return { image, nickname: typeof nickname === 'string' ? Array.from(nickname.trim()).slice(0, 80).join('') : '' }
  }

  return {
    victoryFighter,
    profileSelection: profile && (async wallet => {
      const data = await lookup('/api/boss-raid/profile', 'address', wallet, { Authorization: 'Bearer ' + profile.key }, profile.live ? accountOrigin : PREVIEW_ORIGIN)
      if ((data.tribe !== null && !TRIBES.has(data.tribe))
        || !Array.isArray(data.eligible) || !data.eligible.every(token => typeof token === 'string' && /^(0|[1-9][0-9]?|100)$/.test(token))
        || data.chainId !== Number(nftService.chainId) || data.contract?.toLowerCase() !== nftService.contractAddress.toLowerCase()) {
        throw new Error('Invalid raid Profile evidence')
      }
      const token = profile.readToken(wallet)
      return { eligible: data.eligible, token: data.eligible.includes(token) ? token : null, tribe: data.tribe }
    }),
    usesSharedAccounts: Boolean(accountLookup),
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
    async verify(player, token, openingBlock, wallet, captureTribe, selection) {
      const confirmedBlock = await nftService.getFinalizedMiniBeanyBlock()
      if (BigInt(confirmedBlock) < BigInt(openingBlock)) throw new Error('Finalized RPC state is stale')
      const openingOwner = profile?.live ? null : await owner(token, openingBlock)
      const confirmedOwner = !profile?.live && confirmedBlock === openingBlock ? openingOwner : await owner(token, confirmedBlock)
      const tribe = captureTribe && (profile?.live || openingOwner === wallet) && confirmedOwner === wallet
        ? selection?.tribe ?? await representedTribe(wallet)
        : null
      if (await linkedWallet(player) !== wallet) return null
      return { wallet, token, openingOwner, confirmedOwner, openingBlock, confirmedBlock, tribe }
    },
  }
}

module.exports = { createRaidEvidence }
