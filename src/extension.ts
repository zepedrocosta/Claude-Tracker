import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec, execFile } from "child_process";
import { UsageProvider, RateLimitError } from "./usageProvider";
import { StatusBarManager } from "./statusBar";
import { discoverSkills, buildSkillsDashboardHtml } from "./skillsProvider";
import {
  discoverMcpServers,
  toggleMcpServer,
  deleteMcpServer,
  buildMcpDashboardHtml,
} from "./mcpProvider";

let statusBarManager: StatusBarManager | undefined;
let usageProvider: UsageProvider | undefined;
let lastRefreshTime = 0;
const COOLDOWN_DEFAULT = 60_000;
const COOLDOWN_RATE_LIMIT = 600_000;
let cooldown = COOLDOWN_DEFAULT;

export function activate(context: vscode.ExtensionContext): void {
  usageProvider = new UsageProvider();
  statusBarManager = new StatusBarManager();

  refreshData();

  context.subscriptions.push(
    vscode.commands.registerCommand("claude-tracker.refresh", () =>
      refreshData(),
    ),
    vscode.commands.registerCommand("claude-tracker.openConsole", () =>
      vscode.env.openExternal(
        vscode.Uri.parse("https://claude.ai/settings/usage"),
      ),
    ),
    vscode.commands.registerCommand("claude-tracker.showMcp", () => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const servers = discoverMcpServers(workspaceRoot);
      const panel = vscode.window.createWebviewPanel(
        "claudeTrackerMcp",
        "MCP Servers",
        vscode.ViewColumn.One,
        { enableScripts: true },
      );
      panel.iconPath = vscode.Uri.joinPath(
        context.extensionUri,
        "media",
        "clawd.svg",
      );
      panel.webview.html = buildMcpDashboardHtml(servers);

      const refreshPanel = () => {
        const updated = discoverMcpServers(workspaceRoot);
        panel.webview.html = buildMcpDashboardHtml(updated);
      };

      panel.webview.onDidReceiveMessage((msg) => {
        if (msg.command === "openSettingsFile") {
          const settingsPath = path.join(os.homedir(), ".claude.json");
          vscode.workspace.openTextDocument(vscode.Uri.file(settingsPath)).then(
            (doc) => vscode.window.showTextDocument(doc),
            () =>
              vscode.window.showErrorMessage("Could not open ~/.claude.json"),
          );
        } else if (msg.command === "toggleServer") {
          const ok = toggleMcpServer(msg.name, msg.disabled, msg.scope, workspaceRoot);
          if (ok) {
            refreshPanel();
          } else {
            vscode.window.showErrorMessage(`Failed to toggle "${msg.name}"`);
          }
        } else if (msg.command === "deleteServer") {
          const ok = deleteMcpServer(msg.name, msg.scope, workspaceRoot);
          if (ok) {
            refreshPanel();
            vscode.window.showInformationMessage(
              `Removed "${msg.name}" from MCP config`,
            );
          } else {
            vscode.window.showErrorMessage(`Failed to delete "${msg.name}"`);
          }
        }
      });
    }),
    vscode.commands.registerCommand("claude-tracker.showSkills", () => {
      const skills = discoverSkills();
      const panel = vscode.window.createWebviewPanel(
        "claudeTrackerSkills",
        "Installed Skills",
        vscode.ViewColumn.One,
        { enableScripts: true },
      );
      panel.iconPath = vscode.Uri.joinPath(
        context.extensionUri,
        "media",
        "clawd.svg",
      );
      panel.webview.html = buildSkillsDashboardHtml(skills);
      panel.webview.onDidReceiveMessage((msg) => {
        if (msg.command === "openSkillsFolder") {
          const skillsDir = path.join(os.homedir(), ".claude", "skills");
          if (!fs.existsSync(skillsDir)) {
            fs.mkdirSync(skillsDir, { recursive: true });
          }
          openFolder(skillsDir);
        }
      });
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("claudeTracker")) {
        refreshData();
      }
    }),
    { dispose: () => statusBarManager?.dispose() },
  );
}

function refreshData(): void {
  if (!usageProvider || !statusBarManager) {
    return;
  }
  const now = Date.now();
  if (lastRefreshTime > 0 && now - lastRefreshTime < cooldown) {
    const secsLeft = Math.ceil((cooldown - (now - lastRefreshTime)) / 1000);
    const msg =
      cooldown === COOLDOWN_RATE_LIMIT
        ? `$(warning) Rate limited — refresh available in ${Math.ceil(secsLeft / 60)}m`
        : `$(clock) Refresh available in ${secsLeft}s`;
    vscode.window.setStatusBarMessage(msg, 3000);
    return;
  }
  lastRefreshTime = now;
  usageProvider
    .getUsageData()
    .then((data) => {
      cooldown = COOLDOWN_DEFAULT;
      statusBarManager!.update(data);
    })
    .catch((err) => {
      if (err instanceof RateLimitError) {
        cooldown = COOLDOWN_RATE_LIMIT;
        vscode.window.setStatusBarMessage(
          "$(warning) Rate limited — refresh blocked for 10 minutes",
          5000,
        );
      } else {
        console.error("[Claude Tracker] refresh error:", err);
        const config = vscode.workspace.getConfiguration("claudeTracker");
        const plan = config.get<string>("plan", "Claude Pro");
        statusBarManager!.update({
          plan,
          lastUpdated: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
}

function openFolder(folderPath: string): void {
  const platform = os.platform();
  const isWsl =
    platform === "linux" && os.release().toLowerCase().includes("microsoft");

  if (isWsl) {
    exec(`wslpath -w "${folderPath}"`, (err, winPath) => {
      if (err) {
        vscode.window.showErrorMessage("Failed to resolve Windows path");
        return;
      }
      execFile("explorer.exe", [winPath.trim()]);
    });
  } else if (platform === "win32") {
    execFile("explorer.exe", [folderPath]);
  } else if (platform === "darwin") {
    execFile("open", [folderPath]);
  } else {
    execFile("xdg-open", [folderPath]);
  }
}

export function deactivate(): void {
  statusBarManager?.dispose();
}
