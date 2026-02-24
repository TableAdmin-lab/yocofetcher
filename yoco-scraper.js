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
    // 1) Login (use the correct login URL + robust selectors)
    console.log("Navigating to login page...");
    await page.goto('https://app.yoco.com/login/existing', { waitUntil: 'domcontentloaded' });

    // Cookie banner can block interactions
    const cookieBtn = page.getByRole('button', { name: /I understand/i });
    if (await cookieBtn.isVisible().catch(() => false)) {
      console.log("Dismissing cookie notice...");
      await cookieBtn.click().catch(() => {});
    }

    // Wait for inputs using placeholders present in the real DOM
    const emailInput = page.locator('input[placeholder="Enter your email address"]');
    const passInput = page.locator('input[placeholder="Enter your password"]');

    console.log("Waiting for login inputs...");
    await emailInput.waitFor({ state: 'visible', timeout: 60000 });
    await passInput.waitFor({ state: 'visible', timeout: 60000 });

    console.log("Entering credentials...");
    await emailInput.fill(email);
    await passInput.fill(password);

    // The "Log in" control isn't a normal submit button; it becomes enabled via aria-disabled
    console.log("Submitting login...");
    const loginEnabled = page.locator('[aria-disabled="false"]:has-text("Log in")').first();

    // Sometimes the enabled state takes a moment after typing
    await loginEnabled.waitFor({ state: 'visible', timeout: 30000 });
    await loginEnabled.click();

    // Wait for app to settle after login
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

    // Prefer a real accessible download button; fall back to coordinate click if needed
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
      // top-right corner in 1280x720; adjust if needed
      await page.mouse.click(1235, 78);
    }

    // 5) Pick XLSX option and download
    console.log("Selecting XLSX and downloading...");

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      // Options typically include XLSX; add a couple variants just in case
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
