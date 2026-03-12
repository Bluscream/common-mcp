import { promises as fs } from "fs";
import { fileTypeFromBuffer } from "file-type";

export interface HexArgs {
    mode: "read" | "write";
    path: string;
    offset?: number;
    length?: number;
    hexData?: string;
    searchHex?: string;
    replaceHex?: string;
}

export async function handleHex(args: HexArgs) {
    const { mode, path, offset, length, hexData, searchHex, replaceHex } = args;

    if (mode === "read") {
        let buffer = await fs.readFile(path);
        const originalLength = buffer.length;
        const fileType = await fileTypeFromBuffer(buffer);

        const currentOffset = offset || 0;
        if (currentOffset !== 0 || length !== undefined) {
            buffer = buffer.subarray(currentOffset, length ? currentOffset + length : undefined);
        }

        return JSON.stringify({
            fileType: fileType || "unknown",
            readLength: buffer.length,
            totalLength: originalLength,
            hex: buffer.toString("hex"),
        }, null, 2);
    }

    if (mode === "write") {
        if (searchHex) {
            let buffer = await fs.readFile(path);
            const searchBuffer = Buffer.from(searchHex, "hex");
            const replacementBuffer = Buffer.from(replaceHex || hexData || "", "hex");

            let index = 0;
            let count = 0;
            const resultBuffers: Buffer[] = [];
            let lastMatchEnd = 0;

            while ((index = buffer.indexOf(searchBuffer, lastMatchEnd)) !== -1) {
                resultBuffers.push(buffer.subarray(lastMatchEnd, index));
                resultBuffers.push(replacementBuffer);
                lastMatchEnd = index + searchBuffer.length;
                count++;
            }
            resultBuffers.push(buffer.subarray(lastMatchEnd));

            const finalBuffer = Buffer.concat(resultBuffers);
            await fs.writeFile(path, finalBuffer);

            return `Successfully replaced ${count} occurrences of ${searchHex}. File length changed from ${buffer.length} to ${finalBuffer.length}.`;
        }

        if (offset !== undefined) {
            if (!hexData) throw new Error("hexData is required for patching");
            const patchBuffer = Buffer.from(hexData, "hex");
            const fileHandle = await fs.open(path, "r+");
            try {
                await fileHandle.write(patchBuffer, 0, patchBuffer.length, offset);
            } finally {
                await fileHandle.close();
            }
            return `Successfully patched ${patchBuffer.length} bytes at offset ${offset}.`;
        }

        if (!hexData) throw new Error("hexData is required for writing");
        const buffer = Buffer.from(hexData, "hex");
        await fs.writeFile(path, buffer);
        const fileType = await fileTypeFromBuffer(buffer);

        return `Successfully wrote ${buffer.length} bytes. Detected type: ${fileType?.ext || "unknown"}`;
    }

    throw new Error(`Invalid hex mode: ${mode}`);
}
