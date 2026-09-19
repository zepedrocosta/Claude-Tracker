# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install          # install dependencies
pnpm run compile      # compile TypeScript → out/
pnpm run watch        # watch mode (incremental compile)
pnpm run lint         # ESLint on src/
pnpm run gen-icons    # regenerate icon font (fantasticon)
```

To run the extension: open the folder in VS Code and press **F5** (launches an Extension Development Host). There is no test suite.

To package for distribution:

```bash
pnpm dlx vsce package # produces claude-tracker-<version>.vsix
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
| `src/mcpProvider.ts`    | Discovers, toggles, deletes and annotates MCP servers; renders the MCP dashboard webview                         |
| `src/types.ts`          | Shared types (`LimitSection`, `ModelInfo`, `ClaudeUsageData`)                                                    |
| `src/log.ts`            | Owns the "Claude Tracker" log channel; exports `logInfo`/`logWarn`/`logError`/`errText`                          |

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
  "cachedApiData": { ... },
  "mcpServerMeta": { "<server>": { "description": "...", "url": "..." } }
}
```

- `rateLimitedUntil` — epoch ms when the 429 backoff expires (0 = not rate-limited)
- `lastFetchAt` — epoch ms of the last successful API fetch
- `cachedApiData` — the last parsed `Partial<ClaudeUsageData>` returned by `parseUsageResponse`
- `mcpServerMeta` — per-server descriptions/links written by `mcpProvider` (see the MCP dashboard section)

Writes are best-effort (`writeSharedState` silently ignores file errors).

Two modules write this file, so both writers merge instead of overwriting:

- `writeSharedState` re-reads the file immediately before writing and merges its payload over the on-disk contents — callers pass a snapshot taken *before* a network round-trip, so a blind write would drop concurrent changes. `mcpServerMeta` is always taken from disk, never from the caller's snapshot.
- `updateTrackerCache` (in `mcpProvider`) does the same in the other direction, touching only the `mcpServerMeta` key.

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

### Tooltip layout (`tooltipBuilder.ts`)

The hover is styled after GitHub Copilot's status-bar hover. Sections are separated by full-width `---` rules:

1. **Header** — plan name on the left; a secondary-button-styled **Manage** link (claude.ai usage page) and a `$(settings)` link that opens the extension's settings (`@ext:josecosta.claude-tracker`) on the right.
2. **Usage** (or the error message) — per limit: bold label with the dimmed reset time right-aligned, a large `<h2>` "`N% used`", then a full-width SVG bar. A limit at 0% is greyed out, like Copilot's unused "Additional Budget".
3. **Settings** — `Effort` and `Notifications` (`$(bell) On` / `$(bell-slash) Off`), both as dimmed, read-only values. Notifications are toggled from the command palette or settings, not from the hover.
4. **Service status** — status icon + description, linking to status.claude.com (hidden when `showServiceStatus` is off).
5. **Footer** — Skills / MCP Servers links, with the dimmed "Updated HH:MM" on the right.

VS Code sanitizes hover HTML heavily, which dictates how this is built:

- Inline `style` survives **only on `<span>`**, and only `color`, `background-color`, `display:inline-block` and `border-radius`, **in that order, with no spaces** (colours must be `#hex` or `var(--vscode-…)`). `class` is kept only for `codicon codicon-*`. Anything else is silently dropped.
- So layout uses `<table width="100%">` with `align="right"` cells, vertical spacing uses empty `<td height="N">` rows, and the big percentage is an `<h2>` (the only way to get a larger font).
- Each section is one single-line HTML block, joined with `\n\n---\n\n`. The blank lines end the HTML block so marked parses the `---` as a rule instead of passing it through as raw text.
- The hover `<hr>` has a `-4px` bottom margin, so every section table starts with a spacer row.
- The bar SVG is a `data:` image and cannot read theme variables, so its track is translucent grey (reads on light and dark themes). The fill stays blue / yellow (≥75%) / red (≥90%).
- `$(icon)` syntax is expanded over the *whole* rendered HTML string, attributes included — never put `$(` inside a `title` or other attribute. All user-facing strings go through `escapeHtml`.

The extension watches Claude Code settings files (`~/.claude/settings.json`, etc.) via `fs.watch` to instantly refresh when model/effort settings change. It also auto-refreshes on a 5-minute interval.

### Skills dashboard (`skillsProvider.ts`)

Discovers skills by walking `~/.claude/skills/` for `SKILL.md` files and parsing their YAML frontmatter (`name`, `description`). Also discovers marketplace skills from `~/.claude/plugins/known_marketplaces.json`. Renders into the `media/skillsDashboard.html` template.

Handles these webview messages:

- `openSkillsFolder` — opens `~/.claude/skills/` in the native file manager (creates the directory if absent). Uses `wslpath -w` + `explorer.exe` on WSL, `open` on macOS, `xdg-open` on Linux, `explorer.exe` directly on Windows.
- `openAuthor` — the footer credit link (see *Dashboard footer*).

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
- `saveServerMeta` — calls `setMcpServerMeta(name, description, url)` and replies with `{ command: 'metaSaved', index, ok, description, url }`. It deliberately does **not** re-render the panel: the webview patches the edited row from the reply and closes the dialog, so a failed write can report itself inside the still-open dialog instead of silently discarding the user's typing.
- `openLink` — validates the URL with `parseExternalLink` (in `extension.ts`) and opens it with `vscode.env.openExternal`. Only `http`/`https` URLs **with a host** are accepted; anything else shows an error notification naming the rejected value.
- `openAuthor` — the footer credit link (see *Dashboard footer*).

#### Per-server notes and links

Each row has a pencil **edit button** (`.edit-btn`) in the `Actions` column, between the enable/disable toggle and the delete button. Clicking it opens a modal dialog (`#edit-overlay`) with a **Description** textarea and a **Link** field. Rows themselves are not clickable — the button is the only trigger, which keeps the command text selectable and makes the control keyboard-reachable without a `tabindex` on the row.

The dialog reuses the delete confirmation's `.confirm-overlay` / `.confirm-dialog` shell (`.edit-dialog` just widens it to 460px), so both popups share one backdrop, border and button style. Escape or a backdrop click closes either one; Enter saves from the Link box, Cmd/Ctrl+Enter from the textarea.

**Each row carries its own saved values in `data-description` and `data-url`.** The dialog is populated from the row it was opened on and written back to that row on save — so the row markup is the single source of truth in the webview, and the search box can filter on notes without any per-row form inputs existing in the DOM.

The `Server` and `Actions` cells keep their flex layout in an inner `.name-wrap` / `.actions` wrapper rather than on the `<td>` itself — a `display: flex` table cell stops honouring `vertical-align: middle`, which knocked the controls off-centre once description lines made rows taller. The `Actions` column and its header are centered. Saving writes to the `mcpServerMeta` key of `~/.claude/tracker-cache.json`, keyed by server name (so it survives regardless of scope). **Notes are never written to `~/.claude.json`** — that file is Claude Code's config and the extension only writes to it for the toggle/delete actions that genuinely change MCP configuration.

```json
{
  "mcpServerMeta": {
    "context7": { "description": "Docs lookup", "url": "https://context7.com" }
  }
}
```

- A saved description renders as a dimmed second line under the server name; a saved link renders as a small link chip next to it (click to open externally).
- The description runs to the end of the `Server` column and wraps onto further lines instead of being ellipsised. `.name-cell` is `white-space: nowrap` (so the name line never breaks), so `.server-desc` opts back in with `white-space: normal`. Its `max-width` is the `Server` column width minus the cell padding and the icon — under the table's auto layout that cap is the only thing stopping a long description from widening the column, so the two numbers have to be changed together.
- The **Link** field is split into a small `http://` / `https://` `<select>` (`.url-scheme`) and a host/path text box, so the protocol is always explicit and a link can never be saved without one. The webview's `splitLink()` splits the row's stored URL when the dialog opens and `joinLink()` puts it back together on save; values stored without a protocol default to `https`. Pasting a full URL into the text box moves its protocol into the dropdown instead of leaving `https://https://…`. **The stored value is always the joined, full URL** — the split exists only in the dialog.
- `discoverMcpServers()` overlays this metadata onto every `McpServerInfo` (`description`/`url`, empty strings when unset).
- Saving with both fields blank deletes the server's entry; emptying the map deletes the `mcpServerMeta` key entirely.
- `deleteMcpServer` also drops the server's metadata entry.
- `updateTrackerCache` does a read-modify-write, preserving the usage cache and rate-limit keys. A missing `~/.claude/` directory is created; an unparseable cache is replaced rather than treated as an error (it is regenerable state, unlike `~/.claude.json`).
- The search box filters on the description and link text too, reading them from the row's `data-description` / `data-url`.

### Key types (`src/types.ts`)

- `LimitSection` — has `label`, `subLabel` (reset time string), `percentage`.
- `ModelInfo` — has `effortLevel`.
- `ServiceStatus` — has `indicator` (`"none"` | `"minor"` | `"major"` | `"critical"` | `"maintenance"` | `"unknown"`) and `description`.
- `BreakdownRow` — has `key` (stable product id such as `claude_code`), `label`, `percentage`.
- `UsageBreakdown` — has optional `since` (ISO start of the 7-day window) and `rows` (`BreakdownRow[]`).
- `ClaudeUsageData` — has `plan`, optional `sessionLimit`/`weeklyLimit`/`extraUsage` (all `LimitSection`), optional `weeklyBreakdown` (`UsageBreakdown`), optional `modelInfo`, optional `serviceStatus`, `lastUpdated`, and optional `error`.

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

### Logging (`src/log.ts`)

One `LogOutputChannel` named **Claude Tracker**, created by `createLogChannel()` in `activate` and disposed with the extension. View it with *Output → Claude Tracker*; it honours the channel's log-level picker.

The channel lives in `log.ts` rather than `extension.ts` for one reason: `extension.ts` imports `mcpProvider` and `skillsProvider`, so those modules cannot import it back without a require cycle. They import `logInfo` / `logWarn` / `logError` / `errText` from `log.ts` instead. `UsageProvider` is different — it takes a `log` callback in its constructor, and `extension.ts` still uses `outputChannel` directly.

Calls made before `createLogChannel()` are dropped rather than throwing, so module-level code is safe.

What gets logged:

- **File I/O** — `mcpProvider.readJsonFile` logs malformed JSON at **error** level and unreadable files at **warn**, but stays silent on `ENOENT`, since a missing `.mcp.json` or tracker cache is the normal case. This is the one that matters most: a syntax error in `~/.claude.json` used to render an empty dashboard indistinguishable from "no servers configured". Failed writes to `~/.claude.json`, `.mcp.json` and the tracker cache log at error level.
- **MCP discovery** — one summary line per `discoverMcpServers()` call: total, per-scope counts, how many are disabled, how many have saved notes.
- **MCP mutations** — `toggleMcpServer` / `deleteMcpServer` log the attempt, then either the result or the specific reason for the `false` return (no workspace folder, unreadable config, name not present in that scope). `setMcpServerMeta` logs saves and clears.
- **Skills discovery** — `collectSkills()` logs a per-source summary plus a **warn** line for every `SKILL.md` it drops and why (unreadable, no `name:` in the frontmatter, duplicate name). A skill silently missing from the dashboard is otherwise unexplainable. Marketplaces skipped for a missing or uninstalled `installLocation` are logged individually.
- **Commands** — opening either dashboard, opening `~/.claude.json`, revealing the skills folder, and opening or rejecting an external link.
- **Raw API responses (debug only)** — when the extension runs in the Extension Development Host (`ExtensionMode.Development`, the same flag that shows `DEV` in the status bar), `UsageProvider` logs the status code and pretty-printed body of every call to the usage API and the status API, as `[debug] GET <url> → <status>`. `extension.ts` passes the flag as the constructor's second argument. The lines are written at info level, so they appear without changing the channel's log-level picker. Request headers are never logged, because they carry the OAuth token.

`openFolder` reports spawn failures from `open` / `xdg-open` as errors with a notification, but only *logs* `explorer.exe` results: explorer exits with code 1 even on success, so treating that as a failure would alarm every Windows and WSL user.

### Temporary notifications (`extension.ts` — `showTemporaryNotification`)

Dashboard feedback (toggle/delete/save failures, bad links) goes through `showTemporaryNotification(message, level, timeoutMs)`, which uses `vscode.window.withProgress` at `ProgressLocation.Notification` so the message auto-dismisses (30 s default) instead of sticking around like `showErrorMessage`.

`ProgressOptions.title` is **plain text** — codicon syntax (`$(error)`) is not rendered there and shows up verbatim in the notification. Severity is conveyed with an `Error:` / `Warning:` text prefix instead. Codicons only work in places that document them, such as `StatusBarItem.text` (`$(clawd-icon)` in `statusBar.ts`) and `MarkdownString` with `supportThemeIcons` (`tooltipBuilder.ts`).

### Usage notifications (`extension.ts` — `checkNotifications`)

Called after every successful `getUsageData()`. Reads `claudeTracker.notifications` and `claudeTracker.notificationThresholds`. For each `LimitSection` (session, weekly, extra), iterates thresholds from highest to lowest and fires a notification the first time a threshold is crossed — info notification for lower thresholds, **warning** for the highest threshold. Each `"<label>:<threshold>"` key is stored in a module-level `notifiedThresholds` `Set` to prevent duplicate alerts within the same VS Code session. The set is cleared when `claude-tracker.toggleNotifications` is invoked.

### API response parsing (`UsageProvider.parseUsageResponse`)

The usage API response is parsed by looking for `five_hour`/`session` and `seven_day`/`weekly` bucket keys. Each bucket is checked for utilization percentage (`utilization`, `used_percent`, etc.) and reset time (`reset_at`, `resets_at`, etc.). Percentage values that are fractions (0–1) are normalized to integers (0–100). An `extra_usage` bucket is included when enabled.

`seven_day_breakdown` (each product's share of the weekly usage) is parsed by `parseBreakdown` into `weeklyBreakdown`. It reads `window_started_at` and each row's `key` / `display_name` / `percent`, skips malformed rows, and leaves the field unset (logging why) when no row survives:

```json
"seven_day_breakdown": {
  "as_of": "2026-09-19T20:14:23Z",
  "window_started_at": "2026-09-15T11:00:00Z",
  "rows": [{ "key": "claude_code", "display_name": "Claude Code", "percent": 12 }, …]
}
```

### Webview security

Dashboard HTML templates use a fresh random `nonce` for CSP on each render. No external resources are loaded.

### Dashboard footer

Every dashboard's `.footer` ends with a `.credit` line: "Made by José Costa · github.com/zepedrocosta ↗". The link follows the usage dashboard's *Manage usage* link: `href="#"` plus a click handler that posts `{ command: 'openAuthor' }`. All three panels handle that message with `openAuthorPage()` in `extension.ts`, which opens the fixed `AUTHOR_URL`. The webview never supplies the URL.

### Usage dashboard (`usageDashboard.ts`)

Builds the usage dashboard webview. On every render it calls `discoverMcpServers()` to compute live MCP counts (total and enabled) and injects them as template variables alongside the `ClaudeUsageData`. The HTML template (`media/usageDashboard.html`) receives usage data as `INITIAL_DATA` JSON and subsequent updates via `postMessage({ command: 'update', data })`.

#### Weekly usage by product (donut chart)

A full-width card between the limit bars and the MCP cards renders `weeklyBreakdown` as an inline-SVG donut. The legend beside it lists each product with its percentage, and the header shows `Since <date>` from `since`.

- **Products are shown largest share first, and products at 0% are left out entirely.** `renderBreakdown` filters and sorts the rows once, so the legend and the slices share the same order. The slices run clockwise from 12 o'clock. The card is `hidden` when no product is above 0%, or when there is no breakdown (for example while the shared cache still holds a response from before the field existed).
- **Each slice is a `<circle>` with `stroke-dasharray`**, rotated to start at 12 o'clock. There is a 2px surface gap between slices when more than one is drawn.
- **Colour follows the product key, never its rank.** `claude_code`, `chat` and `cowork` are pinned to `--series-1..3`. Unknown keys take `--series-4` and `--series-5` in the API's row order. The slots are assigned *before* sorting, so a product keeps its colour when its rank changes. `other` (plus anything beyond slot 5) uses the grey `--series-other`. The colours are defined per theme in the `body.vscode-dark` / `body.vscode-light` blocks and were checked as a set against each theme's `--surface`. On the light theme, orange and aqua sit below 3:1 contrast, which is why the legend always shows the percentages as text.
- **Hover** over a slice or a legend row adds `.hovering` to the card and `.active` to the matching pair (both carry the same `data-i`), which dims everything else. The centre shows that row. Otherwise, the centre shows the first (largest) row. Each slice also has an SVG `<title>`, and the `<svg>` has an `aria-label` that lists every row.
- The CSP has no `'unsafe-inline'`, so colours reach the SVG through classes (`.series-N` sets `--series`, which both `.seg` and `.swatch` read). Never use `style="…"` attributes: they are blocked. `display_name` comes from the API, so it goes through the template's `esc()` before `innerHTML`.

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

## Dependency updates (`.github/dependabot.yml`)

Dependabot checks two ecosystems weekly, with a 7-day cooldown on newly published versions:

- **`npm`** (covers pnpm via `pnpm-lock.yaml`) — minor and patch bumps are grouped into one PR; each major bump gets its own PR.
- **`github-actions`** — all action bumps are grouped into one PR. Every `uses:` is pinned to a full commit SHA with a trailing `# vX.Y.Z` comment; Dependabot updates both together, so keep the comment when editing by hand.

`@types/vscode` is **ignored on purpose**. `vsce package` fails when the declared `@types/vscode` range is newer than `engines.vscode` (`^1.80.0`), and Dependabot would raise it to the latest version. Raise both together by hand when the minimum VS Code version changes.

Dependabot's pnpm 11 support depends on `pnpm-lock.yaml` staying a **single YAML document**. Adding a `packageManager` field to `package.json` makes pnpm 11 write a multi-document lockfile, and GitHub's dependency graph then reads only the first document, which silently drops the Dependabot security alerts.

No workflow runs on pull requests, so Dependabot PRs are not built or linted in CI — check them locally (`pnpm install && pnpm run compile && pnpm run lint`) before merging.
