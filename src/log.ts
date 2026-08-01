import * as vscode from "vscode";

/**
 * The extension's single log channel.
 *
 * The providers import these helpers rather than the channel itself: the
 * channel lives here instead of in `extension.ts` so that `mcpProvider` and
 * `skillsProvider` can log without importing the module that already imports
 * them, which would be a require cycle.
 *
 * Calls made before `createLogChannel()` are dropped rather than throwing, so
 * anything that runs at import time stays safe.
 */
let channel: vscode.LogOutputChannel | undefined;

/** Creates the channel. Called once from `activate`. */
export function createLogChannel(): vscode.LogOutputChannel {
  channel = vscode.window.createOutputChannel("Claude Tracker", {
    log: true,
  });
  return channel;
}

export function logInfo(message: string): void {
  channel?.info(message);
}

export function logWarn(message: string): void {
  channel?.warn(message);
}

export function logError(message: string): void {
  channel?.error(message);
}

/** Formats an unknown thrown value for a log line. */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
