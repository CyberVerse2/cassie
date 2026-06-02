import { chromium, type Browser } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderTradeCardDocument } from "../../../../lib/trade-card-document";
import { getTradeCardRenderData } from "../../../../lib/trade-card-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const RENDER_TIMEOUT_MS = 20_000;
const IMAGE_CACHE_TTL_MS = 60_000;

let browserPromise: Promise<Browser> | null = null;
let assetsPromise: Promise<TradeCardDocumentAssets> | null = null;
const imageCache = new Map<string, { createdAt: number; image: Promise<ArrayBuffer> }>();

type TradeCardDocumentAssets = Parameters<typeof renderTradeCardDocument>[1];

type RouteContext = {
  params: Promise<{ positionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { positionId } = await context.params;
  const image = await getCachedImage(positionId);

  return new Response(image, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}

async function getCachedImage(positionId: string) {
  const now = Date.now();
  const cached = imageCache.get(positionId);
  if (cached && now - cached.createdAt < IMAGE_CACHE_TTL_MS) return cached.image;

  const image = renderImage(positionId).catch((error) => {
    imageCache.delete(positionId);
    throw error;
  });
  imageCache.set(positionId, { createdAt: now, image });
  return image;
}

async function renderImage(positionId: string) {
  const [{ cardProps }, assets] = await Promise.all([
    getTradeCardRenderData(positionId),
    getTradeCardDocumentAssets(),
  ]);
  const html = renderTradeCardDocument({ ...cardProps, frameWidth: 1110 }, assets, await tradeCardCss());
  const browser = await getBrowser();
  const browserContext = await browser.newContext({
    viewport: { width: OG_WIDTH, height: OG_HEIGHT },
    deviceScaleFactor: 1,
    javaScriptEnabled: false,
  });
  const page = await browserContext.newPage();

  try {
    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: RENDER_TIMEOUT_MS,
    });
    const renderTarget = page.locator('[data-og-render-ready="true"]');
    await renderTarget.waitFor({ state: "visible", timeout: RENDER_TIMEOUT_MS });
    const errorPageVisible = await page.getByText("This page couldn’t load").isVisible().catch(() => false);
    if (errorPageVisible) {
      throw new Error(`Trade PnL OG render document failed to load for ${positionId}`);
    }
    await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    const screenshot = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: OG_WIDTH, height: OG_HEIGHT },
      scale: "css",
    });
    const bytes = new Uint8Array(screenshot);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } finally {
    await browserContext.close();
  }
}

function getBrowser() {
  browserPromise ??= chromium.launch({
    headless: true,
  });
  return browserPromise;
}

function getTradeCardDocumentAssets() {
  assetsPromise ??= Promise.all([
    publicImageDataUrl("cassie-logo-transparent.png"),
    publicImageDataUrl("hyperliquid-logo.png"),
    publicImageDataUrl("polymarket-logo.png"),
  ]).then(([cassieLogo, hyperliquidLogo, polymarketLogo]) => ({
    cassieLogo,
    hyperliquidLogo,
    polymarketLogo,
  }));
  return assetsPromise;
}

async function publicImageDataUrl(filename: string) {
  const buffer = await readFile(path.join(process.cwd(), "apps/web/public", filename));
  return `data:${imageMimeType(filename)};base64,${buffer.toString("base64")}`;
}

async function tradeCardCss() {
  return await readFile(path.join(process.cwd(), "apps/web/app/components/trade-card.module.css"), "utf8");
}

function imageMimeType(filename: string) {
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "image/jpeg";
  throw new Error(`Unsupported OG card asset type: ${filename}`);
}
