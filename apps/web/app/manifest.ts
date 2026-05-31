import type { MetadataRoute } from "next";
import { siteDescription, siteName } from "./metadata-config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cassie - Turn a tweet into a trade",
    short_name: siteName,
    description: siteDescription,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#071012",
    theme_color: "#071012",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
