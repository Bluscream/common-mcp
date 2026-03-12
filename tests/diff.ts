import { runCommonMcp } from "./common";
import * as fs from "fs/promises";
import * as path from "path";

async function testDiff() {
    console.log("Testing String Diff...");
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
    console.log("String Diff Result:", diffRes[diffRes.length - 1]?.result?.content?.[0]?.text);

    console.log("\nTesting Folder Diff...");
    const tmpDirA = path.join("p:\\MCPs\\common-mcp", "tmp_test_a");
    const tmpDirB = path.join("p:\\MCPs\\common-mcp", "tmp_test_b");

    await fs.mkdir(tmpDirA, { recursive: true });
    await fs.mkdir(tmpDirB, { recursive: true });

    await fs.writeFile(path.join(tmpDirA, "diff.txt"), "content A");
    await fs.writeFile(path.join(tmpDirB, "diff.txt"), "content B");
    await fs.writeFile(path.join(tmpDirA, "only_a.txt"), "only A");
    await fs.writeFile(path.join(tmpDirB, "only_b.txt"), "only B");

    const folderDiffReq = {
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

    const folderDiffRes: any = await runCommonMcp([], folderDiffReq);
    console.log("Folder Diff Result:\n", folderDiffRes[folderDiffRes.length - 1]?.result?.content?.[0]?.text);

    await fs.rm(tmpDirA, { recursive: true, force: true });
    await fs.rm(tmpDirB, { recursive: true, force: true });
}

testDiff().catch(console.error);
