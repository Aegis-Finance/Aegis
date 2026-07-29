import { test, expect } from '@playwright/test'

test.describe.configure({ mode: 'parallel' })

test.describe('Frontend security posture', () => {
  test('home page exposes CSP meta tag and integrity manifest', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.ok()).toBeTruthy()

    const cspMeta = page.locator('meta[http-equiv="Content-Security-Policy"]')
    await expect(cspMeta).toHaveAttribute('content', /default-src 'self'/)

    const manifestResponse = await page.request.get('/manifest.hash.json')
    expect(manifestResponse.ok()).toBeTruthy()
    const manifest = await manifestResponse.json() as { files?: Record<string, string> }
    expect(manifest.files).toBeTruthy()
    const indexHash = manifest.files?.['index.html']
    expect(indexHash).toBeTruthy()
    expect(indexHash).toMatch(/^[a-f0-9]{64}$/)
  })

  test('governance dashboard renders without wallet connected', async ({ page }) => {
    await page.goto('/governance')

    await expect(page.locator('h1', { hasText: 'Governance' })).toBeVisible()
    await expect(page.locator('text=Create proposals, vote')).toBeVisible()
    await expect(page.locator('button', { hasText: /Connect Wallet/i })).toBeVisible()
  })

  test('bridge view guards Sonic Gateway conversion when wallet disconnected', async ({ page }) => {
    await page.goto('/bridge')

    const converterGuard = page.locator('text=Please connect your wallet to use Sonic Gateway converter')
    await expect(converterGuard).toBeVisible()

    // Ensure CSP prevents inline script injection attempts
    const result = await page.evaluate(() => {
      const script = document.createElement('script')
      script.textContent = "window.__tampered = true;"
      try {
        document.body.appendChild(script)
        return !!(window as typeof window & { __tampered?: boolean }).__tampered
      } catch {
        return false
      }
    })
    expect(result).toBeFalsy()
  })
})

