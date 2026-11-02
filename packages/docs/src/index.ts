import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import matter from "gray-matter";
import { z } from "zod";
import { SERVICE_CATALOG } from "@rsl/billing";
import { ERROR_CATALOG, getEnv, newEntityId } from "@rsl/core";
import { controlSchema } from "@rsl/database";
import { ACTION_CATALOG, REGISTERED_API_ROUTES, type RegisteredApiRoute } from "@rsl/logging";
import { PERMISSION_CATALOG, SYSTEM_ROLES } from "@rsl/rbac";
import { controlDb } from "@rsl/tenancy";

export const DocFrontmatterSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(10),
  section: z.enum(["Getting Started", "Daily Operations", "Data & Cloud Storage", "Billing & Security", "Developers"]),
  audience: z.enum(["customer", "developer", "both"]).default("customer"),
  service: z.string().optional(),
  order: z.number().int().min(1).max(999).default(50),
  lastReviewed: z
    .union([z.string(), z.date()])
    .transform((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v))
    .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
});

export type DocFrontmatter = z.infer<typeof DocFrontmatterSchema>;

export interface LoadedDocArticle extends DocFrontmatter {
  slug: string;
  bodyMarkdown: string;
  headings: Array<{ level: 2 | 3; text: string; id: string }>;
  readingMinutes: number;
}

function findContentRoot(): string {
  const candidates = [
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), "content", "en"),
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "..", "content", "en"),
    path.resolve(/*turbopackIgnore: true*/ __dirname, "..", "..", "..", "content", "en"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ dir)) return dir;
  }
  return candidates[0]!;
}

function extractHeadings(markdown: string): Array<{ level: 2 | 3; text: string; id: string }> {
  const headings: Array<{ level: 2 | 3; text: string; id: string }> = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^(#{2,3})\s+(.+)$/.exec(line.trim());
    if (m) {
      const level = m[1]!.length as 2 | 3;
      const text = m[2]!.trim();
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      headings.push({ level, text, id });
    }
  }
  return headings;
}

export function loadAllDocArticles(): LoadedDocArticle[] {
  const contentDir = findContentRoot();
  if (!fs.existsSync(/*turbopackIgnore: true*/ contentDir)) return [];

  const files = fs
    .readdirSync(/*turbopackIgnore: true*/ contentDir)
    .filter((f) => f.endsWith(".md") || f.endsWith(".mdx"));
  const articles: LoadedDocArticle[] = [];

  for (const file of files) {
    const fullPath = path.join(/*turbopackIgnore: true*/ contentDir, file);
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ fullPath, "utf8");
    const parsed = matter(raw);
    const fm = DocFrontmatterSchema.parse(parsed.data);
    const slug = file.replace(/\.(md|mdx)$/, "");
    const words = parsed.content.trim().split(/\s+/).filter(Boolean).length;
    articles.push({
      ...fm,
      slug,
      bodyMarkdown: parsed.content.trim(),
      headings: extractHeadings(parsed.content),
      readingMinutes: Math.max(1, Math.round(words / 180)),
    });
  }

  return articles.sort((a, b) => a.order - b.order);
}

export function getDocArticleBySlug(slug: string): LoadedDocArticle | null {
  return loadAllDocArticles().find((a) => a.slug === slug) ?? null;
}

export const BUILTIN_API_ENDPOINTS: RegisteredApiRoute[] = [
  {
    id: "v1.contacts.list",
    method: "GET",
    path: "/api/v1/contacts",
    title: "List Customer Contacts",
    summary: "Returns paginated customer contacts for your business workspace.",
    scopes: ["contacts:read"],
    service: "api.access",
    rateLimitPerMin: 120,
    supportsIdempotency: false,
    errorCodes: ["RSL-API-1001", "RSL-API-1002", "RSL-API-1003", "RSL-BILL-1001"],
    responseExample: {
      ok: true,
      items: [
        {
          id: "cnt_yourbiz_01k9x8m4q2r7",
          name: "Aarav Hardware Mart",
          phoneE164: "+919820000001",
          email: "accounts@aaravhardware.in",
          lifetimeValuePaise: 2450000,
        },
      ],
    },
  },
  {
    id: "v1.contacts.create",
    method: "POST",
    path: "/api/v1/contacts",
    title: "Create or Update Customer Contact",
    summary: "Adds a customer contact (or updates by phone number) with an optional Idempotency-Key header.",
    scopes: ["contacts:write"],
    service: "api.access",
    rateLimitPerMin: 120,
    supportsIdempotency: true,
    errorCodes: ["RSL-API-1001", "RSL-API-1002", "RSL-VAL-1001"],
    requestExample: {
      name: "Mehta Electricals",
      phoneE164: "+919820011223",
      email: "billing@mehtaelectricals.in",
      companyName: "Mehta Electricals Pvt Ltd",
    },
    responseExample: {
      ok: true,
      contact: {
        id: "cnt_yourbiz_01k9x9a2m4p8",
        name: "Mehta Electricals",
        phoneE164: "+919820011223",
      },
    },
  },
  {
    id: "v1.vouchers.list",
    method: "GET",
    path: "/api/v1/vouchers",
    title: "List Tally Bills & Payment Receipts",
    summary: "Returns synced or imported Tally Prime sales bills and payment receipts.",
    scopes: ["vouchers:read"],
    service: "api.access",
    rateLimitPerMin: 120,
    supportsIdempotency: false,
    errorCodes: ["RSL-API-1001", "RSL-API-1002", "RSL-BILL-1001"],
    responseExample: {
      ok: true,
      vouchers: [
        {
          id: "tvch_yourbiz_01k9xa3n5r9w",
          voucherNumber: "GST/26-27/0108",
          voucherType: "Sales",
          partyName: "Mehta Electricals",
          amountPaise: 1485000,
          paidAmountPaise: 0,
          paymentStatus: "unpaid",
        },
      ],
    },
  },
  {
    id: "v1.vouchers.upsert",
    method: "POST",
    path: "/api/v1/vouchers",
    title: "Record a Bill or Payment Receipt",
    summary: "Creates or updates a sales bill or payment receipt from your ERP or checkout flow.",
    scopes: ["vouchers:write"],
    service: "api.access",
    rateLimitPerMin: 120,
    supportsIdempotency: true,
    errorCodes: ["RSL-API-1001", "RSL-API-1002", "RSL-VAL-1001"],
    requestExample: {
      companyName: "Main Trading Co",
      voucherNumber: "INV-2026-409",
      voucherType: "Sales",
      partyName: "Mehta Electricals",
      partyPhoneE164: "+919820011223",
      amountRupees: 14850,
      paidAmountRupees: 0,
    },
    responseExample: {
      ok: true,
      voucherId: "tvch_yourbiz_01k9xb7q2k4m",
    },
  },
  {
    id: "v1.tally.bill_event",
    method: "POST",
    path: "/api/v1/tally/bill-event",
    title: "Push Tally Bill & Trigger Automated WhatsApp Message",
    summary: "Saves a Tally sales bill or receipt and immediately queues any matching WhatsApp template rules in the background worker.",
    scopes: ["vouchers:write"],
    service: "tally.sync",
    rateLimitPerMin: 120,
    supportsIdempotency: true,
    errorCodes: ["RSL-API-1001", "RSL-API-1002", "RSL-BILL-1001", "RSL-VAL-1001"],
    requestExample: {
      companyName: "Shree Traders",
      voucherNumber: "GST/26-27/0412",
      voucherType: "Sales",
      partyName: "Mehta Electricals",
      partyPhone: "9820011223",
      amountRupees: 18500,
      dueDate: "2026-11-15",
    },
    responseExample: {
      ok: true,
      voucherId: "tvch_yourbiz_01k9xc4p9m2n",
      queuedMessagesCount: 1,
    },
  },
  {
    id: "v1.whatsapp.send_template",
    method: "POST",
    path: "/api/v1/whatsapp/send-template",
    title: "Send Approved WhatsApp Business Template",
    summary: "Queues an approved WhatsApp Business template message to a customer phone number with template variables.",
    scopes: ["whatsapp:write"],
    service: "whatsapp.messaging",
    rateLimitPerMin: 120,
    supportsIdempotency: true,
    errorCodes: ["RSL-API-1001", "RSL-API-1002", "RSL-BILL-1001", "RSL-BILL-1003", "RSL-WA-1002"],
    requestExample: {
      phone: "+919820011223",
      customerName: "Mehta Electricals",
      templateName: "tally_sales_bill_created",
      variables: {
        "1": "Mehta Electricals",
        "2": "GST/26-27/0412",
        "3": "₹18,500",
        "4": "15 Nov 2026",
      },
    },
    responseExample: {
      ok: true,
      jobId: "out_yourbiz_01k9xd8s1w3z",
      status: "queued",
    },
  },
  {
    id: "v1.analytics.summary",
    method: "GET",
    path: "/api/v1/analytics",
    title: "Get Business Cashflow, Messages & Receivables Analytics",
    summary: "Returns live workspace KPIs, Tally receivables aging buckets, channel performance, and daily time series (range=7d|30d|90d|365d|all).",
    scopes: ["analytics:read"],
    service: "api.access",
    rateLimitPerMin: 120,
    supportsIdempotency: false,
    errorCodes: ["RSL-API-1001", "RSL-API-1002", "RSL-API-1003", "RSL-BILL-1001"],
    responseExample: {
      ok: true,
      workspaceId: "01K9X000000000000000000000",
      range: "30d",
      daysCount: 30,
      kpis: {
        moneyCollectedPaise: 2450000,
        pendingReceivablesPaise: 840000,
        unpaidBillsCount: 4,
        messagesInCount: 42,
        messagesOutCount: 68,
        walletBalancePaise: 250000,
      },
    },
  },
];

export function getApiReferenceEndpoints(): RegisteredApiRoute[] {
  const byKey = new Map<string, RegisteredApiRoute>();
  for (const ep of BUILTIN_API_ENDPOINTS) {
    byKey.set(`${ep.method}:${ep.path}`, ep);
  }
  for (const ep of REGISTERED_API_ROUTES) {
    byKey.set(`${ep.method}:${ep.path}`, ep);
  }
  return Array.from(byKey.values());
}

export function generateCodeSamples(endpoint: RegisteredApiRoute, baseUrl = "https://app.rapidshiftlabs.in") {
  const fullUrl = `${baseUrl}${endpoint.path}`;
  const bodyJson = endpoint.requestExample ? JSON.stringify(endpoint.requestExample, null, 2) : null;

  const curl = bodyJson
    ? `curl -X ${endpoint.method} "${fullUrl}" \\\n  -H "Authorization: Bearer rsl_live_yourbiz_secret" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: req_001" \\\n  -d '${bodyJson}'`
    : `curl -X ${endpoint.method} "${fullUrl}" \\\n  -H "Authorization: Bearer rsl_live_yourbiz_secret"`;

  const javascript = bodyJson
    ? `const response = await fetch("${fullUrl}", {\n  method: "${endpoint.method}",\n  headers: {\n    "Authorization": \`Bearer \${process.env.RSL_API_KEY}\`,\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify(${bodyJson}),\n});\nconst data = await response.json();`
    : `const response = await fetch("${fullUrl}", {\n  headers: { "Authorization": \`Bearer \${process.env.RSL_API_KEY}\` },\n});\nconst data = await response.json();`;

  const python = bodyJson
    ? `import os, requests\n\nres = requests.${endpoint.method.toLowerCase()}(\n    "${fullUrl}",\n    headers={"Authorization": f"Bearer {os.environ['RSL_API_KEY']}"},\n    json=${bodyJson},\n    timeout=15,\n)\nprint(res.json())`
    : `import os, requests\n\nres = requests.get(\n    "${fullUrl}",\n    headers={"Authorization": f"Bearer {os.environ['RSL_API_KEY']}"},\n    timeout=15,\n)\nprint(res.json())`;

  const php = `$ch = curl_init("${fullUrl}");\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\ncurl_setopt($ch, CURLOPT_CUSTOMREQUEST, "${endpoint.method}");\ncurl_setopt($ch, CURLOPT_HTTPHEADER, [\n  "Authorization: Bearer " . getenv("RSL_API_KEY"),\n  "Content-Type: application/json"\n]);${
    bodyJson ? `\ncurl_setopt($ch, CURLOPT_POSTFIELDS, '${JSON.stringify(endpoint.requestExample)}');` : ""
  }\n$response = curl_exec($ch);`;

  const go = `req, _ := http.NewRequest("${endpoint.method}", "${fullUrl}", ${
    bodyJson ? `strings.NewReader(\`${JSON.stringify(endpoint.requestExample)}\`)` : "nil"
  })\nreq.Header.Set("Authorization", "Bearer "+os.Getenv("RSL_API_KEY"))\nreq.Header.Set("Content-Type", "application/json")\nresp, err := http.DefaultClient.Do(req)`;

  return { curl, javascript, python, php, go };
}

export function generateOpenApiSpec(baseUrl = "https://app.rapidshiftlabs.in") {
  const endpoints = getApiReferenceEndpoints();
  const paths: Record<string, Record<string, unknown>> = {};

  for (const ep of endpoints) {
    paths[ep.path] ??= {};
    paths[ep.path]![ep.method.toLowerCase()] = {
      operationId: ep.id,
      summary: ep.title,
      description: ep.summary,
      security: [{ BearerApiKey: ep.scopes }],
      responses: {
        "200": {
          description: "Successful response",
          content: {
            "application/json": {
              example: ep.responseExample,
            },
          },
        },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "RapidShift Labs Platform Public API",
      version: "1.1.0",
      description:
        "Official REST API on rapidshiftlabs.in and *.api.rapidshiftlabs.in for contacts, Tally bills, exact Tally PDFs, receipts, and WhatsApp notifications.",
    },
    servers: [
      { url: baseUrl, description: "Primary Cloud API" },
      {
        url: "https://{workspace}.api.rapidshiftlabs.in",
        description: "Dedicated Client SSL API Subdomain",
        variables: {
          workspace: { default: "your-business" },
        },
      },
    ],
    components: {
      securitySchemes: {
        BearerApiKey: {
          type: "http",
          scheme: "bearer",
          description: "Use your rsl_live_<business>_... or rsl_test_<business>_... API key.",
        },
      },
    },
    paths,
  };
}

export function getAutoGeneratedRegistries() {
  return {
    roles: SYSTEM_ROLES,
    permissions: PERMISSION_CATALOG,
    errors: Object.values(ERROR_CATALOG),
    services: SERVICE_CATALOG,
    actions: Object.values(ACTION_CATALOG),
    apiEndpoints: getApiReferenceEndpoints(),
  };
}

function getDocsSearchDbPath(): string {
  const env = getEnv();
  const dir = path.join(env.DATA_DIR, "platform");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, "docs-index.db");
}

export function buildDocsSearchIndex(): { indexedItems: number; dbPath: string } {
  const dbPath = getDocsSearchDbPath();
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`
    DROP TABLE IF EXISTS docs_fts;
    CREATE VIRTUAL TABLE docs_fts USING fts5(
      kind,
      slug,
      title,
      summary,
      body,
      tokenize='porter unicode61'
    );
  `);

  const insertStmt = sqlite.prepare(
    `INSERT INTO docs_fts (kind, slug, title, summary, body) VALUES (?, ?, ?, ?, ?)`
  );

  const articles = loadAllDocArticles();
  const endpoints = getApiReferenceEndpoints();
  const errors = Object.values(ERROR_CATALOG);

  const tx = sqlite.transaction(() => {
    for (const a of articles) {
      insertStmt.run("guide", `/guides/${a.slug}`, a.title, a.summary, a.bodyMarkdown);
    }
    for (const errItem of errors) {
      insertStmt.run(
        "error",
        `/errors#${errItem.code}`,
        `${errItem.code} — ${errItem.userMessage}`,
        errItem.remediation,
        `${errItem.code} ${errItem.title} ${errItem.userMessage} ${errItem.remediation}`
      );
    }
    for (const ep of endpoints) {
      insertStmt.run(
        "api",
        `/api-reference#${ep.id}`,
        `${ep.method} ${ep.path} — ${ep.title}`,
        ep.summary,
        `${ep.method} ${ep.path} ${ep.scopes.join(" ")} ${ep.summary}`
      );
    }
  });

  tx();
  const total = articles.length + errors.length + endpoints.length;
  sqlite.close();
  return { indexedItems: total, dbPath };
}

export interface DocsSearchHit {
  kind: "guide" | "error" | "api";
  href: string;
  title: string;
  summary: string;
}

export function searchDocs(query: string, surface: "public" | "help" | "admin" = "public"): DocsSearchHit[] {
  const cleaned = query.trim();
  if (!cleaned) return [];

  const dbPath = getDocsSearchDbPath();
  if (!fs.existsSync(dbPath)) {
    buildDocsSearchIndex();
  }

  const safeTokens = cleaned
    .replace(/[^a-zA-Z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => `"${tok}"*`)
    .join(" OR ");

  let results: DocsSearchHit[] = [];
  if (safeTokens) {
    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const rows = sqlite
        .prepare(
          `SELECT kind, slug AS href, title, summary
           FROM docs_fts
           WHERE docs_fts MATCH ?
           ORDER BY rank
           LIMIT 15`
        )
        .all(safeTokens) as DocsSearchHit[];
      results = rows;
    } finally {
      sqlite.close();
    }
  }

  try {
    controlDb()
      .insert(controlSchema.docsSearchLogs)
      .values({
        id: newEntityId("req", "docs"),
        query: cleaned.slice(0, 160),
        resultCount: results.length,
        surface,
        createdAt: Date.now(),
      })
      .run();
  } catch {
    // Non-blocking search analytics
  }

  return results;
}

export function recordDocsFeedback(params: {
  slug: string;
  helpful: boolean;
  comment?: string;
  workspaceId?: string | null;
}) {
  const id = newEntityId("req", params.workspaceId ?? "docs");
  controlDb()
    .insert(controlSchema.docsFeedback)
    .values({
      id,
      slug: params.slug.slice(0, 120),
      helpful: params.helpful,
      comment: params.comment?.trim().slice(0, 500) || null,
      workspaceId: params.workspaceId ?? null,
      createdAt: Date.now(),
    })
    .run();
  return { id };
}
