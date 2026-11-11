import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  GuideDrawer,
  GuideDrawerButton,
  ThemeToggleButton,
  type GuideDrawerContent,
} from "@rsl/ui";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function collectTsxFiles(dir: string, acc: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "__tests__" || ent.name === "node_modules") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      collectTsxFiles(full, acc);
    } else if (ent.name.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

describe("Phase 36 — Bottom Guide Drawers, 5-Variable Palette, Frost/Blur, Typography & Dark Mode", () => {
  it("defines the 5 brand CSS variables, frost/hard-blur layers, 3-voice typography, and dark mode across web, admin, and docs", () => {
    const themeCss = fs.readFileSync(
      path.join(REPO_ROOT, "packages/ui/src/theme.css"),
      "utf8"
    );

    expect(themeCss).toContain("--butter-cream: #F4EAD5;");
    expect(themeCss).toContain("--forest-green: #1E3B2F;");
    expect(themeCss).toContain("--snow-white: #F6F4EE;");
    expect(themeCss).toContain("--midnight-black: #090A10;");
    expect(themeCss).toContain("--sunset-orange: #FF7A1A;");

    expect(themeCss).toContain("--blur-frost:");
    expect(themeCss).toContain("--blur-hard:");
    expect(themeCss).toContain(".rsl-frost-surface");
    expect(themeCss).toContain(".rsl-frost-card");
    expect(themeCss).toContain(".rsl-frost-header");
    expect(themeCss).toContain(".rsl-hard-blur-scrim");
    expect(themeCss).toContain(".rsl-drawer-frost");
    expect(themeCss).toContain('[data-theme="dark"]');

    for (const app of ["web", "admin", "docs"]) {
      const globalsCss = fs.readFileSync(
        path.join(REPO_ROOT, `apps/${app}/src/app/globals.css`),
        "utf8"
      );
      expect(globalsCss).toContain("packages/ui/src/theme.css");
      expect(globalsCss).toContain("--font-display:");
      expect(globalsCss).toContain("--font-sans:");
      expect(globalsCss).toContain("--font-mono:");
      expect(globalsCss).toContain("--color-butter-cream: var(--butter-cream)");
      expect(globalsCss).toContain("--color-forest-green: var(--forest-green)");
      expect(globalsCss).toContain("--color-snow-white: var(--snow-white)");
      expect(globalsCss).toContain("--color-midnight-black: var(--midnight-black)");
      expect(globalsCss).toContain("--color-sunset-orange: var(--sunset-orange)");

      const rootLayout = fs.readFileSync(
        path.join(REPO_ROOT, `apps/${app}/src/app/layout.tsx`),
        "utf8"
      );
      expect(rootLayout).toContain("Fraunces");
      expect(rootLayout).toContain("Plus_Jakarta_Sans");
      expect(rootLayout).toContain("JetBrains_Mono");
      expect(rootLayout).toContain("rsl_theme");
      expect(rootLayout).toContain("data-theme");
    }
  });

  it("enforces zero inline style attributes and zero hardcoded hex/rgb colors across all UI .tsx files", () => {
    const uiDirs = [
      path.join(REPO_ROOT, "packages/ui/src"),
      path.join(REPO_ROOT, "apps/web/src"),
      path.join(REPO_ROOT, "apps/admin/src"),
      path.join(REPO_ROOT, "apps/docs/src"),
    ];
    const tsxFiles = uiDirs.flatMap((d) => collectTsxFiles(d));
    expect(tsxFiles.length).toBeGreaterThan(80);

    const violations: string[] = [];
    for (const file of tsxFiles) {
      const rel = path.relative(REPO_ROOT, file);
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (/style=\{\{/.test(line) || /\bstyle="/.test(line)) {
          violations.push(`${rel}:${idx + 1} inline style -> ${line.trim()}`);
        }
        if (/rgba?\(/.test(line)) {
          violations.push(`${rel}:${idx + 1} hardcoded rgb/rgba -> ${line.trim()}`);
        }
        const hexMatches = line.match(
          /(?:bg-\[#|text-\[#|border-\[#|from-\[#|via-\[#|to-\[#|fill="#|stroke="#|color:\s*"#[0-9a-fA-F]{3,8}|#[0-9a-fA-F]{6}\b)/g
        );
        if (hexMatches) {
          violations.push(
            `${rel}:${idx + 1} hardcoded hex (${hexMatches.join(", ")}) -> ${line.trim()}`
          );
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it("renders GuideDrawer, GuideDrawerButton, and ThemeToggleButton cleanly with accessible attributes", () => {
    const sampleContent: GuideDrawerContent = {
      eyebrow: "Setup Guide",
      title: "Connect Tally Prime in 2 Minutes",
      summary: "Follow the numbered steps below.",
      roleNote: "Windows Connector",
      tabs: [
        {
          id: "exe",
          label: "Windows Connector",
          summary: "Outbound HTTPS pairing with zero firewall changes.",
          copyValues: [{ label: "Local Tally XML Port", value: "http://127.0.0.1:9000" }],
          steps: [
            {
              title: "Download Paired Launcher",
              detail: "Run the paired .cmd script on the Tally PC.",
            },
          ],
          cautions: ["Keep Tally Prime open with at least one active company loaded."],
        },
        {
          id: "tdl",
          label: "TDL Add-On",
          steps: [{ title: "Load .tdl in F1 Help", detail: "Attach under TDLs & Add-Ons." }],
        },
      ],
      fullGuideHref: "/help?slug=tally-sync-and-import",
      fullGuideLabel: "Full Help Guide →",
    };

    const buttonHtml = renderToStaticMarkup(
      React.createElement(GuideDrawerButton, {
        drawerId: "test-tally-drawer",
        label: "Need help? • Tally Setup",
        badgeText: "2 guides",
        guide: sampleContent,
      })
    );
    expect(buttonHtml).toContain("Need help? • Tally Setup");
    expect(buttonHtml).toContain("2 guides");
    expect(buttonHtml).toContain("rsl-guide-trigger");

    const openDrawerHtml = renderToStaticMarkup(
      React.createElement(GuideDrawer, {
        open: true,
        onClose: () => {},
        guide: sampleContent,
      })
    );
    expect(openDrawerHtml).toContain('role="dialog"');
    expect(openDrawerHtml).toContain('aria-modal="true"');
    expect(openDrawerHtml).toContain('role="tablist"');
    expect(openDrawerHtml).toContain("Connect Tally Prime in 2 Minutes");
    expect(openDrawerHtml).toContain("http://127.0.0.1:9000");
    expect(openDrawerHtml).toContain("Download Paired Launcher");
    expect(openDrawerHtml).toContain("Keep Tally Prime open");
    expect(openDrawerHtml).toContain("rsl-drawer-frost");
    expect(openDrawerHtml).toContain("rsl-hard-blur-scrim");

    const toggleHtml = renderToStaticMarkup(
      React.createElement(ThemeToggleButton, { showLabel: true })
    );
    expect(toggleHtml).toContain("aria-pressed");
    expect(toggleHtml).toContain("Dark");
  });

  it("removes inline tutorial walls from action pages while preserving dedicated guide routes", () => {
    const tallyStudio = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/components/tally-connect-studio.tsx"),
      "utf8"
    );
    expect(tallyStudio).toContain("GuideDrawerButton");
    expect(tallyStudio).not.toContain("Zero Technical Setup • Beginner Step-by-Step");

    const teamSettings = fs.readFileSync(
      path.join(REPO_ROOT, "apps/web/src/app/(dashboard)/settings/team/page.tsx"),
      "utf8"
    );
    expect(teamSettings).toContain("GuideDrawerButton");

    const adminCredentials = fs.readFileSync(
      path.join(REPO_ROOT, "apps/admin/src/app/(console)/credentials/page.tsx"),
      "utf8"
    );
    expect(adminCredentials).toContain("GuideDrawerButton");
    expect(adminCredentials).not.toContain(
      "Complete Admin Setup Guide — RapidShift Labs Google OAuth Screen"
    );

    expect(
      fs.existsSync(path.join(REPO_ROOT, "apps/web/src/app/(dashboard)/help/page.tsx"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(REPO_ROOT, "apps/admin/src/app/(console)/runbooks/page.tsx"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(REPO_ROOT, "apps/docs/src/app/guides/[slug]/page.tsx"))
    ).toBe(true);
  });

  it("enforces unlayered dark-mode utility overrides, zero-FOUC theme sync, Turnstile dark theme, and dark-safe button spinners", () => {
    const themeCss = fs.readFileSync(
      path.join(REPO_ROOT, "packages/ui/src/theme.css"),
      "utf8"
    );
    expect(themeCss).toContain('.bg-white:not(img)');
    expect(themeCss).toContain(':is(button, a, span):is(');
    expect(themeCss).toContain('[data-theme="dark"] .adm-btn-dark');
    expect(themeCss).toContain(".rsl-tab-pill-active");
    expect(themeCss).toContain(".rsl-chat-outbound");

    for (const app of ["web", "admin", "docs"]) {
      const globalsCss = fs.readFileSync(
        path.join(REPO_ROOT, `apps/${app}/src/app/globals.css`),
        "utf8"
      );
      expect(globalsCss).toContain("@custom-variant dark");

      const rootLayout = fs.readFileSync(
        path.join(REPO_ROOT, `apps/${app}/src/app/layout.tsx`),
        "utf8"
      );
      expect(rootLayout).toContain("THEME_INIT_SCRIPT");
    }

    const turnstileSrc = fs.readFileSync(
      path.join(REPO_ROOT, "packages/ui/src/turnstile-widget.tsx"),
      "utf8"
    );
    expect(turnstileSrc).toContain("rsl-theme-change");

    const uiDirs = [
      path.join(REPO_ROOT, "packages/ui/src"),
      path.join(REPO_ROOT, "apps/web/src"),
      path.join(REPO_ROOT, "apps/admin/src"),
      path.join(REPO_ROOT, "apps/docs/src"),
    ];
    const tsxFiles = uiDirs.flatMap((d) => collectTsxFiles(d));
    const whiteSpinners: string[] = [];
    for (const file of tsxFiles) {
      const rel = path.relative(REPO_ROOT, file);
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (/IosSpinner[^>]*text-white/.test(line)) {
          whiteSpinners.push(`${rel}:${idx + 1} -> ${line.trim()}`);
        }
      });
    }
    expect(whiteSpinners).toEqual([]);
  });
});
