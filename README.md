# Claude Tracker

A VS Code extension that tracks your Claude AI usage at a glance. See your session and weekly limits, reset countdowns, extra usage, effort level, installed skills, and MCP servers — all from the status bar.

## Features

### Status Bar

A persistent crab style (Claude Code mascot) indicator in the bottom status bar. Hover to see a rich tooltip with:

- Your plan name (e.g. "Claude Pro Usage")
- Session and weekly limit percentages with color-coded progress bars
- Reset countdowns (minutes, hours, or days depending on time remaining)
- Extra usage consumption (if enabled on your account)
- Claude service status with a link to [status.claude.com](https://status.claude.com) — a warning notification fires (once per indicator change) when the status is non-nominal, with a **View Status Page** action button
- Current effort level (read from Claude Code settings)
- Notification indicator (bell on/off)
- Links to **Manage usage**, **Installed Skills**, and **MCP Servers**

Progress bars change color based on usage: green under 75%, yellow at 75–89%, red at 90%+.

Clicking the status bar item opens the **Usage Dashboard** webview.

The extension auto-refreshes every 5 minutes and watches Claude Code settings files (`~/.claude/settings.json`, etc.) for instant effort level updates. Multiple VS Code windows are synchronized — only one instance fetches from the API per interval; the rest share the cached result.

### Usage Dashboard

A full webview panel with richer usage detail. Open via `Claude Tracker: Show Usage Dashboard` in the Command Palette or from the tooltip link.

Displays:

- Session and weekly usage cards with percentage and color-coded progress bars
- Extra usage card (when enabled on your account)
- MCP server summary cards: **In Config** (out of 30) and **Enabled** (out of 10) with color-coded bars
- Claude service status, current effort level, and last-updated time
- Navigation buttons to the Skills and MCP dashboards

**Refresh button** — manually re-fetches with a 1-minute cache (instead of the 5-minute auto-refresh interval). The button is disabled for 60 seconds after clicking, with an animated progress bar showing the cooldown.

### Skills Dashboard

View all your installed Claude Code skills in one place. Discovers:

- **Local skills** from `~/.claude/skills/` (parses `SKILL.md` frontmatter)
- **Marketplace skills** from `~/.claude/plugins/known_marketplaces.json`

An **Open Skills Folder** button opens `~/.claude/skills/` in your native file manager (Finder on macOS, Explorer on Windows/WSL, `xdg-open` on Linux), creating the directory if it doesn't exist.

Open via the tooltip link or `Claude Tracker: Show Installed Skills` in the Command Palette.

### MCP Dashboard

View, toggle, and delete MCP servers across all scopes:

- **User** — `~/.claude.json` top-level `mcpServers`
- **Local** — `~/.claude.json` project-scoped `mcpServers`
- **Project** — `.mcp.json` at workspace root

Each server shows its command, scope badge, enable/disable toggle, and delete button. An **Open Settings File** button opens `~/.claude.json` in the VS Code text editor.

Open via the tooltip link or `Claude Tracker: Show MCP Servers` in the Command Palette.

### Authentication

No manual configuration needed. The extension reads OAuth credentials from `~/.claude/.credentials.json` (or `~/.claude/credentials.json`), written by the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). On macOS it also falls back to the system Keychain (`security find-generic-password -s "Claude Code-credentials"`) if the credential file isn't found. Just have Claude Code installed and logged in.

### Multi-instance synchronization

All open VS Code windows share a single cache file at `~/.claude/tracker-cache.json`. When the 5-minute timer fires, whichever instance checks first fetches the data and writes it to the cache; all others reuse that cached result without making additional API calls.

### Rate Limiting

If the API returns a 429 (rate limit), the backoff state is written to the shared cache file so **all** open instances stop fetching for 10 minutes. Your last usage data remains visible during the backoff period.

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

| Setting                                | Type       | Default        | Description                                                                |
| -------------------------------------- | ---------- | -------------- | -------------------------------------------------------------------------- |
| `claudeTracker.plan`                   | `string`   | `"Claude Pro"` | Plan name shown in the tooltip header                                      |
| `claudeTracker.showStatusBar`          | `boolean`  | `true`         | Show or hide the status bar item                                           |
| `claudeTracker.notifications`          | `boolean`  | `true`         | Show VS Code notifications when usage reaches the configured thresholds    |
| `claudeTracker.notificationThresholds` | `number[]` | `[75, 90]`     | Usage percentages (1–100) at which to fire notifications                   |
| `claudeTracker.showServiceStatus`      | `boolean`  | `true`         | Show Claude service status in the tooltip (fetched from status.claude.com) |

### Usage notifications

When `claudeTracker.notifications` is enabled, an info notification fires at the lower threshold and a **warning** notification fires at the highest threshold. Each threshold for each limit (session, weekly, extra) fires at most once per VS Code session. Thresholds reset when you toggle notifications off and back on.

## Commands

Access via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command                                       | Description                                                         |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `Claude Tracker: Open Claude Usage Page`      | Opens claude.ai/settings/usage in your browser                      |
| `Claude Tracker: Show Usage Dashboard`        | Opens the usage dashboard webview                                   |
| `Claude Tracker: Show Installed Skills`       | Opens the skills dashboard webview                                  |
| `Claude Tracker: Show MCP Servers`            | Opens the MCP servers dashboard webview                             |
| `Claude Tracker: Toggle Usage Notifications`  | Toggles usage notifications on/off and clears the notified state    |

## Development

```bash
npm run watch      # watch mode — auto-recompiles on save
npm run compile    # single compile
npm run lint       # ESLint on src/
npm run gen-icons  # regenerate icon font (fantasticon)
```

| File                      | Role                                                            |
| ------------------------- | --------------------------------------------------------------- |
| `src/extension.ts`        | Entry point, command registration, refresh timer, file watchers |
| `src/usageProvider.ts`    | Reads Claude CLI credentials, fetches and parses the usage API  |
| `src/usageDashboard.ts`   | Builds the usage dashboard webview HTML                         |
| `src/statusBar.ts`        | Status bar item management (Claude mascot icon)                 |
| `src/tooltipBuilder.ts`   | Builds the MarkdownString tooltip with progress bars            |
| `src/skillsProvider.ts`   | Discovers skills, renders the skills dashboard webview          |
| `src/mcpProvider.ts`      | Discovers/toggles/deletes MCP servers, renders MCP dashboard    |
| `src/types.ts`            | `LimitSection`, `ModelInfo`, and `ClaudeUsageData` interfaces   |

## Requirements

- VS Code `^1.80.0`
- Node.js `18+` (build only)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and logged in
