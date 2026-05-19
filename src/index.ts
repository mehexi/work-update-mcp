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
};

const styleGuide =
  "STYLE RULES - follow these exactly when writing:\n" +
  "1. Opening: Warm greeting - 'I hope you're doing well and this message finds you in great spirits.'\n" +
  "2. Each task: Issue -> Action Taken -> Result -> Fallback offer\n" +
  "3. Tone: Warm, professional, reassuring, proactive, service-oriented. Never cold or robotic.\n" +
  "4. Voice: First-person active - 'I fixed', 'I improved', 'I implemented'. Never passive voice.\n" +
  "5. Client empowerment: After each fix, tell them what they can now do - 'You can now...'\n" +
  "6. Closing: Acknowledge progress, invite more feedback, end with commitment. Sign off with 'Best regards'.";

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<p>${escaped.replace(/\n/g, "<br>")}</p>`;
}

function formatUpdate(params: {
  date: string;
  recipient?: string;
  tasks: Array<{
    issue: string;
    action: string;
    result: string;
    fallback_offer?: string;
  }>;
  progress_note?: string;
  extra_notes?: string;
  custom_closing?: string;
}): string {
  const recipient = params.recipient || "Client";
  const lines: string[] = [];

  const today = params.date || new Date().toISOString().split("T")[0];

  lines.push("Subject: Work Update - " + today);
  lines.push("");
  lines.push("I hope you're doing well and this message finds you in great spirits.");
  lines.push("");
  lines.push("Here's a summary of what I've been working on:");
  lines.push("");

  for (const task of params.tasks) {
    lines.push("- " + task.issue);
    lines.push("  I " + task.action);
    lines.push("  You can now " + task.result);
    if (task.fallback_offer) {
      lines.push("  If you still face difficulty, feel free to " + task.fallback_offer);
    }
    lines.push("");
  }

  if (params.progress_note) {
    lines.push(params.progress_note);
    lines.push("");
  }

  if (params.extra_notes) {
    lines.push(params.extra_notes);
    lines.push("");
  }

  if (params.custom_closing) {
    lines.push(params.custom_closing);
  } else {
    lines.push("I'm really happy to hear everything is looking solid on your end.");
    lines.push("If you have any more concerns, ideas, or improvements, please don't hesitate to share them.");
    lines.push("I'll be more than happy to take care of everything.");
  }

  lines.push("");
  lines.push("Best regards,");
  if (config.authorName) lines.push(config.authorName);

  return lines.join("\n");
}

const server = new McpServer({
  name: "work-update-mcp",
  version: "1.0.0",
});

server.tool(
  "write_update",
  "Draft a client work update following the exact style rules. " +
    "Returns the message for YOUR REVIEW - does NOT publish. After user approves, use publish_update.\n\n" + styleGuide,
  {
    date: z.string().describe("Date of the update (YYYY-MM-DD)"),
    recipient: z.string().optional().describe("Client/recipient name"),
    tasks: z.array(z.object({
      issue: z.string().describe("What the issue or requirement was"),
      action: z.string().describe("What was done - starts after 'I', e.g. 'fixed the login token validation'"),
      result: z.string().describe("What client can now do - starts after 'You can now', e.g. 'log in without SSO issues'"),
      fallback_offer: z.string().optional().describe("Optional - starts after 'If you still face difficulty, feel free to'"),
    })).describe("Each task: Issue -> Action -> Result -> Fallback"),
    progress_note: z.string().optional().describe("A sentence acknowledging overall progress"),
    extra_notes: z.string().optional().describe("Any additional context to include"),
    custom_closing: z.string().optional().describe("Custom closing paragraph (default uses standard warm closing)"),
  },
  async (params) => {
    const formatted = formatUpdate(params);
    return {
      content: [{ type: "text" as const, text: formatted }],
    };
  },
);

async function publishToPortal(params: {
  message: string;
  clientName?: string;
  orderId?: string;
  profileId?: string;
  updateTo?: string;
}) {
  if (!config.nextAction) {
    return { ok: false, text: "NEXT_ACTION not configured. Set it in the server env vars." };
  }
  if (!config.cookies) {
    return { ok: false, text: "COOKIES not configured. Set them in the server env vars." };
  }

  const payload = [{
    profileId: params.profileId || config.profileId,
    clientName: params.clientName || config.clientName,
    orderId: params.orderId || config.orderId,
    attachments: "$undefined",
    commentFromOperation: "$undefined",
    commentFromSales: "$undefined",
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
      return { ok: false, text: "Portal request failed (" + response.status + "): " + responseText };
    }

    return { ok: true, text: "Update published to portal.\nStatus: " + response.status + "\nResponse: " + responseText };
  } catch (error) {
    return { ok: false, text: "Error publishing: " + (error instanceof Error ? error.message : String(error)) };
  }
}

server.tool(
  "publish_update",
  "Publish a pre-approved HTML message to the portal. " +
    "ONLY use after the user has reviewed and explicitly approved the draft message. " +
    "The tool auto-converts plain text to HTML if needed.",
  {
    message: z.string().describe("The update message content (plain text - auto-converted to HTML)"),
    clientName: z.string().optional().describe("Override client name"),
    orderId: z.string().optional().describe("Override order/project ID"),
    profileId: z.string().optional().describe("Override profile ID"),
    updateTo: z.string().optional().describe("Update type (defaults to INBOX_PAGE_UPDATE)"),
  },
  async (params) => {
    const html = textToHtml(params.message);
    const result = await publishToPortal({
      message: html,
      clientName: params.clientName,
      orderId: params.orderId,
      profileId: params.profileId,
      updateTo: params.updateTo,
    });
    return {
      content: [{ type: "text" as const, text: result.text }],
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
