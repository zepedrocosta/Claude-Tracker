import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { errText, logError, logInfo, logWarn } from "./log";

export type McpScope = "user" | "local" | "project";

export interface McpServerInfo {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  disabled: boolean;
  scope: McpScope;
  /** User-authored note, stored in ~/.claude/tracker-cache.json */
  description: string;
  /** User-authored documentation link, stored in ~/.claude/tracker-cache.json */
  url: string;
}

/** Per-server notes/links the user adds from the MCP dashboard. */
export interface McpServerMeta {
  description: string;
  url: string;
}

interface McpServerConfig {
  type?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}

// ~/.claude.json — contains user-scope mcpServers (top-level) and local-scope
// mcpServers (under projects[workspacePath].mcpServers)
const CLAUDE_JSON_PATH = path.join(os.homedir(), ".claude.json");

// Claude Tracker's own state file. Per-server notes and links live here rather
// than in ~/.claude.json so the extension never writes user notes into Claude
// Code's config. Keyed by server name, so it applies regardless of scope.
const TRACKER_CACHE_PATH = path.join(
  os.homedir(),
  ".claude",
  "tracker-cache.json",
);
const MCP_META_KEY = "mcpServerMeta";
const TRACKER_CACHE_COMMENT =
  "Claude Tracker shared cache. Coordinates API fetches and rate-limit backoff across all open VS Code instances. Do not edit manually.";

function readJsonFile(filePath: string): Record<string, unknown> | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    // A missing file is the normal case for .mcp.json and the tracker cache,
    // so only log the reads that failed for some other reason.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logWarn(`MCP: could not read ${filePath} — ${errText(err)}`);
    }
    return null;
  }
  try {
    return JSON.parse(content);
  } catch (err) {
    // Worth shouting about: malformed JSON here makes the dashboard look empty
    // rather than broken, which is otherwise indistinguishable from "no servers".
    logError(`MCP: ignoring malformed JSON in ${filePath} — ${errText(err)}`);
    return null;
  }
}

function writeJsonFile(
  filePath: string,
  data: Record<string, unknown>,
): boolean {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    return true;
  } catch (err) {
    logError(`MCP: failed to write ${filePath} — ${errText(err)}`);
    return false;
  }
}

/**
 * Read-modify-write of ~/.claude/tracker-cache.json that preserves every other
 * key (usage cache, rate-limit backoff). The file is a regenerable cache, so an
 * unparseable one is replaced rather than treated as an error.
 */
function updateTrackerCache(
  mutate: (cache: Record<string, unknown>) => void,
): boolean {
  const cache = readJsonFile(TRACKER_CACHE_PATH) ?? {};
  mutate(cache);
  try {
    fs.mkdirSync(path.dirname(TRACKER_CACHE_PATH), { recursive: true });
    const payload = { _comment: TRACKER_CACHE_COMMENT, ...cache };
    fs.writeFileSync(
      TRACKER_CACHE_PATH,
      JSON.stringify(payload, null, 2),
      "utf-8",
    );
    return true;
  } catch (err) {
    logError(`MCP: failed to write ${TRACKER_CACHE_PATH} — ${errText(err)}`);
    return false;
  }
}

/** Reads every stored note/link from the tracker cache, keyed by server name. */
export function readMcpMeta(): Record<string, McpServerMeta> {
  const cache = readJsonFile(TRACKER_CACHE_PATH);
  const raw = cache?.[MCP_META_KEY] as
    | Record<string, Partial<McpServerMeta>>
    | undefined;
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const meta: Record<string, McpServerMeta> = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    meta[name] = {
      description:
        typeof entry.description === "string" ? entry.description : "",
      url: typeof entry.url === "string" ? entry.url : "",
    };
  }
  return meta;
}

/**
 * Writes the note/link for a server into the tracker cache. Passing two blank
 * values removes the entry.
 */
export function setMcpServerMeta(
  name: string,
  description: string,
  url: string,
): boolean {
  const trimmedDescription = description.trim();
  const trimmedUrl = url.trim();
  const clearing = !trimmedDescription && !trimmedUrl;

  const ok = updateTrackerCache((cache) => {
    const meta = (cache[MCP_META_KEY] ?? {}) as Record<string, McpServerMeta>;
    if (clearing) {
      delete meta[name];
    } else {
      meta[name] = { description: trimmedDescription, url: trimmedUrl };
    }
    if (Object.keys(meta).length === 0) {
      delete cache[MCP_META_KEY];
    } else {
      cache[MCP_META_KEY] = meta;
    }
  });

  if (!ok) {
    logError(`MCP: failed to save notes for "${name}"`);
  } else if (clearing) {
    logInfo(`MCP: cleared notes for "${name}"`);
  } else {
    logInfo(
      `MCP: saved notes for "${name}" ` +
        `(description ${trimmedDescription.length} chars, ` +
        `link ${trimmedUrl || "none"})`,
    );
  }
  return ok;
}

/** Drops a server's stored note/link (used when the server itself is deleted). */
function removeMcpMeta(name: string): void {
  const meta = readMcpMeta();
  if (!meta[name]) {
    return;
  }
  setMcpServerMeta(name, "", "");
}

function parseMcpEntries(
  mcpServers: Record<string, McpServerConfig>,
  scope: McpScope,
): McpServerInfo[] {
  const results: McpServerInfo[] = [];
  for (const [name, server] of Object.entries(mcpServers)) {
    if (!server || typeof server.command !== "string") {
      continue;
    }
    results.push({
      name,
      command: server.command,
      args: server.args ?? [],
      env: server.env ?? {},
      disabled: server.disabled === true,
      scope,
      description: "",
      url: "",
    });
  }
  return results;
}

export function discoverMcpServers(workspaceRoot?: string): McpServerInfo[] {
  const serverMap = new Map<string, McpServerInfo>();

  // 1. User scope — ~/.claude.json top-level mcpServers
  const claudeJson = readJsonFile(CLAUDE_JSON_PATH);
  if (claudeJson) {
    const userMcp = claudeJson.mcpServers as
      | Record<string, McpServerConfig>
      | undefined;
    if (userMcp && typeof userMcp === "object") {
      for (const s of parseMcpEntries(userMcp, "user")) {
        serverMap.set(s.name, s);
      }
    }

    // 2. Local scope — ~/.claude.json projects[workspacePath].mcpServers
    if (workspaceRoot) {
      const projects = claudeJson.projects as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (projects && typeof projects === "object") {
        const projectEntry = projects[workspaceRoot];
        if (projectEntry) {
          const localMcp = projectEntry.mcpServers as
            | Record<string, McpServerConfig>
            | undefined;
          if (localMcp && typeof localMcp === "object") {
            for (const s of parseMcpEntries(localMcp, "local")) {
              serverMap.set(s.name, s); // local overrides user
            }
          }
        }
      }
    }
  }

  // 3. Project scope — .mcp.json at workspace root
  if (workspaceRoot) {
    const mcpJsonPath = path.join(workspaceRoot, ".mcp.json");
    const mcpJson = readJsonFile(mcpJsonPath);
    if (mcpJson) {
      const projectMcp = mcpJson.mcpServers as
        | Record<string, McpServerConfig>
        | undefined;
      if (projectMcp && typeof projectMcp === "object") {
        // Check enabled/disabled overrides from ~/.claude.json projects entry
        let disabledSet = new Set<string>();
        if (claudeJson) {
          const projects = claudeJson.projects as
            | Record<string, Record<string, unknown>>
            | undefined;
          const projectEntry = projects?.[workspaceRoot];
          if (projectEntry) {
            const disabledList = projectEntry.disabledMcpjsonServers as
              | string[]
              | undefined;
            if (Array.isArray(disabledList)) {
              disabledSet = new Set(disabledList);
            }
          }
        }
        for (const s of parseMcpEntries(projectMcp, "project")) {
          if (disabledSet.has(s.name)) {
            s.disabled = true;
          }
          serverMap.set(s.name, s); // project scope: local > project > user in priority
        }
      }
    }
  }

  // Overlay the user's own notes/links, stored separately from the MCP config
  const meta = readMcpMeta();
  const servers = Array.from(serverMap.values());
  for (const server of servers) {
    const entry = meta[server.name];
    if (entry) {
      server.description = entry.description;
      server.url = entry.url;
    }
  }
  servers.sort((a, b) => a.name.localeCompare(b.name));

  const byScope = { user: 0, local: 0, project: 0 };
  for (const s of servers) {
    byScope[s.scope]++;
  }
  const disabledCount = servers.filter((s) => s.disabled).length;
  logInfo(
    `MCP: discovered ${servers.length} server(s) — ` +
      `user ${byScope.user}, local ${byScope.local}, project ${byScope.project}; ` +
      `${disabledCount} disabled, ${Object.keys(meta).length} with saved notes`,
  );

  return servers;
}

export function toggleMcpServer(
  name: string,
  disabled: boolean,
  scope: McpScope,
  workspaceRoot?: string,
): boolean {
  const action = disabled ? "disable" : "enable";
  logInfo(`MCP: ${action} "${name}" (${scope} scope)`);

  if (scope === "project") {
    // Project-scope servers (.mcp.json) — toggle via enabledMcpjsonServers/disabledMcpjsonServers
    // in ~/.claude.json projects entry
    if (!workspaceRoot) {
      logWarn(`MCP: cannot ${action} "${name}" — no workspace folder is open`);
      return false;
    }
    const claudeJson = readJsonFile(CLAUDE_JSON_PATH);
    if (!claudeJson) {
      logWarn(`MCP: cannot ${action} "${name}" — ${CLAUDE_JSON_PATH} unreadable`);
      return false;
    }
    const projects = (claudeJson.projects ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    const entry = projects[workspaceRoot] ?? {};
    const enabledList = new Set<string>(
      Array.isArray(entry.enabledMcpjsonServers)
        ? (entry.enabledMcpjsonServers as string[])
        : [],
    );
    const disabledList = new Set<string>(
      Array.isArray(entry.disabledMcpjsonServers)
        ? (entry.disabledMcpjsonServers as string[])
        : [],
    );
    if (disabled) {
      disabledList.add(name);
      enabledList.delete(name);
    } else {
      enabledList.add(name);
      disabledList.delete(name);
    }
    entry.enabledMcpjsonServers = Array.from(enabledList);
    entry.disabledMcpjsonServers = Array.from(disabledList);
    projects[workspaceRoot] = entry;
    claudeJson.projects = projects;
    const written = writeJsonFile(CLAUDE_JSON_PATH, claudeJson);
    if (written) {
      logInfo(`MCP: "${name}" ${disabled ? "disabled" : "enabled"}`);
    }
    return written;
  }

  // User or local scope — toggle disabled field in ~/.claude.json
  const claudeJson = readJsonFile(CLAUDE_JSON_PATH);
  if (!claudeJson) {
    logWarn(`MCP: cannot ${action} "${name}" — ${CLAUDE_JSON_PATH} unreadable`);
    return false;
  }

  let mcpServers: Record<string, McpServerConfig> | undefined;
  if (scope === "user") {
    mcpServers = claudeJson.mcpServers as
      | Record<string, McpServerConfig>
      | undefined;
  } else if (scope === "local" && workspaceRoot) {
    const projects = claudeJson.projects as
      | Record<string, Record<string, unknown>>
      | undefined;
    mcpServers = projects?.[workspaceRoot]?.mcpServers as
      | Record<string, McpServerConfig>
      | undefined;
  }

  if (!mcpServers || !mcpServers[name]) {
    logWarn(`MCP: cannot ${action} "${name}" — not found in ${scope} scope`);
    return false;
  }

  if (disabled) {
    mcpServers[name].disabled = true;
  } else {
    delete mcpServers[name].disabled;
  }
  const written = writeJsonFile(CLAUDE_JSON_PATH, claudeJson);
  if (written) {
    logInfo(`MCP: "${name}" ${disabled ? "disabled" : "enabled"}`);
  }
  return written;
}

export function deleteMcpServer(
  name: string,
  scope: McpScope,
  workspaceRoot?: string,
): boolean {
  logInfo(`MCP: delete "${name}" (${scope} scope)`);

  if (scope === "project") {
    // Delete from .mcp.json
    if (!workspaceRoot) {
      logWarn(`MCP: cannot delete "${name}" — no workspace folder is open`);
      return false;
    }
    const mcpJsonPath = path.join(workspaceRoot, ".mcp.json");
    const mcpJson = readJsonFile(mcpJsonPath);
    if (!mcpJson) {
      logWarn(`MCP: cannot delete "${name}" — ${mcpJsonPath} unreadable`);
      return false;
    }
    const servers = mcpJson.mcpServers as
      | Record<string, McpServerConfig>
      | undefined;
    if (!servers || !servers[name]) {
      logWarn(`MCP: cannot delete "${name}" — not found in ${mcpJsonPath}`);
      return false;
    }
    delete servers[name];
    const removed = writeJsonFile(mcpJsonPath, mcpJson);
    if (removed) {
      logInfo(`MCP: removed "${name}" from ${mcpJsonPath}`);
      removeMcpMeta(name);
    }
    return removed;
  }

  // User or local scope — delete from ~/.claude.json
  const claudeJson = readJsonFile(CLAUDE_JSON_PATH);
  if (!claudeJson) {
    logWarn(`MCP: cannot delete "${name}" — ${CLAUDE_JSON_PATH} unreadable`);
    return false;
  }

  let mcpServers: Record<string, McpServerConfig> | undefined;
  if (scope === "user") {
    mcpServers = claudeJson.mcpServers as
      | Record<string, McpServerConfig>
      | undefined;
  } else if (scope === "local" && workspaceRoot) {
    const projects = claudeJson.projects as
      | Record<string, Record<string, unknown>>
      | undefined;
    mcpServers = projects?.[workspaceRoot]?.mcpServers as
      | Record<string, McpServerConfig>
      | undefined;
  }

  if (!mcpServers || !mcpServers[name]) {
    logWarn(`MCP: cannot delete "${name}" — not found in ${scope} scope`);
    return false;
  }
  delete mcpServers[name];
  const removed = writeJsonFile(CLAUDE_JSON_PATH, claudeJson);
  if (removed) {
    logInfo(`MCP: removed "${name}" from ${scope} scope`);
    removeMcpMeta(name);
  }
  return removed;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildMcpDashboardHtml(
  servers: McpServerInfo[],
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const nonce = crypto.randomBytes(16).toString("hex");

  const totalCount = servers.length;
  const enabledCount = servers.filter((s) => !s.disabled).length;

  const configPct = Math.min((totalCount / 30) * 100, 100);
  const enabledPct = Math.min((enabledCount / 10) * 100, 100);

  const configColor =
    totalCount > 30 ? "#e55" : totalCount >= 20 ? "#5b5" : "var(--accent)";
  const enabledColor =
    enabledCount > 10 ? "#e55" : enabledCount > 7 ? "var(--accent)" : "#5b5";

  const scopeLabel = (s: McpServerInfo) => {
    switch (s.scope) {
      case "user":
        return "User";
      case "local":
        return "Local";
      case "project":
        return "Project";
    }
  };

  const rows =
    servers.length > 0
      ? servers
          .map(
            (s, i) => `
        <tr class="server-row" data-index="${i}" data-name="${escapeHtml(s.name)}" data-description="${escapeHtml(s.description)}" data-url="${escapeHtml(s.url)}" style="animation: fadeIn 0.3s ease ${i * 0.04}s both;">
          <td class="name-cell">
            <div class="name-wrap">
              <span class="server-icon ${s.disabled ? "disabled" : ""}">&#9881;</span>
              <span class="name-block">
                <span class="name-line">
                  <span class="server-name ${s.disabled ? "disabled-text" : ""}">${escapeHtml(s.name)}</span>
                  <button class="link-chip" title="Open link" ${s.url ? "" : "hidden"}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                  </button>
                </span>
                <span class="server-desc" ${s.description ? "" : "hidden"}>${escapeHtml(s.description)}</span>
              </span>
            </div>
          </td>
          <td class="command-cell ${s.disabled ? "disabled-text" : ""}">${escapeHtml(s.command + (s.args.length ? " " + s.args.join(" ") : ""))}</td>
          <td class="source-cell"><span class="source-badge source-${s.scope}">${scopeLabel(s)}</span></td>
          <td class="actions-cell">
            <div class="actions">
              <label class="toggle" title="${s.disabled ? "Enable" : "Disable"} server">
                <input type="checkbox" ${s.disabled ? "" : "checked"} data-name="${escapeHtml(s.name)}" data-scope="${s.scope}" />
                <span class="toggle-slider"></span>
              </label>
              <button class="edit-btn" title="Edit description and link">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
              </button>
              <button class="delete-btn" data-name="${escapeHtml(s.name)}" data-scope="${s.scope}" title="Delete server">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>
          </td>
        </tr>`,
          )
          .join("")
      : `<tr><td colspan="4" class="empty">No MCP servers configured. Run <code>claude mcp add</code> to get started.</td></tr>`;

  const serverIconUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "icons", "server.svg"),
  );
  const templatePath = path.join(__dirname, "..", "media", "mcpDashboard.html");
  return fs
    .readFileSync(templatePath, "utf-8")
    .replace(/\{\{NONCE\}\}/g, nonce)
    .replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource)
    .replace(/\{\{SERVER_ICON\}\}/g, serverIconUri.toString())
    .replace(/\{\{ROWS\}\}/g, rows)
    .replace(/\{\{ENABLED_COUNT\}\}/g, String(enabledCount))
    .replace(/\{\{TOTAL_COUNT\}\}/g, String(totalCount))
    .replace(/\{\{CONFIG_PCT\}\}/g, String(configPct))
    .replace(/\{\{CONFIG_COLOR\}\}/g, configColor)
    .replace(/\{\{ENABLED_PCT\}\}/g, String(enabledPct))
    .replace(/\{\{ENABLED_COLOR\}\}/g, enabledColor);
}
