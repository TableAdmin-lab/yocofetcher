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

    // Dismiss cookie banner if it blocks input/clicks
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

    // The login "button" is a DIV with aria-disabled, not a normal <button>
    // We'll locate the aria-disabled container that CONTAINS the "Log in" text.
    const loginContainer = page.locator('[aria-disabled]:has-text("Log in")').first();

    // Wait for it to exist/visible
    await loginContainer.waitFor({ state: 'visible', timeout: 60000 });

    // Give the app a moment to validate and enable the control
    // Then click it (force helps if it's a div with overlay-ish behavior)
    console.log("Submitting login...");
    await page.waitForTimeout(500);

    // Try clicking; if it doesn't navigate, try Enter as fallback
    await loginContainer.click({ force: true, timeout: 10000 }).catch(() => {});

    // If still on login, try pressing Enter in password field
    await page.waitForTimeout(1000);
    if (page.url().includes('/login/')) {
      console.log("Login click may not have submitted; pressing Enter in password field...");
      await passInput.press('Enter').catch(() => {});
    }

    // Wait until we are NOT on a login URL anymore (auth completed)
    console.log("Waiting for login redirect...");
    await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 60000 })
      .catch(() => {});

    // 2) Navigate directly to products report (today)
    console.log("Navigating to products report...");
    await page.goto('https://app.yoco.com/reports/products/home?period=today', { waitUntil: 'domcontentloaded' });

    // If we got bounced back to login, fail with a clearer message
    if (page.url().includes('/login')) {
      throw new Error(`Not authenticated (redirected back to login). Current URL: ${page.url()}`);
    }

    // Instead of relying on "Products report" text (could vary),
    // wait for something stable on the report page: the "Today" pill and the tabs row.
    await page.waitForSelector('text=Today', { timeout: 60000 });

    // 3) Ensure Today is selected (safe no-op if already selected)
    console.log('Ensuring "Today" filter...');
    await page.getByText('Today', { exact: true }).click().catch(() => {});
    await page.waitForTimeout(1200);

    // 4) Click the top-right download icon button (matches your button snippet)
    console.log("Opening download menu...");

    // On this page, the download icon is a button in the header/top-right.
    // We'll target the LAST button in the header area as a pragmatic approach,
    // then verify the download preferences dialog appears.
    // If this fails, fallback to coordinate click.
    const topRightDownloadBtn = page.locator('button[type="button"]').last();

    let opened = false;
    try {
      await topRightDownloadBtn.click({ timeout: 5000 });
      opened = true;
    } catch {
      opened = false;
    }

    if (!opened) {
      console.log("Falling back to coordinate click for download icon...");
      await page.mouse.click(1235, 78);
    }

    // 5) In the "Download preferences" dialog, click Excel and trigger download
    // Your DOM shows a "Download preferences" heading and an "Excel" option button.
    console.log("Selecting Excel option...");
    await page.waitForSelector('text=Download preferences', { timeout: 30000 });

    const excelBtn = page.locator('button:has-text("Excel")').first();
    await excelBtn.click({ timeout: 15000 });

    // The actual download might trigger immediately after selecting Excel,
    // OR it might require another click (e.g., "Download" confirm).
    // We'll wait briefly; if no download starts, click the top-right icon again.
    console.log("Waiting for XLSX download to start...");

    let download;
    try {
      download = await page.waitForEvent('download', { timeout: 15000 });
    } catch {
      // Some UIs require clicking the download icon again after setting preference
      console.log("No download yet; clicking download icon again...");
      // Try to click download icon again and wait for event
      await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }).then(d => { download = d; }),
        topRightDownloadBtn.click({ timeout: 5000 }).catch(async () => {
          await page.mouse.click(1235, 78);
        }),
      ]);
    }

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
