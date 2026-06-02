import { chromium, type Browser } from "playwright";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const RENDER_TIMEOUT_MS = 20_000;

let browserPromise: Promise<Browser> | null = null;

type RouteContext = {
  params: Promise<{ positionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { positionId } = await context.params;
  const renderUrl = new URL(
    `/trades/${encodeURIComponent(positionId)}/pnl/og-render`,
    requestOrigin(request),
  );
  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: { width: OG_WIDTH, height: OG_HEIGHT },
    deviceScaleFactor: 1,
  });

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
    await page.evaluate(async () => {
      await Promise.all(Array.from(document.images).map((image) => image.decode().catch(() => undefined)));
    });
    await page.waitForTimeout(750);
    const image = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: OG_WIDTH, height: OG_HEIGHT },
      scale: "css",
    });

    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  } finally {
    await page.close();
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
