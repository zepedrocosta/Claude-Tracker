# Claude Tracker

A VS Code extension that tracks your Claude AI usage at a glance. See your session and weekly limits, reset countdowns, and extra usage — all from a status bar tooltip.

## Features

### Status Bar

A persistent **$(sparkle) Claude** indicator in the bottom status bar. Hover to see a tooltip with:

- Your plan name (e.g. "Claude Pro Usage")
- Session and weekly limit percentages with color-coded progress bars
- Reset countdowns (minutes, hours, or days depending on time remaining)
- Extra usage consumption (if enabled on your account)
- A **Manage usage** link to claude.ai
- A **refresh** button with a 1-minute cooldown

Progress bars change color based on usage: blue under 75%, yellow at 75-89%, red at 90%+.

Clicking the status bar item opens the [Claude usage page](https://claude.ai/settings/usage) in your browser.

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
| `Claude Tracker: Refresh Usage Data`     | Re-fetches usage data (1-min cooldown)         |
| `Claude Tracker: Open Claude Usage Page` | Opens claude.ai/settings/usage in your browser |

## Development

```bash
npm run watch    # watch mode — auto-recompiles on save
npm run compile  # single compile
npm run lint     # ESLint on src/
```

| File                    | Role                                                           |
| ----------------------- | -------------------------------------------------------------- |
| `src/extension.ts`      | Entry point, command registration, refresh cooldown logic      |
| `src/usageProvider.ts`  | Reads Claude CLI credentials, fetches and parses the usage API |
| `src/statusBar.ts`      | Status bar item management                                     |
| `src/tooltipBuilder.ts` | Builds the MarkdownString tooltip with progress bars           |
| `src/types.ts`          | `LimitSection` and `ClaudeUsageData` interfaces                |

## Requirements

- VS Code `^1.80.0`
- Node.js `18+` (build only)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and logged in
