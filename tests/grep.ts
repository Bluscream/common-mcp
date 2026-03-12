import { runCommonMcp } from "./common";

async function testGrep() {
    console.log("Testing Grep...");
    const grepReq = {
        method: "tools/call",
        params: {
            name: "grep",
            arguments: {
                paths: ["p:\\MCPs\\common-mcp\\src"],
                pattern: "handleGrep",
                type: "string"
            }
        }
    };
    const grepRes: any = await runCommonMcp([], grepReq);
    console.log("Grep Result:", JSON.stringify(grepRes[grepRes.length - 1]?.result?.content?.[0]?.text).slice(0, 100) + "...");
}

testGrep().catch(console.error);
