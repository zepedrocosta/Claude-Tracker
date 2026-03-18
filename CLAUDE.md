# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run compile      # compile TypeScript → out/
npm run watch        # watch mode (incremental compile)
npm run lint         # ESLint on src/
```

To run the extension: open the folder in VS Code and press **F5** (launches an Extension Development Host). There is no test suite.

To package for distribution:

```bash
npx vsce package     # produces claude-tracker-<version>.vsix
```

## Architecture

This is a VS Code extension. The compiled entry point is `out/extension.js` (from `src/extension.ts`). It activates on `onStartupFinished`.

### Data flow

```text
UsageProvider.getUsageData()   →   ClaudeUsageData
        ↓                                ↓
  StatusBarManager.update()      PanelProvider.updateContent()
```

`getUsageData()` is **async**. It reads Claude Code CLI credentials from `~/.claude/.credentials.json`:

- **Credentials found**: uses the OAuth access token (`Bearer` auth) and the stored `organizationUuid` to call `GET /api/organizations/{uuid}/usage` on `claude.ai`. No bootstrap call is needed since the org UUID is already in the credentials file.
- **No credentials**: returns an error prompting the user to install/log in to Claude Code CLI.

### Panel rendering

`PanelProvider` implements `vscode.WebviewViewProvider` and is registered in the built-in **bottom panel** (`views.panel` in `package.json`). Clicking the status bar item fires the auto-generated `claudeTracker.usagePanel.focus` command, which slides up the panel — no new editor tab is opened.

`resolveWebviewView` is called lazily by VS Code when the view first becomes visible. The provider caches the latest `ClaudeUsageData` in `_latestData` and applies it immediately in `resolveWebviewView` if data arrived earlier.

`buildHtml()` renders session limit → divider → weekly limit → extra usage rows when data is available, mirroring the claude.ai browser UI. When no data is present (error state), it shows the error message with an "Open usage page" button.

### Key types (`src/types.ts`)

- `LimitSection` — has `label`, `subLabel` (reset time string), `percentage`.
- `ClaudeUsageData` — has `plan`, optional `sessionLimit`/`weeklyLimit`/`extraUsage` (all `LimitSection`), `lastUpdated`, and optional `error`.

### API response parsing (`UsageProvider.parseUsageResponse`)

The claude.ai usage endpoint shape is undocumented. The parser tries three response shapes in order (nested `session`/`weekly` keys, flat `session_percent`/`weekly_percent` keys, wrapped `rate_limits` key) and normalizes percentage values that may be fractions (0–1) or integers (0–100).

### Status bar tooltip

The `MarkdownString` tooltip (hover on the status bar item) shows session + weekly data when `data.sessionLimit` is present, otherwise falls back to the manual items list. It is rebuilt on every `refreshData()` call.

### Webview security

Every `buildHtml()` call generates a fresh random `nonce` used in both the `Content-Security-Policy` meta tag and the `<style>`/`<script>` tags. No external resources are loaded.

## Authentication

The extension reads OAuth credentials from `~/.claude/.credentials.json` (written by Claude Code CLI). It uses the `claudeAiOauth.accessToken` as a Bearer token and the `organizationUuid` to call the usage API. No manual API key or session key configuration is needed — just have Claude Code installed and logged in.

## Settings namespace

All settings live under `claudeTracker.*`. The only settings are `claudeTracker.plan` (display name) and `claudeTracker.showStatusBar`.
