import { performance } from "perf_hooks";

export interface RegexArgs {
    pattern: string;
    text: string;
    flags?: string;
    mode?: "match" | "test" | "replace" | "split";
    replace?: string;
}

export interface RegexMatchDetail {
    matchIndex: number;
    matchedText: string;
    startIndex: number;
    endIndex: number;
    length: number;
    line: number;
    column: number;
    namedGroups: Record<string, string | null> | null;
    numberedGroups: (string | null)[];
}

export interface FailureAnalysis {
    reason: string;
    positionsTested: number;
    furthestReachedIndex?: number;
    furthestReachedPosition?: { line: number; column: number };
    mismatchHint?: string;
}

function getPosition(content: string, index: number): { line: number; column: number } {
    let line = 1;
    let lastLineBreak = -1;
    for (let i = 0; i < index && i < content.length; i++) {
        if (content[i] === "\n") {
            line++;
            lastLineBreak = i;
        }
    }
    const column = index - lastLineBreak;
    return { line, column };
}

function analyzeFailure(pattern: string, flags: string, text: string): FailureAnalysis {
    const positionsTested = text.length + 1;

    // Check if regex compilation fails or has issue
    if (text.length === 0) {
        return {
            reason: "Input text is empty",
            positionsTested: 1,
        };
    }

    // Try finding partial prefix matches to estimate how far matching progressed
    let maxMatchLen = 0;
    let furthestIdx = 0;

    for (let len = text.length - 1; len > 0; len--) {
        const sub = text.substring(0, len);
        try {
            // Check unanchored subpattern match
            const subRegex = new RegExp(pattern.startsWith("^") ? pattern.slice(1) : pattern, flags);
            if (subRegex.test(sub)) {
                maxMatchLen = len;
                furthestIdx = len;
                break;
            }
        } catch {
            // ignore subpattern errors
        }
    }

    let hint = "Pattern did not match anywhere in the input string.";
    if (pattern.startsWith("^")) {
        // Compare beginning of text with literal prefix of regex if present
        const literalPrefixMatch = pattern.match(/^\^([a-zA-Z0-9:\/\.\-_]+)/);
        if (literalPrefixMatch) {
            const expected = literalPrefixMatch[1];
            let mismatchIndex = 0;
            while (
                mismatchIndex < expected.length &&
                mismatchIndex < text.length &&
                expected[mismatchIndex] === text[mismatchIndex]
            ) {
                mismatchIndex++;
            }
            if (mismatchIndex < expected.length) {
                hint = `Mismatch near index ${mismatchIndex}: expected prefix '${expected}' but text had '${text.substring(0, mismatchIndex + 5)}'`;
                furthestIdx = mismatchIndex;
            }
        }
    }

    const pos = getPosition(text, furthestIdx);

    return {
        reason: hint,
        positionsTested,
        furthestReachedIndex: furthestIdx,
        furthestReachedPosition: pos,
    };
}

export async function handleRegex(args: RegexArgs): Promise<string> {
    const {
        pattern,
        text,
        flags = "g",
        mode = "match",
        replace,
    } = args;

    if (text === undefined || text === null) {
        throw new Error("The 'text' argument is required for regex evaluation.");
    }

    const startTime = performance.now();

    let regex: RegExp;
    try {
        regex = new RegExp(pattern, flags);
    } catch (err: any) {
        return JSON.stringify({
            pattern,
            flags,
            isMatch: false,
            syntaxError: true,
            error: err.message,
        }, null, 2);
    }

    if (mode === "split") {
        const parts = text.split(regex);
        const endTime = performance.now();
        return JSON.stringify({
            pattern,
            flags,
            executionTimeMs: Number((endTime - startTime).toFixed(3)),
            splitResult: {
                partsCount: parts.length,
                parts,
            },
        }, null, 2);
    }

    if (mode === "replace") {
        if (replace === undefined) {
            throw new Error("'replace' argument is required when mode is 'replace'.");
        }
        let replacedCount = 0;
        const searchRegex = flags.includes("g") ? regex : new RegExp(pattern, flags + "g");
        const matchesArr = text.match(searchRegex);
        replacedCount = matchesArr ? matchesArr.length : 0;

        const output = text.replace(regex, replace);
        const endTime = performance.now();

        return JSON.stringify({
            pattern,
            flags,
            executionTimeMs: Number((endTime - startTime).toFixed(3)),
            replaceResult: {
                replacedCount,
                output,
            },
        }, null, 2);
    }

    // Default mode: "match" or "test"
    const searchRegex = flags.includes("g") ? regex : new RegExp(pattern, flags + "g");
    const matches: RegexMatchDetail[] = [];

    let matchObj: RegExpExecArray | null;
    let count = 0;

    while ((matchObj = searchRegex.exec(text)) !== null) {
        count++;
        const startIndex = matchObj.index;
        const matchedText = matchObj[0];
        const endIndex = startIndex + matchedText.length;
        const pos = getPosition(text, startIndex);

        let namedGroups: Record<string, string | null> | null = null;
        if (matchObj.groups && Object.keys(matchObj.groups).length > 0) {
            namedGroups = {};
            for (const key of Object.keys(matchObj.groups)) {
                namedGroups[key] = matchObj.groups[key] !== undefined ? matchObj.groups[key] : null;
            }
        }

        const numberedGroups: (string | null)[] = [];
        for (let i = 1; i < matchObj.length; i++) {
            numberedGroups.push(matchObj[i] !== undefined ? matchObj[i] : null);
        }

        matches.push({
            matchIndex: count,
            matchedText,
            startIndex,
            endIndex,
            length: matchedText.length,
            line: pos.line,
            column: pos.column,
            namedGroups,
            numberedGroups,
        });

        // Prevent infinite loop on zero-width matches
        if (matchObj.index === searchRegex.lastIndex) {
            searchRegex.lastIndex++;
        }
    }

    const endTime = performance.now();
    const executionTimeMs = Number((endTime - startTime).toFixed(3));
    const isMatch = matches.length > 0;

    const result: any = {
        pattern,
        flags,
        isMatch,
        matchCount: matches.length,
        executionTimeMs,
        matches,
    };

    if (!isMatch) {
        result.failureAnalysis = analyzeFailure(pattern, flags, text);
    }

    return JSON.stringify(result, null, 2);
}
