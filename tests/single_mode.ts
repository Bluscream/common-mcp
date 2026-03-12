import { runCommonMcp } from "./common";

async function testSingleMode() {
    console.log("Testing Single Tool Mode...");
    const singleReq = {
        method: "tools/call",
        params: {
            name: "common",
            arguments: {
                tool: "eval",
                arguments: {
                    language: "node",
                    code: "console.log('Single tool mode works')"
                }
            }
        }
    };
    const singleRes: any = await runCommonMcp(["--single-tool"], singleReq);
    console.log("Single Tool Result:", singleRes[singleRes.length - 1]?.result?.content?.[0]?.text);
}

testSingleMode().catch(console.error);
