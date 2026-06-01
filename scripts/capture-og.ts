import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT_DIR = process.env.OUT_DIR ?? path.resolve("apps/web/public");
const SCALE = Number(process.env.SCALE ?? 2);

const OG_W = 1200;
const OG_H = 630;

const TARGETS: { query: string; file: string }[] = [
  { query: "", file: "og-trade.png" },
  { query: "?ex=hyperliquid", file: "og-trade-hyperliquid.png" },
  { query: "?v=split", file: "og-trade-split.png" },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: OG_W, height: OG_H },
    deviceScaleFactor: SCALE,
  });

  for (const { query, file } of TARGETS) {
    const url = `${BASE_URL}/card/og${query}`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
    await page.evaluate(() => {
      document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
    });
    await page.waitForTimeout(400);

    const out = path.join(OUT_DIR, file);
    await page.screenshot({
      path: out,
      clip: { x: 0, y: 0, width: OG_W, height: OG_H },
      scale: "css",
    });
    console.log(`${file} <- ${url}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
