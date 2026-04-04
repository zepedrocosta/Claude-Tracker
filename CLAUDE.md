# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run compile      # compile TypeScript → out/
npm run watch        # watch mode (incremental compile)
npm run lint         # ESLint on src/
npm run gen-icons    # regenerate icon font (fantasticon)
```

To run the extension: open the folder in VS Code and press **F5** (launches an Extension Development Host). There is no test suite.

To package for distribution:

```bash
npx vsce package     # produces claude-tracker-<version>.vsix
```

The `vscode:prepublish` script runs `gen-icons` then `compile` automatically.

## Architecture

This is a VS Code extension. The compiled entry point is `out/extension.js` (from `src/extension.ts`). It activates on `onStartupFinished`.

### Source files

| File                    | Purpose                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/extension.ts`      | Activation, command registration, refresh timer, settings file watchers, usage notifications, log output channel |
| `src/usageProvider.ts`  | Reads credentials, calls the usage API, parses response                                                          |
| `src/usageDashboard.ts` | Builds the usage dashboard webview HTML (injects usage data, MCP counts, icon URIs)                              |
| `src/statusBar.ts`      | `StatusBarManager` — manages the status bar item (clawd icon)                                                    |
| `src/tooltipBuilder.ts` | Builds the `MarkdownString` tooltip with usage bars, model info, and action links                                |
| `src/skillsProvider.ts` | Discovers local + marketplace skills, renders the skills dashboard webview                                       |
| `src/mcpProvider.ts`    | Discovers, toggles, and deletes MCP servers; renders the MCP dashboard webview                                   |
| `src/types.ts`          | Shared types (`LimitSection`, `ModelInfo`, `ClaudeUsageData`)                                                    |

### Data flow

```text
UsageProvider.getUsageData()   →   ClaudeUsageData
        ↓                                ↓
  StatusBarManager.update()      buildTooltip()
```

`getUsageData()` is **async**. It reads Claude Code CLI credentials from `~/.claude/.credentials.json` (or `credentials.json`):

- **Credentials found**: uses the OAuth access token (`Bearer` auth) to call `GET /api/oauth/usage` on `api.anthropic.com` with the `anthropic-beta: oauth-2025-04-20` header.
- **No credentials**: returns an error prompting the user to install/log in to Claude Code CLI.
- **Expired credentials**: returns an error prompting to refresh the CLI session.

`getUsageData()` also reads `ModelInfo` (effort level) from Claude Code settings files (`~/.claude/settings.json`, `~/.claude/settings.local.json`, and workspace-local equivalents).

Before hitting the network, `getUsageData()` consults a shared state file (`~/.claude/tracker-cache.json`) to coordinate across multiple VS Code instances:

1. **Rate-limited** (`rateLimitedUntil > now`): skip the fetch, return cached data with an error message showing the remaining backoff time.
2. **Cache fresh** (`lastFetchAt` < cache max-age and `cachedApiData` present): return cached data without a network call. Max-age is 5 minutes for automatic refreshes, 1 minute when triggered manually from the dashboard (`forceRefresh = true`).
3. **Stale/empty**: fetch from the API, write the result to the shared cache.
4. **429 response**: set `rateLimitedUntil = now + 10 min` in the shared cache, blocking all instances.

### Shared state (`~/.claude/tracker-cache.json`)

> Cross-instance coordination file. Persists the last successful API response, the timestamp of the last fetch, and the rate-limit expiry time. All open VS Code windows read and write this file so that only one instance fetches per 5-minute interval and a 429 backoff is respected globally.

Written and read by `UsageProvider`. Structure:

```json
{
  "rateLimitedUntil": 0,
  "lastFetchAt": 1234567890,
  "cachedApiData": { ... }
}
```

- `rateLimitedUntil` — epoch ms when the 429 backoff expires (0 = not rate-limited)
- `lastFetchAt` — epoch ms of the last successful API fetch
- `cachedApiData` — the last parsed `Partial<ClaudeUsageData>` returned by `parseUsageResponse`

Writes are best-effort (`writeSharedState` silently ignores file errors).

### Registered commands

| Command ID                           | Description                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `claude-tracker.openConsole`         | Opens the claude.ai usage page in a browser                                    |
| `claude-tracker.showDashboard`       | Opens the usage dashboard webview panel                                        |
| `claude-tracker.showSkills`          | Opens a webview panel listing installed Claude Code skills                     |
| `claude-tracker.showMcp`             | Opens a webview panel listing MCP servers with toggle/delete controls          |
| `claude-tracker.toggleNotifications` | Toggles `claudeTracker.notifications` globally and clears `notifiedThresholds` |

### Status bar

The status bar item uses a custom `$(clawd-icon)` from the `clawd-icons` icon font (generated by fantasticon from SVGs in `media/icons/`). Clicking it opens the **Usage Dashboard** webview (`claude-tracker.showDashboard`). Hovering shows a rich tooltip (built in `tooltipBuilder.ts`) with usage bars, service status, effort level, notification state (bell icon), and links to skills/MCP dashboards.

The extension watches Claude Code settings files (`~/.claude/settings.json`, etc.) via `fs.watch` to instantly refresh when model/effort settings change. It also auto-refreshes on a 5-minute interval.

### Skills dashboard (`skillsProvider.ts`)

Discovers skills by walking `~/.claude/skills/` for `SKILL.md` files and parsing their YAML frontmatter (`name`, `description`). Also discovers marketplace skills from `~/.claude/plugins/known_marketplaces.json`. Renders into the `media/skillsDashboard.html` template.

Handles one webview message:

- `openSkillsFolder` — opens `~/.claude/skills/` in the native file manager (creates the directory if absent). Uses `wslpath -w` + `explorer.exe` on WSL, `open` on macOS, `xdg-open` on Linux, `explorer.exe` directly on Windows.

### MCP dashboard (`mcpProvider.ts`)

Discovers MCP servers from three scopes with layered precedence:

1. **User** — `~/.claude.json` top-level `mcpServers`
2. **Local** — `~/.claude.json` → `projects[workspacePath].mcpServers`
3. **Project** — `.mcp.json` at workspace root

Supports toggling (enable/disable) and deleting servers. Project-scope toggle state is stored in `~/.claude.json` via `enabledMcpjsonServers`/`disabledMcpjsonServers` lists. Renders into `media/mcpDashboard.html`.

Handles these webview messages:

- `openSettingsFile` — opens `~/.claude.json` in the VS Code text editor.
- `toggleServer` — calls `toggleMcpServer(name, disabled, scope, workspaceRoot)` then re-renders the panel.
- `deleteServer` — calls `deleteMcpServer(name, scope, workspaceRoot)` then re-renders and shows an info notification.

### Key types (`src/types.ts`)

- `LimitSection` — has `label`, `subLabel` (reset time string), `percentage`.
- `ModelInfo` — has `effortLevel`.
- `ServiceStatus` — has `indicator` (`"none"` | `"minor"` | `"major"` | `"critical"` | `"maintenance"` | `"unknown"`) and `description`.
- `ClaudeUsageData` — has `plan`, optional `sessionLimit`/`weeklyLimit`/`extraUsage` (all `LimitSection`), optional `modelInfo`, optional `serviceStatus`, `lastUpdated`, and optional `error`.

### Service status (`UsageProvider.fetchServiceStatus`)

Fetches `GET https://status.claude.com/api/v2/status.json` in parallel with the usage API call. Returns a `ServiceStatus` with `indicator` and `description`. When the indicator is not `"none"`, a VS Code warning notification is shown (respects `claudeTracker.showServiceStatus`). The result is always written to `ClaudeUsageData.serviceStatus` and rendered in the tooltip with an icon:

| Indicator            | Icon          |
| -------------------- | ------------- |
| `none`               | `$(check)`    |
| `maintenance`        | `$(tools)`    |
| `minor`              | `$(warning)`  |
| `unknown`            | `$(question)` |
| `major` / `critical` | `$(error)`    |

If the fetch fails, `indicator` is `"unknown"` and `description` is `"Status unavailable"`.

### Usage notifications (`extension.ts` — `checkNotifications`)

Called after every successful `getUsageData()`. Reads `claudeTracker.notifications` and `claudeTracker.notificationThresholds`. For each `LimitSection` (session, weekly, extra), iterates thresholds from highest to lowest and fires a notification the first time a threshold is crossed — info notification for lower thresholds, **warning** for the highest threshold. Each `"<label>:<threshold>"` key is stored in a module-level `notifiedThresholds` `Set` to prevent duplicate alerts within the same VS Code session. The set is cleared when `claude-tracker.toggleNotifications` is invoked.

### API response parsing (`UsageProvider.parseUsageResponse`)

The usage API response is parsed by looking for `five_hour`/`session` and `seven_day`/`weekly` bucket keys. Each bucket is checked for utilization percentage (`utilization`, `used_percent`, etc.) and reset time (`reset_at`, `resets_at`, etc.). Percentage values that are fractions (0–1) are normalized to integers (0–100). An `extra_usage` bucket is included when enabled.

### Webview security

Dashboard HTML templates use a fresh random `nonce` for CSP on each render. No external resources are loaded.

### Usage dashboard (`usageDashboard.ts`)

Builds the usage dashboard webview. On every render it calls `discoverMcpServers()` to compute live MCP counts (total and enabled) and injects them as template variables alongside the `ClaudeUsageData`. The HTML template (`media/usageDashboard.html`) receives usage data as `INITIAL_DATA` JSON and subsequent updates via `postMessage({ command: 'update', data })`.

The dashboard's **Refresh** button posts `{ command: 'refresh' }` to the extension, which in turn calls `getUsageData(true)` (1-minute cache). The extension replies with `{ command: 'refreshStarted' }` before fetching so the webview can start a 60-second animated progress bar and disable the button for the full cooldown period.

### Media assets

- `media/fonts/clawd-icons.woff2` — custom icon font (generated by fantasticon)
- `media/icons/` — SVG source icons (clawd, server, tools)
- `media/clawd.svg` — panel icon for webview tabs
- `media/usageDashboard.html` — usage dashboard template
- `media/skillsDashboard.html`, `media/mcpDashboard.html` — HTML templates

## Authentication

The extension reads OAuth credentials from `~/.claude/.credentials.json` (written by Claude Code CLI). It uses the `claudeAiOauth.accessToken` as a Bearer token to call the Anthropic usage API. No manual API key or session key configuration is needed — just have Claude Code installed and logged in.

## Settings namespace

All settings live under `claudeTracker.*`:

- `claudeTracker.plan` — display name (e.g. "Claude Pro", "Claude Max")
- `claudeTracker.showStatusBar` — show/hide the status bar item
- `claudeTracker.notifications` — enable/disable usage threshold notifications (default `true`)
- `claudeTracker.notificationThresholds` — `number[]` of percentages (1–100) at which to notify (default `[75, 90]`)
- `claudeTracker.showServiceStatus` — show/hide the service status row in the tooltip and suppress status-change notifications (default `true`)
