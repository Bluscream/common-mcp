import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { handleGrep } from "./tools/grep.js";
import { handleHex } from "./tools/hex.js";
import { handleCount } from "./tools/count.js";
import { handleEval } from "./tools/eval.js";
import { handleDiff } from "./tools/diff.js";

const isSingleMode = process.argv.includes("--single-tool") || process.argv.includes("-s");

const server = new Server(
    {
        name: "common-mcp",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

const toolSchemas: Record<string, any> = {
    count: {
        name: "count",
        description: "Count files, folders, lines, words, characters, bytes, or items in files/folders.",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Path to a file or folder" },
                recursive: { type: "boolean", description: "Recursive search" },
                text: { type: "string", description: "Text to count instead of path" },
                types: {
                    type: "array",
                    items: { type: "string" },
                    description: "Count types (lines, words, chars, bytes, files, folders, items)",
                },
            },
            required: ["types"],
        },
    },
    eval: {
        name: "eval",
        description: "Evaluates source code in multiple languages.",
        inputSchema: {
            type: "object",
            properties: {
                language: { type: "string", description: "The language to execute" },
                code: { type: "string", description: "The source code" },
            },
            required: ["language", "code"],
        },
    },
    diff: {
        name: "diff",
        description: "Compare two strings or paths and return a readable diff.",
        inputSchema: {
            type: "object",
            properties: {
                left: { type: "string", description: "Content or file path A" },
                right: { type: "string", description: "Content or file path B" },
                type: { type: "string", enum: ["auto", "string", "file", "directory"], description: "Force input type" },
                context: { type: "number", description: "Context lines" },
            },
            required: ["left", "right"],
        },
    },
    grep: {
        name: "grep",
        description: "Search across files and folders with flexible pattern types.",
        inputSchema: {
            type: "object",
            properties: {
                paths: { type: "array", items: { type: "string" }, description: "Search paths" },
                pattern: { type: "string", description: "Search pattern" },
                type: { type: "string", enum: ["regex", "glob", "string"], description: "Pattern type" },
                replace: { type: "string", description: "Replacement string" },
                depth: { type: "number", description: "Recursion depth" },
            },
            required: ["paths", "pattern", "type"],
        },
    },
    hex: {
        name: "hex",
        description: "Hex read/write tool.",
        inputSchema: {
            type: "object",
            properties: {
                mode: { type: "string", enum: ["read", "write"], description: "Read or write mode" },
                path: { type: "string", description: "File path" },
                offset: { type: "number", description: "Byte offset" },
                length: { type: "number", description: "Length to read" },
                hexData: { type: "string", description: "Hex data for writing" },
                searchHex: { type: "string", description: "Pattern to find and replace" },
                replaceHex: { type: "string", description: "Replacement hex" },
            },
            required: ["mode", "path"],
        },
    },
};

server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (isSingleMode) {
        return {
            tools: [
                {
                    name: "common",
                    description: "Unified utility tool for counting, evaluation, diffing, grepping, and hex operations.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            tool: {
                                type: "string",
                                enum: ["count", "eval", "diff", "grep", "hex"],
                                description: "The specific sub-tool to invoke",
                            },
                            arguments: {
                                type: "object",
                                description: "The arguments for the sub-tool",
                            },
                        },
                        required: ["tool", "arguments"],
                    },
                },
            ],
        };
    }
    return {
        tools: Object.values(toolSchemas),
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        let toolName = name;
        let toolArgs = args;

        if (isSingleMode) {
            if (name !== "common") throw new Error(`Only 'common' tool is allowed in single-tool mode`);
            toolName = args?.tool as string;
            toolArgs = args?.arguments as any;
        }

        let result: any;
        switch (toolName) {
            case "count": result = await handleCount(toolArgs as any); break;
            case "eval": result = await handleEval(toolArgs as any); break;
            case "diff": result = await handleDiff(toolArgs as any); break;
            case "grep": result = await handleGrep(toolArgs as any); break;
            case "hex": result = await handleHex(toolArgs as any); break;
            default: throw new Error(`Tool not found: ${toolName}`);
        }

        return {
            content: [{ type: "text", text: result }],
        };
    } catch (error: any) {
        return {
            isError: true,
            content: [{ type: "text", text: `Error: ${error.message}` }],
        };
    }
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`Common MCP Server running (single-tool mode: ${isSingleMode})`);
}

main().catch((error) => {
    console.error("Critical error in main:", error);
    process.exit(1);
});
