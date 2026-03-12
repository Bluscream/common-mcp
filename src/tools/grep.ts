import { promises as fs } from "fs";
import { glob } from "glob";

export interface GrepArgs {
    paths: string[];
    pattern: string;
    type: "regex" | "glob" | "string";
    replace?: string;
    depth?: number;
}

interface GrepResult {
    file: string;
    line: number;
    content: string;
    replaced?: string;
}

async function findFiles(paths: string[], depth?: number): Promise<string[]> {
    const allFiles: string[] = [];
    for (const p of paths) {
        try {
            const stats = await fs.stat(p);
            if (stats.isFile()) {
                allFiles.push(p);
            } else if (stats.isDirectory()) {
                const options: any = { cwd: p, nodir: true, absolute: true };
                if (depth !== undefined) {
                    options.maxDepth = depth + 1;
                }
                const files = await glob("**/*", options);
                allFiles.push(...files);
            }
        } catch (err) {
            console.error(`Error accessing path ${p}:`, err);
        }
    }
    return [...new Set(allFiles)];
}

export async function handleGrep(args: GrepArgs) {
    const { paths, pattern, type, replace, depth } = args;

    try {
        const files = await findFiles(paths, depth);
        const results: GrepResult[] = [];
        let replacedCount = 0;

        for (const file of files) {
            const content = await fs.readFile(file, "utf8");
            const lines = content.split(/\r?\n/);
            let fileModified = false;
            const newLines: string[] = [];

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                let match = false;
                let newLine = line;

                if (type === "regex") {
                    const regex = new RegExp(pattern, "g");
                    if (regex.test(line)) {
                        match = true;
                        if (replace !== undefined) {
                            newLine = line.replace(regex, replace);
                        }
                    }
                } else if (type === "string") {
                    if (line.includes(pattern)) {
                        match = true;
                        if (replace !== undefined) {
                            newLine = line.split(pattern).join(replace);
                        }
                    }
                } else if (type === "glob") {
                    const globRegex = new RegExp(pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'), 'g');
                    if (globRegex.test(line)) {
                        match = true;
                        if (replace !== undefined) {
                            newLine = line.replace(globRegex, replace);
                        }
                    }
                }

                if (match) {
                    const result: GrepResult = { file, line: i + 1, content: line };
                    if (replace !== undefined && newLine !== line) {
                        result.replaced = newLine;
                        fileModified = true;
                        replacedCount++;
                    }
                    results.push(result);
                }
                newLines.push(newLine);
            }

            if (fileModified && replace !== undefined) {
                await fs.writeFile(file, newLines.join("\n"), "utf8");
            }
        }

        let outputText = "";
        if (replace !== undefined) {
            outputText = `Successfully performed replacement in ${replacedCount} occurrences.\n\n`;
        }

        if (results.length === 0) {
            outputText += "No matches found.";
        } else {
            outputText += results.map(r => 
                `${r.file}:${r.line}: ${r.content}${r.replaced ? ` -> ${r.replaced}` : ""}`
            ).join("\n");
        }

        return outputText;
    } catch (error: any) {
        throw new Error(`Grep error: ${error.message}`);
    }
}
