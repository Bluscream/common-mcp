import { promises as fs } from "fs";
import * as diff from "diff";
import * as path from "path";

export interface DiffArgs {
    left: string;
    right: string;
    type?: "string" | "file" | "auto";
    context?: number;
}

async function isExistingFile(p: string): Promise<boolean> {
    try {
        const stats = await fs.stat(p);
        return stats.isFile();
    } catch {
        return false;
    }
}

export async function handleDiff(args: DiffArgs) {
    const { left, right, type = "auto", context = 3 } = args;

    let leftContent = left;
    let rightContent = right;
    let leftName = "left";
    let rightName = "right";

    let resolvedType = type;
    if (type === "auto") {
        const leftIsFile = await isExistingFile(left);
        const rightIsFile = await isExistingFile(right);
        resolvedType = (leftIsFile && rightIsFile) ? "file" : "string";
    }

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

    return patch || "(no differences found)";
}
