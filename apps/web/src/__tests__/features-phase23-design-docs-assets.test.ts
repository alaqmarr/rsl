import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_CATALOG } from "@rsl/core";
import { loadAllDocArticles } from "@rsl/docs";
import { getAvatarInitials, getAvatarToneClasses } from "@rsl/ui";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

describe("Sprint 6 & Sprint 7 — Design Tokens, True Vector Assets, Interactive Charts & Docs Portal", () => {
  it("replaces bloated base64 SVGs with < 4 KB true vector SVGs and syncs favicon, manifest, OG, email logo & diagrams", () => {
    const svgFiles = [
      "logo-nobg.svg",
      "logo.svg",
      "long-logo-nobg.svg",
      "long-logo.svg",
    ];

    for (const file of svgFiles) {
      const full = path.join(REPO_ROOT, "public", file);
      const raw = fs.readFileSync(full, "utf8");
      const stat = fs.statSync(full);
      expect(stat.size).toBeLessThan(4096);
      expect(raw).toContain("<svg");
      expect(raw).not.toContain("data:image/");
    }

    const requiredAssets = [
      "favicon.ico",
      "apple-touch-icon.png",
      "icon-192.png",
      "icon-512.png",
      "og-image.png",
      "email-logo.png",
      "site.webmanifest",
      "diagrams/tally-sync-architecture.svg",
      "diagrams/whatsapp-cloud-flow.svg",
    ];

    for (const rel of requiredAssets) {
      expect(fs.existsSync(path.join(REPO_ROOT, "public", rel))).toBe(true);
      expect(fs.existsSync(path.join(REPO_ROOT, "apps/web/public", rel))).toBe(true);
      expect(fs.existsSync(path.join(REPO_ROOT, "apps/admin/public", rel))).toBe(true);
      expect(fs.existsSync(path.join(REPO_ROOT, "apps/docs/public", rel))).toBe(true);
    }

    const emailLogoSize = fs.statSync(path.join(REPO_ROOT, "public/email-logo.png")).size;
    expect(emailLogoSize).toBeLessThan(12 * 1024);

    const emailTemplates = fs.readFileSync(
      path.join(REPO_ROOT, "packages/notifications/src/templates.tsx"),
      "utf8"
    );
    expect(emailTemplates).toContain("/email-logo.png");
    expect(emailTemplates).not.toContain("/long-logo.jpeg");
  });

  it("maps CSS variables into Tailwind v4 @theme with dark mode, solid red .adm-btn-danger, interactive charts & deterministic avatars", () => {
    expect(getAvatarInitials("Aarav Hardware Mart")).toBe("AM");
    expect(getAvatarInitials("Mehta")).toBe("ME");
    const toneA = getAvatarToneClasses("owner@rapidshiftlabs.in");
    const toneA2 = getAvatarToneClasses("owner@rapidshiftlabs.in");
    expect(toneA).toBe(toneA2);
    expect(toneA).toContain("text-white");

    for (const app of ["web", "admin", "docs"]) {
      const css = fs.readFileSync(
        path.join(REPO_ROOT, `apps/${app}/src/app/globals.css`),
        "utf8"
      );
      expect(css).toContain("--color-canvas: var(--canvas)");
      expect(css).toContain('[data-theme="dark"]');
    }

    const adminCss = fs.readFileSync(
      path.join(REPO_ROOT, "apps/admin/src/app/globals.css"),
      "utf8"
    );
    expect(adminCss).toMatch(/\.adm-btn-danger[\s\S]*?#dc2626/);
    expect(adminCss).toContain(".adm-btn-danger-soft");

    const uiIndex = fs.readFileSync(path.join(REPO_ROOT, "packages/ui/src/index.tsx"), "utf8");
    expect(uiIndex).toContain("InteractiveAreaChartCanvas");
    expect(uiIndex).toContain("PendingSubmitButton");
    expect(uiIndex).toContain("text-[20px] font-bold");
    expect(uiIndex).toContain("text-[17px] font-semibold");
    expect(uiIndex).toContain("text-[15px] font-semibold");
    expect(uiIndex).toContain("CopyCodeBlock");
  });

  it("provides dynamic /errors/[code], sticky TOC & categorized sidebar on guides, tabbed API viewer, and clean SOP numbering", () => {
    const errorRoute = path.join(REPO_ROOT, "apps/docs/src/app/errors/[code]/page.tsx");
    expect(fs.existsSync(errorRoute)).toBe(true);
    const errorRouteSource = fs.readFileSync(errorRoute, "utf8");
    expect(errorRouteSource).toContain("ERROR_CATALOG");
    expect(Object.keys(ERROR_CATALOG).length).toBeGreaterThanOrEqual(20);

    const guidePage = fs.readFileSync(
      path.join(REPO_ROOT, "apps/docs/src/app/guides/[slug]/page.tsx"),
      "utf8"
    );
    expect(guidePage).toContain("On This Page");
    expect(guidePage).toContain("SECTION_ORDER");

    const apiRefPage = fs.readFileSync(
      path.join(REPO_ROOT, "apps/docs/src/app/api-reference/page.tsx"),
      "utf8"
    );
    expect(apiRefPage).toContain("TabbedApiCodeViewer");

    // Verify internal SOPs have unique SOP 1..5 headings and standardized rsl-tally-connector.mjs
    const internalDir = path.join(REPO_ROOT, "content/internal");
    const sopHeadings: string[] = [];
    for (const file of fs.readdirSync(internalDir).filter((f) => f.endsWith(".md"))) {
      const content = fs.readFileSync(path.join(internalDir, file), "utf8");
      expect(content).not.toContain("rsl-tally-agent.mjs");
      const firstLine = content.split(/\r?\n/)[0] ?? "";
      const match = /^# Staff SOP (\d+)/.exec(firstLine);
      if (match) sopHeadings.push(match[1]!);
    }
    expect(new Set(sopHeadings).size).toBe(sopHeadings.length);
    expect(sopHeadings.sort()).toEqual(["1", "2", "3", "4", "5"]);

    const articles = loadAllDocArticles();
    expect(articles.length).toBe(14);
  });
});
