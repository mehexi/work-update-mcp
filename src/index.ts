#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const config = {
  apiUrl: process.env.API_URL || "",
  apiMethod: (process.env.API_METHOD || "POST").toUpperCase(),
  apiAuthHeader: process.env.API_AUTH_HEADER || "",
  apiAuthValue: process.env.API_AUTH_VALUE || "",
  authorName: process.env.AUTHOR_NAME || "",
  authorRole: process.env.AUTHOR_ROLE || "",
};

let extraHeaders: Record<string, string> = {};
try {
  if (process.env.API_EXTRA_HEADERS) {
    extraHeaders = JSON.parse(process.env.API_EXTRA_HEADERS);
  }
} catch { /* ignore invalid json */ }

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

  lines.push(`Subject: Work Update — ${today}`);
  lines.push("");
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
  },
  async (params) => {
    const formatted = formatUpdate(params);
    return {
      content: [{ type: "text" as const, text: formatted }],
    };
  },
);

server.tool(
  "publish_update",
  "Publish a formatted work update to the configured website API",
  {
    content: z.string().describe("The formatted update content to publish"),
    title: z.string().optional().describe("Optional title for the update entry"),
  },
  async (params) => {
    if (!config.apiUrl) {
      return {
        content: [{ type: "text" as const, text: "Error: API_URL is not configured. Set environment variables before starting the server." }],
        isError: true,
      };
    }

    const now = new Date().toISOString();
    const body = {
      title: params.title || `Work Update — ${now.split("T")[0]}`,
      content: params.content,
      author: config.authorName || undefined,
      createdAt: now,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...extraHeaders,
    };
    if (config.apiAuthHeader && config.apiAuthValue) {
      headers[config.apiAuthHeader] = config.apiAuthValue;
    }

    try {
      const response = await fetch(config.apiUrl, {
        method: config.apiMethod,
        headers,
        body: JSON.stringify(body),
      });

      const responseText = await response.text();
      if (!response.ok) {
        return {
          content: [{ type: "text" as const, text: `API request failed (${response.status}): ${responseText}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: `Update published successfully.\nStatus: ${response.status}\nResponse: ${responseText}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error publishing update: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "compose_and_publish",
  "Write a work update from notes and publish it to the website in one step",
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
    title: z.string().optional().describe("Title for the published update"),
  },
  async (params) => {
    const formatted = formatUpdate(params);

    if (!config.apiUrl) {
      return {
        content: [{ type: "text" as const, text: `Update written successfully but API_URL is not configured, so it wasn't published.\n\n---\n\n${formatted}` }],
      };
    }

    const now = new Date().toISOString();
    const body = {
      title: params.title || `Work Update — ${now.split("T")[0]}`,
      content: formatted,
      author: config.authorName || undefined,
      createdAt: now,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...extraHeaders,
    };
    if (config.apiAuthHeader && config.apiAuthValue) {
      headers[config.apiAuthHeader] = config.apiAuthValue;
    }

    try {
      const response = await fetch(config.apiUrl, {
        method: config.apiMethod,
        headers,
        body: JSON.stringify(body),
      });

      const responseText = await response.text();
      if (!response.ok) {
        return {
          content: [{ type: "text" as const, text: `Written and formatted, but publish failed (${response.status}): ${responseText}\n\n---\n\n${formatted}` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: `Update written and published successfully.\nStatus: ${response.status}\n\n---\n\n${formatted}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Written but publish error: ${error instanceof Error ? error.message : String(error)}\n\n---\n\n${formatted}` }],
        isError: true,
      };
    }
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
