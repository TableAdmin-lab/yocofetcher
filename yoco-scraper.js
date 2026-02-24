const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function run() {
    const email = process.env.YOCO_EMAIL;
    const password = process.env.YOCO_PASSWORD;

    if (!email || !password) {
        console.error("Missing YOCO credentials in environment variables.");
        process.exit(1);
    }

    console.log(`Starting YOCO sync for: ${email}`);

    // Launch Chromium in headless mode
    const browser = await chromium.launch({ headless: true });

    // Create a context that permits downloads
    const context = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();

    try {
        // 1. Navigate to YOCO Login
        console.log("Navigating to login page...");
        await page.goto('https://app.yoco.com/');

        // Wait for the email input to be visible (Using generic selectors for typical auth forms)
        // Adjust these selectors if YOCO's actual DOM is different
        console.log("Entering credentials...");
        await page.fill('input[type="email"], input[name="email"]', email);

        // Wait for password and submit
        await page.fill('input[type="password"], input[name="password"]', password);

        // Click the submit/login button
        await page.click('button[type="submit"], button:has-text("Log in"), button:has-text("Sign in")');

        // Wait for successful login (e.g., waiting for a known dashboard element or URL change)
        console.log("Waiting for dashboard to load...");
        await page.waitForTimeout(5000); // Wait 5 seconds to let the dashboard resolve

        // 2. Navigate to Reports
        console.log("Navigating to reports...");
        await page.goto('https://app.yoco.com/reports/sales'); // Or the specific report URL
        await page.waitForTimeout(4000); // Allow report to load

        // 3. Trigger Download
        console.log("Triggering CSV download...");
        // Wait for download event when clicking the export button
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 30000 }),
            // Click the common export/download button (You may need to inspect YOCO's exact button class/text)
            page.click('button:has-text("Export"), button:has-text("Download"), a:has-text("Export to CSV")')
        ]);

        // 4. Save the file to the workspace
        const downloadPath = path.join(__dirname, 'latest_yoco_sales.csv');
        await download.saveAs(downloadPath);

        console.log(`✅ Successfully downloaded YOCO sales to: ${downloadPath}`);

    } catch (error) {
        console.error("❌ Error during Playwright execution:");
        console.error(error);
        process.exit(1); // Fail the GitHub Action so the user sees the error
    } finally {
        await browser.close();
    }
}

run();
