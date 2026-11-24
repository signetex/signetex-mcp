/**
 * Signetex read-only remote MCP server (Cloudflare Worker).
 * Streamable HTTP at /mcp. Data is fetched from the public static register
 * on https://signetex.ch (public entries plus MCP-only entries under
 * /data/mcp/) and cached for one hour. Internal (paywalled) entries and
 * Futures essays are never included. No KV or R2: origin JSON plus the
 * Cache API keeps the Worker inside the USD 5 Workers Paid plan.
 */
const SITE = "https://signetex.ch";
// DATA_REV only changes the cache key of the three index files so a new data release is read at once.
const DATA_REV = "2026-11-23ev9";
const INDEX_URL = `${SITE}/data/index.json?rev=${DATA_REV}`;
const MCP_INDEX_URL = `${SITE}/data/mcp/index.json?rev=${DATA_REV}`;
const DASHBOARD_URL = `${SITE}/data/dashboard.json?rev=${DATA_REV}`;
const PROOFS_URL = `${SITE}/proofs/index.json`;
const METHOD_URL = `${SITE}/en/methodology.html`;
const ENTRY_URL = (id) => `${SITE}/data/entries/${encodeURIComponent(id)}.json`;
const MCP_ENTRY_URL = (id) => `${SITE}/data/mcp/entries/${encodeURIComponent(id)}.json`;
const ENTRY_PAGE = (id) => `${SITE}/en/entry/${encodeURIComponent(id)}.html`;

const SERVER_NAME = "signetex";
const SERVER_VERSION = "1.7.41";
const MISSION =
  "Signetex is the most reliable public record of what was claimed and what became of it. We record who said what, when and where, verbatim and with sources, and check it later against a criterion fixed in advance. History captured after its outcome was known is marked criterion_timing: retrospective (criterion applied retrospectively, not pre-registered) and is excluded from every hit rate. We do not decide what is true; we show the evidence, the evidence grade (E0–E4) and the outcome. Independent, timestamped, open to humans and machines.";
const TERMS_URL = `${SITE}/en/terms.html`;
const TERMS = {
  licence: "Individual entries: CC BY-NC 4.0 (non-commercial reuse with attribution).",
  database_licence: "The database as a whole (collection, selection, structure, history, bulk JSON and aggregate MCP output) is not licensed under Creative Commons; systematic extraction, bulk copying, mirroring or substantial reuse requires a written licence from Signetex / Hotel Phoenix AG for any purpose, including non-commercial use, AI training or building another database.",
  attribution: "Source: Signetex, signetex.ch, <entry ID>",
  terms_url: TERMS_URL,
  disclaimer: "Not investment advice. A register of publicly made statements, collected information, provided without warranty.",
};
const SERVER_INSTRUCTIONS =
  `${MISSION} Query the register with search_claims, get_entry, due_forecasts, list_due, track_record, compare_forecasts, register_stats, evidence_grades and latest_proof. Public pages and MCP-only verified entries are included; internal (paywalled) entries and the speculative Futures essays are not. Signetex grades evidence and issues no true/false verdicts. Do not treat a grade as a verdict. Always cite the canonical entry URL returned with each result. Each full entry has quote_type: verbatim_text (wording as published) or table_row (a row copied from a published table such as FOMC SEP Table 1; data, not a spoken statement), with quote_note. Terms: quote with attribution \"Source: Signetex, signetex.ch, <entry ID>\". Individual entries are CC BY-NC 4.0. Individual queries are free within rate limits, but the database as a whole (collection, selection, structure, history, bulk JSON and aggregate MCP output) is not licensed under Creative Commons; systematic extraction, bulk copying, mirroring or substantial reuse requires a written licence from Signetex / Hotel Phoenix AG for any purpose, including non-commercial use, AI training or building another database. (${TERMS_URL}). Not investment advice; no warranty.`;
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const DEFAULT_PROTOCOL = "2025-03-26";
const CACHE_TTL_SECONDS = 3600;
const RATE_LIMIT_PER_MINUTE = 30;
const DAILY_CAP_DEFAULT = 250000;
const CAP_RESERVE_BATCH = 50;
const VERDICT_NOTE =
  "Signetex grades evidence and issues no true/false verdicts. A grade describes the quality of the evidence at hand, not whether the claim is true or false.";

const KIND_IN = {
  befund: "befund",
  finding: "befund",
  findings: "befund",
  moeglichkeit: "moeglichkeit",
  möglichkeit: "moeglichkeit",
  possibility: "moeglichkeit",
  prognose: "prognose",
  forecast: "prognose",
  forecasts: "prognose",
};
const KIND_EN = {
  befund: "finding",
  moeglichkeit: "possibility",
  prognose: "forecast",
};
const OUTCOME_IN = {
  met: "met",
  erfuellt: "met",
  erfüllt: "met",
  not_met: "not_met",
  nicht_erfuellt: "not_met",
  "nicht erfüllt": "not_met",
  partial: "partial",
  teilweise: "partial",
  open: "open",
  offen: "open",
  unclear: "unclear",
  unklar: "unclear",
};
const OUTCOME_EN = {
  met: "met",
  not_met: "not met",
  partial: "partial",
  open: "open",
  unclear: "unclear",
};
const AREA_IN = {
  "machine-intelligence": "machine-intelligence",
  machine: "machine-intelligence",
  "ai-mind": "machine-intelligence",
  "human-impact": "human-impact",
  humans: "human-impact",
  "ki-mensch": "human-impact",
  "politics-economy": "politics-economy",
  pe: "politics-economy",
  "politik-wirtschaft": "politics-economy",
  "corporate-promises": "corporate-promises",
  co: "corporate-promises",
  unternehmensversprechen: "corporate-promises",
};

const TOOLS = [
  {
    name: "search_claims",
    description:
      "Search the Signetex register of verified claims (public pages and MCP-only entries) across machine-intelligence, human-impact, politics-economy and corporate-promises. Internal or paywalled corporate entries are not included, nor are the speculative Futures essays. Returns matching entries with canonical URLs. Signetex grades evidence and issues no true/false verdicts.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text search over English and German claim text, verbatim quote, speaker, organisation, company, ticker, topic and ID. Several words are matched individually (case and accents ignored) and results are ranked; common names and abbreviations are understood, for example SNB, Fed/FOMC, ECB/EZB, IMF, Take-Two/TTWO, GTA 6, Nvidia/NVDA, Altman. Optional if filters are set.",
        },
        area: {
          type: "string",
          enum: ["machine-intelligence", "human-impact", "politics-economy", "corporate-promises"],
          description: "Register area: machine-intelligence (the AI itself), human-impact (AI and humans) politics-economy (forecasts by governments, central banks, politicians and economists) or corporate-promises (company and CEO statements).",
        },
        kind: {
          type: "string",
          description: "Entry kind: finding, forecast or possibility (also accepts the stored values befund, prognose, moeglichkeit).",
        },
        grade: {
          type: "string",
          description: "Evidence grade: E0, E1, E2, E3 or E4.",
        },
        outcome: {
          type: "string",
          description: "Forecast outcome: open, met, partial, not_met, unclear (German stored values also accepted).",
        },
        limit: {
          type: "integer",
          description: "Maximum number of results to return (default 10, max 50).",
          minimum: 1,
          maximum: 50,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_entry",
    description:
      "Get one register entry by its stable ID (for example SGX-AI-000031 or SGX-HU-000016), including sources, counter-evidence, grade rationale and history, with the canonical page URL. Signetex grades evidence and issues no true/false verdicts.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Stable Signetex entry ID, for example SGX-AI-000031.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "due_forecasts",
    description:
      "List register forecasts whose due date falls within the given number of days (including those already due and still open). Futures essays are not included. Signetex grades evidence and issues no true/false verdicts.",
    inputSchema: {
      type: "object",
      properties: {
        within_days: {
          type: "integer",
          description: "Include forecasts due on or before today plus this many days (default 365, max 3650). Already-due open forecasts are included.",
          minimum: 0,
          maximum: 3650,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "register_stats",
    description:
      "Headline counts for the published register: totals, areas, grades, forecast outcomes. A hit rate is only included once at least 30 forecasts have closed, as on the public site. Only forecasts whose criterion was fixed before the outcome count; back-captured entries with criterion_timing retrospective are reported separately as retrospective_accuracy, never as a hit rate. Signetex grades evidence and issues no true/false verdicts.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "evidence_grades",
    description:
      "Return the published E0–E4 evidence-grade definitions from the Signetex method page, not a true/false scale.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "latest_proof",
    description:
      "Return the latest published OpenTimestamps proof snapshot of the register (root hash, status, manifest URLs).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "track_record",
    description:
      "Return the closed-forecast record of a speaker or institution: counts of met, partial and not met, and a hit rate per register area. Hit rates count only forecasts whose criterion was fixed before the outcome; retrospective (back-captured) entries are counted separately under retrospective. Uses public and MCP-only entries, never internal ones. Signetex grades evidence and issues no true/false verdicts.",
    inputSchema: {
      type: "object",
      properties: {
        speaker: {
          type: "string",
          description: "Name of the person or official speaker to match (case- and accent-insensitive; partial names, surnames and common short forms allowed, for example Altman or Powell).",
        },
        institution: {
          type: "string",
          description: "Name of the institution or organisation to match (case- and accent-insensitive, partial match allowed; common abbreviations understood, for example SNB, Fed/FOMC, ECB/EZB, IMF, TTWO, NVDA). Alias: organisation.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_due",
    description:
      "List forecasts whose due date falls in the inclusive window from…to (YYYY-MM-DD). Returns public and MCP-only entries, including already closed ones in that window. Signetex grades evidence and issues no true/false verdicts.",
    inputSchema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "Start of the due-date window, inclusive, YYYY-MM-DD.",
        },
        to: {
          type: "string",
          description: "End of the due-date window, inclusive, YYYY-MM-DD.",
        },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
  },
  {
    name: "compare_forecasts",
    description:
      "Show forecasts by different sources on one topic, drawn from public and MCP-only entries. Signetex grades evidence and issues no true/false verdicts.",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Topic or free-text query, for example inflation, GDP, AGI, deliveries, or several words such as \"SNB inflation\" (matched word by word, ranked).",
        },
        area: {
          type: "string",
          enum: ["machine-intelligence", "human-impact", "politics-economy", "corporate-promises"],
          description: "Optional register area filter.",
        },
        limit: {
          type: "integer",
          description: "Maximum number of forecasts to return (default 20, max 50).",
          minimum: 1,
          maximum: 50,
        },
      },
      required: ["topic"],
      additionalProperties: false,
    },
  },
];


// ---- Discovery (read-only metadata; no claims beyond what the server does) ----
const CANONICAL_MCP_URL = "https://mcp.signetex.ch/mcp";
const REGISTRY_NAME = "ch.signetex/register";
const CARD_DESCRIPTION = "Public register of claims and forecasts with E0-E4 evidence grades and outcomes; no verdicts.";
const CARD_PATHS = ["/mcp/server-card", "/server-card", "/.well-known/mcp/server-card.json"];

function serverCard() {
  return {
    $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    name: REGISTRY_NAME,
    title: "Signetex",
    version: SERVER_VERSION,
    description: CARD_DESCRIPTION,
    websiteUrl: SITE,
    icons: [{ src: `${SITE}/favicon.svg`, mimeType: "image/svg+xml", sizes: ["any"] }],
    remotes: [{ type: "streamable-http", url: CANONICAL_MCP_URL, supportedProtocolVersions: PROTOCOL_VERSIONS }],
  };
}

function aiCatalog() {
  return {
    specVersion: "0.9",
    host: { displayName: "Signetex", identifier: "signetex.ch", documentationUrl: `${SITE}/en/api.html` },
    entries: [
      {
        identifier: "urn:air:signetex.ch:mcp:register",
        displayName: "Signetex",
        description: CARD_DESCRIPTION,
        type: "application/mcp-server-card+json",
        url: "https://mcp.signetex.ch/mcp/server-card",
      },
    ],
  };
}

function discoverResult() {
  return {
    resultType: "complete",
    supportedVersions: PROTOCOL_VERSIONS,
    capabilities: { tools: { listChanged: false } },
    _meta: { "io.modelcontextprotocol/serverInfo": { name: SERVER_NAME, version: SERVER_VERSION, websiteUrl: SITE } },
    instructions: SERVER_INSTRUCTIONS,
    ttlMs: 3600000,
    cacheScope: "public",
  };
}

function staticDoc(request, body, contentType, etag, maxAge) {
  const headers = {
    "content-type": contentType,
    "cache-control": `public, max-age=${maxAge}`,
    etag,
    "access-control-allow-origin": "*",
  };
  const inm = request.headers.get("if-none-match");
  if (inm && inm.split(",").map((x) => x.trim().replace(/^W\//, "")).includes(etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
}

// Returns a Response for a discovery path, or null if the path is not one of them.
function discoveryResponse(request, path) {
  const method = request.method;
  if (method !== "GET" && method !== "HEAD") return null;
  if (CARD_PATHS.includes(path)) {
    return staticDoc(request, JSON.stringify(serverCard(), null, 2), "application/mcp-server-card+json; charset=utf-8", `"card-${SERVER_VERSION}"`, 3600);
  }
  if (path === "/.well-known/ai-catalog.json") {
    return staticDoc(request, JSON.stringify(aiCatalog(), null, 2), "application/ai-catalog+json; charset=utf-8", `"catalog-${SERVER_VERSION}"`, 3600);
  }
  if (path === "/robots.txt") {
    return staticDoc(request, "User-agent: *\nAllow: /\n", "text/plain; charset=utf-8", `"robots-1"`, 86400);
  }
  if (path === "/favicon.ico") {
    return new Response(null, { status: 302, headers: { location: `${SITE}/favicon.svg`, "cache-control": "public, max-age=86400" } });
  }
  if (path.startsWith("/.well-known/oauth-")) {
    return jsonResponse(
      {
        error: "Not found",
        note: "This server has no authentication and is not an OAuth protected resource, so it publishes no OAuth metadata. Connect to the MCP endpoint directly.",
        mcp: CANONICAL_MCP_URL,
      },
      404,
    );
  }
  return null;
}

export class DailyCap {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const day = String(body.day || "");
    const limit = Number(body.limit);
    const want = Number(body.n);
    if (!day || !Number.isFinite(limit) || limit <= 0) {
      return Response.json({ allowed: false, granted: 0, error: "invalid cap request" }, { status: 400 });
    }
    const n = Math.max(1, Math.min(Number.isFinite(want) && want > 0 ? want : 1, limit));
    const storedDay = (await this.ctx.storage.get("day")) || "";
    let count = storedDay === day ? Number(await this.ctx.storage.get("count")) || 0 : 0;
    if (count >= limit) {
      return Response.json({ allowed: false, granted: 0, count, limit, day });
    }
    const granted = Math.min(n, limit - count);
    count += granted;
    await this.ctx.storage.put({ day, count });
    return Response.json({ allowed: true, granted, count, limit, day });
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method === "OPTIONS") {
        return cors(new Response(null, { status: 204 }));
      }
      const peek = request.clone();
      const limited = await rateLimit(request, env, ctx);
      if (limited) return limited;
      const capped = await enforceDailyCap(request, env, ctx);
      if (capped) return capped;

      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      let response;
      const discovered = discoveryResponse(request, path);
      if (discovered) {
        response = cors(discovered);
      } else if (request.method === "GET" && (path === "/" || path === "/health")) {
        response = cors(landing(request));
      } else if (path === "/mcp") {
        if (request.method === "GET" || request.method === "HEAD") {
          // Streamable HTTP: this server offers no SSE stream on GET, so 405 is the specified answer.
          // The body only describes the server for humans and scanners; the status stays 405.
          response = cors(
            jsonResponse(
              {
                error: "This server is a stateless Streamable HTTP MCP endpoint without a server-initiated stream. Send JSON-RPC by POST to /mcp.",
                mcp: CANONICAL_MCP_URL,
                transport: "streamable-http",
                auth: "none",
                access: "read-only",
                tools: TOOLS.map((t) => t.name),
                server_card: "https://mcp.signetex.ch/mcp/server-card",
                catalog: "https://mcp.signetex.ch/.well-known/ai-catalog.json",
                docs: `${SITE}/en/api.html`,
              },
              405,
            ),
          );
          response.headers.set("allow", "POST, OPTIONS");
        } else if (request.method !== "POST") {
          response = cors(jsonResponse({ error: "Method not allowed" }, 405));
          response.headers.set("allow", "POST, OPTIONS");
        } else {
          response = cors(await handleMcpPost(request, ctx));
        }
      } else {
        response = cors(jsonResponse({ error: "Not found", docs: SITE }, 404));
      }
      scheduleUsageLog(env, ctx, peek, response, request.cf);
      return response;
    } catch (err) {
      const response = cors(
        jsonResponse(
          { error: "Server error", message: "The request could not be completed." },
          500,
        ),
      );
      try {
        scheduleUsageLog(env, ctx, request, response, request.cf);
      } catch {
        /* logging must never affect the client */
      }
      return response;
    }
  },
};


function clip(value, max) {
  const s = String(value || "").trim();
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max);
}

function uaFamilyOf(ua) {
  if (!ua) return "unknown";
  const token = String(ua).trim().split(/\s+/)[0] || "unknown";
  return clip(token, 40) || "unknown";
}

function clientLabel(msg) {
  if (!msg || msg.method !== "initialize") return "";
  const info = msg.params && msg.params.clientInfo;
  if (!info || typeof info !== "object") return "";
  const name = String(info.name || "").trim();
  const ver = String(info.version || "").trim();
  return clip([name, ver].filter(Boolean).join("/"), 64);
}

function usagePoint(kind, httpMethod, status, uaFamily, rpcMethod, tool, client, extra) {
  const now = new Date();
  const x = extra || {};
  return {
    indexes: [kind === "mcp" ? "mcp" : "noise"],
    blobs: [
      utcDateString(now),
      String(now.getUTCHours()).padStart(2, "0"),
      clip(httpMethod, 16),
      clip(rpcMethod, 64),
      clip(tool, 64),
      clip(client, 64),
      uaFamily,
      clip(x.path, 64),
      clip(x.country, 8),
      clip(x.asOrg, 80),
      clip(x.argShape, 128),
      clip(x.area, 40),
      clip(x.idPrefix, 16),
      clip(x.queryHash, 16),
      clip(x.ua, 80),
      clip(x.protocol, 24),
    ],
    doubles: [
      Number(status) || 0,
      Number.isFinite(x.resultCount) ? x.resultCount : -1,
      Number(x.asn) || 0,
      Number(x.queryLength) || 0,
    ],
  };
}

const QUERY_KEYS = ["query", "topic", "speaker", "institution"];

async function sha256Hex16(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function argDetails(msg) {
  const out = { argShape: "", area: "", idPrefix: "", queryHash: "", queryLength: 0, protocol: "" };
  if (!msg || !msg.params || typeof msg.params !== "object") return out;
  if (msg.method === "initialize") {
    out.protocol = String(msg.params.protocolVersion || "");
    return out;
  }
  if (msg.method !== "tools/call") return out;
  const args = msg.params.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    out.argShape = args === undefined ? "" : "(non-object)";
    return out;
  }
  out.argShape = Object.keys(args).slice(0, 12).map((k) => clip(k, 24)).sort().join(",");
  if (typeof args.area === "string") out.area = args.area;
  if (typeof args.id === "string") {
    const m = /^\s*(SGX-[A-Za-z]{2})/i.exec(args.id);
    out.idPrefix = m ? m[1].toUpperCase() : "(other)";
  }
  const texts = [];
  for (const key of QUERY_KEYS) {
    if (typeof args[key] === "string" && args[key].trim()) texts.push(key + "=" + args[key].trim().toLowerCase().replace(/\s+/g, " "));
  }
  if (texts.length) {
    const joined = texts.join("|");
    out.queryLength = joined.length;
    out.queryHash = await sha256Hex16(joined);
  }
  return out;
}

function resultCountFrom(text) {
  if (!text) return NaN;
  const m = /\\?"count\\?"\s*:\s*(\d+)/.exec(text);
  return m ? Number(m[1]) : NaN;
}

function messagesFromBody(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const list = Array.isArray(body) ? body : [body];
  const valid = [];
  for (const msg of list) {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string" || !msg.method) {
      continue;
    }
    valid.push(msg);
  }
  return valid.length ? valid : null;
}

async function usagePointsFor(request, status, uaFamily, responseText, cfInfo) {
  const method = request.method || "";
  let path = "/";
  try {
    path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    path = "/";
  }
  const cf = cfInfo || request.cf || {};
  const base = {
    path,
    country: cf.country || "",
    asOrg: cf.asOrganization || "",
    asn: cf.asn || 0,
    ua: (request.headers && request.headers.get("user-agent")) || "",
  };
  if (method === "POST" && path === "/mcp") {
    let raw = "";
    try {
      raw = await request.text();
    } catch {
      raw = "";
    }
    if (raw.length > 65536) raw = raw.slice(0, 65536);
    const messages = messagesFromBody(raw);
    if (messages) {
      const single = messages.length === 1;
      const points = [];
      for (const msg of messages.slice(0, 20)) {
        let details = {};
        try {
          details = await argDetails(msg);
        } catch {
          details = {};
        }
        const resultCount = single && msg.method === "tools/call" ? resultCountFrom(responseText) : NaN;
        points.push(
          usagePoint(
            "mcp",
            method,
            status,
            uaFamily,
            msg.method,
            msg.method === "tools/call" && msg.params && msg.params.name ? String(msg.params.name) : "",
            clientLabel(msg),
            { ...base, ...details, resultCount },
          ),
        );
      }
      return points;
    }
  }
  return [usagePoint("noise", method, status, uaFamily, "", "", "", base)];
}

function scheduleUsageLog(env, ctx, request, response, cfInfo) {
  try {
    if (!env || !env.USAGE || typeof env.USAGE.writeDataPoint !== "function") return;
    const status = response && response.status;
    const uaFamily = uaFamilyOf(request && request.headers && request.headers.get("user-agent"));
    let copy = null;
    try {
      if (request && request.method === "POST" && status === 200 && response && response.body) copy = response.clone();
    } catch {
      copy = null;
    }
    const task = (async () => {
      try {
        let responseText = "";
        if (copy) {
          try {
            responseText = (await copy.text()).slice(0, 4096);
          } catch {
            responseText = "";
          }
        }
        const points = await usagePointsFor(request, status, uaFamily, responseText, cfInfo);
        for (const point of points) env.USAGE.writeDataPoint(point);
      } catch {
        /* swallow */
      }
    })();
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(task);
  } catch {
    /* logging must never throw to the client */
  }
}

function landing(request) {
  const origin = new URL(request.url).origin;
  const payload = {
    name: "Signetex MCP",
    version: SERVER_VERSION,
    description: MISSION,
    register: SITE,
    mcp_endpoint: `${origin}/mcp`,
    transport: "streamable-http",
    auth: "none",
    access: "read-only",
    licence: TERMS.licence,
    database_licence: TERMS.database_licence,
    terms: TERMS_URL,
    tools: TOOLS.map((t) => t.name),
    excluded: "Internal (paywalled) entries and the speculative Futures essays are not part of this interface.",
    note: VERDICT_NOTE,
    custom_domain: "https://mcp.signetex.ch/mcp",
    server_card: "https://mcp.signetex.ch/mcp/server-card",
    catalog: "https://mcp.signetex.ch/.well-known/ai-catalog.json",
  };
  const accept = request.headers.get("accept") || "";
  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return jsonResponse(payload, 200);
  }
  const tools = TOOLS.map((t) => `<li><code>${esc(t.name)}</code></li>`).join("");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Signetex MCP</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #eceef2; background: #0b0d10; }
    a { color: #3ec8e0; }
    code { font-family: ui-monospace, monospace; }
    .note { color: #9aa3ad; }
  </style>
</head>
<body>
  <h1>Signetex MCP</h1>
  <p>${esc(MISSION)}</p>
  <p>Read-only <a href="https://modelcontextprotocol.io">Model Context Protocol</a> server for the public register at <a href="${SITE}">signetex.ch</a>.</p>
  <p>Connect with Streamable HTTP to <code>${esc(origin)}/mcp</code>. No authentication. Internal (paywalled) entries and the speculative Futures essays are not included.</p>
  <p>Tools:</p>
  <ul>${tools}</ul>
  <p class="note">${esc(VERDICT_NOTE)}</p>
  <p class="note">Individual entries: CC BY-NC 4.0. The database as a whole requires a written licence for systematic extraction, bulk copying, mirroring or substantial reuse, for any purpose. <a href="https://signetex.ch/en/terms.html">Terms of use</a>. Public endpoint: <code>https://mcp.signetex.ch/mcp</code>.</p>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}

async function handleMcpPost(request, ctx) {
  const raw = await request.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonrpcError(null, -32700, "Parse error", 400);
  }
  const messages = Array.isArray(body) ? body : [body];
  const results = [];
  for (const msg of messages) {
    const out = await handleMessage(msg, ctx);
    if (out) results.push(out);
  }
  if (results.length === 0) {
    return new Response(null, { status: 202 });
  }
  const payload = Array.isArray(body) ? results : results[0];
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/event-stream") && !accept.includes("application/json")) {
    const sse = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
    return new Response(sse, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    });
  }
  return jsonResponse(payload, 200);
}

async function handleMessage(msg, ctx) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") {
    return { jsonrpc: "2.0", id: msg && "id" in msg ? msg.id : null, error: { code: -32600, message: "Invalid Request" } };
  }
  const id = "id" in msg ? msg.id : undefined;
  const method = msg.method;
  const isNotification = id === undefined || method && String(method).startsWith("notifications/");
  if (isNotification && (id === undefined || String(method).startsWith("notifications/"))) {
    return null;
  }
  try {
    if (method === "initialize") {
      const requested = msg.params && msg.params.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION, websiteUrl: SITE },
          instructions: SERVER_INSTRUCTIONS,
        },
      };
    }
    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }
    if (method === "server/discover") {
      return { jsonrpc: "2.0", id, result: discoverResult() };
    }
    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    }
    if (method === "tools/call") {
      const name = msg.params && msg.params.name;
      const args = (msg.params && msg.params.arguments) || {};
      const result = await callTool(name, args, ctx);
      return { jsonrpc: "2.0", id, result };
    }
    if (method === "resources/list") {
      return { jsonrpc: "2.0", id, result: { resources: [] } };
    }
    if (method === "prompts/list") {
      return { jsonrpc: "2.0", id, result: { prompts: [] } };
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (err) {
    const message = err && err.expose && err.message ? err.message : "Tool call failed.";
    if (method === "tools/call") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: message }],
          isError: true,
        },
      };
    }
    return { jsonrpc: "2.0", id, error: { code: -32603, message: "Internal error" } };
  }
}

async function callTool(name, args, ctx) {
  if (!name || !TOOLS.some((t) => t.name === name)) {
    const err = new Error(`Unknown tool: ${name || "(missing)"}`);
    err.expose = true;
    throw err;
  }
  args = args && typeof args === "object" ? args : {};
  let data;
  if (name === "search_claims") data = await toolSearch(args, ctx);
  else if (name === "get_entry") data = await toolGetEntry(args, ctx);
  else if (name === "due_forecasts") data = await toolDue(args, ctx);
  else if (name === "list_due") data = await toolListDue(args, ctx);
  else if (name === "track_record") data = await toolTrackRecord(args, ctx);
  else if (name === "compare_forecasts") data = await toolCompare(args, ctx);
  else if (name === "register_stats") data = await toolStats(ctx);
  else if (name === "evidence_grades") data = await toolGrades(ctx);
  else if (name === "latest_proof") data = await toolProof(ctx);
  else {
    const err = new Error(`Unknown tool: ${name}`);
    err.expose = true;
    throw err;
  }
  if (data && typeof data === "object" && !Array.isArray(data) && !("terms" in data)) {
    data = { ...data, terms: TERMS };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    _meta: { "ch.signetex/terms": TERMS },
  };
}

async function toolSearch(args, ctx) {
  const entries = await loadIndex(ctx);
  const query = String(args.query || "").trim().toLowerCase();
  const area = normalizeArea(args.area);
  const kind = normalizeKind(args.kind);
  const grade = normalizeGrade(args.grade);
  const outcome = normalizeOutcome(args.outcome);
  let limit = Number(args.limit);
  if (!Number.isFinite(limit) || limit <= 0) limit = 10;
  limit = Math.min(50, Math.floor(limit));

  const filterFn = (entry) =>
    !(area && areaOf(entry) !== area) &&
    !(kind && kindOf(entry) !== kind) &&
    !(grade && gradeOf(entry) !== grade) &&
    !(outcome && outcomeOf(entry) !== outcome);
  const ordered = query
    ? rankedSearch(entries, query, filterFn, (entry) => haystack(entry).includes(query))
    : entries.filter(filterFn);
  const matches = ordered.slice(0, limit).map(summarise);
  return {
    note: VERDICT_NOTE,
    query: args.query || null,
    filters: { area: area || null, kind: kind ? KIND_EN[kind] : null, grade: grade || null, outcome: outcome || null },
    count: matches.length,
    results: matches,
  };
}

async function toolGetEntry(args, ctx) {
  const id = String(args.id || "").trim().toUpperCase();
  if (!/^SGX-[A-Z]+-\d+$/.test(id)) {
    const err = new Error("Please provide a Signetex entry ID such as SGX-AI-000031.");
    err.expose = true;
    throw err;
  }
  if (!isRegisterId(id)) {
    const err = new Error("That ID is not part of the public register (Futures essays and other non-register material are not available through this server).");
    err.expose = true;
    throw err;
  }
  let raw = await cachedJsonOrNull(ENTRY_URL(id), ctx);
  if (!raw || !raw.id) {
    raw = await cachedJsonOrNull(MCP_ENTRY_URL(id), ctx);
    if (raw && !raw.visibility) raw.visibility = "mcp";
    // 1.7.6: an MCP-only file is served only while its ID is listed in the current MCP index (withdrawn entries stay unreachable).
    if (raw && raw.id) {
      const listed = (await loadIndex(ctx)).some((e) => e && String(e.id).toUpperCase() === id);
      if (!listed) raw = null;
    }
  }
  if (!raw || !raw.id) {
    const err = new Error(`No published entry found for ${id}.`);
    err.expose = true;
    throw err;
  }
  if (!isRegisterEntry(raw)) {
    const err = new Error("That record is not part of the public register and is not available through this server.");
    err.expose = true;
    throw err;
  }
  return {
    note: VERDICT_NOTE,
    url: entryUrl(raw),
    visibility: visibilityOf(raw),
    entry: presentFull(raw),
  };
}

async function toolDue(args, ctx) {
  let within = Number(args.within_days);
  if (!Number.isFinite(within) || within < 0) within = 365;
  within = Math.min(3650, Math.floor(within));
  const today = utcDateString(new Date());
  const horizon = addDays(today, within);
  const entries = await loadIndex(ctx);
  const due = [];
  for (const entry of entries) {
    if (kindOf(entry) !== "prognose" && entry.type !== "forecast") continue;
    const dueDate = entry.due || (entry.forecast && entry.forecast.due);
    if (!dueDate) continue;
    if (dueDate > horizon) continue;
    const outcome = outcomeOf(entry);
    if (outcome && outcome !== "open") continue;
    due.push({
      ...summarise(entry),
      due: dueDate,
      days_until_due: dayDiff(today, dueDate),
    });
  }
  due.sort((a, b) => String(a.due).localeCompare(String(b.due)));
  return {
    note: VERDICT_NOTE,
    as_of: today,
    within_days: within,
    horizon,
    count: due.length,
    forecasts: due,
  };
}

async function toolListDue(args, ctx) {
  const from = String(args.from || "").trim().slice(0, 10);
  const to = String(args.to || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    const err = new Error("Please provide from and to as YYYY-MM-DD dates.");
    err.expose = true;
    throw err;
  }
  if (from > to) {
    const err = new Error("The from date must be on or before the to date.");
    err.expose = true;
    throw err;
  }
  const entries = await loadIndex(ctx);
  const due = [];
  for (const entry of entries) {
    if (kindOf(entry) !== "prognose" && entry.type !== "forecast") continue;
    const dueDate = (entry.due || (entry.forecast && entry.forecast.due) || "").slice(0, 10);
    if (!dueDate) continue;
    if (dueDate < from || dueDate > to) continue;
    due.push({
      ...summarise(entry),
      due: dueDate,
    });
  }
  due.sort((a, b) => String(a.due).localeCompare(String(b.due)) || String(a.id).localeCompare(String(b.id)));
  return {
    note: VERDICT_NOTE,
    from,
    to,
    count: due.length,
    forecasts: due,
  };
}

async function toolTrackRecord(args, ctx) {
  const speakerQ = String(args.speaker || "").trim().toLowerCase();
  const instQ = String(args.institution || args.organisation || args.organization || "").trim().toLowerCase();
  if (!speakerQ && !instQ) {
    const err = new Error("Please provide a speaker and/or an institution to look up.");
    err.expose = true;
    throw err;
  }
  const entries = await loadIndex(ctx);
  const matched = [];
  const matchedExtra = [];
  for (const entry of entries) {
    const speaker = String(entry.speaker || (entry.origin && entry.origin.speaker) || "").toLowerCase();
    const org = String(entry.organisation || (entry.origin && entry.origin.organisation) || "").toLowerCase();
    const speakerOld = !speakerQ || (speaker && speaker.includes(speakerQ)) || (org && org.includes(speakerQ));
    const instOld = !instQ || (org && org.includes(instQ)) || (speaker && speaker.includes(instQ));
    if (speakerOld && instOld) { matched.push(entry); continue; }
    const speakerOk = speakerOld || nameMatches(entry, speakerQ);
    const instOk = instOld || nameMatches(entry, instQ);
    if (speakerOk && instOk) matchedExtra.push(entry);
  }
  matched.push(...matchedExtra);
  const areas = ["machine-intelligence", "human-impact", "politics-economy", "corporate-promises"];
  function tally(group) {
    const outcomes = { open: 0, met: 0, partial: 0, not_met: 0, unclear: 0 };
    let forecasts = 0;
    const retro = { met: 0, partial: 0, not_met: 0, unclear: 0 };
    for (const e of group) {
      if (kindOf(e) !== "prognose" && e.type !== "forecast") continue;
      forecasts += 1;
      const o = outcomeOf(e) || "open";
      if (e.criterion_timing === "retrospective" && o !== "open") {
        if (retro[o] !== undefined) retro[o] += 1;
        continue;
      }
      if (outcomes[o] !== undefined) outcomes[o] += 1;
      else outcomes.open += 1;
    }
    const closed = outcomes.met + outcomes.partial + outcomes.not_met;
    const hit_rate = closed > 0 ? outcomes.met / closed : null;
    return {
      entries: group.length,
      forecasts,
      closed,
      met: outcomes.met,
      partial: outcomes.partial,
      not_met: outcomes.not_met,
      open: outcomes.open,
      unclear: outcomes.unclear,
      hit_rate,
      hit_rate_preliminary: Boolean(closed) && closed < 30,
      hit_rate_scope: "prospective only (criterion fixed before the outcome)",
      retrospective: (() => {
        const rc = retro.met + retro.partial + retro.not_met;
        return { closed: rc, met: retro.met, partial: retro.partial, not_met: retro.not_met, unclear: retro.unclear,
          retrospective_accuracy: rc > 0 ? retro.met / rc : null,
          note: "Criterion applied retrospectively (after the outcome was available); not pre-registered; not a hit rate." };
      })(),
    };
  }
  const byArea = {};
  for (const area of areas) {
    const group = matched.filter((e) => areaOf(e) === area);
    if (group.length) byArea[area] = tally(group);
  }
  return {
    note: VERDICT_NOTE,
    query: { speaker: args.speaker || null, institution: instQ ? (args.institution || args.organisation || args.organization) : null },
    matches: matched.length,
    overall: tally(matched),
    by_area: byArea,
    examples: matched.slice(0, 10).map(summarise),
  };
}

async function toolCompare(args, ctx) {
  const topic = String(args.topic || "").trim();
  if (!topic) {
    const err = new Error("Please provide a topic to compare, for example inflation or GDP.");
    err.expose = true;
    throw err;
  }
  const area = normalizeArea(args.area);
  let limit = Number(args.limit);
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  limit = Math.min(50, Math.floor(limit));
  const q = topic.toLowerCase();
  const entries = await loadIndex(ctx);
  const hits = rankedSearch(
    entries,
    topic,
    (entry) => (kindOf(entry) === "prognose" || entry.type === "forecast") && !(area && areaOf(entry) !== area),
    (entry) => haystack(entry).includes(q),
  ).slice(0, limit);
  const groups = {};
  for (const entry of hits) {
    const org = entry.organisation || (entry.origin && entry.origin.organisation) || entry.speaker || "unknown";
    if (!groups[org]) groups[org] = [];
    groups[org].push(summarise(entry));
  }
  return {
    note: VERDICT_NOTE,
    topic,
    area: area || null,
    count: hits.length,
    sources: Object.keys(groups).length,
    by_source: groups,
  };
}

function availableViaMcp(dashboard, publicIndex, mcpIndex) {
  // Same figure as the "Entries available via MCP" block on signetex.ch (home and API page).
  const map = { machine: "machine-intelligence", humans: "human-impact", pe: "politics-economy", co: "corporate-promises" };
  const av = dashboard && dashboard.mcp_availability;
  if (av && av.areas) {
    const areas = {};
    for (const [k, name] of Object.entries(map)) {
      const a = av.areas[k] || {};
      areas[name] = { public: a.public || 0, mcp_only: a.mcp_only || 0, total: a.total || 0 };
    }
    return { total: av.total, public: av.public, mcp_only: av.mcp_only, areas, updated: av.updated || null,
      note: "Entries this server can return: public entries plus MCP-only entries. Internal entries are never included." };
  }
  const areas = {};
  for (const name of Object.values(map)) areas[name] = { public: 0, mcp_only: 0, total: 0 };
  for (const e of publicIndex) { const a = areaOf(e); if (areas[a]) { areas[a].public += 1; areas[a].total += 1; } }
  for (const e of mcpIndex) { const a = areaOf(e); if (areas[a]) { areas[a].mcp_only += 1; areas[a].total += 1; } }
  return { total: publicIndex.length + mcpIndex.length, public: publicIndex.length, mcp_only: mcpIndex.length, areas, updated: null,
    note: "Entries this server can return: public entries plus MCP-only entries. Internal entries are never included." };
}

async function toolStats(ctx) {
  const index = await loadIndex(ctx);
  let dashboard = null;
  try {
    dashboard = await cachedJson(DASHBOARD_URL, ctx);
  } catch {
    dashboard = null;
  }
  const publicIndex = index.filter((e) => visibilityOf(e) !== "mcp");
  const mcpIndex = index.filter((e) => visibilityOf(e) === "mcp");
  const grades = { E0: 0, E1: 0, E2: 0, E3: 0, E4: 0 };
  const areas = { "machine-intelligence": 0, "human-impact": 0, "politics-economy": 0, "corporate-promises": 0 };
  const kinds = { finding: 0, forecast: 0, possibility: 0 };
  const outcomes = { open: 0, met: 0, partial: 0, not_met: 0, unclear: 0, none: 0 };
  for (const e of publicIndex) {
    const g = gradeOf(e);
    if (g && grades[g] !== undefined) grades[g] += 1;
    const a = areaOf(e);
    if (a) areas[a] += 1;
    const k = KIND_EN[kindOf(e)] || "finding";
    kinds[k] += 1;
    const o = outcomeOf(e);
    if (!o) outcomes.none += 1;
    else if (outcomes[o] !== undefined) outcomes[o] += 1;
  }
  const po = dashboard && dashboard.prospective_outcomes ? dashboard.prospective_outcomes : null;
  const ro = dashboard && dashboard.retrospective_outcomes ? dashboard.retrospective_outcomes : null;
  const closed = po
    ? (po.met || 0) + (po.partial || 0) + (po.not_met || 0)
    : 0;
  const met = po ? po.met || 0 : 0;
  const rClosed = ro ? (ro.met || 0) + (ro.partial || 0) + (ro.not_met || 0) : 0;
  const hitRateMinimum = (dashboard && dashboard.hit_rate_minimum) || 30;
  const stats = {
    note: VERDICT_NOTE,
    register: SITE,
    generated_at: dashboard && dashboard.generated_at ? dashboard.generated_at : null,
    last_checked: dashboard && dashboard.last_checked ? dashboard.last_checked : null,
    total: dashboard && dashboard.total != null ? dashboard.total : publicIndex.length,
    mcp_only: dashboard && dashboard.mcp_count != null ? dashboard.mcp_count : mcpIndex.length,
    mcp_note: "Additional verified entries available via this server only. They are not included in the public website counts.",
    available_via_mcp: availableViaMcp(dashboard, publicIndex, mcpIndex),
    areas: {
      "machine-intelligence": dashboard && dashboard.machine != null ? dashboard.machine : areas["machine-intelligence"],
      "human-impact": dashboard && dashboard.humans != null ? dashboard.humans : areas["human-impact"],
      "politics-economy": dashboard && dashboard.pe != null ? dashboard.pe : areas["politics-economy"],
      "corporate-promises": dashboard && dashboard.co != null ? dashboard.co : areas["corporate-promises"],
    },
    grades: dashboard && dashboard.grades ? dashboard.grades : grades,
    kinds,
    forecasts: {
      total: dashboard && dashboard.forecasts != null ? dashboard.forecasts : kinds.forecast,
      open: dashboard && dashboard.outcomes ? dashboard.outcomes.open : outcomes.open,
      met: dashboard && dashboard.outcomes ? dashboard.outcomes.met : outcomes.met,
      partial: dashboard && dashboard.outcomes ? dashboard.outcomes.partial : outcomes.partial,
      not_met: dashboard && dashboard.outcomes ? dashboard.outcomes.not_met : outcomes.not_met,
      unclear: dashboard && dashboard.outcomes ? dashboard.outcomes.unclear : outcomes.unclear,
    },
    prospective_forecasts: po,
    retrospective_accuracy: ro
      ? { met: ro.met || 0, partial: ro.partial || 0, not_met: ro.not_met || 0, unclear: ro.unclear || 0, closed: rClosed,
          rate: rClosed > 0 ? (ro.met || 0) / rClosed : null,
          note: "Back-captured forecasts whose criterion was applied retrospectively (after the outcome was available, using Signetex's uniform rules such as the ±0.5 pp rule adopted 2026-11-17). Not pre-registered and not a hit rate." }
      : null,
    hit_rate_minimum: hitRateMinimum,
    hit_rate_scope: "Only forecasts whose criterion was fixed before the outcome (prospective) count. forecasts.met/partial/not_met above include retrospective entries.",
    hit_rate:
      closed >= hitRateMinimum && closed > 0
        ? { met, closed, rate: met / closed }
        : null,
    hit_rate_note:
      closed >= hitRateMinimum
        ? "Headline hit rate is met / (met + partial + not met) over prospective forecasts only. Open, unclear and retrospective cases are excluded."
        : `A headline hit rate is published only once at least ${hitRateMinimum} prospective forecasts (criterion fixed before the outcome) have closed. ${closed} are closed so far; ${rClosed} retrospective entries are reported separately under retrospective_accuracy.`,
  };
  return stats;
}

async function toolGrades(ctx) {
  const html = await cachedText(METHOD_URL, ctx);
  const parsed = parseGradeTable(html);
  if (!parsed || parsed.grades.length < 5) {
    const err = new Error(
      `The published definitions could not be read from ${METHOD_URL}. No fallback definitions are substituted. Please try again later.`,
    );
    err.expose = true;
    throw err;
  }
  return {
    note: VERDICT_NOTE,
    source: METHOD_URL,
    draft_note: parsed.draft_note,
    closing_note: parsed.closing_note,
    grades: parsed.grades,
  };
}

async function toolProof(ctx) {
  const data = await cachedJson(PROOFS_URL, ctx);
  const proofs = Array.isArray(data.proofs) ? data.proofs.slice() : [];
  proofs.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const latest = proofs[0] || null;
  const abs = (p) => {
    if (!p) return null;
    if (/^https?:/i.test(p)) return p;
    return SITE + (p.startsWith("/") ? p : `/${p}`);
  };
  return {
    note: VERDICT_NOTE,
    source: PROOFS_URL,
    algorithm: data.algorithm || null,
    root_method: data.root_method || null,
    updated_at: data.updated_at || (latest && latest.updated_at) || null,
    latest: latest
      ? {
          date: latest.date,
          root: latest.root,
          status: latest.status,
          entry_count: latest.entry_count,
          generated_at: latest.generated_at || null,
          stamped_at: latest.stamped_at || null,
          manifest: abs(latest.manifest),
          manifest_txt: abs(latest.manifest_txt),
          ots: abs(latest.ots),
        }
      : null,
  };
}

async function loadIndex(ctx) {
  const data = await cachedJson(INDEX_URL, ctx);
  const list = Array.isArray(data) ? data : data.entries || data.items || [];
  let mcp = [];
  const mcpData = await cachedJsonOrNull(MCP_INDEX_URL, ctx);
  if (mcpData) {
    mcp = Array.isArray(mcpData) ? mcpData : mcpData.entries || mcpData.items || [];
    for (const e of mcp) {
      if (e && !e.visibility) e.visibility = "mcp";
    }
  }
  return list.concat(mcp).filter(isRegisterEntry);
}

function isRegisterId(id) {
  return /^SGX-(AI|HU|PE|CO)-\d+$/i.test(id);
}

function isRegisterEntry(entry) {
  if (!entry || !entry.id) return false;
  if (!isRegisterId(entry.id)) return false;
  const vis = String(entry.visibility || "public").toLowerCase();
  if (vis === "internal") return false;
  const area = areaOf(entry);
  return area === "machine-intelligence" || area === "human-impact" || area === "politics-economy" || area === "corporate-promises";
}

function areaOf(entry) {
  const raw = [entry.collection, entry.ring, entry.section, entry.area]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());
  for (const v of raw) {
    if (AREA_IN[v]) return AREA_IN[v];
  }
  const id = String(entry.id || "");
  if (id.startsWith("SGX-AI-")) return "machine-intelligence";
  if (id.startsWith("SGX-HU-")) return "human-impact";
  if (id.startsWith("SGX-PE-")) return "politics-economy";
  if (id.startsWith("SGX-CO-")) return "corporate-promises";
  return null;
}

function kindOf(entry) {
  return KIND_IN[String(entry.kind || "").toLowerCase()] || (entry.type === "forecast" ? "prognose" : "befund");
}

function gradeOf(entry) {
  const g = String(entry.grade || entry.evidence_grade || "").toUpperCase().trim();
  return /^E[0-4]$/.test(g) ? g : null;
}

function outcomeOf(entry) {
  const raw = entry.outcome != null ? entry.outcome : entry.forecast && entry.forecast.outcome;
  if (raw == null || raw === "") return null;
  return OUTCOME_IN[String(raw).toLowerCase()] || null;
}

function normalizeArea(v) {
  if (v == null || v === "") return null;
  const n = AREA_IN[String(v).toLowerCase()];
  if (!n) {
    const err = new Error("area must be machine-intelligence, human-impact, politics-economy or corporate-promises.");
    err.expose = true;
    throw err;
  }
  return n;
}

function normalizeKind(v) {
  if (v == null || v === "") return null;
  const n = KIND_IN[String(v).toLowerCase()];
  if (!n) {
    const err = new Error("kind must be finding, forecast or possibility.");
    err.expose = true;
    throw err;
  }
  return n;
}

function normalizeGrade(v) {
  if (v == null || v === "") return null;
  const g = String(v).toUpperCase().trim();
  if (!/^E[0-4]$/.test(g)) {
    const err = new Error("grade must be E0, E1, E2, E3 or E4.");
    err.expose = true;
    throw err;
  }
  return g;
}

function normalizeOutcome(v) {
  if (v == null || v === "") return null;
  const n = OUTCOME_IN[String(v).toLowerCase()];
  if (!n) {
    const err = new Error("outcome must be open, met, partial, not_met or unclear.");
    err.expose = true;
    throw err;
  }
  return n;
}

// ---- Multi-word search (1.7.2) -------------------------------------------
// Tokenised, case- and diacritics-insensitive matching with a small alias list.
// Backward compatible: entries matched by the old exact-substring test come first,
// in the same order as before; token matches follow, ranked by relevance.
const ALIAS_GROUPS = [
  ["snb", "swiss national bank", "schweizerische nationalbank", "schweizerischen nationalbank", "banque nationale suisse"],
  ["fed", "federal reserve", "fomc", "federal open market committee", "us notenbank", "us federal reserve"],
  ["ecb", "ezb", "european central bank", "europaische zentralbank", "eurosystem"],
  ["boe", "bank of england", "monetary policy committee"],
  ["imf", "iwf", "international monetary fund", "internationaler wahrungsfonds"],
  ["oecd", "organisation for economic co operation and development"],
  ["obr", "office for budget responsibility"],
  ["eia", "energy information administration"],
  ["iea", "international energy agency"],
  ["bfs", "federal statistical office", "bundesamt fur statistik"],
  ["seco", "expertengruppe konjunkturprognosen"],
  ["take two", "taketwo", "take two interactive", "ttwo"],
  ["rockstar", "rockstar games"],
  ["gta 6", "gta vi", "gta6", "grand theft auto vi", "grand theft auto 6"],
  ["gta", "grand theft auto"],
  ["nvidia", "nvda"],
  ["tesla", "tsla"],
  ["apple", "aapl"],
  ["microsoft", "msft"],
  ["alphabet", "google", "googl"],
  ["amazon", "amzn"],
  ["meta", "meta platforms", "facebook"],
  ["deepmind", "google deepmind"],
  ["openai", "open ai"],
  ["altman", "sam altman"],
  ["amodei", "dario amodei"],
  ["hassabis", "demis hassabis"],
  ["musk", "elon musk"],
  ["zuckerberg", "mark zuckerberg"],
  ["huang", "jensen huang", "jen hsun huang"],
  ["nadella", "satya nadella"],
  ["pichai", "sundar pichai"],
  ["lecun", "yann lecun"],
  ["suleyman", "mustafa suleyman"],
  ["hinton", "geoffrey hinton"],
  ["sutskever", "ilya sutskever"],
  ["kurzweil", "ray kurzweil"],
  ["zelnick", "strauss zelnick"],
  ["lagarde", "christine lagarde"],
  ["agi", "artificial general intelligence"],
  ["asi", "superintelligence", "artificial superintelligence"],
  ["gdp", "bip", "real gdp", "gross domestic product", "economic growth"],
  ["cpi", "consumer price index", "landesindex der konsumentenpreise"],
  ["inflation", "teuerung", "jahresteuerung", "hicp", "pce inflation", "price stability"],
  ["unemployment", "arbeitslosenquote", "arbeitslosigkeit", "jobless"],
  ["self driving", "autonomous driving", "driverless", "robotaxi", "robotaxis"],
  ["guidance", "outlook", "ausblick", "expected to be", "expects", "anticipates"],
  ["projection", "projected", "projections", "projizierten", "forecast", "forecasts", "prognose"],
  ["release", "released", "releasing", "launch", "launches", "launching", "erscheinen", "veroffentlichen"],
  ["revenue", "revenues", "umsatz", "net sales", "net bookings"],
  ["capex", "capital expenditures", "capital expenditure", "investitionen"],
];
const STOPWORDS = new Set(("a an the of and or for in on at to by with from about over vs versus is are was were be been " +
  "what who when where which how did does do say said says claim claims predicted prediction predictions " +
  "der die das den dem des und oder fur im in am an zu von mit uber ist sind war wie was wer wann").split(" "));

function foldText(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss").replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ALIAS_INDEX = (() => {
  const phrases = [];
  ALIAS_GROUPS.forEach((group, gi) => {
    const alts = group.map(foldText).filter(Boolean);
    for (const alt of alts) phrases.push({ phrase: alt, gi, alts });
  });
  phrases.sort((a, b) => b.phrase.split(" ").length - a.phrase.split(" ").length || b.phrase.length - a.phrase.length);
  return phrases;
})();

function stemWord(w) {
  if (w.length <= 4 || /^\d/.test(w)) return w;
  for (const suf of ["ations", "ation", "ions", "ion", "ings", "ing", "ies", "ed", "es", "s", "ungen", "ung"]) {
    if (w.endsWith(suf) && w.length - suf.length >= 4) return w.slice(0, -suf.length);
  }
  return w;
}

// Parse a query into concepts. Each concept is a list of alternative folded phrases.
function parseQuery(raw) {
  const folded = foldText(raw);
  if (!folded) return [];
  let words = folded.split(" ");
  const concepts = [];
  const used = new Array(words.length).fill(false);
  for (const { phrase, alts } of ALIAS_INDEX) {
    const pw = phrase.split(" ");
    for (let i = 0; i + pw.length <= words.length; i++) {
      let ok = true;
      for (let j = 0; j < pw.length; j++) if (used[i + j] || words[i + j] !== pw[j]) { ok = false; break; }
      if (ok) {
        for (let j = 0; j < pw.length; j++) used[i + j] = true;
        concepts.push({ alts, alias: true, label: phrase });
      }
    }
  }
  for (let i = 0; i < words.length; i++) {
    if (used[i]) continue;
    const w = words[i];
    if (STOPWORDS.has(w) && words.length > 1) continue;
    concepts.push({ alts: [w], alias: false, label: w, stem: stemWord(w) });
  }
  return concepts;
}

const FIELD_WEIGHTS = [
  ["id", 8], ["speaker", 5], ["organisation", 5], ["company", 5], ["ticker", 5],
  ["claim_en", 3], ["claim", 2], ["quote", 2], ["event_en", 1.5], ["topic", 2], ["area", 1], ["collection", 1], ["kind", 0.5], ["grade", 0.5],
];

function searchFields(entry) {
  const o = entry.origin || {};
  const cached = entry.__fold;
  if (cached) return cached;
  const f = {
    id: foldText(entry.id),
    speaker: foldText(entry.speaker || o.speaker),
    organisation: foldText(entry.organisation || o.organisation),
    company: foldText(entry.company),
    ticker: foldText(entry.ticker),
    claim_en: foldText(entry.claim_en),
    claim: foldText(entry.claim),
    quote: foldText(entry.quote || entry.claim_quote),
    event_en: foldText(entry.event_en || o.event_en),
    topic: foldText(entry.topic),
    area: foldText(entry.area),
    collection: foldText(entry.collection),
    kind: foldText(entry.kind),
    grade: foldText(entry.grade),
  };
  for (const k of Object.keys(f)) f[k] = f[k] ? ` ${f[k]} ` : "";
  Object.defineProperty(entry, "__fold", { value: f, enumerable: false, configurable: true });
  return f;
}

function conceptFieldHit(concept, text) {
  if (!text) return false;
  for (const alt of concept.alts) {
    if (text.includes(` ${alt} `)) return true;
  }
  if (!concept.alias && concept.stem && concept.stem.length >= 4) {
    if (text.includes(` ${concept.stem}`)) return true; // word-prefix match on the stem
  }
  return false;
}

// Returns {matched, score} for an entry against parsed concepts, restricted to the given fields.
function scoreEntry(entry, concepts, fields) {
  const f = searchFields(entry);
  let matched = 0;
  let score = 0;
  for (const c of concepts) {
    let best = 0;
    for (const [name, w] of FIELD_WEIGHTS) {
      if (fields && !fields.includes(name)) continue;
      if (conceptFieldHit(c, f[name]) && w > best) best = w;
    }
    if (best > 0) { matched += 1; score += best * (c.alias ? 1.5 : 1); }
  }
  return { matched, score };
}

function requiredMatches(concepts) {
  const n = concepts.length;
  if (n <= 2) return n;
  // Numbers and register IDs must match exactly; otherwise tolerate one unmatched word ("most").
  if (concepts.some((c) => /\d/.test(c.label))) return n;
  return n - 1;
}

// Ranked search. oldTest(entry) keeps the previous exact-substring behaviour first and in order.
function rankedSearch(entries, query, filterFn, oldTest) {
  const concepts = parseQuery(query);
  const first = [];
  const rest = [];
  entries.forEach((entry, idx) => {
    if (filterFn && !filterFn(entry)) return;
    if (oldTest && oldTest(entry)) { first.push(entry); return; }
    if (!concepts.length) return;
    const { matched, score } = scoreEntry(entry, concepts, null);
    if (matched >= requiredMatches(concepts) && matched > 0) {
      rest.push({ entry, idx, score: score + (matched === concepts.length ? 100 : 0) });
    }
  });
  rest.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return first.concat(rest.map((r) => r.entry));
}

// All words of a name must match within speaker/organisation/company/ticker fields.
function nameMatches(entry, query) {
  const concepts = parseQuery(query);
  if (!concepts.length) return false;
  const { matched } = scoreEntry(entry, concepts, ["speaker", "organisation", "company", "ticker"]);
  return matched === concepts.length;
}
// ---------------------------------------------------------------------------

function haystack(entry) {
  return [
    entry.id,
    entry.claim_en,
    entry.claim,
    entry.speaker,
    entry.organisation,
    entry.topic,
    entry.kind,
    entry.grade,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function summarise(entry) {
  return {
    id: entry.id,
    url: entryUrl(entry),
    visibility: visibilityOf(entry),
    claim: pickEn(entry.claim_en, entry.claim),
    speaker: entry.speaker || (entry.origin && entry.origin.speaker) || null,
    organisation: entry.organisation || (entry.origin && entry.origin.organisation) || null,
    date: entry.date || (entry.origin && entry.origin.date) || null,
    area: areaOf(entry),
    kind: KIND_EN[kindOf(entry)] || kindOf(entry),
    grade: gradeOf(entry),
    outcome: outcomeOf(entry) ? OUTCOME_EN[outcomeOf(entry)] : null,
    due: entry.due || (entry.forecast && entry.forecast.due) || null,
    note: VERDICT_NOTE,
  };
}

function presentFull(entry) {
  const origin = entry.origin || {};
  const forecast = entry.forecast || null;
  const sources = Array.isArray(entry.sources)
    ? entry.sources.map((s) => ({
        title: pickEn(s.title_en, s.title),
        publisher: s.publisher || null,
        date: s.date || null,
        url: s.url || null,
        stance: s.stance || null,
      }))
    : [];
  const counter = Array.isArray(entry.counter_evidence)
    ? entry.counter_evidence.map((s) => ({
        title: pickEn(s.title_en, s.title),
        note: pickEn(s.note_en, s.note),
        publisher: s.publisher || null,
        date: s.date || null,
        url: s.url || null,
      }))
    : [];
  const history = Array.isArray(entry.history)
    ? entry.history.map((h) => ({
        date: h.date || null,
        change: pickEn(h.change_en, h.change),
      }))
    : [];
  return {
    id: entry.id,
    claim: pickEn(entry.claim_en, entry.claim),
    quote: entry.claim_quote || null,
    quote_type: entry.claim_quote ? quoteTypeOf(entry) : null,
    quote_note: entry.claim_quote ? quoteNoteOf(entry) : null,
    why_it_matters: pickEn(entry.why_it_matters_en, entry.why_it_matters),
    speaker: origin.speaker || entry.speaker || null,
    role: pickEn(origin.role_en, origin.role) || null,
    organisation: origin.organisation || entry.organisation || null,
    date: origin.date || null,
    event: pickEn(origin.event_en, origin.event) || null,
    origin_url: origin.url || null,
    area: areaOf(entry),
    kind: KIND_EN[kindOf(entry)] || kindOf(entry),
    topic: entry.topic || null,
    grade: gradeOf(entry),
    grade_rationale: pickEn(entry.grade_rationale_en, entry.grade_rationale),
    layer: entry.atlas_layer || null,
    outcome: outcomeOf(entry) ? OUTCOME_EN[outcomeOf(entry)] : null,
    due: (forecast && forecast.due) || entry.due || null,
    check_criterion: forecast ? pickEn(forecast.criterion_en, forecast.criterion) : null,
    criterion_timing: forecast ? (forecast.criterion_timing || "prospective") : null,
    criterion_fixed_at: forecast ? forecast.criterion_fixed_at || null : null,
    criterion_timing_note: forecast ? pickEn(forecast.criterion_timing_note_en, forecast.criterion_timing_note) || null : null,
    counts_in_hit_rate: forecast ? forecast.criterion_timing !== "retrospective" : null,
    outcome_note: forecast ? pickEn(forecast.outcome_note_en, forecast.outcome_note) : null,
    last_checked: entry.last_checked || null,
    visibility: visibilityOf(entry),
    licence: entry.license || "CC BY-NC 4.0",
    licence_scope: "individual_entry_only",
    database_licence: TERMS.database_licence,
    sources,
    counter_evidence: counter,
    history,
  };
}

// 1.7.6/1.7.7: say whether "quote" is verbatim text or a row copied from a published table (e.g. FOMC SEP Table 1).
const TABLE_NOTE_RE = /^(quote = table|table data, not a spoken statement|row from table|table row|[\u201c"][^\u201d"]+[\u201d"] row from table)/i;
function quoteTableNote(entry) {
  const own = pickEn(entry.claim_quote_note_en, entry.claim_quote_note);
  if (own && (entry.claim_quote_type === "table_row" || TABLE_NOTE_RE.test(String(own).trim()))) return own;
  for (const s of Array.isArray(entry.sources) ? entry.sources : []) {
    const n = pickEn(s && s.note_en, s && s.note);
    if (n && TABLE_NOTE_RE.test(String(n).trim()) && s.stance === "origin") return n;
  }
  return null;
}
function quoteTypeOf(entry) {
  if (entry.claim_quote_type) return entry.claim_quote_type;
  return quoteTableNote(entry) ? "table_row" : "verbatim_text";
}
function quoteNoteOf(entry) {
  if (quoteTypeOf(entry) === "table_row") return quoteTableNote(entry) || "Row copied from a published table, not a spoken statement.";
  return pickEn(entry.claim_quote_note_en, entry.claim_quote_note) || null;
}

function pickEn(en, fallback) {
  if (en != null && String(en).trim() !== "") return en;
  return fallback == null ? null : fallback;
}

function parseGradeTable(html) {
  if (!html) return null;
  const tableMatch = html.match(/<table[^>]*class="[^"]*grade-table[^"]*"[\s\S]*?<\/table>/i);
  const chunk = tableMatch ? tableMatch[0] : html;
  const grades = [];
  const rowRe = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(chunk))) {
    const row = m[0];
    const idMatch = row.match(/\b(E[0-4])\b/);
    if (!idMatch) continue;
    const tds = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let t;
    while ((t = tdRe.exec(row))) tds.push(t[1]);
    if (tds.length < 2) continue;
    const label = strip(tds[0]).replace(new RegExp("^" + idMatch[1] + "\\s*"), "").trim();
    const meaning = strip(tds[1]).trim();
    if (!meaning) continue;
    grades.push({ grade: idMatch[1], label, meaning });
  }
  const unique = [];
  const seen = new Set();
  for (const g of grades) {
    if (seen.has(g.grade)) continue;
    seen.add(g.grade);
    unique.push(g);
  }
  unique.sort((a, b) => a.grade.localeCompare(b.grade));
  const draft = attrText(html, "draft-note", /Evidence grades[\s\S]{0,400}?<p[^>]*class="[^"]*draft-note[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
  const closing = attrText(
    html,
    "closing",
    /grade-table[\s\S]{0,200}<\/table>[\s\S]{0,80}<p[^>]*>([\s\S]*?)<\/p>/i,
  );
  return { grades: unique, draft_note: draft, closing_note: closing };
}

function attrText(html, _name, re) {
  const m = html.match(re);
  return m ? strip(m[1]).trim() : null;
}

function strip(s) {
  return decodeEntities(
    String(s)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function visibilityOf(entry) {
  return String((entry && entry.visibility) || "public").toLowerCase();
}

function entryUrl(entry) {
  const id = entry && entry.id;
  if (!id) return SITE;
  if (visibilityOf(entry) === "mcp") return MCP_ENTRY_URL(id);
  return ENTRY_PAGE(id);
}

function isNotFound(err) {
  return Boolean(err && err.message && /^Not found:/.test(err.message));
}

async function cachedJsonOrNull(url, ctx) {
  try {
    return await cachedJson(url, ctx);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function cachedJson(url, ctx) {
  const text = await cachedText(url, ctx);
  try {
    return JSON.parse(text);
  } catch {
    if (/^\s*</.test(text)) {
      // An HTML error page (for example a cached origin 404) is treated as "not found" and evicted.
      memoryCache.delete(url);
      try {
        await caches.default.delete(new Request(url, { method: "GET" }));
      } catch {
        /* ignore */
      }
      const nf = new Error(`Not found: ${url}`);
      nf.expose = true;
      throw nf;
    }
    const err = new Error(`The document at ${url} was not valid JSON.`);
    err.expose = true;
    throw err;
  }
}

const memoryCache = new Map();

async function cachedText(url, ctx) {
  const now = Date.now();
  const mem = memoryCache.get(url);
  if (mem && mem.expires > now) return mem.text;
  const cache = caches.default;
  const cacheReq = new Request(url, { method: "GET" });
  const hit = await cache.match(cacheReq);
  if (hit) {
    const text = await hit.text();
    memoryCache.set(url, { text, expires: now + CACHE_TTL_SECONDS * 1000 });
    return text;
  }
  const res = await fetch(url, {
    headers: { "user-agent": "Signetex-MCP/1.0 (+https://signetex.ch; read-only register client)" },
    cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true },
  });
  if (res.status === 404) {
    const err = new Error(`Not found: ${url}`);
    err.expose = true;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Could not fetch ${url} (HTTP ${res.status}).`);
    err.expose = true;
    throw err;
  }
  const text = await res.text();
  if (/\.json$/.test(new URL(url).pathname) && /^\s*</.test(text)) {
    const err = new Error(`Not found: ${url}`);
    err.expose = true;
    throw err;
  }
  memoryCache.set(url, { text, expires: Date.now() + CACHE_TTL_SECONDS * 1000 });
  const cached = new Response(text, {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type") || "text/plain; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
  if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheReq, cached.clone()));
  return text;
}

function rateLimitKey(request) {
  const ip = request.headers.get("cf-connecting-ip") || "0";
  return fnv1a(ip);
}

function tooManyRequests() {
  return cors(
    new Response(JSON.stringify({ error: "Too many requests. Please retry shortly." }), {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": "60",
        "cache-control": "no-store",
      },
    }),
  );
}

async function rateLimit(request, env, ctx) {
  const key = rateLimitKey(request);
  if (env && env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === "function") {
    const { success } = await env.RATE_LIMITER.limit({ key });
    if (!success) return tooManyRequests();
    return null;
  }
  const minute = Math.floor(Date.now() / 60000);
  const keyUrl = `https://signetex-mcp.rate-limit/m/${minute}/${key}`;
  const cache = caches.default;
  const cacheReq = new Request(keyUrl, { method: "GET" });
  const hit = await cache.match(cacheReq);
  let count = 0;
  if (hit) {
    count = Number(await hit.text()) || 0;
  }
  count += 1;
  const stored = new Response(String(count), {
    headers: { "cache-control": "max-age=70", "content-type": "text/plain" },
  });
  if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheReq, stored));
  if (count > RATE_LIMIT_PER_MINUTE) return tooManyRequests();
  return null;
}

let capReservation = { day: "", remaining: 0 };

function dailyCapLimit(env) {
  const raw = env && env.DAILY_CAP_LIMIT;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return DAILY_CAP_DEFAULT;
}

function secondsUntilUtcMidnight(now) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

function capacityReached(day, now) {
  const retry = secondsUntilUtcMidnight(now);
  return cors(
    new Response(
      JSON.stringify({
        error: "daily capacity reached, try tomorrow",
        day,
        retry_after_seconds: retry,
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "retry-after": String(retry),
          "cache-control": "no-store",
        },
      },
    ),
  );
}

function capBlockedRequest(day, limit) {
  return new Request(`https://signetex-mcp.internal/cap-blocked/${day}/${limit}`, { method: "GET" });
}

async function markCapBlocked(day, limit, seconds, ctx) {
  const cached = new Response("blocked", {
    headers: { "cache-control": `public, max-age=${seconds}`, "content-type": "text/plain" },
  });
  if (ctx && ctx.waitUntil) ctx.waitUntil(caches.default.put(capBlockedRequest(day, limit), cached));
}

async function enforceDailyCap(request, env, ctx) {
  const now = new Date();
  const day = utcDateString(now);
  const limit = dailyCapLimit(env);
  const hit = await caches.default.match(capBlockedRequest(day, limit));
  if (hit) return capacityReached(day, now);

  if (capReservation.day === day && capReservation.remaining > 0) {
    capReservation.remaining -= 1;
    return null;
  }

  if (!env || !env.DAILY_CAP) {
    return capacityReached(day, now);
  }

  let data;
  try {
    const id = env.DAILY_CAP.idFromName(`signetex-mcp-cap:${day}`);
    const stub = env.DAILY_CAP.get(id);
    const res = await stub.fetch("https://daily-cap/admit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ day, limit, n: Math.min(CAP_RESERVE_BATCH, limit) }),
    });
    data = await res.json();
  } catch {
    return capacityReached(day, now);
  }

  if (!data || !data.allowed || !(data.granted > 0)) {
    await markCapBlocked(day, limit, secondsUntilUtcMidnight(now), ctx);
    capReservation = { day, remaining: 0 };
    return capacityReached(day, now);
  }

  capReservation = { day, remaining: data.granted - 1 };
  return null;
}

function fnv1a(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function utcDateString(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return utcDateString(dt);
}

function dayDiff(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function jsonrpcError(id, code, message, httpStatus) {
  return jsonResponse({ jsonrpc: "2.0", id, error: { code, message } }, httpStatus || 200);
}

function cors(response) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    "content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  );
  headers.set("access-control-expose-headers", "mcp-protocol-version, mcp-session-id");
  headers.set("access-control-max-age", "86400");
  return new Response(response.body, { status: response.status, headers });
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
