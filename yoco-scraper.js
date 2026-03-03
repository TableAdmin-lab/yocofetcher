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

    const loginContainer = page.locator('[aria-disabled]:has-text("Log in")').first();
    await loginContainer.waitFor({ state: 'visible', timeout: 60000 });

    console.log("Submitting login...");
    await page.waitForTimeout(500);

    await loginContainer.click({ force: true, timeout: 10000 }).catch(() => { });

    await page.waitForTimeout(1000);
    if (page.url().includes('/login/')) {
      console.log("Login click may not have submitted; pressing Enter in password field...");
      await passInput.press('Enter').catch(() => { });
    }

    console.log("Waiting for login redirect...");
    await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 60000 })
      .catch(() => { });

    // 2) Navigate directly to products report (today)
    console.log("Navigating to products report...");
    await page.goto('https://app.yoco.com/reports/products/home?period=today', { waitUntil: 'domcontentloaded' });

    if (page.url().includes('/login')) {
      throw new Error(`Not authenticated (redirected back to login). Current URL: ${page.url()}`);
    }

    await page.waitForSelector('text=Today', { timeout: 60000 });

    // 3) Ensure Today is selected
    console.log('Ensuring "Today" filter...');
    await page.getByText('Today', { exact: true }).click().catch(() => { });
    await page.waitForTimeout(1200);

    console.log("Opening download menu...");

    const cookieBtn2 = page.getByRole('button', { name: /I understand/i });
    if (await cookieBtn2.isVisible().catch(() => false)) {
      console.log("Dismissing cookie notice (again)...");
      await cookieBtn2.click().catch(() => { });
    }

    const downloadIconBtn = page.locator('button:has(div[style*="font-family: MaterialIcons"]):has-text("")').first();

    if (await downloadIconBtn.count() === 0) {
      throw new Error('Could not find the download icon button (). Selector may need adjustment.');
    }

    await downloadIconBtn.click({ timeout: 15000, force: true });

    console.log("Waiting for download drawer...");
    await page.waitForFunction(() => {
      const bodyText = document.body?.innerText || "";
      return (
        bodyText.includes("Download product report") ||
        bodyText.includes("Download preferences") ||
        (bodyText.includes("Excel") && bodyText.includes("CSV"))
      );
    }, null, { timeout: 60000 });

    // 5) Choose Excel, then click Download
    console.log("Selecting Excel...");
    await page.getByRole('button', { name: /Excel/i }).click({ timeout: 15000 }).catch(async () => {
      await page.locator('text=Excel').first().click({ timeout: 15000 });
    });

    console.log("Clicking Download...");
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.getByRole('button', { name: /^Download$/i }).click({ timeout: 30000 })
        .catch(async () => {
          await page.locator('button:has-text("Download")').last().click({ timeout: 30000 });
        })
    ]);

    const downloadPath = path.join(__dirname, 'latest_yoco_sales.xlsx');
    await download.saveAs(downloadPath);

    console.log(`✅ Successfully downloaded YOCO sales XLSX to: ${downloadPath}`);

    // --- SECOND EXPORT: PRODUCTS CATALOG ---
    console.log("Navigating to products catalog...");
    await page.goto('https://app.yoco.com/manage/products/home', { waitUntil: 'domcontentloaded' });

    console.log("Opening catalog export menu...");
    await page.waitForTimeout(2000);
    
    // Step 1: Open the drawer using a native click on the VISIBLE button.
    const openDrawerBtn = page.locator('button:has-text("Export"):visible, div[role="button"]:has-text("Export"):visible').last();
    await openDrawerBtn.click({ force: true, timeout: 15000 });

    console.log("Waiting for catalog download drawer...");
    await page.waitForTimeout(3000); 

    console.log("Selecting Excel for catalog...");
    // Step 2: Click the 'Excel' text natively
    await page.locator('text="Excel"').last().click({ force: true, timeout: 15000 });

    await page.waitForTimeout(2500);

    console.log("Clicking final Export/Download button...");
    
    // Step 3: Click the big blue Export button at the bottom of the drawer natively.
    // By combining :visible and .last(), it guarantees we hit the blue button in the drawer.
    const finalExportBtn = page.locator('button:has-text("Export"):visible').last();

    const [download2] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      finalExportBtn.click({ force: true, timeout: 15000 })
    ]);

    const downloadPath2 = path.join(__dirname, 'latest_yoco_catalog.xlsx');
    await download2.saveAs(downloadPath2);
    console.log(`✅ Successfully downloaded YOCO catalog XLSX to: ${downloadPath2}`);

  } catch (error) {
    console.error("❌ Synchronization failed. Please check credentials or try again later.");
    console.error(error);
    if (process.env.GITHUB_ACTIONS) {
        await page.screenshot({ path: 'error_screenshot.png', fullPage: true }).catch(() => {});
        console.log("Debug screenshot saved.");
    }
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
