import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

export interface SkillInfo {
  name: string;
  description: string;
}

export interface MarketplaceSkillGroup {
  marketplace: string;
  repo: string;
  skills: SkillInfo[];
}

function findSkillFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) {
    return results;
  }
  const walk = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        results.push(full);
      }
    }
  };
  walk(dir);
  return results;
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }
  const block = match[1];
  const nameMatch = block.match(/^name:\s*(.+)$/m);
  const descMatch = block.match(/^description:\s*(.+)$/m);
  return {
    name: nameMatch ? nameMatch[1].trim() : undefined,
    description: descMatch ? descMatch[1].trim() : undefined,
  };
}

export function discoverSkills(): SkillInfo[] {
  const claudeDir = path.join(os.homedir(), ".claude");
  const skillFiles = findSkillFiles(path.join(claudeDir, "skills"));

  const skills: SkillInfo[] = [];
  const seen = new Set<string>();

  for (const file of skillFiles) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const meta = parseFrontmatter(content);
      if (meta.name && !seen.has(meta.name)) {
        seen.add(meta.name);
        skills.push({
          name: meta.name,
          description: meta.description ?? "",
        });
      }
    } catch {
      // skip unreadable files
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

export function discoverMarketplaceSkills(): MarketplaceSkillGroup[] {
  const knownPath = path.join(os.homedir(), ".claude", "plugins", "known_marketplaces.json");
  if (!fs.existsSync(knownPath)) {
    return [];
  }

  let marketplaces: Record<string, { source?: { repo?: string }; installLocation?: string }>;
  try {
    marketplaces = JSON.parse(fs.readFileSync(knownPath, "utf-8"));
  } catch {
    return [];
  }

  const groups: MarketplaceSkillGroup[] = [];

  for (const [name, info] of Object.entries(marketplaces)) {
    const installDir = info.installLocation;
    if (!installDir || !fs.existsSync(installDir)) {
      continue;
    }

    const skillFiles = findSkillFiles(path.join(installDir, "skills"));
    const skills: SkillInfo[] = [];
    const seen = new Set<string>();

    for (const file of skillFiles) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        const meta = parseFrontmatter(content);
        if (meta.name && !seen.has(meta.name)) {
          seen.add(meta.name);
          skills.push({
            name: meta.name,
            description: meta.description ?? "",
          });
        }
      } catch {
        // skip unreadable files
      }
    }

    skills.sort((a, b) => a.name.localeCompare(b.name));
    groups.push({
      marketplace: name,
      repo: info.source?.repo ?? "",
      skills,
    });
  }

  groups.sort((a, b) => a.marketplace.localeCompare(b.marketplace));
  return groups;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSkillsDashboardHtml(
  skills: SkillInfo[],
  marketplaceGroups: MarketplaceSkillGroup[],
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const nonce = crypto.randomBytes(16).toString("hex");

  // Local skills rows
  const localRows = skills.length > 0
    ? skills.map((s, i) => `
        <tr style="animation: fadeIn 0.3s ease ${i * 0.04}s both;">
          <td class="name-cell">
            <span class="skill-icon">&#9671;</span>
            ${escapeHtml(s.name)}
          </td>
          <td class="desc-cell">${escapeHtml(s.description)}</td>
        </tr>`).join("")
    : "";

  // Marketplace group rows
  const marketplaceRows = marketplaceGroups.map((group) => {
    const groupId = `mp-${group.marketplace.replace(/[^a-zA-Z0-9-]/g, "_")}`;
    const skillCount = `${group.skills.length} skill${group.skills.length !== 1 ? "s" : ""}`;
    const repoLabel = group.repo ? ` &middot; ${escapeHtml(group.repo)}` : "";

    const folderRow = `
        <tr class="marketplace-folder" data-group="${groupId}" style="cursor: pointer;">
          <td class="name-cell">
            <span class="folder-chevron" id="chevron-${groupId}">&#9654;</span>
            <span class="folder-icon">&#128230;</span>
            ${escapeHtml(group.marketplace)}
          </td>
          <td class="desc-cell">
            <span class="mp-badge">${skillCount}</span>${repoLabel}
          </td>
        </tr>`;

    const childRows = group.skills.map((s, i) => `
        <tr class="marketplace-skill ${groupId}" style="display: none; animation: fadeIn 0.2s ease ${i * 0.02}s both;">
          <td class="name-cell mp-indent">
            <span class="skill-icon">&#9671;</span>
            ${escapeHtml(s.name)}
          </td>
          <td class="desc-cell">${escapeHtml(s.description)}</td>
        </tr>`).join("");

    return folderRow + childRows;
  }).join("");

  const allRows = (localRows + marketplaceRows) ||
    `<tr><td colspan="2" class="empty">No skills found in ~/.claude/</td></tr>`;

  const totalSkills = skills.length + marketplaceGroups.reduce((sum, g) => sum + g.skills.length, 0);
  const skillsBadge = `${totalSkills} skill${totalSkills !== 1 ? "s" : ""}`;
  const toolsIconUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "icons", "tools.svg"),
  );
  const templatePath = path.join(__dirname, "..", "media", "skillsDashboard.html");
  return fs
    .readFileSync(templatePath, "utf-8")
    .replace(/\{\{NONCE\}\}/g, nonce)
    .replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource)
    .replace(/\{\{TOOLS_ICON\}\}/g, toolsIconUri.toString())
    .replace(/\{\{ROWS\}\}/g, allRows)
    .replace(/\{\{SKILLS_BADGE\}\}/g, skillsBadge);
}
