const { chromium } = require('playwright');
const path = require('path');

async function run() {
  const email = process.env.YOCO_EMAIL;
  const password = process.env.YOCO_PASSWORD;

  if (!email || !password) {
    console.error("Missing YOCO credentials in environment variables.");
    process.exit(1);
  }

  console.log(`Starting YOCO products sync for: ${email}`);

  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();

  try {
    // 1) Login
    console.log("Navigating to login page...");
    await page.goto('https://app.yoco.com/login/existing', { waitUntil: 'domcontentloaded' });

    // Cookie banner can block interactions
    const cookieBtn = page.getByRole('button', { name: /I understand/i });
    if (await cookieBtn.isVisible().catch(() => false)) {
      console.log("Dismissing cookie notice...");
      await cookieBtn.click().catch(() => {});
    }

    const emailInput = page.locator('input[placeholder="Enter your email address"]');
    const passInput = page.locator('input[placeholder="Enter your password"]');

    console.log("Waiting for login inputs...");
    await emailInput.waitFor({ state: 'visible', timeout: 60000 });
    await passInput.waitFor({ state: 'visible', timeout: 60000 });

    console.log("Entering credentials...");
    await emailInput.fill(email);
    await passInput.fill(password);

    // IMPORTANT:
    // Your HTML shows "Log in" is inside a DIV with aria-disabled, not a button.
    // It may stay aria-disabled="true" but still become clickable via styles.
    // So instead of waiting for aria-disabled=false, we:
    // - locate the element containing "Log in"
    // - wait for it to exist/visible
    // - click it
    // - if it fails due to overlay/disabled, press Enter in password field as fallback.
    console.log("Submitting login...");

    const loginControl = page.locator('div:has-text("Log in")').first();
    await loginControl.waitFor({ state: 'visible', timeout: 60000 });

    // Try clicking the closest clickable parent (the aria-disabled container)
    const loginContainer = loginControl.locator('xpath=ancestor-or-self::*[@aria-disabled][1]');
    if (await loginContainer.count()) {
      await loginContainer.click({ timeout: 10000, force: true });
    } else {
      // Fallback: click the text node container
      await loginControl.click({ timeout: 10000, force: true });
    }

    // Fallback: if still on login page after short wait, press Enter in password field
    await page.waitForTimeout(1500);
    if (page.url().includes('/login/')) {
      console.log("Login click may not have submitted; pressing Enter in password field...");
      await passInput.press('Enter').catch(() => {});
    }

    // Wait for navigation/app state change
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

    // 2) Navigate to Products report page
    console.log("Navigating to products report...");
    await page.goto('https://app.yoco.com/reports/products/home', { waitUntil: 'domcontentloaded' });

    // Ensure we're actually on the report (auth succeeded)
    await page.waitForSelector('text=Products report', { timeout: 60000 });

    // 3) Ensure "Today" is selected
    console.log('Selecting "Today" filter...');
    await page.getByText('Today', { exact: true }).click().catch(() => {});
    await page.waitForTimeout(1500);

    // 4) Click download icon (top right) and choose XLSX
    console.log("Opening download menu...");

    const downloadCandidates = [
      'button[aria-label*="download" i]',
      'button[title*="download" i]',
      '[role="button"][aria-label*="download" i]',
      'a[aria-label*="download" i]',
    ];

    let openedMenu = false;
    for (const sel of downloadCandidates) {
      const loc = page.locator(sel).first();
      if (await loc.count()) {
        try {
          await loc.click({ timeout: 3000 });
          openedMenu = true;
          break;
        } catch {}
      }
    }

    if (!openedMenu) {
      console.log("Falling back to coordinate click for download icon...");
      await page.mouse.click(1235, 78);
    }

    // 5) Pick XLSX option and download
    console.log("Selecting XLSX and downloading...");

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.locator('text=/\\bXLSX\\b/i, text=/\\bExcel\\b/i').first().click({ timeout: 30000 }),
    ]);

    const downloadPath = path.join(__dirname, 'latest_yoco_products.xlsx');
    await download.saveAs(downloadPath);

    console.log(`✅ Successfully downloaded YOCO products XLSX to: ${downloadPath}`);
  } catch (error) {
    console.error("❌ Error during Playwright execution:");
    console.error(error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
