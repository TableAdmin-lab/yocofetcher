const { chromium } = require('playwright');
const path = require('path');

async function run() {
  const email = process.env.YOCO_EMAIL;
  const password = process.env.YOCO_PASSWORD;

  if (!email || !password) {
    console.error("Missing YOCO credentials in environment variables.");
    process.exit(1);
  }

  console.log(`[Yoco Sync Engine] Starting sync for: ${email}`);

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
      await cookieBtn.click().catch(() => { });
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
    await loginContainer.click({ force: true, timeout: 10000 }).catch(() => { });

    // If still on login, try pressing Enter in password field
    await page.waitForTimeout(1000);
    if (page.url().includes('/login/')) {
      console.log("Login click may not have submitted; pressing Enter in password field...");
      await passInput.press('Enter').catch(() => { });
    }

    // Wait until we are NOT on a login URL anymore (auth completed)
    console.log("Waiting for login redirect...");
    await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 60000 })
      .catch(() => { });

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
    await page.getByText('Today', { exact: true }).click().catch(() => { });
    await page.waitForTimeout(1200);

    console.log("Opening download menu...");

    // dismiss cookie banner if present
    const cookieBtn2 = page.getByRole('button', { name: /I understand/i });
    if (await cookieBtn2.isVisible().catch(() => false)) {
      console.log("Dismissing cookie notice (again)...");
      await cookieBtn2.click().catch(() => { });
    }

    // CLICK THE ACTUAL DOWNLOAD ICON BUTTON by its MaterialIcons glyph ""
    const downloadIconBtn = page.locator('button:has(div[style*="font-family: MaterialIcons"]):has-text("")').first();

    if (await downloadIconBtn.count() === 0) {
      throw new Error('Could not find the download icon button (). Selector may need adjustment.');
    }

    await downloadIconBtn.click({ timeout: 15000, force: true });

    // Wait for *any* sign the drawer opened
    console.log("Waiting for download drawer...");
    await page.waitForFunction(() => {
      const bodyText = document.body?.innerText || "";
      return (
        bodyText.includes("Download product report") ||
        bodyText.includes("Download preferences") ||
        (bodyText.includes("Excel") && bodyText.includes("CSV"))
      );
    }, null, { timeout: 60000 });

    // 5) Choose Excel, then click Download to trigger file download
    console.log("Selecting Excel...");
    await page.getByRole('button', { name: /Excel/i }).click({ timeout: 15000 }).catch(async () => {
      // fallback: click the Excel row by text
      await page.locator('text=Excel').first().click({ timeout: 15000 });
    });

    // Now click the Download button in the drawer and wait for download event
    console.log("Clicking Download...");
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.getByRole('button', { name: /^Download$/i }).click({ timeout: 30000 })
        .catch(async () => {
          // fallback: click by text if role lookup fails
          await page.locator('button:has-text("Download")').last().click({ timeout: 30000 });
        })
    ]);

    const downloadPath = path.join(__dirname, 'latest_yoco_sales.xlsx');
    await download.saveAs(downloadPath);

    console.log(`✅ Successfully downloaded YOCO sales XLSX to: ${downloadPath}`);

    // --- SECOND EXPORT: PRODUCTS CATALOG ---
    console.log("Navigating to products catalog...");
    await page.goto('https://app.yoco.com/manage/products/home', { waitUntil: 'domcontentloaded' });

    // Click Export button
    // Click Export button
    console.log("Opening catalog export menu...");
    const exportBtn = page.locator('button:has-text("Export")').last();
    await exportBtn.waitFor({ state: 'attached', timeout: 30000 });
    await exportBtn.click({ timeout: 15000, force: true }).catch(async () => {
      console.log("Fallback to evaluate click for Export button...");
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const target = btns.find(b => b.innerText && b.innerText.includes('Export'));
        if (target) target.click();
      });
    });

    // Wait for the drawer
    console.log("Waiting for catalog download drawer...");
    await page.waitForFunction(() => {
      const bodyText = document.body?.innerText || "";
      return bodyText.includes("Excel");
    }, null, { timeout: 60000 });

    console.log("Selecting Excel for catalog...");
    await page.getByRole('button', { name: /Excel/i }).click({ timeout: 15000 }).catch(async () => {
      await page.locator('text=Excel').first().click({ timeout: 15000 });
    });

    console.log("Clicking Download for catalog...");
    const [download2] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.getByRole('button', { name: /^Download$/i }).click({ timeout: 30000 })
        .catch(async () => {
          await page.locator('button:has-text("Download")').last().click({ timeout: 30000 });
        })
    ]);

    const downloadPath2 = path.join(__dirname, 'latest_yoco_catalog.xlsx');
    await download2.saveAs(downloadPath2);
    console.log(`✅ Successfully downloaded YOCO catalog XLSX to: ${downloadPath2}`);

  } catch (error) {
    console.error("❌ Synchronization failed. Please check credentials or try again later.");
    console.error(error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
