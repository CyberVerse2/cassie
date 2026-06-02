import { chromium, type Browser } from "playwright";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const RENDER_TIMEOUT_MS = 20_000;
const IMAGE_CACHE_TTL_MS = 60_000;

let browserPromise: Promise<Browser> | null = null;
const imageCache = new Map<string, { createdAt: number; image: Promise<Uint8Array> }>();

type RouteContext = {
  params: Promise<{ positionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { positionId } = await context.params;
  const image = await getCachedImage(positionId, request);

  return new Response(image, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}

async function getCachedImage(positionId: string, request: Request) {
  const now = Date.now();
  const cached = imageCache.get(positionId);
  if (cached && now - cached.createdAt < IMAGE_CACHE_TTL_MS) return cached.image;

  const image = renderImage(positionId, request).catch((error) => {
    imageCache.delete(positionId);
    throw error;
  });
  imageCache.set(positionId, { createdAt: now, image });
  return image;
}

async function renderImage(positionId: string, request: Request) {
  const renderUrl = new URL(
    `/trades/${encodeURIComponent(positionId)}/pnl/og-render`,
    requestOrigin(request),
  );
  const browser = await getBrowser();
  const browserContext = await browser.newContext({
    viewport: { width: OG_WIDTH, height: OG_HEIGHT },
    deviceScaleFactor: 1,
    javaScriptEnabled: false,
  });
  const page = await browserContext.newPage();

  try {
    await page.goto(renderUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: RENDER_TIMEOUT_MS,
    });
    const renderTarget = page.locator('[data-og-render-ready="true"]');
    await renderTarget.waitFor({ state: "visible", timeout: RENDER_TIMEOUT_MS });
    const errorPageVisible = await page.getByText("This page couldn’t load").isVisible().catch(() => false);
    if (errorPageVisible) {
      throw new Error(`Trade PnL OG render page failed to load: ${renderUrl.toString()}`);
    }
    await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    return await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: OG_WIDTH, height: OG_HEIGHT },
      scale: "css",
    });
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

function requestOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProto ?? requestUrl.protocol.replace(/:$/u, "");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost ?? request.headers.get("host") ?? requestUrl.host;
  const browserHost = host.replace(/^0\.0\.0\.0(?::|$)/u, (match) => match.replace("0.0.0.0", "localhost"));
  return `${protocol}://${browserHost}`;
}
