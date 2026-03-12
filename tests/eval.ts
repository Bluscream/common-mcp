import { runCommonMcp } from "./common";

async function testEval() {
    console.log("Testing Eval (Node)...");
    const evalReq = {
        method: "tools/call",
        params: {
            name: "eval",
            arguments: {
                language: "node",
                code: "console.log(1 + 2)"
            }
        }
    };
    const evalRes: any = await runCommonMcp([], evalReq);
    console.log("Eval Result:", evalRes[evalRes.length - 1]?.result?.content?.[0]?.text);
}

testEval().catch(console.error);
