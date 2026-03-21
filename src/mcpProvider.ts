import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

export type McpScope = "user" | "local" | "project";

export interface McpServerInfo {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  disabled: boolean;
  scope: McpScope;
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

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
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
  } catch {
    return false;
  }
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

  const servers = Array.from(serverMap.values());
  servers.sort((a, b) => a.name.localeCompare(b.name));
  return servers;
}

export function toggleMcpServer(
  name: string,
  disabled: boolean,
  scope: McpScope,
  workspaceRoot?: string,
): boolean {
  if (scope === "project") {
    // Project-scope servers (.mcp.json) — toggle via enabledMcpjsonServers/disabledMcpjsonServers
    // in ~/.claude.json projects entry
    if (!workspaceRoot) {
      return false;
    }
    const claudeJson = readJsonFile(CLAUDE_JSON_PATH);
    if (!claudeJson) {
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
    return writeJsonFile(CLAUDE_JSON_PATH, claudeJson);
  }

  // User or local scope — toggle disabled field in ~/.claude.json
  const claudeJson = readJsonFile(CLAUDE_JSON_PATH);
  if (!claudeJson) {
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
    return false;
  }

  if (disabled) {
    mcpServers[name].disabled = true;
  } else {
    delete mcpServers[name].disabled;
  }
  return writeJsonFile(CLAUDE_JSON_PATH, claudeJson);
}

export function deleteMcpServer(
  name: string,
  scope: McpScope,
  workspaceRoot?: string,
): boolean {
  if (scope === "project") {
    // Delete from .mcp.json
    if (!workspaceRoot) {
      return false;
    }
    const mcpJsonPath = path.join(workspaceRoot, ".mcp.json");
    const mcpJson = readJsonFile(mcpJsonPath);
    if (!mcpJson) {
      return false;
    }
    const servers = mcpJson.mcpServers as
      | Record<string, McpServerConfig>
      | undefined;
    if (!servers || !servers[name]) {
      return false;
    }
    delete servers[name];
    return writeJsonFile(mcpJsonPath, mcpJson);
  }

  // User or local scope — delete from ~/.claude.json
  const claudeJson = readJsonFile(CLAUDE_JSON_PATH);
  if (!claudeJson) {
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
    return false;
  }
  delete mcpServers[name];
  return writeJsonFile(CLAUDE_JSON_PATH, claudeJson);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildMcpDashboardHtml(servers: McpServerInfo[], webview: vscode.Webview, extensionUri: vscode.Uri): string {
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
        <tr style="animation: fadeIn 0.3s ease ${i * 0.04}s both;">
          <td class="name-cell">
            <span class="server-icon ${s.disabled ? "disabled" : ""}">&#9881;</span>
            <span class="server-name ${s.disabled ? "disabled-text" : ""}">${escapeHtml(s.name)}</span>
          </td>
          <td class="command-cell ${s.disabled ? "disabled-text" : ""}">${escapeHtml(s.command + (s.args.length ? " " + s.args.join(" ") : ""))}</td>
          <td class="source-cell"><span class="source-badge source-${s.scope}">${scopeLabel(s)}</span></td>
          <td class="actions-cell">
            <label class="toggle" title="${s.disabled ? "Enable" : "Disable"} server">
              <input type="checkbox" ${s.disabled ? "" : "checked"} data-name="${escapeHtml(s.name)}" data-scope="${s.scope}" />
              <span class="toggle-slider"></span>
            </label>
            <button class="delete-btn" data-name="${escapeHtml(s.name)}" data-scope="${s.scope}" title="Delete server">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>
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
