export function formatCustomerAuditSummary(summary: string): string {
  return summary
    .replace(/\s+and provisioned isolated SQLite databases/gi, "")
    .replace(/\bSQLite\s+/gi, "")
    .replace(/\bWAL\s+checkpoint\b/gi, "workspace optimization")
    .replace(/\binstagram_feed\b/g, "Instagram Feed")
    .replace(/\binstagram_reel\b/g, "Instagram Reel")
    .replace(/\bfacebook_page\b/g, "Facebook Page")
    .replace(/\bgoogle_post\b/g, "Google Business")
    .replace(/\bWHATSAPP\b/g, "WhatsApp")
    .trim();
}
