import { promises as fs } from "fs";
import * as diff from "diff";
import * as path from "path";
import * as crypto from "crypto";
import { glob } from "glob";

export interface DiffArgs {
    left: string;
    right: string;
    type?: "string" | "file" | "directory" | "auto";
    context?: number;
}

async function getFileHash(filePath: string): Promise<string> {
    const buffer = await fs.readFile(filePath);
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function listAllFiles(dir: string): Promise<Record<string, { size: number; hash: string; isDir: boolean }>> {
    const absoluteRoot = path.resolve(dir);
    const results: Record<string, { size: number; hash: string; isDir: boolean }> = {};
    const items = await glob("**/*", { cwd: absoluteRoot, mark: true, posix: true });

    for (const item of items) {
        const fullPath = path.join(absoluteRoot, item);
        const stats = await fs.stat(fullPath);
        const relativePath = item.endsWith("/") ? item.slice(0, -1) : item;
        
        results[relativePath] = {
            size: stats.size,
            isDir: stats.isDirectory(),
            hash: stats.isDirectory() ? "" : await getFileHash(fullPath),
        };
    }
    return results;
}

async function getPathInfo(p: string): Promise<{ isFile: boolean; isDirectory: boolean; exists: boolean }> {
    try {
        const stats = await fs.stat(p);
        return { isFile: stats.isFile(), isDirectory: stats.isDirectory(), exists: true };
    } catch {
        return { isFile: false, isDirectory: false, exists: false };
    }
}

export async function handleDiff(args: DiffArgs) {
    const { left, right, type = "auto", context = 3 } = args;

    let resolvedType = type;
    const infoLeft = await getPathInfo(left);
    const infoRight = await getPathInfo(right);

    if (type === "auto") {
        if (infoLeft.isDirectory && infoRight.isDirectory) {
            resolvedType = "directory";
        } else if (infoLeft.isFile && infoRight.isFile) {
            resolvedType = "file";
        } else {
            resolvedType = "string";
        }
    }

    if (resolvedType === "directory") {
        const leftFiles = await listAllFiles(left);
        const rightFiles = await listAllFiles(right);

        const allPaths = [...new Set([...Object.keys(leftFiles), ...Object.keys(rightFiles)])].sort();
        const diffResults: string[] = [];

        for (const p of allPaths) {
            const leftInfo = leftFiles[p];
            const rightInfo = rightFiles[p];

            if (leftInfo && rightInfo) {
                if (leftInfo.isDir !== rightInfo.isDir) {
                    diffResults.push(`[TYPE MISMATCH] ${p}: Left is ${leftInfo.isDir ? "dir" : "file"}, Right is ${rightInfo.isDir ? "dir" : "file"}`);
                } else if (!leftInfo.isDir) {
                    if (leftInfo.hash !== rightInfo.hash) {
                        diffResults.push(`[MODIFIED] ${p}: Size ${leftInfo.size} -> ${rightInfo.size}, Hash ${leftInfo.hash.slice(0, 8)}... -> ${rightInfo.hash.slice(0, 8)}...`);
                    }
                }
            } else if (leftInfo) {
                diffResults.push(`[REMOVED] ${p} (${leftInfo.isDir ? "dir" : "file"})`);
            } else if (rightInfo) {
                diffResults.push(`[ADDED] ${p} (${rightInfo.isDir ? "dir" : "file"})`);
            }
        }

        return diffResults.length > 0 
            ? `Folder diff between ${left} and ${right}:\n\n${diffResults.join("\n")}`
            : `Folders ${left} and ${right} are identical (recursive check).`;
    }

    let leftContent = left;
    let rightContent = right;
    let leftName = "left";
    let rightName = "right";

    if (resolvedType === "file") {
        leftContent = await fs.readFile(left, "utf8");
        rightContent = await fs.readFile(right, "utf8");
        leftName = path.basename(left);
        rightName = path.basename(right);
    }

    const patch = diff.createTwoFilesPatch(
        leftName,
        rightName,
        leftContent,
        rightContent,
        undefined,
        undefined,
        { context }
    );

    return patch || `Files are identical.`;
}
