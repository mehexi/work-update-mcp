#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const config = {
  apiUrl: process.env.API_URL || "https://portal.scaleupdevagency.com/update-sheet/add-entry",
  nextAction: process.env.NEXT_ACTION || "",
  cookies: process.env.COOKIES || "",
  profileId: process.env.PROFILE_ID || "",
  clientName: process.env.CLIENT_NAME || "",
  orderId: process.env.ORDER_ID || "",
  updateTo: process.env.UPDATE_TO || "INBOX_PAGE_UPDATE",
  authorName: process.env.AUTHOR_NAME || "",
  authorRole: process.env.AUTHOR_ROLE || "",
};

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const withBreaks = escaped.replace(/\n/g, "<br>");
  return `<p>${withBreaks}</p>`;
}

function formatUpdate(params: {
  date: string;
  recipient?: string;
  tasks: Array<{
    summary: string;
    problem?: string;
    action?: string;
    current_state?: string;
    next_step?: string;
  }>;
  general_notes?: string;
  closing?: string;
}): string {
  const recipient = params.recipient || "Client";
  const lines: string[] = [];

  const today = params.date || new Date().toISOString().split("T")[0];

  lines.push(`Hi ${recipient},`);
  lines.push("");
  lines.push("Please find below a summary of the work completed and current status of ongoing tasks.");
  lines.push("");

  for (const task of params.tasks) {
    lines.push(`• ${task.summary}`);
    if (task.problem) lines.push(`  - Problem: ${task.problem}`);
    if (task.action) lines.push(`  - Action taken: ${task.action}`);
    if (task.current_state) lines.push(`  - Current state: ${task.current_state}`);
    if (task.next_step) lines.push(`  - Next step: ${task.next_step}`);
    lines.push("");
  }

  if (params.general_notes) {
    lines.push(`Additional notes: ${params.general_notes}`);
    lines.push("");
  }

  if (params.closing) {
    lines.push(params.closing);
  } else {
    lines.push("Please let me know if you'd like any adjustments or if there's anything else you'd like me to address.");
  }

  lines.push("");
  if (config.authorName) {
    lines.push(`Best regards,`);
    lines.push(config.authorName);
    if (config.authorRole) lines.push(config.authorRole);
  }

  return lines.join("\n");
}

const server = new McpServer({
  name: "work-update-mcp",
  version: "1.0.0",
});

server.tool(
  "write_update",
  "Format work notes into a structured client update (problem → action → current state → next step)",
  {
    date: z.string().describe("Date of the update (YYYY-MM-DD)"),
    recipient: z.string().optional().describe("Recipient name (defaults to Client)"),
    tasks: z.array(z.object({
      summary: z.string().describe("Short headline for this task"),
      problem: z.string().optional().describe("What issue or requirement prompted the work"),
      action: z.string().optional().describe("What was done to address it"),
      current_state: z.string().optional().describe("Where things stand now"),
      next_step: z.string().optional().describe("Suggested next action or decision needed"),
    })).describe("List of tasks with structured details"),
    general_notes: z.string().optional().describe("Any additional context or notes"),
    closing: z.string().optional().describe("Custom closing message"),
    as_html: z.boolean().optional().describe("Return as HTML instead of plain text"),
  },
  async (params) => {
    const formatted = formatUpdate(params);
    const output = params.as_html ? textToHtml(formatted) : formatted;
    return {
      content: [{ type: "text" as const, text: output }],
    };
  },
);

async function publishToPortal(params: {
  message: string;
  clientName?: string;
  orderId?: string;
  profileId?: string;
  updateTo?: string;
  attachments?: string;
  commentFromOperation?: string;
  commentFromSales?: string;
}) {
  if (!config.nextAction) {
    return { ok: false, text: "Error: NEXT_ACTION is not configured. Set it in the server env vars." };
  }
  if (!config.cookies) {
    return { ok: false, text: "Error: COOKIES is not configured. Set it in the server env vars." };
  }

  const payload = [{
    profileId: params.profileId || config.profileId,
    clientName: params.clientName || config.clientName,
    orderId: params.orderId || config.orderId,
    attachments: params.attachments || "$undefined",
    commentFromOperation: params.commentFromOperation || "$undefined",
    commentFromSales: params.commentFromSales || "$undefined",
    updateTo: params.updateTo || config.updateTo,
    message: params.message,
  }];

  try {
    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "Next-Action": config.nextAction,
        "Cookie": config.cookies,
        "Origin": new URL(config.apiUrl).origin,
        "Referer": config.apiUrl,
        "Accept": "text/x-component",
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    if (!response.ok) {
      return { ok: false, text: `Portal request failed (${response.status}): ${responseText}` };
    }

    return { ok: true, text: `Update published to portal.\nStatus: ${response.status}\nResponse: ${responseText}` };
  } catch (error) {
    return { ok: false, text: `Error publishing: ${error instanceof Error ? error.message : String(error)}` };
  }
}

server.tool(
  "publish_update",
  "Publish HTML content to the portal as a work update entry",
  {
    message: z.string().describe("HTML content for the update message body"),
    clientName: z.string().optional().describe("Override client name"),
    orderId: z.string().optional().describe("Override order/project ID"),
    profileId: z.string().optional().describe("Override profile ID"),
    updateTo: z.string().optional().describe("Update type (defaults to INBOX_PAGE_UPDATE)"),
  },
  async (params) => {
    const result = await publishToPortal(params);
    return {
      content: [{ type: "text" as const, text: result.text }],
      isError: !result.ok,
    };
  },
);

server.tool(
  "compose_and_publish",
  "Write a work update from notes, convert to HTML, and publish to the portal in one step",
  {
    date: z.string().describe("Date of the update (YYYY-MM-DD)"),
    recipient: z.string().optional().describe("Recipient name"),
    tasks: z.array(z.object({
      summary: z.string().describe("Short headline for this task"),
      problem: z.string().optional().describe("What issue or requirement prompted the work"),
      action: z.string().optional().describe("What was done to address it"),
      current_state: z.string().optional().describe("Where things stand now"),
      next_step: z.string().optional().describe("Suggested next action or decision needed"),
    })).describe("List of tasks"),
    general_notes: z.string().optional().describe("Additional context"),
    closing: z.string().optional().describe("Custom closing message"),
    clientName: z.string().optional().describe("Client name for the portal entry"),
    orderId: z.string().optional().describe("Order/project ID"),
    profileId: z.string().optional().describe("Profile ID override"),
    updateTo: z.string().optional().describe("Update type (defaults to INBOX_PAGE_UPDATE)"),
  },
  async (params) => {
    const formatted = formatUpdate(params);
    const messageHtml = textToHtml(formatted);

    const result = await publishToPortal({
      message: messageHtml,
      clientName: params.clientName,
      orderId: params.orderId,
      profileId: params.profileId,
      updateTo: params.updateTo,
    });

    return {
      content: [{ type: "text" as const, text: `${result.ok ? "Published successfully." : "Publish failed."}\n\n---\n\n${formatted}` }],
      isError: !result.ok,
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("work-update-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
