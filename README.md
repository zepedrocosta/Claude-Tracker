# Claude Tracker

A VS Code extension that tracks your Claude AI usage at a glance, inspired by the GitHub Copilot Pro Usage panel. See your plan limits, premium request consumption, and extra usage — all from the status bar.

## Features

### Status Bar Item

A persistent **✦ Claude** indicator lives in the bottom status bar (left side), colored in Anthropic's brand terracotta.

**Hover** over it to see a rich tooltip with:

- Your plan name
- Each metric's label, current value, and a blue SVG progress bar
- Reset time / next reset date

No click required — the tooltip stays open while you hover.

### Two Modes

#### API Mode (automatic, live data)

Set `claudeTracker.sessionKey` to your claude.ai session cookie value. The extension will:

1. Call `GET /api/bootstrap` to resolve your organization UUID
2. Call `GET /api/organizations/{uuid}/usage` to fetch real usage data
3. Display live **session** and **weekly** limits with reset countdowns

#### Manual Mode (default, no network calls)

Leave `sessionKey` blank. The extension reads all values from VS Code settings (`claudeTracker.*`) and renders them statically. Useful if you don't want to expose your session key.

### Usage Panel

A styled webview in the bottom panel that mirrors the Copilot Pro Usage layout:

| Row | Description |
| --- | --- |
| **Standard messages** | Full blue bar labeled "Included" |
| **Claude Code messages** | Full blue bar labeled "Included" |
| **Premium API requests** | Partial blue bar showing your configured percentage |
| **Extra usage** | Always visible — blue if enabled, gray if not |

- **Refresh button** — re-reads settings / re-fetches API and updates all bars
- **Settings button** — opens VS Code settings filtered to `claudeTracker.*`
- **Open Claude Console** button — opens `claude.ai/settings` in your browser
- **Reset date** and **last updated** time shown at the bottom

### Live Updates

Any change to `claudeTracker.*` settings instantly refreshes both the status bar tooltip and the open panel — no restart required.

## Installation (from source)

**Requirements:** Node.js 18+, VS Code 1.80+

```bash
# 1. Clone or download the project
cd Claude-Tracker

# 2. Install dependencies
npm install

# 3. Compile TypeScript
npm run compile
```

Open the folder in VS Code and press **F5** (or **Run > Start Debugging**) to launch an Extension Development Host.

## Configuration

All settings live under the `claudeTracker` namespace.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `claudeTracker.sessionKey` | `string` | `""` | Your claude.ai session cookie. When set, enables API mode with live data. Leave blank for manual mode. |
| `claudeTracker.plan` | `string` | `"Claude Pro"` | Plan name shown in the header (manual mode) |
| `claudeTracker.premiumRequests.used` | `number` | `32` | Premium requests used (manual mode) |
| `claudeTracker.premiumRequests.limit` | `number` | `100` | Premium requests total limit (manual mode) |
| `claudeTracker.extraUsage.enabled` | `boolean` | `false` | Whether pay-as-you-go extra usage is active |
| `claudeTracker.extraUsage.percentage` | `number` | `0` | Extra usage consumed percentage |
| `claudeTracker.resetDate` | `string` | `"April 1, 2026 at 1:00 AM"` | Allowance reset date (manual mode) |
| `claudeTracker.showStatusBar` | `boolean` | `true` | Show or hide the status bar item |

### Getting your session key

1. Open [claude.ai](https://claude.ai) in your browser and log in
2. Open DevTools → Application → Cookies → `claude.ai`
3. Copy the value of the `sessionKey` cookie
4. Paste it into `claudeTracker.sessionKey` in your VS Code settings

### Example `settings.json`

```json
{
  "claudeTracker.sessionKey": "sk-ant-...",
  "claudeTracker.plan": "Claude Pro",
  "claudeTracker.resetDate": "April 1, 2026 at 1:00 AM"
}
```

## Commands

Access via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
| --- | --- |
| `Claude Tracker: Show Claude Usage` | Opens the usage panel |
| `Claude Tracker: Refresh Usage Data` | Re-fetches/re-reads data and refreshes |
| `Claude Tracker: Open Claude Console` | Opens `claude.ai/settings` in your browser |

## Development

```bash
npm run watch    # watch mode — auto-recompiles on save
npm run compile  # single compile
npm run lint     # ESLint on src/
```

| File | Role |
| --- | --- |
| [src/extension.ts](src/extension.ts) | Entry point, command registration, config listener |
| [src/usageProvider.ts](src/usageProvider.ts) | Fetches API data or reads manual settings; produces `ClaudeUsageData` |
| [src/panelProvider.ts](src/panelProvider.ts) | Builds and manages the webview panel HTML/CSS |
| [src/statusBar.ts](src/statusBar.ts) | Status bar item with SVG progress bar tooltip |
| [src/types.ts](src/types.ts) | `UsageItem`, `LimitSection`, `ClaudeUsageData` interfaces |

## Requirements

- VS Code `^1.80.0`
- Node.js `18+` (build only)
