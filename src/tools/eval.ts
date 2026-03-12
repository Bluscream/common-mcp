import { exec } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";

const execPromise = promisify(exec);

const EXTRA_PATHS = [
    "C:\\Ruby33-x64\\bin",
    "D:\\Coding\\Go\\bin",
    "D:\\Coding\\xampp\\php",
    "P:\\vcpkg\\downloads\\tools\\perl\\5.40.2.1\\perl\\bin",
    "P:\\vcpkg\\downloads\\tools\\perl\\5.40.2.1\\c\\bin",
    "C:\\Program Files\\Java\\jdk-25\\bin",
    "P:\\Program Files\\dotnet"
];

export interface EvalArgs {
    language: string;
    code: string;
}

async function runCommand(command: string, envOverrides: any = {}): Promise<{ stdout: string; stderr: string }> {
    try {
        const env: any = { ...process.env, ...envOverrides };
        const pathVar = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
        env[pathVar] = EXTRA_PATHS.concat(env[pathVar] ? [env[pathVar]] : []).join(';');

        const { stdout, stderr } = await execPromise(command, { env });
        return { stdout, stderr };
    } catch (error: any) {
        return {
            stdout: error.stdout || "",
            stderr: error.stderr || error.message,
        };
    }
}

async function withTempFile(extension: string, content: string, callback: (filePath: string) => Promise<any>, preferredName?: string) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-eval-"));
    const fileName = preferredName ? `${preferredName}${extension}` : `script${extension}`;
    const filePath = path.join(tempDir, fileName);
    await fs.writeFile(filePath, content);
    try {
        return await callback(filePath);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

const handlers: Record<string, (code: string) => Promise<{ stdout: string; stderr: string }>> = {
    powershell: async (code) => {
        return await withTempFile(".ps1", code, async (filePath) => {
            return await runCommand(`pwsh -NoProfile -File "${filePath}"`);
        });
    },
    cmd: async (code) => {
        return await withTempFile(".bat", code, async (filePath) => {
            return await runCommand(`cmd.exe /c "${filePath}"`);
        });
    },
    python: async (code) => {
        return await withTempFile(".py", code, async (filePath) => {
            return await runCommand(`python "${filePath}"`);
        });
    },
    node: async (code) => {
        return await runCommand(`node -e ${JSON.stringify(code)}`);
    },
    ruby: async (code) => {
        return await withTempFile(".rb", code, async (filePath) => {
            return await runCommand(`ruby "${filePath}"`);
        });
    },
    perl: async (code) => {
        return await withTempFile(".pl", code, async (filePath) => {
            return await runCommand(`perl "${filePath}"`);
        });
    },
    php: async (code) => {
        return await withTempFile(".php", code, async (filePath) => {
            return await runCommand(`php -n "${filePath}"`);
        });
    },
    go: async (code) => {
        return await withTempFile(".go", code, async (filePath) => {
            return await runCommand(`go run "${filePath}"`);
        });
    },
    lua: async (code) => {
        return await withTempFile(".lua", code, async (filePath) => {
            return await runCommand(`lua "${filePath}"`);
        });
    },
    typescript: async (code) => {
        return await withTempFile(".ts", code, async (filePath) => {
            return await runCommand(`npx --yes tsx "${filePath}"`);
        });
    },
};

export async function handleEval(args: EvalArgs) {
    const { language, code } = args;
    const handler = handlers[language.toLowerCase()];
    if (!handler) {
        throw new Error(`Unsupported language: ${language}`);
    }

    const { stdout, stderr } = await handler(code);
    let output = "";
    if (stdout) output += stdout;
    if (stderr) output += `\nError/Stderr:\n${stderr}`;
    return output || "(no output)";
}
