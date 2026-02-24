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
    viewport: { width: 1280, height: 720 }
  });

  const page = await context.newPage();

  try {
    // 1) Login
    console.log("Navigating to login page...");
    await page.goto('https://app.yoco.com/', { waitUntil: 'domcontentloaded' });

    console.log("Entering credentials...");
    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
      page.click('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")')
    ]);

    // 2) Navigate to Products report page
    console.log("Navigating to products report...");
    await page.goto('https://app.yoco.com/reports/products/home', { waitUntil: 'domcontentloaded' });

    // Wait for page to be "ready enough" (headline present)
    await page.waitForSelector('text=Products report', { timeout: 30000 });

    // 3) Ensure "Today" is selected (so it is daily/today)
    // If it's already selected, clicking again usually does nothing harmful.
    console.log('Selecting "Today" filter...');
    await page.click('text=Today', { timeout: 15000 }).catch(() => {});

    // Small wait for any report refresh after filter click
    await page.waitForTimeout(1500);

    // 4) Click download icon (top right) and choose XLSX
    console.log("Opening download menu...");

    // Try a few selectors to find the top-right download control.
    // Screenshot shows a download icon; depending on implementation it could be a button, icon button, or has aria-label.
    const downloadButtonCandidates = [
      'button[aria-label*="Download" i]',
      'button[title*="Download" i]',
      'button:has(svg)', // fallback if icon-only button
      '[role="button"][aria-label*="Download" i]',
      'a[aria-label*="Download" i]'
    ];

    let clicked = false;
    for (const sel of downloadButtonCandidates) {
      const loc = page.locator(sel).first();
      if (await loc.count()) {
        // We only want the top-right one; the first icon-only button isn't always correct,
        // but in this screen it's typically the only icon button in the header row.
        try {
          await loc.click({ timeout: 2000 });
          clicked = true;
          break;
        } catch {}
      }
    }

    if (!clicked) {
      // Last resort: click the top-right area where the icon is, based on typical layout
      // (Not ideal, but useful if the icon is not selectable)
      console.log("Falling back to coordinate click for download icon...");
      await page.mouse.click(1235, 78); // near top-right in 1280x720 viewport
    }

    // 5) Pick XLSX option and download
    console.log("Selecting XLSX and downloading...");

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      // Menu items could be "XLSX", "Excel", or similar
      page.click('text=XLSX, text=Excel', { timeout: 15000 })
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
