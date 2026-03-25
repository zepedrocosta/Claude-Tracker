import * as vscode from "vscode";
import { ClaudeUsageData, LimitSection } from "./types";

function barColor(percentage: number): string {
  if (percentage >= 90) {
    return "#e05d44";
  }
  if (percentage >= 75) {
    return "#dfb317";
  }
  return "#007acc";
}

function buildBar(percentage: number): string {
  const W = 260,
    H = 4;
  const filled = Math.round((percentage / 100) * W);
  const color = barColor(percentage);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" rx="2" fill="#3c3c3c"/>` +
    `<rect width="${filled}" height="${H}" rx="2" fill="${color}"/>` +
    `</svg>`;
  return `<img src="data:image/svg+xml,${encodeURIComponent(svg)}">`;
}


function appendLimitRow(md: vscode.MarkdownString, limit: LimitSection): void {
  md.appendMarkdown(`${limit.label} &nbsp;&nbsp; **${limit.percentage}%**\n\n`);
  md.appendMarkdown(`<p align="center">${buildBar(limit.percentage)}</p>\n\n`);
  if (limit.subLabel) {
    md.appendMarkdown(`${limit.subLabel}\n\n`);
  }
}

export function buildTooltip(data: ClaudeUsageData): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.isTrusted = true;
  md.supportHtml = true;

  if (data.error) {
    md.appendMarkdown(`$(warning) ${data.error}\n\n`);
  } else {
    md.appendMarkdown(`**${data.plan} Usage**\n\n`);

    if (data.sessionLimit) {
      appendLimitRow(md, data.sessionLimit);
    }

    if (data.weeklyLimit) {
      appendLimitRow(md, data.weeklyLimit);
    }

    if (data.extraUsage) {
      appendLimitRow(md, data.extraUsage);
    }

    md.appendMarkdown(`$(clock) Updated at ${data.lastUpdated}\n\n`);
  }

  if (data.modelInfo) {
    md.appendMarkdown(`---\n\n`);
    const effort =
      data.modelInfo.effortLevel.charAt(0).toUpperCase() +
      data.modelInfo.effortLevel.slice(1);
    md.appendMarkdown(`$(dashboard) Effort: **${effort}**\n\n`);
  }

  const notificationsEnabled = vscode.workspace
    .getConfiguration("claudeTracker")
    .get<boolean>("notifications", false);
  const notifIcon = notificationsEnabled ? "$(bell)" : "$(bell-slash)";
  const notifLabel = notificationsEnabled ? "On" : "Off";

  md.appendMarkdown(`---\n\n`);
  md.appendMarkdown(`${notifIcon} Notifications: **${notifLabel}**\n\n`);
  md.appendMarkdown(`---\n\n`);
  md.appendMarkdown(
    `[Manage usage](https://claude.ai/settings/usage) &nbsp;|&nbsp; [$(tools) Installed Skills](command:claude-tracker.showSkills "View installed skills") &nbsp;|&nbsp; [$(server) MCP Servers](command:claude-tracker.showMcp "View MCP servers")\n\n`,
  );

  return md;
}
