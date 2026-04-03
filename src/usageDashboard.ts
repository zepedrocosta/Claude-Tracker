import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { discoverMcpServers } from "./mcpProvider";
import { ClaudeUsageData } from "./types";

export function buildUsageDashboardHtml(
  data: ClaudeUsageData,
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const clawdIconUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "icons", "clawd.svg"),
  );
  const toolsIconUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "icons", "tools.svg"),
  );
  const serverIconUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "icons", "server.svg"),
  );
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const servers = discoverMcpServers(workspaceRoot);
  const mcpTotal = servers.length;
  const mcpEnabled = servers.filter((s) => !s.disabled).length;
  const mcpConfigPct = Math.min((mcpTotal / 30) * 100, 100);
  const mcpEnabledPct = Math.min((mcpEnabled / 10) * 100, 100);
  const mcpConfigColor =
    mcpTotal > 30 ? "#e55" : mcpTotal >= 20 ? "#5b5" : "var(--accent)";
  const mcpEnabledColor =
    mcpEnabled > 10 ? "#e55" : mcpEnabled > 7 ? "var(--accent)" : "#5b5";

  const templatePath = path.join(
    __dirname,
    "..",
    "media",
    "usageDashboard.html",
  );
  return fs
    .readFileSync(templatePath, "utf-8")
    .replace(/\{\{NONCE\}\}/g, nonce)
    .replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource)
    .replace(/\{\{CLAWD_ICON\}\}/g, clawdIconUri.toString())
    .replace(/\{\{TOOLS_ICON\}\}/g, toolsIconUri.toString())
    .replace(/\{\{SERVER_ICON\}\}/g, serverIconUri.toString())
    .replace(/\{\{MCP_TOTAL\}\}/g, String(mcpTotal))
    .replace(/\{\{MCP_ENABLED\}\}/g, String(mcpEnabled))
    .replace(/\{\{MCP_CONFIG_PCT\}\}/g, String(mcpConfigPct))
    .replace(/\{\{MCP_CONFIG_COLOR\}\}/g, mcpConfigColor)
    .replace(/\{\{MCP_ENABLED_PCT\}\}/g, String(mcpEnabledPct))
    .replace(/\{\{MCP_ENABLED_COLOR\}\}/g, mcpEnabledColor)
    .replace("{{INITIAL_DATA}}", JSON.stringify(data));
}
