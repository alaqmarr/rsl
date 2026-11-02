import { buildDocsSearchIndex, loadAllDocArticles } from "../index";

const articles = loadAllDocArticles();
const built = buildDocsSearchIndex();
console.log(
  `[rsl-docs] Built search index with ${built.indexedItems} entries (${articles.length} guides) -> ${built.dbPath}`
);
