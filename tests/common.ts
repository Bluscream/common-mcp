import { spawn } from "child_process";

export async function runCommonMcp(args: string[], request: any) {
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
