import * as vscode from "vscode";
import { ClaudeUsageData, LimitSection, ServiceStatus } from "./types";

// Styled after Copilot's status-bar hover: a plan header with actions on the
// right, then sections split by full-width rules, each made of
// "label ........ value" rows.
//
// Hover markdown goes through VS Code's sanitizer, which strips nearly all
// inline CSS: only `color`, `background-color`, `display:inline-block` and
// `border-radius` survive, only on <span>, and only in that order. So layout
// uses <table width="100%"> with `align="right"` cells, vertical spacing uses
// empty cells with a `height` attribute, and the big percentage is an <h2>.

const EXTENSION_ID = "josecosta.claude-tracker";
const SETTINGS_URI = `command:workbench.action.openSettings?${encodeURIComponent(
  JSON.stringify([`@ext:${EXTENSION_ID}`]),
)}`;

const DIM_COLOR = "var(--vscode-descriptionForeground)";
const WARNING_COLOR = "var(--vscode-editorWarning-foreground)";
const ERROR_COLOR = "var(--vscode-editorError-foreground)";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tint(color: string, html: string): string {
  return `<span style="color:${color};">${html}</span>`;
}

function dim(html: string): string {
  return tint(DIM_COLOR, html);
}

function row(left: string, right = ""): string {
  return `<tr><td>${left}</td><td align="right">${right}</td></tr>`;
}

function fullRow(html: string): string {
  return `<tr><td colspan="2">${html}</td></tr>`;
}

function spacer(height: number): string {
  return `<tr><td colspan="2" height="${height}"></td></tr>`;
}

// The hover's <hr> has a -4px bottom margin, so every section opens with a
// spacer to keep its first line off the rule above it.
function section(rows: string[], last = false): string {
  return `<table width="100%">${spacer(6)}${rows.join("")}${last ? spacer(4) : ""}</table>`;
}

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
  const W = 320,
    H = 6;
  const pct = Math.min(Math.max(percentage, 0), 100);
  // Any non-zero usage stays visible as at least a dot.
  const filled = pct > 0 ? Math.max(H, Math.round((pct / 100) * W)) : 0;
  // The track is translucent grey rather than a fixed colour so it reads on
  // both light and dark hovers (the SVG can't see theme variables).
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" rx="${H / 2}" fill="#808080" fill-opacity="0.3"/>` +
    (filled
      ? `<rect width="${filled}" height="${H}" rx="${H / 2}" fill="${barColor(pct)}"/>`
      : "") +
    `</svg>`;
  return `<img src="data:image/svg+xml,${encodeURIComponent(svg)}" width="100%" alt="${pct}% used">`;
}

function buildHeader(plan: string): string {
  const manage =
    `<a href="https://claude.ai/settings/usage" title="Manage usage on claude.ai">` +
    `<span style="color:var(--vscode-button-secondaryForeground);background-color:var(--vscode-button-secondaryBackground);display:inline-block;border-radius:4px;">&nbsp;&nbsp;Manage&nbsp;&nbsp;</span>` +
    `</a>`;
  const settings = `<a href="${SETTINGS_URI}" title="Claude Tracker settings">${tint("var(--vscode-icon-foreground)", "$(settings)")}</a>`;
  return section([row(escapeHtml(plan), `${manage}&nbsp;&nbsp;${settings}`)]);
}

function buildLimitRows(limit: LimitSection): string[] {
  // Like Copilot's untouched "Additional Budget", a limit with nothing used
  // is greyed out.
  const idle = limit.percentage === 0;
  const tone = (html: string) => (idle ? dim(html) : html);
  return [
    row(
      tone(`<strong>${escapeHtml(limit.label)}</strong>`),
      limit.subLabel ? dim(escapeHtml(limit.subLabel)) : "",
    ),
    fullRow(
      `<h2>${tone(`${limit.percentage}%`)} <small>${dim("used")}</small></h2>`,
    ),
    fullRow(buildBar(limit.percentage)),
  ];
}

function buildServiceStatusRow({
  indicator,
  description,
}: ServiceStatus): string {
  const icon =
    indicator === "none"
      ? "$(check)"
      : indicator === "maintenance"
        ? "$(tools)"
        : indicator === "minor"
          ? tint(WARNING_COLOR, "$(warning)")
          : indicator === "unknown"
            ? "$(question)"
            : tint(ERROR_COLOR, "$(error)");
  return row(
    "Service status",
    `<a href="https://status.claude.com" title="Open status.claude.com">${dim(`${icon} ${escapeHtml(description)}`)}</a>`,
  );
}

export function buildTooltip(data: ClaudeUsageData): vscode.MarkdownString {
  const config = vscode.workspace.getConfiguration("claudeTracker");
  const sections = [buildHeader(data.plan)];

  if (data.error) {
    sections.push(
      section([
        fullRow(`${tint(WARNING_COLOR, "$(warning)")} ${escapeHtml(data.error)}`),
      ]),
    );
  } else {
    const limits = [data.sessionLimit, data.weeklyLimit, data.extraUsage].filter(
      (l): l is LimitSection => l !== undefined,
    );
    if (limits.length) {
      sections.push(
        section(
          limits.flatMap((l, i) => [
            ...(i ? [spacer(6)] : []),
            ...buildLimitRows(l),
          ]),
        ),
      );
    }
  }

  const settingRows: string[] = [];
  if (data.modelInfo) {
    const effort =
      data.modelInfo.effortLevel.charAt(0).toUpperCase() +
      data.modelInfo.effortLevel.slice(1);
    settingRows.push(row("Effort", dim(escapeHtml(effort))));
  }
  const notificationsEnabled = config.get<boolean>("notifications", false);
  settingRows.push(
    row(
      "Notifications",
      dim(notificationsEnabled ? "$(bell) On" : "$(bell-slash) Off"),
    ),
  );
  sections.push(section(settingRows));

  if (
    data.serviceStatus !== undefined &&
    config.get<boolean>("showServiceStatus", true)
  ) {
    sections.push(section([buildServiceStatusRow(data.serviceStatus)]));
  }

  const links =
    `<a href="command:claude-tracker.showSkills" title="View installed skills">$(tools) Skills</a>` +
    `&nbsp;&nbsp;&nbsp;` +
    `<a href="command:claude-tracker.showMcp" title="View MCP servers">$(server) MCP Servers</a>`;
  sections.push(
    section(
      [
        row(
          links,
          data.error ? "" : dim(`Updated ${escapeHtml(data.lastUpdated)}`),
        ),
      ],
      true,
    ),
  );

  // Blank lines end each HTML block so marked sees the `---` as a rule.
  const md = new vscode.MarkdownString(sections.join("\n\n---\n\n"), true);
  md.isTrusted = true;
  md.supportHtml = true;
  return md;
}
