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
    await page.goto('https://app.yoco.com/login/existing', { waitUntil: 'networkidle' });

    const cookieBtn = page.getByRole('button', { name: /I understand/i });
    if (await cookieBtn.isVisible().catch(() => false)) {
      await cookieBtn.click().catch(() => { });
    }

    const emailInput = page.locator('input[placeholder*="email"]');
    const passInput = page.locator('input[placeholder*="password"]');

    await emailInput.waitFor({ state: 'visible' });
    await emailInput.fill(email);
    await passInput.fill(password);

    const loginContainer = page.locator('[aria-disabled]:has-text("Log in"), button:has-text("Log in")').first();
    await loginContainer.click({ force: true });

    await page.waitForFunction(() => !location.pathname.includes('/login'), { timeout: 30000 }).catch(() => {
        return passInput.press('Enter');
    });

    // 2) FIRST EXPORT: SALES REPORT
    console.log("Navigating to products report...");
    await page.goto('https://app.yoco.com/reports/products/home?period=today', { waitUntil: 'networkidle' });

    const downloadIconBtn = page.locator('button:has(div[style*="MaterialIcons"]), button:has-text("")').first();
    await downloadIconBtn.waitFor({ state: 'visible' });
    await downloadIconBtn.click({ force: true });

    console.log("Selecting Excel for Sales...");
    const excelBtn = page.locator('button:has-text("Excel"), div:has-text("Excel")').first();
    await excelBtn.click({ force: true });
    
    // Small buffer for the UI to register the format change
    await page.waitForTimeout(1000);

    console.log("Downloading Sales Report...");
    const [download1] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      page.locator('button:has-text("Download")').last().click({ force: true })
    ]);

    const path1 = path.join(__dirname, 'latest_yoco_sales.xlsx');
    await download1.saveAs(path1);
    console.log(`✅ Sales XLSX saved to: ${path1}`);

    // 3) SECOND EXPORT: PRODUCTS CATALOG
    console.log("Navigating to products catalog...");
    await page.goto('https://app.yoco.com/manage/products/home', { waitUntil: 'networkidle' });

    console.log("Opening catalog export menu...");
    // Use a text-based locator that looks for "Export" in any button or clickable div
    const catalogExportBtn = page.locator('button:has-text("Export"), div[role="button"]:has-text("Export")').last();
    await catalogExportBtn.waitFor({ state: 'visible' });
    await catalogExportBtn.click({ force: true });

    console.log("Waiting for catalog drawer and selecting Excel...");
    // Wait for the Excel option to appear in the drawer
    const catalogExcelOption = page.locator('button:has-text("Excel"), div:has-text("Excel"), [role="button"]:has-text("Excel")').last();
    await catalogExcelOption.waitFor({ state: 'visible' });
    await catalogExcelOption.click({ force: true });

    // IMPORTANT: Wait for the "Download" button to become active/updated after choosing Excel
    await page.waitForTimeout(2000);

    console.log("Clicking Catalog Download button...");
    const catalogDownloadBtn = page.locator('button:has-text("Download")').last();

    const [download2] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }),
      catalogDownloadBtn.click({ force: true })
    ]);

    const path2 = path.join(__dirname, 'latest_yoco_catalog.xlsx');
    await download2.saveAs(path2);
    console.log(`✅ Catalog XLSX saved to: ${path2}`);

  } catch (error) {
    console.error("❌ Sync failed:");
    console.error(error.message);
    // Take a screenshot if it's running in CI to help debug
    if (process.env.GITHUB_ACTIONS) {
        await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
        console.log("Screenshot saved as error_screenshot.png");
    }
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
