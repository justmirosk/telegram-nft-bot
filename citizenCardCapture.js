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
    // Decorative Telegram-only overlay. Keep the original React Citizen Card and QR
    // untouched; the frame is composited in the browser immediately before capture.
    await page.locator('main > div').first().evaluate((card) => {
      card.style.position = 'relative'
      const frame = document.createElement('div')
      frame.setAttribute('aria-hidden', 'true')
      frame.style.cssText = 'position:absolute;inset:0;z-index:100;pointer-events:none;overflow:hidden;'
      frame.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 750 1050" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true">
        <defs>
          <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8c4b0b"/><stop offset=".18" stop-color="#ffeaa1"/><stop offset=".38" stop-color="#d99420"/><stop offset=".55" stop-color="#fff4bd"/><stop offset=".75" stop-color="#b96b0c"/><stop offset="1" stop-color="#f5cc65"/></linearGradient>
          <linearGradient id="violet" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f1d0ff"/><stop offset=".55" stop-color="#7930b9"/><stop offset="1" stop-color="#2c0e55"/></linearGradient>
          <filter id="shine" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>
          <g id="corner" fill="none" stroke="url(#gold)" stroke-linejoin="round">
            <path d="M 9 90 Q 12 34 34 12 Q 58 10 90 9 L 66 19 Q 36 20 24 42 Q 20 58 19 66 Z" fill="#291039" stroke-width="3"/>
            <path d="M 10 60 Q 26 12 60 10 M 17 85 Q 24 25 85 17" stroke-width="2"/>
            <path d="M 12 13 L 31 21 L 21 31 Z M 34 12 L 43 28 L 27 43 L 12 34 Z" fill="url(#gold)" stroke-width="2"/>
            <path d="M 27 27 L 35 18 L 43 27 L 35 36 Z" fill="url(#violet)" stroke="#fff1ad" stroke-width="2"/>
            <path d="M 16 68 Q 34 46 56 42 M 42 56 Q 46 34 68 16" stroke-width="2"/>
          </g>
        </defs>
        <rect x="9" y="9" width="732" height="1032" rx="23" fill="none" stroke="#663309" stroke-width="13"/>
        <rect x="9" y="9" width="732" height="1032" rx="23" fill="none" stroke="url(#gold)" stroke-width="6"/>
        <rect x="18" y="18" width="714" height="1014" rx="17" fill="none" stroke="#f8d37d" stroke-opacity=".75" stroke-width="1.5"/>
        <g stroke="url(#gold)" stroke-width="3" fill="#291039">
          <path d="M 350 10 L 375 32 L 400 10 L 388 35 L 375 49 L 362 35 Z"/>
          <path d="M 350 1040 L 375 1018 L 400 1040 L 388 1015 L 375 1001 L 362 1015 Z"/>
          <path d="M 10 503 L 31 525 L 10 547 L 34 537 L 48 525 L 34 513 Z"/>
          <path d="M 740 503 L 719 525 L 740 547 L 716 537 L 702 525 L 716 513 Z"/>
        </g>
        <g fill="url(#violet)" stroke="#fff0ad" stroke-width="2"><path d="M375 18 l10 14 -10 14 -10 -14 Z"/><path d="M375 1004 l10 14 -10 14 -10 -14 Z"/><path d="M18 525 l12 -11 12 11 -12 11 Z"/><path d="M732 525 l-12 -11 -12 11 12 11 Z"/></g>
        <use href="#corner"/><use href="#corner" transform="translate(750 0) scale(-1 1)"/>
        <use href="#corner" transform="translate(0 1050) scale(1 -1)"/><use href="#corner" transform="translate(750 1050) scale(-1 -1)"/>
      </svg>`
      card.appendChild(frame)
    })
    const image = await page.locator('main > div').first().screenshot({ type: 'png', animations: 'disabled', timeout: 20000 })
    if (!image.length || image.length > 5 * 1024 * 1024) throw new Error('Citizen card PNG size invalid')
    return image
  } finally {
    await browser.close()
  }
}
module.exports = { renderUrl, captureCitizenCard }
