import type { MetadataRoute } from "next";
import { siteUrl } from "./metadata-config";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl.toString(),
      lastModified: new Date("2026-05-31"),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
