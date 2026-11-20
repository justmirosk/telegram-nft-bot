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
    const page = await browser.newPage({ viewport: { width: 750, height: 1050 }, deviceScaleFactor: 1 })
    await page.goto(renderUrl(base, wallet), { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.locator('main > div').first().waitFor({ state: 'visible', timeout: 30000 })
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
    // The QR is populated in a React effect. Wait until it appears.
    await page.locator('img[alt="QR code linking to the public BeaniWorld profile"]').waitFor({ timeout: 15000 })
    const image = await page.locator('main > div').first().screenshot({ type: 'png', animations: 'disabled', timeout: 20000 })
    if (!image.length || image.length > 5 * 1024 * 1024) throw new Error('Citizen card PNG size invalid')
    return image
  } finally {
    await browser.close()
  }
}
module.exports = { renderUrl, captureCitizenCard }
