import type { Metadata } from "next";
import { EB_Garamond, Manrope } from "next/font/google";
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
    <html lang="en" className={`${garamond.variable} ${manrope.variable}`}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
