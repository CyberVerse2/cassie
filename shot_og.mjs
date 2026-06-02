import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:3000/card/og?ex=hyperliquid", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.screenshot({ path: "/tmp/og-stage.png" });
await page.close();
await browser.close();
console.log("done");
