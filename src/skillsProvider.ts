import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

export interface SkillInfo {
  name: string;
  description: string;
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildSkillsDashboardHtml(skills: SkillInfo[]): string {
  const nonce = crypto.randomBytes(16).toString("hex");

  const rows = skills.length > 0
    ? skills.map((s, i) => `
        <tr style="animation: fadeIn 0.3s ease ${i * 0.04}s both;">
          <td class="name-cell">
            <span class="skill-icon">&#9671;</span>
            ${escapeHtml(s.name)}
          </td>
          <td class="desc-cell">${escapeHtml(s.description)}</td>
        </tr>`).join("")
    : `<tr><td colspan="2" class="empty">No skills found in ~/.claude/</td></tr>`;

  const skillsBadge = `${skills.length} skill${skills.length !== 1 ? "s" : ""}`;
  const templatePath = path.join(__dirname, "..", "media", "skillsDashboard.html");
  return fs
    .readFileSync(templatePath, "utf-8")
    .replace(/\{\{NONCE\}\}/g, nonce)
    .replace(/\{\{ROWS\}\}/g, rows)
    .replace(/\{\{SKILLS_BADGE\}\}/g, skillsBadge);
}
