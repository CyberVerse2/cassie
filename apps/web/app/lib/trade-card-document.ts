import type { TradeCardProps } from "../components/trade-card";
import styles from "../components/trade-card.module.css";

type TradeCardDocumentAssets = {
  cassieLogo: string;
  hyperliquidLogo: string;
  polymarketLogo: string;
};

export function renderTradeCardDocument(
  props: TradeCardProps,
  assets: TradeCardDocumentAssets,
  tradeCardCss: string,
) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${STAGE_CSS}
${cssModuleToInlineCss(tradeCardCss)}
</style>
</head>
<body>
<main data-og-render-ready="true">${renderTradeCard(props, assets)}</main>
</body>
</html>`;
}

function renderTradeCard(props: TradeCardProps, assets: TradeCardDocumentAssets) {
  const brand = props.brand ?? "Cassie";
  const author = props.author ?? { name: "@CryptoCapo_", avatarUrl: "https://unavatar.io/x/CryptoCapo_" };
  const trader = props.trader ?? { name: "@0xWhaleHunter", avatarUrl: "https://unavatar.io/x/0xWhaleHunter" };
  const headline = props.headline ?? "Bitcoin reclaims the range high with funding flat.";
  const result = props.tradeResult ?? {
    percent: "+94.2%",
    side: "YES",
    when: "1 wk ago",
    entry: "52c",
    exit: "100c",
  };
  const market = props.market ?? {
    venue: "Polymarket",
    question: "Will Bitcoin reach $75,000 in March?",
    side: "YES",
    logoUrl: "/polymarket-logo.png",
  };
  const positive = !result.percent.trim().startsWith("-");
  const label = `${market.venue} ${result.side} ${result.percent}`;
  const venueLogo = market.logoUrl === "/hyperliquid-logo.png"
    ? assets.hyperliquidLogo
    : market.logoUrl === "/polymarket-logo.png"
      ? assets.polymarketLogo
      : market.logoUrl;
  const frameStyle = props.frameWidth ? ` style="width: ${props.frameWidth}px; max-width: none;"` : "";

  return `<figure class="${className("frame")}" data-positive="${positive}" role="img" aria-label="${escapeAttribute(label)}"${frameStyle}>
  <div class="${className("card")}">
    ${renderDirectionEmblem(positive)}
    <div class="${className("content")}">
      <header class="${className("head")}">
        <div class="${className("brand")}">
          <img class="${className("logo")}" src="${escapeAttribute(assets.cassieLogo)}" alt="">
          <span class="${className("wordmark")}">${escapeHtml(brand)}</span>
        </div>
      </header>
      <div class="${className("people")}">
        ${renderLockup("Thesis", author)}
        <span class="${className("peopleArrow")}" aria-hidden="true">&rarr;</span>
        ${renderLockup("Traded", trader)}
      </div>
      <div class="${className("identity")}">
        <div class="${className("venueRow")}">
          ${venueLogo ? `<img class="${className("venueLogo")}" src="${escapeAttribute(venueLogo)}" alt="">` : ""}
          <span class="${className("venueName")}">${escapeHtml(market.venue)}</span>
          <span class="${className("sideBadge")}">${escapeHtml(market.side)}</span>
        </div>
        <p class="${className("question")}">${escapeHtml(market.question)}</p>
      </div>
      <div class="${className("callout")}">
        <p class="${className("headline")}">${escapeHtml(headline)}</p>
      </div>
      <div class="${className("figureWrap")}">
        <div class="${className("figure")}">${escapeHtml(result.percent)}</div>
        <div class="${className("spec")}">
          <div class="${className("specItem")}">
            <span class="${className("specLabel")}">Entry</span>
            <span class="${className("specValue")}">${escapeHtml(result.entry)}</span>
          </div>
          <span class="${className("specArrow")}" aria-hidden="true">&rarr;</span>
          <div class="${className("specItem")}">
            <span class="${className("specLabel")}">Exit</span>
            <span class="${className("specValue")}">${escapeHtml(result.exit)}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</figure>`;
}

function renderLockup(label: string, person: { name: string; avatarUrl?: string }) {
  return `<div class="${className("lockup")}">
    ${renderAvatar(person)}
    <div class="${className("lockupText")}">
      <span class="${className("lockupLabel")}">${escapeHtml(label)}</span>
      <span class="${className("lockupName")}">${escapeHtml(person.name)}</span>
    </div>
  </div>`;
}

function renderAvatar(person: { name: string; avatarUrl?: string }) {
  if (person.avatarUrl) {
    return `<img class="${className("avatar")}" src="${escapeAttribute(person.avatarUrl)}" alt="">`;
  }
  const initial = person.name.replace(/^@/u, "").charAt(0).toUpperCase() || "?";
  return `<span class="${className("avatar")}" data-fallback="true" aria-hidden="true">${escapeHtml(initial)}</span>`;
}

function renderDirectionEmblem(positive: boolean) {
  const arrow = "M50 14 L82 46 L66 46 L66 86 L34 86 L34 46 L18 46 Z";
  const rings = Array.from({ length: 40 }, (_, i) => {
    const scale = 0.3 + i * 0.05;
    const opacity = Math.max(0.025, 0.95 * Math.pow(0.9, i));
    const strokeWidth = i === 0 ? 1 : i < 3 ? 0.7 : 0.45;
    return `<path d="${arrow}" transform="translate(50 54) scale(${scale.toFixed(3)}) translate(-50 -54)" fill="${i === 0 ? "color-mix(in oklab, var(--tc-result) 18%, transparent)" : "none"}" stroke="var(--tc-result)" stroke-width="${strokeWidth}" stroke-linejoin="round" vector-effect="non-scaling-stroke" style="opacity: ${opacity}"></path>`;
  }).join("");
  return `<svg class="${className("emblem")}" viewBox="0 0 100 100" data-positive="${positive}" aria-hidden="true">${rings}</svg>`;
}

function cssModuleToInlineCss(css: string) {
  let scoped = css;
  for (const [localName, compiledName] of Object.entries(styles)) {
    scoped = scoped.replace(new RegExp(`\\.${localName}\\b`, "gu"), `.${compiledName}`);
  }
  return scoped;
}

function className(name: keyof typeof styles) {
  return styles[name];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/gu, "&#96;");
}

const STAGE_CSS = `
html, body {
  width: 1200px;
  height: 630px;
  margin: 0;
  overflow: hidden;
  background: #040504;
}

body {
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

main {
  width: 1200px;
  height: 630px;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: #040504;
}
`;
