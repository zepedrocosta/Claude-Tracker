import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { exec, execFile } from "child_process";
import { UsageProvider } from "./usageProvider";
import { StatusBarManager } from "./statusBar";
import { ClaudeUsageData, LimitSection } from "./types";
import {
  discoverSkills,
  discoverMarketplaceSkills,
  buildSkillsDashboardHtml,
} from "./skillsProvider";
import {
  discoverMcpServers,
  toggleMcpServer,
  deleteMcpServer,
  buildMcpDashboardHtml,
} from "./mcpProvider";
import { buildUsageDashboardHtml } from "./usageDashboard";

let statusBarManager: StatusBarManager | undefined;
let usageProvider: UsageProvider | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let lastUsageData: ClaudeUsageData | undefined;
let usageDashboardPanel: vscode.WebviewPanel | undefined;
export let outputChannel: vscode.LogOutputChannel;
const AUTO_REFRESH_INTERVAL = 5 * 60_000;
const settingsWatchers: fs.FSWatcher[] = [];
const notifiedThresholds = new Set<string>();

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("Claude Tracker", {
    log: true,
  });
  context.subscriptions.push(outputChannel);

  usageProvider = new UsageProvider((msg) => outputChannel.info(msg));
  statusBarManager = new StatusBarManager(
    context.extensionMode === vscode.ExtensionMode.Development,
  );

  outputChannel.info("Claude Tracker activated");
  refreshData();
  refreshTimer = setInterval(refreshData, AUTO_REFRESH_INTERVAL);

  // Watch Claude Code settings files for instant model/effort updates
  const settingsFilesToWatch = [
    path.join(os.homedir(), ".claude", "settings.json"),
    path.join(os.homedir(), ".claude", "settings.local.json"),
  ];
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    settingsFilesToWatch.push(
      path.join(workspaceRoot, ".claude", "settings.json"),
      path.join(workspaceRoot, ".claude", "settings.local.json"),
    );
  }
  for (const filePath of settingsFilesToWatch) {
    try {
      const watcher = fs.watch(filePath, () => {
        outputChannel.info(`Settings changed: ${filePath}`);
        refreshData();
      });
      settingsWatchers.push(watcher);
      outputChannel.info(`Watching: ${filePath}`);
    } catch {
      // File doesn't exist yet — skip
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("claude-tracker.openConsole", () =>
      vscode.env.openExternal(
        vscode.Uri.parse("https://claude.ai/settings/usage"),
      ),
    ),
    vscode.commands.registerCommand("claude-tracker.showDashboard", () => {
      if (usageDashboardPanel) {
        usageDashboardPanel.reveal();
        return;
      }
      const data = lastUsageData ?? {
        plan: vscode.workspace
          .getConfiguration("claudeTracker")
          .get<string>("plan", "Claude Pro"),
        lastUpdated: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      };
      const panel = vscode.window.createWebviewPanel(
        "claudeTrackerUsage",
        "Claude Usage",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "media"),
          ],
        },
      );
      panel.iconPath = vscode.Uri.joinPath(
        context.extensionUri,
        "media",
        "icons",
        "clawd.svg",
      );
      panel.webview.html = buildUsageDashboardHtml(
        data as ClaudeUsageData,
        panel.webview,
        context.extensionUri,
      );
      usageDashboardPanel = panel;
      panel.onDidDispose(() => {
        usageDashboardPanel = undefined;
      });
      panel.webview.onDidReceiveMessage((msg) => {
        if (msg.command === "refresh") {
          refreshData();
        } else if (msg.command === "openConsole") {
          vscode.env.openExternal(
            vscode.Uri.parse("https://claude.ai/settings/usage"),
          );
        } else if (msg.command === "showSkills") {
          vscode.commands.executeCommand("claude-tracker.showSkills");
        } else if (msg.command === "showMcp") {
          vscode.commands.executeCommand("claude-tracker.showMcp");
        }
      });
    }),
    vscode.commands.registerCommand(
      "claude-tracker.toggleNotifications",
      async () => {
        const config = vscode.workspace.getConfiguration("claudeTracker");
        const current = config.get<boolean>("notifications", false);
        await config.update(
          "notifications",
          !current,
          vscode.ConfigurationTarget.Global,
        );
        notifiedThresholds.clear();
        if (lastUsageData && statusBarManager) {
          statusBarManager.update(lastUsageData);
        }
      },
    ),
    vscode.commands.registerCommand("claude-tracker.showMcp", () => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const servers = discoverMcpServers(workspaceRoot);
      const panel = vscode.window.createWebviewPanel(
        "claudeTrackerMcp",
        "MCP Servers",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "media"),
          ],
        },
      );
      panel.iconPath = vscode.Uri.joinPath(
        context.extensionUri,
        "media",
        "icons",
        "clawd.svg",
      );
      panel.webview.html = buildMcpDashboardHtml(
        servers,
        panel.webview,
        context.extensionUri,
      );

      const refreshPanel = () => {
        const updated = discoverMcpServers(workspaceRoot);
        panel.webview.html = buildMcpDashboardHtml(
          updated,
          panel.webview,
          context.extensionUri,
        );
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
          const ok = toggleMcpServer(
            msg.name,
            msg.disabled,
            msg.scope,
            workspaceRoot,
          );
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
      const marketplaceGroups = discoverMarketplaceSkills();
      const panel = vscode.window.createWebviewPanel(
        "claudeTrackerSkills",
        "Installed Skills",
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "media"),
          ],
        },
      );
      panel.iconPath = vscode.Uri.joinPath(
        context.extensionUri,
        "media",
        "icons",
        "clawd.svg",
      );
      panel.webview.html = buildSkillsDashboardHtml(
        skills,
        marketplaceGroups,
        panel.webview,
        context.extensionUri,
      );
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
    {
      dispose: () => {
        if (refreshTimer) {
          clearInterval(refreshTimer);
        }
        for (const w of settingsWatchers) {
          w.close();
        }
        statusBarManager?.dispose();
      },
    },
  );
}

function refreshData(): void {
  if (!usageProvider || !statusBarManager) {
    return;
  }
  usageProvider
    .getUsageData()
    .then((data) => {
      lastUsageData = data;
      statusBarManager!.update(data);
      if (usageDashboardPanel) {
        usageDashboardPanel.webview.postMessage({ command: "update", data });
      }
      if (data.error) {
        outputChannel.warn(`Usage data error: ${data.error}`);
      } else {
        const parts: string[] = [`plan=${data.plan}`];
        if (data.sessionLimit) {
          parts.push(`session=${data.sessionLimit.percentage}%`);
        }
        if (data.weeklyLimit) {
          parts.push(`weekly=${data.weeklyLimit.percentage}%`);
        }
        if (data.modelInfo) {
          parts.push(`effort=${data.modelInfo.effortLevel}`);
        }
        outputChannel.info(`OK — ${parts.join(", ")}`);
      }
      checkNotifications(data);
    })
    .catch((err) => {
      outputChannel.error(
        `Refresh error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      const config = vscode.workspace.getConfiguration("claudeTracker");
      const plan = config.get<string>("plan", "Claude Pro");
      statusBarManager!.update({
        plan,
        lastUpdated: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

function checkNotifications(data: ClaudeUsageData): void {
  const enabled = vscode.workspace
    .getConfiguration("claudeTracker")
    .get<boolean>("notifications", false);
  if (!enabled || data.error) {
    return;
  }

  const config = vscode.workspace.getConfiguration("claudeTracker");
  const thresholds = [
    ...config.get<number[]>("notificationThresholds", [75, 90]),
  ]
    .filter((t) => typeof t === "number" && t >= 1 && t <= 100)
    .sort((a, b) => b - a);

  const limits: LimitSection[] = [
    data.sessionLimit,
    data.weeklyLimit,
    data.extraUsage,
  ].filter((l): l is LimitSection => !!l);

  const maxThreshold = thresholds[0] ?? 90;

  for (const limit of limits) {
    for (const threshold of thresholds) {
      const key = `${limit.label}:${threshold}`;
      if (limit.percentage >= threshold && !notifiedThresholds.has(key)) {
        notifiedThresholds.add(key);
        const method =
          threshold >= maxThreshold
            ? vscode.window.showWarningMessage
            : vscode.window.showInformationMessage;
        method(`Claude Tracker: ${limit.label} is at ${limit.percentage}%`);
        outputChannel.info(
          `Notification: ${limit.label} at ${limit.percentage}% (threshold ${threshold}%)`,
        );
        break;
      }
    }
  }
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
  outputChannel.info("Claude Tracker deactivated");
}
