import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface AgentStateFile {
  serverUrl: string;
  deviceId: string;
  signingSecret: string;
  workspaceId: string;
  deviceName: string;
  tallyHost: string;
  tallyPort: number;
  lastAlterId: number;
  companyAlterIds?: Record<string, number>;
  pairedAt: string;
}

const AGENT_VERSION = "2.2.0";
const DEFAULT_CLOUD_URL = "https://app.rapidshiftlabs.in";
const STATE_PATH =
  process.env.RSL_TALLY_AGENT_STATE ||
  path.join(os.homedir(), ".rsl-tally-agent", "device-state.json");

export function parseAgentCliFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith("--")) continue;
    const eqIdx = token.indexOf("=");
    if (eqIdx > 2) {
      flags[token.slice(2, eqIdx)] = token.slice(eqIdx + 1);
    } else {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return flags;
}

function escapeXml(val: string): string {
  return val
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(val: string): string {
  return val
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .trim();
}

function signPayload(signingSecret: string, rawBody: string): { timestamp: string; signature: string } {
  const timestamp = String(Date.now());
  const signature = crypto
    .createHmac("sha256", signingSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return { timestamp, signature };
}

function loadState(): AgentStateFile | null {
  try {
    if (!fs.existsSync(STATE_PATH)) return null;
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as AgentStateFile;
  } catch {
    return null;
  }
}

function saveState(state: AgentStateFile): void {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true, mode: 0o700 });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
}

async function pairDevice(params: {
  serverUrl: string;
  pairingCode: string;
  deviceName: string;
  tallyHost: string;
  tallyPort: number;
}): Promise<AgentStateFile> {
  const cleanServerUrl = params.serverUrl.replace(/\/+$/, "");
  const res = await fetch(`${cleanServerUrl}/api/agent/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pairingCode: params.pairingCode.trim(),
      deviceName: params.deviceName.trim() || os.hostname(),
      osVersion: `${os.platform()} ${os.release()}`,
      agentVersion: AGENT_VERSION,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Pairing failed (HTTP ${res.status}): ${errText}`);
  }

  const json = (await res.json()) as {
    deviceId: string;
    signingSecret: string;
    workspaceId: string;
    tallyCloudBaseUrl?: string;
  };

  const preferredServerUrl =
    json.tallyCloudBaseUrl && cleanServerUrl === DEFAULT_CLOUD_URL
      ? json.tallyCloudBaseUrl.replace(/\/+$/, "")
      : cleanServerUrl;

  const state: AgentStateFile = {
    serverUrl: preferredServerUrl,
    deviceId: json.deviceId,
    signingSecret: json.signingSecret,
    workspaceId: json.workspaceId,
    deviceName: params.deviceName.trim() || os.hostname(),
    tallyHost: params.tallyHost,
    tallyPort: params.tallyPort,
    lastAlterId: 0,
    companyAlterIds: {},
    pairedAt: new Date().toISOString(),
  };

  saveState(state);
  console.log(
    `[rsl-tally-agent] Paired PC '${state.deviceName}' -> Workspace ${state.workspaceId} (${state.serverUrl})`
  );
  return state;
}

function buildOpenCompaniesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>RSLOpenCompanies</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="RSLOpenCompanies" ISMODIFY="No">
            <TYPE>Company</TYPE>
            <NATIVEMETHOD>Name, GUID</NATIVEMETHOD>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function buildIncrementalTallyCollectionXml(sinceAlterId: number, companyName?: string): string {
  const companyTag = companyName?.trim()
    ? `\n        <SVCURRENTCOMPANY>${escapeXml(companyName.trim())}</SVCURRENTCOMPANY>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>RSLSyncVouchers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>${companyTag}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="RSLSyncVouchers" ISMODIFY="No">
            <TYPE>Voucher</TYPE>
            <NATIVEMETHOD>MasterID, GUID, AlterID, Date, VoucherNumber, VoucherTypeName, PartyLedgerName, PartyMobileNo, Amount, BasicDueDateOfPymt, IsCancelled, IsOptional</NATIVEMETHOD>
            <NATIVEMETHOD>LedgerEntries.LedgerName, LedgerEntries.IsPartyLedger, LedgerEntries.Amount</NATIVEMETHOD>
            <NATIVEMETHOD>AllLedgerEntries.LedgerName, AllLedgerEntries.IsPartyLedger, AllLedgerEntries.Amount</NATIVEMETHOD>
            <COMPUTE>RSLPartyPhone : $LedgerMobile:Ledger:$PartyLedgerName</COMPUTE>
            <COMPUTE>RSLBaseVchType : $Parent:VoucherType:$VoucherTypeName</COMPUTE>
            <COMPUTE>SVCurrentCompany : $$CurrentCompany</COMPUTE>
            <FILTER>RSLAlterFilter</FILTER>
          </COLLECTION>
          <SYSTEM TYPE="Formulae" NAME="RSLAlterFilter">$AlterID > ${Math.max(0, Math.trunc(sinceAlterId))}</SYSTEM>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/**
 * Exports Tally Prime's exact native printed Voucher PDF (%PDF-1.x) without altering the client's invoice design.
 */
function buildNativeTallyVoucherPdfXml(masterId: string, companyName?: string): string {
  const cleanMasterId = masterId.replace(/[^0-9]/g, "");
  const companyTag = companyName?.trim()
    ? `\n        <SVCURRENTCOMPANY>${escapeXml(companyName.trim())}</SVCURRENTCOMPANY>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>RSLNativeVoucherPrint</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:PDF</SVEXPORTFORMAT>
        <SVPRINTMODE>0</SVPRINTMODE>${companyTag}
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <REPORT NAME="RSLNativeVoucherPrint" ISMODIFY="No">
            <USE>Voucher</USE>
            <OBJECT>Voucher : "ID:${cleanMasterId}"</OBJECT>
          </REPORT>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

async function fetchOpenCompanies(tallyHost: string, tallyPort: number): Promise<{
  reachable: boolean;
  companies: string[];
  errorMessage: string | null;
}> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`http://${tallyHost}:${tallyPort}`, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body: buildOpenCompaniesXml(),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      return {
        reachable: false,
        companies: [],
        errorMessage: `Tally XML port responded with HTTP ${resp.status}`,
      };
    }
    const xml = await resp.text();
    const blocks = xml.match(/<COMPANY(?:\s[^>]*)?>[\s\S]*?<\/COMPANY>/gi) ?? [];
    const companies: string[] = [];
    for (const block of blocks) {
      const tagMatch = block.match(/<NAME[^>]*>([\s\S]*?)<\/NAME>/i);
      const attrMatch = block.match(/<COMPANY[^>]*\bNAME="([^"]+)"/i);
      const name = unescapeXml(tagMatch?.[1] ?? attrMatch?.[1] ?? "");
      if (name && !companies.includes(name)) companies.push(name);
    }
    return { reachable: true, companies, errorMessage: null };
  } catch (err) {
    return {
      reachable: false,
      companies: [],
      errorMessage:
        err instanceof Error
          ? err.message
          : `Could not connect to Tally Prime on ${tallyHost}:${tallyPort}`,
    };
  }
}

async function fetchTallyVouchersXml(
  tallyHost: string,
  tallyPort: number,
  sinceAlterId: number,
  companyName?: string
): Promise<{
  reachable: boolean;
  xml: string | null;
  companyName: string | null;
  errorMessage: string | null;
}> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(`http://${tallyHost}:${tallyPort}`, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body: buildIncrementalTallyCollectionXml(sinceAlterId, companyName),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      return {
        reachable: false,
        xml: null,
        companyName: null,
        errorMessage: `Tally XML port responded with HTTP ${resp.status}`,
      };
    }

    const xml = await resp.text();
    const compMatch = xml.match(/<SVCURRENTCOMPANY[^>]*>([\s\S]*?)<\/SVCURRENTCOMPANY>/i);
    return {
      reachable: true,
      xml,
      companyName: companyName || unescapeXml(compMatch?.[1] ?? "") || null,
      errorMessage: null,
    };
  } catch (err) {
    return {
      reachable: false,
      xml: null,
      companyName: null,
      errorMessage:
        err instanceof Error
          ? err.message
          : `Could not connect to Tally Prime on ${tallyHost}:${tallyPort}`,
    };
  }
}

async function exportNativeVoucherPdfs(
  tallyHost: string,
  tallyPort: number,
  xmlContent: string,
  companyName: string | null
): Promise<
  Array<{
    guid: string;
    masterId: string;
    voucherNumber: string;
    voucherType: string;
    companyName?: string;
    alterId: number;
    pdfBase64: string;
  }>
> {
  const blocks = xmlContent.match(/<VOUCHER(?:\s[^>]*)?>[\s\S]*?<\/VOUCHER>/gi) ?? [];
  const results: Array<{
    guid: string;
    masterId: string;
    voucherNumber: string;
    voucherType: string;
    companyName?: string;
    alterId: number;
    pdfBase64: string;
  }> = [];

  for (const block of blocks.slice(0, 12)) {
    const isCancelled = /<ISCANCELLED[^>]*>\s*Yes\s*<\/ISCANCELLED>/i.test(block);
    const isOptional = /<ISOPTIONAL[^>]*>\s*Yes\s*<\/ISOPTIONAL>/i.test(block);
    if (isCancelled || isOptional) continue;

    const masterId = (block.match(/<MASTERID[^>]*>([\s\S]*?)<\/MASTERID>/i)?.[1] ?? "").replace(
      /[^0-9]/g,
      ""
    );
    const guid = unescapeXml(block.match(/<GUID[^>]*>([\s\S]*?)<\/GUID>/i)?.[1] ?? "");
    const voucherNumber = unescapeXml(
      block.match(/<VOUCHERNUMBER[^>]*>([\s\S]*?)<\/VOUCHERNUMBER>/i)?.[1] ?? ""
    );
    const voucherType = unescapeXml(
      block.match(/<RSLBASEVCHTYPE[^>]*>([\s\S]*?)<\/RSLBASEVCHTYPE>/i)?.[1] ??
        block.match(/<VOUCHERTYPENAME[^>]*>([\s\S]*?)<\/VOUCHERTYPENAME>/i)?.[1] ??
        "Sales"
    );
    const alterId = Number(
      (block.match(/<ALTERID[^>]*>\s*(\d+)\s*<\/ALTERID>/i)?.[1] ?? "0").trim()
    );
    if (!masterId || !guid || /purchase/i.test(voucherType)) continue;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const pdfResp = await fetch(`http://${tallyHost}:${tallyPort}`, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8" },
        body: buildNativeTallyVoucherPdfXml(masterId, companyName ?? undefined),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!pdfResp.ok) continue;
      const buf = Buffer.from(await pdfResp.arrayBuffer());
      if (buf.length >= 120 && buf.subarray(0, 5).toString("latin1") === "%PDF-") {
        results.push({
          guid,
          masterId,
          voucherNumber: voucherNumber || masterId,
          voucherType,
          companyName: companyName ?? undefined,
          alterId: Number.isFinite(alterId) ? alterId : 0,
          pdfBase64: buf.toString("base64"),
        });
      }
    } catch {
      // Skip non-fatal PDF export error
    }
  }

  return results;
}

function extractMaxAlterId(xml: string): number {
  let maxId = 0;
  const matches = xml.matchAll(/<ALTERID[^>]*>\s*(\d+)\s*<\/ALTERID>/gi);
  for (const m of matches) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > maxId) maxId = n;
  }
  return maxId;
}

async function sendSignedHeartbeat(
  state: AgentStateFile,
  probe: { reachable: boolean; companyName: string | null; errorMessage: string | null }
): Promise<void> {
  const body = JSON.stringify({
    agentVersion: AGENT_VERSION,
    osVersion: `${os.platform()} ${os.release()}`,
    tallyReachable: probe.reachable,
    tallyHost: state.tallyHost,
    tallyPort: state.tallyPort,
    activeCompanyName: probe.companyName,
    lastAlterId: state.lastAlterId,
    lastErrorMessage: probe.errorMessage,
    hostname: os.hostname(),
  });
  const { timestamp, signature } = signPayload(state.signingSecret, body);

  await fetch(`${state.serverUrl}/api/agent/heartbeat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RSL-Device-Id": state.deviceId,
      "X-RSL-Timestamp": timestamp,
      "X-RSL-Signature": signature,
    },
    body,
  });
}

async function pushTallyXmlToCloud(params: {
  state: AgentStateFile;
  xmlContent: string;
  companyName: string | null;
  fullSnapshot: boolean;
  voucherPdfs: Array<{
    guid: string;
    masterId: string;
    voucherNumber: string;
    voucherType: string;
    companyName?: string;
    alterId: number;
    pdfBase64: string;
  }>;
}): Promise<void> {
  const { state, xmlContent, companyName, fullSnapshot, voucherPdfs } = params;
  const body = JSON.stringify({
    format: "tally_xml",
    rawXml: xmlContent,
    rawContent: xmlContent,
    companyName: companyName ?? undefined,
    fullSnapshot,
    voucherPdfs,
  });
  const { timestamp, signature } = signPayload(state.signingSecret, body);

  const res = await fetch(`${state.serverUrl}/api/agent/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RSL-Device-Id": state.deviceId,
      "X-RSL-Timestamp": timestamp,
      "X-RSL-Signature": signature,
    },
    body,
  });

  if (res.ok) {
    const out = (await res.json()) as {
      upserted?: number;
      deletedCount?: number;
      queuedJobs?: number;
      maxAlterId?: number;
    };
    const nextAlterId = Math.max(
      companyName ? state.companyAlterIds?.[companyName] ?? 0 : state.lastAlterId,
      out.maxAlterId ?? 0,
      extractMaxAlterId(xmlContent)
    );
    state.companyAlterIds ??= {};
    if (companyName) {
      state.companyAlterIds[companyName] = nextAlterId;
    }
    if (nextAlterId > state.lastAlterId) {
      state.lastAlterId = nextAlterId;
    }
    saveState(state);
    console.log(
      `[rsl-tally-agent] Synced ${out.upserted ?? 0} voucher(s) (${voucherPdfs.length} native Tally PDF(s), ${out.deletedCount ?? 0} deleted) | Queued ${out.queuedJobs ?? 0} WhatsApp job(s) | AlterID=${nextAlterId}`
    );
  } else {
    const errText = await res.text();
    throw new Error(`Cloud ingest HTTP ${res.status}: ${errText}`);
  }
}

async function main() {
  const flags = parseAgentCliFlags(process.argv.slice(2));
  const pairCode = flags.pair || flags.code;
  const serverArg = (
    flags.server ||
    process.env.RSL_SERVER_URL ||
    DEFAULT_CLOUD_URL
  ).replace(/\/+$/, "");
  const tallyHost = flags["tally-host"] || process.env.TALLY_HOST || "127.0.0.1";
  const tallyPort = Number(flags["tally-port"] || process.env.TALLY_PORT || "9000");
  const deviceName = flags.device || os.hostname();

  if (flags.doctor === "true") {
    console.log(
      `[rsl-tally-agent] Running connectivity check -> Cloud (${serverArg}) & Local Tally (http://${tallyHost}:${tallyPort})...`
    );
    const openComp = await fetchOpenCompanies(tallyHost, tallyPort);
    console.log(
      openComp.reachable
        ? `  [OK] Tally Prime XML Server reachable on ${tallyHost}:${tallyPort}${openComp.companies.length ? ` (Open: ${openComp.companies.join(", ")})` : ""}`
        : `  [WARN] Tally Prime port ${tallyPort} closed or unreachable: ${openComp.errorMessage}`
    );
    const cloudHealth = await fetch(`${serverArg}/api/health`)
      .then((r) => r.ok)
      .catch(() => false);
    console.log(
      cloudHealth
        ? `  [OK] RapidShift Labs Cloud reachable (${serverArg})`
        : `  [ERR] RapidShift Labs Cloud unreachable (${serverArg})`
    );
    process.exit(openComp.reachable && cloudHealth ? 0 : 1);
  }

  let state = loadState();
  if (pairCode) {
    state = await pairDevice({
      serverUrl: serverArg,
      pairingCode: pairCode,
      deviceName,
      tallyHost,
      tallyPort,
    });
    if (flags.once === "true") return;
  }

  if (!state) {
    console.log(
      `Usage: pnpm --filter @rsl/tally-agent start -- --pair RSL-XXXXXX-XXXXXX --server ${DEFAULT_CLOUD_URL} --device "Accounts Office PC"`
    );
    return;
  }

  if (flags.server) state.serverUrl = serverArg;
  if (flags["tally-host"]) state.tallyHost = tallyHost;
  if (flags["tally-port"]) state.tallyPort = tallyPort;

  console.log(
    `[rsl-tally-agent] Watching Tally Prime at http://${state.tallyHost}:${state.tallyPort} -> ${state.serverUrl}`
  );

  let tickCounter = 0;
  const lastDigestByCompany = new Map<string, string>();
  const tick = async () => {
    tickCounter++;
    const fullReconcilePass = tickCounter === 1 || tickCounter % 4 === 0;
    const openComp = await fetchOpenCompanies(state!.tallyHost, state!.tallyPort);

    await sendSignedHeartbeat(state!, {
      reachable: openComp.reachable,
      companyName: openComp.companies.join(", ") || null,
      errorMessage: openComp.errorMessage,
    }).catch((err) =>
      console.error("[rsl-tally-agent] Heartbeat warning:", err instanceof Error ? err.message : err)
    );

    if (!openComp.reachable) return;
    const companiesToPoll = openComp.companies.length > 0 ? openComp.companies : [""];

    for (const companyName of companiesToPoll) {
      const sinceAlterId = fullReconcilePass
        ? 0
        : (companyName ? state!.companyAlterIds?.[companyName] : state!.lastAlterId) || 0;

      const probe = await fetchTallyVouchersXml(
        state!.tallyHost,
        state!.tallyPort,
        sinceAlterId,
        companyName || undefined
      );
      if (!probe.reachable || !probe.xml) continue;

      const hasVouchers = /<VOUCHER[\s>]/i.test(probe.xml);
      if (!hasVouchers && !fullReconcilePass) continue;

      const digest = crypto.createHash("sha256").update(probe.xml).digest("hex");
      const key = companyName || "__active__";
      if (lastDigestByCompany.get(key) === digest) continue;
      lastDigestByCompany.set(key, digest);

      const voucherPdfs = hasVouchers
        ? await exportNativeVoucherPdfs(
            state!.tallyHost,
            state!.tallyPort,
            probe.xml,
            probe.companyName
          )
        : [];

      await pushTallyXmlToCloud({
        state: state!,
        xmlContent: probe.xml,
        companyName: probe.companyName,
        fullSnapshot: fullReconcilePass && Boolean(probe.companyName),
        voucherPdfs,
      }).catch((err) =>
        console.error("[rsl-tally-agent] Sync warning:", err instanceof Error ? err.message : err)
      );
    }
  };

  await tick();
  if (flags.once === "true") return;
  setInterval(() => void tick(), 30_000);
}

const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith("index.ts") || process.argv[1].endsWith("index.js"));

if (isDirectExecution) {
  main().catch((err) => {
    console.error("[rsl-tally-agent] Error:", err);
    process.exit(1);
  });
}
