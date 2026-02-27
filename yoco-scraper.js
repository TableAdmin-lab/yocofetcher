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
      await cookieBtn.click().catch(() => { });
    }

    const emailInput = page.locator('input[placeholder="Enter your email address"]');
    const passInput = page.locator('input[placeholder="Enter your password"]');

    await emailInput.waitFor({ state: 'visible', timeout: 60000 });
    await emailInput.fill(email);
    await passInput.fill(password);

    const loginContainer = page.locator('[aria-disabled]:has-text("Log in")').first();
    await loginContainer.click({ force: true }).catch(() => { });

    await page.waitForTimeout(1000);
    if (page.url().includes('/login/')) {
      await passInput.press('Enter').catch(() => { });
    }

    await page.waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 60000 }).catch(() => { });

    // 2) FIRST EXPORT: SALES REPORT (Restored to your working version)
    console.log("Navigating to products report...");
    await page.goto('https://app.yoco.com/reports/products/home?period=today', { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('text=Today', { timeout: 60000 });

    const downloadIconBtn = page.locator('button:has(div[style*="font-family: MaterialIcons"]):has-text("")').first();
    await downloadIconBtn.click({ timeout: 15000, force: true });

    console.log("Selecting Excel for Sales...");
    await page.getByRole('button', { name: /Excel/i }).click({ timeout: 15000 }).catch(async () => {
      await page.locator('text=Excel').first().click({ timeout: 15000 });
    });

    const [download1] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.getByRole('button', { name: /^Download$/i }).click({ timeout: 30000 }).catch(async () => {
        await page.locator('button:has-text("Download")').last().click({ timeout: 30000 });
      })
    ]);

    const path1 = path.join(__dirname, 'latest_yoco_sales.xlsx');
    await download1.saveAs(path1);
    console.log(`✅ Successfully downloaded YOCO sales XLSX to: ${path1}`);

    // 3) SECOND EXPORT: PRODUCTS CATALOG (Improved with stability)
    console.log("Navigating to products catalog...");
    await page.goto('https://app.yoco.com/manage/products/home', { waitUntil: 'domcontentloaded' });

    console.log("Opening catalog export menu...");
    await page.waitForTimeout(2000); 

    // Find the Export button specifically
    const catalogExportBtn = page.locator('button:has-text("Export"), div[role="button"]:has-text("Export")').last();
    await catalogExportBtn.click({ force: true });

    console.log("Waiting for catalog download drawer...");
    // Wait for the drawer to actually be visible before clicking Excel
    const excelOption = page.locator('button:has-text("Excel"), [role="button"]:has-text("Excel")').last();
    await excelOption.waitFor({ state: 'visible', timeout: 15000 });
    await excelOption.click({ force: true });

    // CRITICAL: Wait for the app to update the 'Download' button destination
    await page.waitForTimeout(2000);

    console.log("Clicking Catalog Download...");
    const catalogDownloadBtn = page.locator('button:has-text("Download")').last();

    const [download2] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      catalogDownloadBtn.click({ force: true })
    ]);

    const path2 = path.join(__dirname, 'latest_yoco_catalog.xlsx');
    await download2.saveAs(path2);
    console.log(`✅ Successfully downloaded YOCO catalog XLSX to: ${path2}`);

  } catch (error) {
    console.error("❌ Synchronization failed.");
    console.error(error);
    if (process.env.GITHUB_ACTIONS) {
        await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
        console.log("Debug screenshot saved.");
    }
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
