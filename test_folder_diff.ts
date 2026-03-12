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

async function testFolderDiff() {
    console.log("Starting folder diff test...");

    const tmpDirA = path.join("p:\\MCPs\\common-mcp", "tmp_test_a");
    const tmpDirB = path.join("p:\\MCPs\\common-mcp", "tmp_test_b");

    await fs.mkdir(tmpDirA, { recursive: true });
    await fs.mkdir(tmpDirB, { recursive: true });

    // Files in both
    await fs.writeFile(path.join(tmpDirA, "same.txt"), "same content");
    await fs.writeFile(path.join(tmpDirB, "same.txt"), "same content");

    await fs.writeFile(path.join(tmpDirA, "diff.txt"), "content A");
    await fs.writeFile(path.join(tmpDirB, "diff.txt"), "content B");

    // Only in A
    await fs.writeFile(path.join(tmpDirA, "only_a.txt"), "only A");

    // Only in B
    await fs.writeFile(path.join(tmpDirB, "only_b.txt"), "only B");

    // Nested
    await fs.mkdir(path.join(tmpDirA, "subdir"), { recursive: true });
    await fs.mkdir(path.join(tmpDirB, "subdir"), { recursive: true });
    await fs.writeFile(path.join(tmpDirA, "subdir", "file.txt"), "nested content");
    await fs.writeFile(path.join(tmpDirB, "subdir", "file.txt"), "nested content modified");

    console.log("\nRunning Folder Diff...");
    const diffReq = {
        method: "tools/call",
        params: {
            name: "diff",
            arguments: {
                left: tmpDirA,
                right: tmpDirB,
                type: "directory"
            }
        }
    };

    const diffRes: any = await runCommonMcp([], diffReq);
    console.log("Folder Diff Result:\n", diffRes[diffRes.length - 1]?.result?.content?.[0]?.text);

    // Cleanup
    await fs.rm(tmpDirA, { recursive: true, force: true });
    await fs.rm(tmpDirB, { recursive: true, force: true });

    console.log("\nFolder diff test completed!");
}

testFolderDiff().catch(console.error);
