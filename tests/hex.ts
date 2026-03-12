import { runCommonMcp } from "./common";
import * as fs from "fs/promises";

async function testHex() {
    console.log("Testing Hex (Write/Read)...");
    const testHexFile = "p:\\MCPs\\common-mcp\\hex_test.bin";
    const hexWriteReq = {
        method: "tools/call",
        params: {
            name: "hex",
            arguments: {
                mode: "write",
                path: testHexFile,
                hexData: "48656c6c6f" // "Hello"
            }
        }
    };
    await runCommonMcp([], hexWriteReq);
    
    const hexReadReq = {
        method: "tools/call",
        params: {
            name: "hex",
            arguments: {
                mode: "read",
                path: testHexFile
            }
        }
    };
    const hexReadRes: any = await runCommonMcp([], hexReadReq);
    console.log("Hex Read Result:", hexReadRes[hexReadRes.length - 1]?.result?.content?.[0]?.text);

    await fs.unlink(testHexFile).catch(() => {});
}

testHex().catch(console.error);
