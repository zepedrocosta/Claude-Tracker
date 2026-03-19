import * as vscode from "vscode";
import { ClaudeUsageData } from "./types";
import { buildTooltip } from "./tooltipBuilder";

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.text = "$(clawd-icon)";
    this.statusBarItem.color = "#CC785C";
    this.statusBarItem.name = "Claude Tracker";
    this.statusBarItem.command = "claude-tracker.openConsole";
  }

  public update(data: ClaudeUsageData): void {
    const showStatusBar = vscode.workspace
      .getConfiguration("claudeTracker")
      .get<boolean>("showStatusBar", true);

    this.statusBarItem.tooltip = buildTooltip(data);

    if (showStatusBar) {
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
