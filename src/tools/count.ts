import { promises as fs } from "fs";
import * as path from "path";
import { glob } from "glob";

export interface CountArgs {
    path?: string;
    recursive?: boolean;
    text?: string;
    types: string[];
    timeout?: number;
}

export async function handleCount(args: CountArgs) {
    const { path: p, recursive, text, types } = args;

    const results: Record<string, number> = {};
    for (const type of types) {
        results[type] = 0;
    }

    if (text !== undefined) {
        if (types.includes("lines")) results.lines = text.split(/\r?\n/).length;
        if (types.includes("words")) results.words = text.trim().split(/\s+/).filter(w => w).length;
        if (types.includes("chars")) results.chars = text.length;
        if (types.includes("bytes")) results.bytes = Buffer.byteLength(text, "utf8");
        return JSON.stringify(results, null, 2);
    }

    if (p) {
        const stats = await fs.stat(p);
        if (stats.isFile()) {
            const content = await fs.readFile(p, "utf8");
            const buffer = await fs.readFile(p);
            if (types.includes("lines")) results.lines = content.split(/\r?\n/).length;
            if (types.includes("words")) results.words = content.trim().split(/\s+/).filter(w => w).length;
            if (types.includes("chars")) results.chars = content.length;
            if (types.includes("bytes")) results.bytes = buffer.length;
            if (types.includes("files")) results.files = 1;
            if (types.includes("items")) results.items = 1;
        } else if (stats.isDirectory()) {
            const options: any = { cwd: p, absolute: true };
            if (!recursive) {
                // To only get top-level items, we can use a more specific glob or list_dir equivalent.
                // Glob v10 supports maxDepth.
                options.maxDepth = 2; // depth 1 is the dir itself, 2 is its immediate children
            }
            
            const allItems = await glob("**/*", options);
            // items include files and folders
            for (const item of allItems) {
                if (item === p) continue;
                const itemStats = await fs.stat(item);
                if (itemStats.isFile()) {
                    if (types.includes("files")) results.files++;
                    if (types.includes("items")) results.items++;
                    
                    if (types.includes("lines") || types.includes("words") || types.includes("chars") || types.includes("bytes")) {
                        const content = await fs.readFile(item, "utf8");
                        if (types.includes("lines")) results.lines += content.split(/\r?\n/).length;
                        if (types.includes("words")) results.words += content.trim().split(/\s+/).filter(w => w).length;
                        if (types.includes("chars")) results.chars += content.length;
                        if (types.includes("bytes")) results.bytes += (await fs.readFile(item)).length;
                    }
                } else if (itemStats.isDirectory()) {
                    if (types.includes("folders")) results.folders++;
                    if (types.includes("items")) results.items++;
                }
            }
        }
        return JSON.stringify(results, null, 2);
    }

    throw new Error("Either 'path' or 'text' must be provided.");
}
