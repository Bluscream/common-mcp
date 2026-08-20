import { runCommonMcp } from "./common";

async function testRegex() {
    console.log("Testing Regex Analyzer Tool...");

    // Test 1: Successful Match with named and numbered groups
    const matchReq = {
        method: "tools/call",
        params: {
            name: "regex",
            arguments: {
                pattern: "^https?:\\/\\/music\\.youtube\\.com\\/(?:watch|playlist)?\\?(?:.*?&)?v=(?<v>[^&]+)",
                text: "https://music.youtube.com/watch?v=5E_HWO-bvrc&list=PLeH1cMLIX19s"
            }
        }
    };
    const matchRes: any = await runCommonMcp([], matchReq);
    console.log("1. Match Result:\n", matchRes[matchRes.length - 1]?.result?.content?.[0]?.text);

    // Test 2: Failure Analysis (Non-matching string)
    const failReq = {
        method: "tools/call",
        params: {
            name: "regex",
            arguments: {
                pattern: "^https?:\\/\\/music\\.youtube\\.com",
                text: "https://my.domain/youtube.com"
            }
        }
    };
    const failRes: any = await runCommonMcp([], failReq);
    console.log("2. Failure Analysis Result:\n", failRes[failRes.length - 1]?.result?.content?.[0]?.text);

    // Test 3: Replacement
    const replaceReq = {
        method: "tools/call",
        params: {
            name: "regex",
            arguments: {
                pattern: "v=([^&]+)",
                text: "https://music.youtube.com/watch?v=5E_HWO-bvrc&list=PLeH1cMLIX19s",
                mode: "replace",
                replace: "v=REPLACED_ID"
            }
        }
    };
    const replaceRes: any = await runCommonMcp([], replaceReq);
    console.log("3. Replace Result:\n", replaceRes[replaceRes.length - 1]?.result?.content?.[0]?.text);
}

testRegex().catch(console.error);
