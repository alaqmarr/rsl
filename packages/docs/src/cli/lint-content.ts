import { ERROR_CATALOG } from "@rsl/core";
import { SERVICE_CATALOG } from "@rsl/billing";
import { loadAllDocArticles } from "../index";

const articles = loadAllDocArticles();
if (articles.length === 0) {
  console.error("[rsl-docs] No markdown guides found in content/en/");
  process.exit(1);
}

const validServices = new Set(SERVICE_CATALOG.map((s) => s.key));
const validSlugs = new Set(articles.map((a) => a.slug));
let errors = 0;

for (const article of articles) {
  if (article.service && !validServices.has(article.service)) {
    console.error(`[rsl-docs] Guide "${article.slug}" references unknown service key "${article.service}"`);
    errors++;
  }

  // Validate internal /guides/<slug> links
  const linkMatches = article.bodyMarkdown.matchAll(/\]\(\/guides\/([a-z0-9-]+)\)/g);
  for (const m of linkMatches) {
    const targetSlug = m[1]!;
    if (!validSlugs.has(targetSlug)) {
      console.error(`[rsl-docs] Broken internal guide link in "${article.slug}": /guides/${targetSlug}`);
      errors++;
    }
  }
}

console.log(
  `[rsl-docs] Verified ${articles.length} guides, ${Object.keys(ERROR_CATALOG).length} error codes, and ${validServices.size} services.`
);
if (errors > 0) {
  process.exit(1);
}
