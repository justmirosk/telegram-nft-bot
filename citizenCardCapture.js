// Capture the actual BeaniScrolls React Citizen Card instead of recreating its design.
// The browser renders the same component used by the website, with hideFrame enabled.

function renderUrl(base, wallet) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) throw new Error('Invalid citizen wallet')
  const url = new URL(base)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('HTTPS required')
  url.pathname = '/telegram/citizen-card/' + wallet
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function captureCitizenCard(base, wallet) {
  const { chromium } = require('playwright-core')
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  try {
    const target = renderUrl(base, wallet)
    const page = await browser.newPage({ viewport: { width: 750, height: 1050 }, deviceScaleFactor: 1 })
    // Keep the short-lived Preview credential on the target origin only.
    // Images and scripts may be hosted on unrelated domains.
    if (process.env.VERCEL_OIDC_TOKEN) {
      const targetOrigin = new URL(target).origin
      await page.route('**/*', (route) => {
        const request = route.request()
        if (new URL(request.url()).origin !== targetOrigin) return route.continue()
        return route.continue({ headers: {
          ...request.headers(),
          'x-vercel-trusted-oidc-idp-token': process.env.VERCEL_OIDC_TOKEN,
        } })
      })
    }
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 })
    if (!await page.locator('img[alt="QR code linking to the public BeaniWorld profile"]').count()) {
      console.log('Citizen render diagnostic:', JSON.stringify({
        url: page.url(), title: await page.title(),
        body: (await page.locator('body').innerText()).slice(0, 300),
      }))
    }
    if (new URL(page.url()).hostname === 'vercel.com') {
      throw new Error('Protected Vercel Preview requires authenticated browser access; refusing to screenshot login page')
    }
    await page.locator('main > div').first().waitFor({ state: 'visible', timeout: 30000 })
    // QR is generated after hydration; it must exist before image checks.
    const qr = page.locator('img[alt="QR code linking to the public BeaniWorld profile"]')
    await qr.waitFor({ state: 'visible', timeout: 15000 })
    await page.evaluate(async () => {
      await document.fonts.ready
      const images = [...document.querySelectorAll('main img')]
      await Promise.all(images.map(async (img) => {
        img.loading = 'eager'
        if (!img.complete) await new Promise((resolve, reject) => {
          img.addEventListener('load', resolve, { once: true })
          img.addEventListener('error', reject, { once: true })
          setTimeout(() => reject(new Error('Card image timeout')), 12000)
        })
        if (!img.naturalWidth) throw new Error('Card image failed to load: ' + img.alt)
      }))
    })
    if (!await qr.evaluate((img) => img.complete && img.naturalWidth > 0)) {
      throw new Error('Citizen Card QR failed to load')
    }
    const image = await page.locator('main > div').first().screenshot({ type: 'png', animations: 'disabled', timeout: 20000 })
    if (!image.length || image.length > 5 * 1024 * 1024) throw new Error('Citizen card PNG size invalid')
    return image
  } finally {
    await browser.close()
  }
}
module.exports = { renderUrl, captureCitizenCard }
