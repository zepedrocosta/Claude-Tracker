import * as vscode from "vscode";
import { UsageProvider, RateLimitError } from "./usageProvider";
import { StatusBarManager } from "./statusBar";
import { discoverSkills, buildSkillsDashboardHtml } from "./skillsProvider";

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
    vscode.commands.registerCommand("claude-tracker.showSkills", () => {
      const skills = discoverSkills();
      const panel = vscode.window.createWebviewPanel(
        "claudeTrackerSkills",
        "Installed Skills",
        vscode.ViewColumn.One,
        { enableScripts: true },
      );
      panel.webview.html = buildSkillsDashboardHtml(skills);
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
      }
    });
}

export function deactivate(): void {
  statusBarManager?.dispose();
}
