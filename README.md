# Claude Tracker

A VS Code extension that tracks your Claude AI usage at a glance. See your session and weekly limits, reset countdowns, extra usage, effort level, installed skills, and MCP servers — all from the status bar.

## Features

### Status Bar

A persistent **$(clawd-icon)** indicator in the bottom status bar. Hover to see a rich tooltip with:

- Your plan name (e.g. "Claude Pro Usage")
- Session and weekly limit percentages with color-coded progress bars
- Reset countdowns (minutes, hours, or days depending on time remaining)
- Extra usage consumption (if enabled on your account)
- Current effort level (read from Claude Code settings)
- Links to **Manage usage**, **Installed Skills**, and **MCP Servers**

Progress bars change color based on usage: blue under 75%, yellow at 75-89%, red at 90%+.

Clicking the status bar item opens the [Claude usage page](https://claude.ai/settings/usage) in your browser.

The extension auto-refreshes every 5 minutes and watches Claude Code settings files (`~/.claude/settings.json`, etc.) for instant effort level updates.

### Skills Dashboard

View all your installed Claude Code skills in one place. Discovers:

- **Local skills** from `~/.claude/skills/` (parses `SKILL.md` frontmatter)
- **Marketplace skills** from `~/.claude/plugins/known_marketplaces.json`

Open via the tooltip link or `Claude Tracker: Show Installed Skills` in the Command Palette.

### MCP Dashboard

View, toggle, and delete MCP servers across all scopes:

- **User** — `~/.claude.json` top-level `mcpServers`
- **Local** — `~/.claude.json` project-scoped `mcpServers`
- **Project** — `.mcp.json` at workspace root

Each server shows its command, scope badge, enable/disable toggle, and delete button.

Open via the tooltip link or `Claude Tracker: Show MCP Servers` in the Command Palette.

### Authentication

No manual configuration needed. The extension reads OAuth credentials from `~/.claude/.credentials.json`, written by the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). Just have Claude Code installed and logged in.

### Rate Limiting

If the API returns a 429 (rate limit), the extension keeps your last usage data visible and blocks refresh for 10 minutes.

## Installation (from source)

**Requirements:** Node.js 18+, VS Code 1.80+

```bash
cd Claude-Tracker
npm install
npm run compile
```

Open the folder in VS Code and press **F5** to launch an Extension Development Host.

To package:

```bash
npx vsce package
```

## Configuration

| Setting                       | Type      | Default        | Description                           |
| ----------------------------- | --------- | -------------- | ------------------------------------- |
| `claudeTracker.plan`          | `string`  | `"Claude Pro"` | Plan name shown in the tooltip header |
| `claudeTracker.showStatusBar` | `boolean` | `true`         | Show or hide the status bar item      |

## Commands

Access via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command                                  | Description                                    |
| ---------------------------------------- | ---------------------------------------------- |
| `Claude Tracker: Open Claude Usage Page` | Opens claude.ai/settings/usage in your browser |
| `Claude Tracker: Show Installed Skills`  | Opens the skills dashboard webview             |
| `Claude Tracker: Show MCP Servers`       | Opens the MCP servers dashboard webview        |

## Development

```bash
npm run watch      # watch mode — auto-recompiles on save
npm run compile    # single compile
npm run lint       # ESLint on src/
npm run gen-icons  # regenerate icon font (fantasticon)
```

| File                    | Role                                                            |
| ----------------------- | --------------------------------------------------------------- |
| `src/extension.ts`      | Entry point, command registration, refresh timer, file watchers |
| `src/usageProvider.ts`  | Reads Claude CLI credentials, fetches and parses the usage API  |
| `src/statusBar.ts`      | Status bar item management (clawd icon)                         |
| `src/tooltipBuilder.ts` | Builds the MarkdownString tooltip with progress bars            |
| `src/skillsProvider.ts` | Discovers skills, renders the skills dashboard webview          |
| `src/mcpProvider.ts`    | Discovers/toggles/deletes MCP servers, renders MCP dashboard    |
| `src/types.ts`          | `LimitSection`, `ModelInfo`, and `ClaudeUsageData` interfaces   |

## Requirements

- VS Code `^1.80.0`
- Node.js `18+` (build only)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and logged in
