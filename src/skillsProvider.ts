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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <title>Installed Skills</title>
  <style nonce="${nonce}">
    :root {
      --bg: #1e1e2e;
      --surface: #262637;
      --surface-hover: #2e2e42;
      --border: #383850;
      --text: #cdd6f4;
      --text-dim: #9399b2;
      --accent: #cc785c;
      --accent-dim: rgba(204, 120, 92, 0.15);
      --header-bg: #1a1a2a;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 32px;
      line-height: 1.6;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 28px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .logo {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: var(--accent-dim);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
    }

    h1 {
      font-size: 22px;
      font-weight: 600;
      letter-spacing: -0.3px;
    }

    .badge {
      background: var(--accent-dim);
      color: var(--accent);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
    }

    .search-box {
      position: relative;
      margin-bottom: 20px;
    }

    .search-box input {
      width: 100%;
      padding: 10px 16px 10px 40px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }

    .search-box input:focus {
      border-color: var(--accent);
    }

    .search-box input::placeholder {
      color: var(--text-dim);
    }

    .search-icon {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-dim);
      font-size: 14px;
      pointer-events: none;
    }

    .table-wrap {
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead th {
      background: var(--header-bg);
      padding: 12px 20px;
      text-align: left;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--text-dim);
      border-bottom: 1px solid var(--border);
    }

    tbody tr {
      border-bottom: 1px solid var(--border);
      transition: background 0.15s;
    }

    tbody tr:last-child {
      border-bottom: none;
    }

    tbody tr:hover {
      background: var(--surface-hover);
    }

    td {
      padding: 14px 20px;
      font-size: 13.5px;
    }

    .name-cell {
      white-space: nowrap;
      font-weight: 500;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .skill-icon {
      color: var(--accent);
      font-size: 10px;
    }

    .desc-cell {
      color: var(--text-dim);
      max-width: 600px;
    }

    .empty {
      text-align: center;
      padding: 48px 20px;
      color: var(--text-dim);
      font-style: italic;
    }

    .footer {
      margin-top: 20px;
      text-align: center;
      font-size: 12px;
      color: var(--text-dim);
    }

    .no-results {
      display: none;
      text-align: center;
      padding: 48px 20px;
      color: var(--text-dim);
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <div class="logo">&#9830;</div>
      <h1>Installed Skills</h1>
    </div>
    <span class="badge">${skills.length} skill${skills.length !== 1 ? "s" : ""}</span>
  </div>

  <div class="search-box">
    <span class="search-icon">&#128269;</span>
    <input type="text" id="search" placeholder="Filter skills..." />
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th style="width: 220px;">Name</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody id="skills-body">
        ${rows}
      </tbody>
    </table>
  </div>
  <div class="no-results" id="no-results">No skills match your filter.</div>

  <div class="footer">Claude Tracker &middot; Skills discovered from ~/.claude/</div>

  <script nonce="${nonce}">
    const input = document.getElementById('search');
    const tbody = document.getElementById('skills-body');
    const noResults = document.getElementById('no-results');

    input.addEventListener('input', () => {
      const q = input.value.toLowerCase();
      const rows = tbody.querySelectorAll('tr');
      let visible = 0;
      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        const show = text.includes(q);
        row.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      noResults.style.display = visible === 0 ? 'block' : 'none';
    });
  </script>
</body>
</html>`;
}
