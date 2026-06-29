import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_PATH = join(APP_ROOT, "index.html");
const PUBLIC_DIR = join(APP_ROOT, "public");
const MANIFEST_PATH = join(PUBLIC_DIR, "manifest.webmanifest");

interface WebManifest {
  readonly name?: unknown;
  readonly short_name?: unknown;
  readonly id?: unknown;
  readonly start_url?: unknown;
  readonly scope?: unknown;
  readonly display?: unknown;
  readonly background_color?: unknown;
  readonly theme_color?: unknown;
  readonly icons?: unknown;
}

function manifest(): WebManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as WebManifest;
}

describe("PWA install metadata (ROADMAP phase 9)", () => {
  it("links the manifest and theme color from the app shell", () => {
    const html = readFileSync(INDEX_PATH, "utf8");
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<meta name="theme-color" content="#11181a" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
  });

  it("defines an installable standalone app identity", () => {
    const doc = manifest();
    expect(doc.name).toBe("Civitect");
    expect(doc.short_name).toBe("Civitect");
    expect(doc.id).toBe("/");
    expect(doc.start_url).toBe("/");
    expect(doc.scope).toBe("/");
    expect(doc.display).toBe("standalone");
    expect(doc.background_color).toBe("#11181a");
    expect(doc.theme_color).toBe("#11181a");
  });

  it("ships a maskable icon referenced by the manifest and HTML", () => {
    const doc = manifest();
    expect(Array.isArray(doc.icons)).toBe(true);
    const icons = doc.icons as Array<{
      readonly src?: unknown;
      readonly sizes?: unknown;
      readonly type?: unknown;
      readonly purpose?: unknown;
    }>;
    const icon = icons.find((candidate) => candidate.src === "/icons/app-icon.svg");
    expect(icon).toBeDefined();
    expect(icon?.sizes).toBe("any");
    expect(icon?.type).toBe("image/svg+xml");
    expect(String(icon?.purpose)).toContain("maskable");

    const iconPath = join(PUBLIC_DIR, "icons", "app-icon.svg");
    expect(existsSync(iconPath)).toBe(true);
    const svg = readFileSync(iconPath, "utf8");
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(readFileSync(INDEX_PATH, "utf8")).toContain(
      '<link rel="icon" type="image/svg+xml" href="/icons/app-icon.svg" />',
    );
  });
});
