# Signetex MCP server

**Signetex is a public register of claims and forecasts: who said what, when and where, verbatim and with sources, checked later against a criterion that was fixed in advance.** It does not decide what is true. It shows the evidence, the evidence grade (E0–E4) and the outcome. Signetex is independent.

This repository contains the source of the read-only Signetex [Model Context Protocol](https://modelcontextprotocol.io) server (`worker.js`). The server runs as a Cloudflare Worker and answers Streamable HTTP JSON-RPC. It does not store the register. It reads the published static files on [signetex.ch](https://signetex.ch) and caches them for about one hour. Register data is not included in this repository.

| | |
| --- | --- |
| **MCP endpoint** | `https://mcp.signetex.ch/mcp` (Streamable HTTP) |
| **Current version** | 1.7.41 |
| **Authentication** | none |
| **Access** | read-only |
| **Website and register** | <https://signetex.ch> |
| **Official MCP Registry name** | `ch.signetex/register` |
| **Server card** | <https://mcp.signetex.ch/mcp/server-card> |
| **AI catalog** | <https://mcp.signetex.ch/.well-known/ai-catalog.json> |
| **Terms of use** | <https://signetex.ch/en/terms.html> |

Signetex is still being built. Coverage grows every day, and nothing here is a promise about future content or availability.

## What is in the register

Four areas: machine intelligence (`machine-intelligence`), human impact (`human-impact`), politics and economy (`politics-economy`) and corporate promises (`corporate-promises`).

The public site shows entries that have a page on signetex.ch. This server also returns verified MCP-only entries that have no HTML page. Call `register_stats` for the current counts. Internal (paywalled) entries and the speculative "Futures" essays are never served.

**Not investment advice.** Entries in the corporate-promises area record publicly made corporate statements. Nothing in the register or in this server is investment advice, and it is provided without warranty.

## Connect

Claude Code:

```sh
claude mcp add --transport http signetex https://mcp.signetex.ch/mcp
```

Any client with Streamable HTTP support (for example Claude Desktop or Cursor):

```json
{
  "mcpServers": {
    "signetex": {
      "url": "https://mcp.signetex.ch/mcp"
    }
  }
}
```

Plain HTTP check:

```sh
curl -s https://mcp.signetex.ch/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The endpoint is stateless. `GET /mcp` answers `405` with an `Allow: POST, OPTIONS` header, because the server opens no server-initiated stream. Requests are rate limited; please keep clients polite.

## Tools

### `search_claims`

Search the Signetex register of verified claims (public pages and MCP-only entries) across machine-intelligence, human-impact, politics-economy and corporate-promises. Internal or paywalled corporate entries are not included, nor are the speculative Futures essays. Returns matching entries with canonical URLs. Signetex grades evidence and issues no true/false verdicts.

Arguments: `query`, `area` (one of: `machine-intelligence`, `human-impact`, `politics-economy`, `corporate-promises`), `kind`, `grade`, `outcome`, `limit`.

### `get_entry`

Get one register entry by its stable ID (for example SGX-AI-000031 or SGX-HU-000016), including sources, counter-evidence, grade rationale and history, with the canonical page URL. Signetex grades evidence and issues no true/false verdicts.

Arguments: `id` (required).

### `due_forecasts`

List register forecasts whose due date falls within the given number of days (including those already due and still open). Futures essays are not included. Signetex grades evidence and issues no true/false verdicts.

Arguments: `within_days`.

### `list_due`

List forecasts whose due date falls in the inclusive window from…to (YYYY-MM-DD). Returns public and MCP-only entries, including already closed ones in that window. Signetex grades evidence and issues no true/false verdicts.

Arguments: `from` (required), `to` (required).

### `track_record`

Return the closed-forecast record of a speaker or institution: counts of met, partial and not met, and a hit rate per register area. Hit rates count only forecasts whose criterion was fixed before the outcome; retrospective (back-captured) entries are counted separately under retrospective. Uses public and MCP-only entries, never internal ones. Signetex grades evidence and issues no true/false verdicts.

Arguments: `speaker`, `institution`.

### `compare_forecasts`

Show forecasts by different sources on one topic, drawn from public and MCP-only entries. Signetex grades evidence and issues no true/false verdicts.

Arguments: `topic` (required), `area` (one of: `machine-intelligence`, `human-impact`, `politics-economy`, `corporate-promises`), `limit`.

### `register_stats`

Headline counts for the published register: totals, areas, grades, forecast outcomes. A hit rate is only included once at least 30 forecasts have closed, as on the public site. Only forecasts whose criterion was fixed before the outcome count; back-captured entries with criterion_timing retrospective are reported separately as retrospective_accuracy, never as a hit rate. Signetex grades evidence and issues no true/false verdicts.

No arguments.

### `evidence_grades`

Return the published E0–E4 evidence-grade definitions from the Signetex method page, not a true/false scale.

No arguments.

### `latest_proof`

Return the latest published OpenTimestamps proof snapshot of the register (root hash, status, manifest URLs).

No arguments.

## Example queries

Ask your assistant, or call the tools directly:

- "What did the Swiss National Bank forecast for inflation, and what happened?" → `search_claims` with `query: "SNB inflation"`, `area: "politics-economy"`
- "Show me the entry SGX-AI-000031 with its sources and grade rationale." → `get_entry` with `id: "SGX-AI-000031"`
- "Which forecasts are due in the next 90 days?" → `due_forecasts` with `within_days: 90`
- "Which forecasts fall due between 1 January and 30 June 2027?" → `list_due` with `from: "2027-01-01"`, `to: "2027-06-30"`
- "How have forecasts by the IMF turned out?" → `track_record` with `institution: "IMF"`
- "Compare what different sources forecast for AGI." → `compare_forecasts` with `topic: "AGI"`
- "How big is the register, and is there a hit rate yet?" → `register_stats`
- "What do E0 to E4 mean?" → `evidence_grades`
- "Can I verify that the register was not changed afterwards?" → `latest_proof`

## Evidence grades

The grades describe the quality of the evidence at hand. They are **not** a true/false scale.

| Grade | Label | Meaning |
| --- | --- | --- |
| E0 | No checkable evidence | No verifiable evidence; a bare assertion or announcement. |
| E1 | Only the claimant | Evidence only from the source itself (press release, own statements, marketing). |
| E2 | One independent source | Isolated independent evidence, for example a preprint, a single measurement, or specialist press citing a primary source. |
| E3 | Peer-reviewed or reproduced | Peer-reviewed publication(s) or independent reproduction; counter-evidence has been taken into account. |
| E4 | Broadly established | Widely reproduced, established in the market or in standards; a consensus in the specialist literature. |

The definitions are published on the [method page](https://signetex.ch/en/methodology.html) and returned by the `evidence_grades` tool.

## Honesty rules

- **No verdicts.** Signetex grades evidence and issues no true/false verdicts.
- **Verbatim and sourced.** Quotes are reproduced as published. Each entry says whether the text is a `verbatim_text` or a `table_row` copied from a published table.
- **Criteria are fixed in advance.** A forecast is checked against a criterion that was set before the outcome was known.
- **Retrospective entries are marked.** History captured after its outcome was known carries `criterion_timing: retrospective`. It is never described as pre-registered and is excluded from every hit rate.
- **Hit rates only when earned.** A headline hit rate is published only after at least 30 forecasts with a prospectively fixed criterion have closed. Until then the server reports `hit_rate: null` and shows retrospective accuracy separately.
- **No corrections after the fact.** A criterion is never tuned after seeing the outcome.
- **Timestamped.** Register snapshots are anchored with OpenTimestamps; see `latest_proof`.
- **Not investment advice.** The register records publicly made statements and collected information, provided without warranty. This applies in particular to the corporate-promises area.

## Source in this repository

| File | Role |
| --- | --- |
| `worker.js` | Cloudflare Worker source, version 1.7.41, matching the live server |
| `wrangler.toml` | Binding layout for the live Worker (account identifiers omitted) |
| `server.json` | Official MCP Registry metadata for `ch.signetex/register` |
| `glama.json` | Maintainer declaration for Glama |

The Worker reports version `1.7.41` in `serverInfo`. This repository does not change the live Worker.

## Terms

Individual entries are released under CC BY-NC 4.0 with the attribution `Source: Signetex, signetex.ch, <entry ID>`. The register as a whole is not released under a Creative Commons licence; please read the [terms of use](https://signetex.ch/en/terms.html) before any bulk or commercial use.

Operator: Hotel Phoenix AG (legal entity only, not a hotel business).

## License

The server code in this repository is released under the MIT License (see `LICENSE`). Register entries and data served by the MCP server are licensed separately under CC BY-NC 4.0, as stated on https://signetex.ch.
