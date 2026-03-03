const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const AUTH_DIR = path.join(__dirname, ".playwright");
const AUTH_STATE_PATH = path.join(AUTH_DIR, "auth_state.json");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function dismissCookies(page) {
  const cookieBtn = page.getByRole("button", { name: /I understand/i });
  if (await cookieBtn.isVisible().catch(() => false)) {
    await cookieBtn.click().catch(() => {});
  }
}

async function isLoggedIn(page) {
  // If we can load a known authenticated page without being redirected to /login, we’re good.
  await page.goto("https://app.yoco.com/reports/products/home?period=today", {
    waitUntil: "domcontentloaded",
  });

  return !page.url().includes("/login");
}

async function doLogin(page, email, password) {
  await page.goto("https://app.yoco.com/login/existing", {
    waitUntil: "domcontentloaded",
  });

  await dismissCookies(page);

  const emailInput = page.locator('input[placeholder="Enter your email address"]');
  const passInput = page.locator('input[placeholder="Enter your password"]');

  await emailInput.waitFor({ state: "visible", timeout: 60000 });
  await passInput.waitFor({ state: "visible", timeout: 60000 });

  await emailInput.fill(email);
  await passInput.fill(password);

  // Prefer a straightforward submit: press Enter on password
  await passInput.press("Enter").catch(() => {});

  // Wait for redirect away from /login
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60000 });
}

async function exportSalesReport(page) {
  console.log("[Export 1/2] Sales products report (today)");

  // We should already be on the report page from isLoggedIn() check; still ensure.
  if (!page.url().includes("/reports/products/home")) {
    await page.goto("https://app.yoco.com/reports/products/home?period=today", {
      waitUntil: "domcontentloaded",
    });
  }

  await dismissCookies(page);

  // Ensure the page is ready (avoid generic sleeps)
  await page.getByText("Today", { exact: true }).waitFor({ state: "visible", timeout: 60000 });

  // Try to ensure Today is selected (click is harmless if already selected)
  await page.getByText("Today", { exact: true }).click().catch(() => {});

  // Open download menu (your existing icon approach, but with deterministic follow-up waits)
  const downloadIconBtn = page
    .locator('button:has(div[style*="font-family: MaterialIcons"]):has-text("")')
    .first();

  if ((await downloadIconBtn.count()) === 0) {
    throw new Error('Could not find the download icon button (). Selector may need adjustment.');
  }

  await downloadIconBtn.click({ timeout: 15000, force: true });

  // Wait for drawer/menu content to appear by waiting for Excel button
  const excelBtn = page.getByRole("button", { name: /Excel/i }).first();
  await excelBtn.waitFor({ state: "visible", timeout: 60000 });
  await excelBtn.click({ timeout: 15000 }).catch(async () => {
    await page.locator("text=Excel").first().click({ timeout: 15000 });
  });

  const downloadBtn = page.getByRole("button", { name: /^Download$/i }).first();
  await downloadBtn.waitFor({ state: "visible", timeout: 60000 });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    downloadBtn.click({ timeout: 30000 }),
  ]);

  const out = path.join(__dirname, "latest_yoco_sales.xlsx");
  await download.saveAs(out);
  console.log(`✅ Downloaded sales XLSX -> ${out}`);
}

async function exportCatalog(page) {
  console.log("[Export 2/2] Products catalog");

  await page.goto("https://app.yoco.com/manage/products/home", {
    waitUntil: "domcontentloaded",
  });

  await dismissCookies(page);

  // Wait for Export button to be visible (instead of sleeping)
  const openDrawerBtn = page
    .locator('button:has-text("Export"):visible, div[role="button"]:has-text("Export"):visible')
    .last();

  await openDrawerBtn.waitFor({ state: "visible", timeout: 60000 });
  await openDrawerBtn.click({ force: true, timeout: 15000 });

  // Wait for the drawer to show an Excel option, then select it
  const excelOption = page.locator('text="Excel"').last();
  await excelOption.waitFor({ state: "visible", timeout: 60000 });
  await excelOption.click({ force: true, timeout: 15000 });

  // The final Export button in the drawer (blue)
  const finalExportBtn = page.locator('button:has-text("Export"):visible').last();
  await finalExportBtn.waitFor({ state: "visible", timeout: 60000 });

  const [download2] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    finalExportBtn.click({ force: true, timeout: 15000 }),
  ]);

  const out2 = path.join(__dirname, "latest_yoco_catalog.xlsx");
  await download2.saveAs(out2);
  console.log(`✅ Downloaded catalog XLSX -> ${out2}`);
}

async function run() {
  const email = process.env.YOCO_EMAIL;
  const password = process.env.YOCO_PASSWORD;

  if (!email || !password) {
    console.error("Missing YOCO credentials in environment variables.");
    process.exit(1);
  }

  console.log(`[Yoco Sync Engine] Starting sync for: ${email}`);
  ensureDir(AUTH_DIR);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1280, height: 720 },
    // Reuse auth state if it exists
    storageState: fs.existsSync(AUTH_STATE_PATH) ? AUTH_STATE_PATH : undefined,
  });

  context.setDefaultTimeout(60000);
  context.setDefaultNavigationTimeout(60000);

  // Block heavy resources (usually speeds things up a bit)
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (type === "image" || type === "font") return route.abort();
    route.continue();
  });

  const page = await context.newPage();

  try {
    // Attempt authenticated navigation first
    const loggedIn = await isLoggedIn(page);

    if (!loggedIn) {
      console.log("Not authenticated; performing login...");
      await doLogin(page, email, password);

      // Save state for next run
      await context.storageState({ path: AUTH_STATE_PATH });

      // Confirm we’re really in
      if (!(await isLoggedIn(page))) {
        throw new Error(`Login did not persist; still redirected to login. Current URL: ${page.url()}`);
      }
    } else {
      console.log("Authenticated via stored session.");
    }

    await exportSalesReport(page);
    await exportCatalog(page);

  } catch (error) {
    console.error("❌ Synchronization failed.");
    console.error(error);

    if (process.env.GITHUB_ACTIONS) {
      await page.screenshot({ path: "error_screenshot.png", fullPage: true }).catch(() => {});
      console.log("Debug screenshot saved: error_screenshot.png");
    }
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
