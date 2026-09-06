import type { Metadata } from "next";
import { Bodoni_Moda, EB_Garamond, Manrope } from "next/font/google";
import { siteDescription, siteName, siteUrl, socialImage } from "./metadata-config";
import { AppProviders } from "./providers";
import "./globals.css";

const garamond = EB_Garamond({
  subsets: ["latin"],
  variable: "--font-display",
  style: ["normal", "italic"],
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// High-contrast didone for the trade card's hero figure - fashion-plate luxe.
const bodoni = Bodoni_Moda({
  subsets: ["latin"],
  variable: "--font-numeral",
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: siteName,
  title: {
    default: "Cassie - Turn a tweet into a trade",
    template: "%s | Cassie",
  },
  description: siteDescription,
  keywords: [
    "Cassie",
    "tweet trading",
    "AI trading agent",
    "Polymarket",
    "Hyperliquid",
    "crypto trading",
  ],
  authors: [{ name: "Cassie" }],
  creator: "Cassie",
  publisher: "Cassie",
  category: "finance",
  alternates: {
    canonical: "/",
  },
  manifest: "/manifest.webmanifest",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  appleWebApp: {
    capable: true,
    title: siteName,
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName,
    title: "Cassie - Turn a tweet into a trade",
    description: siteDescription,
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    site: "@cassiedottrade",
    creator: "@cassiedottrade",
    title: "Cassie - Turn a tweet into a trade",
    description: siteDescription,
    images: [socialImage.url],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${garamond.variable} ${manrope.variable} ${bodoni.variable}`}>
      <head>
        <meta name="virtual-protocol-site-verification" content="4648e3fc2c002b4dd381f8ba0f140d06" />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
