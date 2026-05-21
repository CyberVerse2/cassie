import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCHEMA_ROOTS = ["packages", "src"];
const IGNORED_DIRS = new Set(["node_modules", "dist", ".git"]);

async function tsFilesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return IGNORED_DIRS.has(entry.name) ? [] : tsFilesUnder(path);
    }
    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  }));
  return files.flat();
}

describe("structured schema compatibility", () => {
  it("does not use z.record in Gemini-facing structured schemas", async () => {
    const files = (await Promise.all(SCHEMA_ROOTS.map(tsFilesUnder))).flat();
    const offenders: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/z\s*\.\s*record\s*\(/.test(source)) {
        offenders.push(file);
      }
    }

    expect(offenders).toEqual([]);
  });
});
