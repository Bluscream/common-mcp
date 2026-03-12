import { runCommonMcp } from "./common";

async function testCount() {
    console.log("Testing Count...");
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
}

testCount().catch(console.error);
