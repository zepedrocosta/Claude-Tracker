import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ClaudeUsageData } from "./types";

export function buildUsageDashboardHtml(
  data: ClaudeUsageData,
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const clawdIconUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "icons", "clawd.svg"),
  );
  const templatePath = path.join(
    __dirname,
    "..",
    "media",
    "usageDashboard.html",
  );
  return fs
    .readFileSync(templatePath, "utf-8")
    .replace(/\{\{NONCE\}\}/g, nonce)
    .replace(/\{\{CSP_SOURCE\}\}/g, webview.cspSource)
    .replace(/\{\{CLAWD_ICON\}\}/g, clawdIconUri.toString())
    .replace("{{INITIAL_DATA}}", JSON.stringify(data));
}
