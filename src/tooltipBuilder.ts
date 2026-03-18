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
  return `![](data:image/svg+xml,${encodeURIComponent(svg)})`;
}

function appendLimitRow(md: vscode.MarkdownString, limit: LimitSection): void {
  md.appendMarkdown(`${limit.label} &nbsp;&nbsp; **${limit.percentage}%**\n\n`);
  md.appendMarkdown(`${buildBar(limit.percentage)}\n\n`);
  if (limit.subLabel) {
    md.appendMarkdown(`${limit.subLabel}\n\n`);
  }
}

export function buildTooltip(data: ClaudeUsageData): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.isTrusted = true;
  md.supportHtml = true;

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

  if (data.error) {
    md.appendMarkdown(`$(warning) ${data.error}\n\n`);
  }

  md.appendMarkdown(`[Manage usage](https://claude.ai/settings/usage) &nbsp;|&nbsp; [$(tools) Installed Skills](command:claude-tracker.showSkills "View installed skills")\n\n`);
  md.appendMarkdown(
    `$(clock) Updated at ${data.lastUpdated} &nbsp; [$(refresh)](command:claude-tracker.refresh "Refresh")`,
  );

  return md;
}
