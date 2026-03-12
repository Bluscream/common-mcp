import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

async function runCommonMcp(args: string[], request: any) {
    return new Promise((resolve, reject) => {
        const proc = spawn("node", ["dist/index.js", ...args], {
            cwd: "p:\\MCPs\\common-mcp",
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        proc.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        proc.on("close", (code) => {
            try {
                const responses = stdout
                    .split("\n")
                    .filter((line) => line.trim())
                    .map((line) => JSON.parse(line));
                resolve(responses);
            } catch (err) {
                reject(new Error(`Failed to parse response: ${stdout}. Stderr: ${stderr}`));
            }
        });

        const mcpRequest = {
            jsonrpc: "2.0",
            id: 1,
            ...request,
        };

        proc.stdin.write(JSON.stringify(mcpRequest) + "\n");
        proc.stdin.end();
    });
}

async function testAll() {
    console.log("Starting common-mcp tests...");

    // Test Grep
    console.log("\nTesting Grep...");
    const grepReq = {
        method: "tools/call",
        params: {
            name: "grep",
            arguments: {
                paths: ["p:\\MCPs\\common-mcp\\src"],
                pattern: "handleGrep",
                type: "string"
            }
        }
    };
    const grepRes: any = await runCommonMcp([], grepReq);
    console.log("Grep Result:", JSON.stringify(grepRes[grepRes.length - 1]?.result?.content?.[0]?.text).slice(0, 100) + "...");

    // Test Count
    console.log("\nTesting Count...");
    const countReq = {
        method: "tools/call",
        params: {
            name: "count",
            arguments: {
                path: "p:\\MCPs\\common-mcp\\src",
                recursive: true,
                types: ["files", "lines"]
            }
        }
    };
    const countRes: any = await runCommonMcp([], countReq);
    console.log("Count Result:", countRes[countRes.length - 1]?.result?.content?.[0]?.text);

    // Test Diff
    console.log("\nTesting Diff...");
    const diffReq = {
        method: "tools/call",
        params: {
            name: "diff",
            arguments: {
                left: "Hello World",
                right: "Hello MCP World",
                type: "string"
            }
        }
    };
    const diffRes: any = await runCommonMcp([], diffReq);
    console.log("Diff Result:", diffRes[diffRes.length - 1]?.result?.content?.[0]?.text);

    // Test Eval
    console.log("\nTesting Eval (Node)...");
    const evalReq = {
        method: "tools/call",
        params: {
            name: "eval",
            arguments: {
                language: "node",
                code: "console.log(1 + 2)"
            }
        }
    };
    const evalRes: any = await runCommonMcp([], evalReq);
    console.log("Eval Result:", evalRes[evalRes.length - 1]?.result?.content?.[0]?.text);

    // Test Hex
    console.log("\nTesting Hex (Write/Read)...");
    const testHexFile = "p:\\MCPs\\common-mcp\\hex_test.bin";
    const hexWriteReq = {
        method: "tools/call",
        params: {
            name: "hex",
            arguments: {
                mode: "write",
                path: testHexFile,
                hexData: "48656c6c6f" // "Hello"
            }
        }
    };
    await runCommonMcp([], hexWriteReq);
    
    const hexReadReq = {
        method: "tools/call",
        params: {
            name: "hex",
            arguments: {
                mode: "read",
                path: testHexFile
            }
        }
    };
    const hexReadRes: any = await runCommonMcp([], hexReadReq);
    console.log("Hex Read Result:", hexReadRes[hexReadRes.length - 1]?.result?.content?.[0]?.text);

    // Test Single Tool Mode
    console.log("\nTesting Single Tool Mode...");
    const singleReq = {
        method: "tools/call",
        params: {
            name: "common",
            arguments: {
                tool: "eval",
                arguments: {
                    language: "node",
                    code: "console.log('Single tool mode works')"
                }
            }
        }
    };
    const singleRes: any = await runCommonMcp(["--single-tool"], singleReq);
    console.log("Single Tool Result:", singleRes[singleRes.length - 1]?.result?.content?.[0]?.text);

    await fs.unlink(testHexFile).catch(() => {});
    console.log("\nAll tests completed!");
}

testAll().catch(console.error);
