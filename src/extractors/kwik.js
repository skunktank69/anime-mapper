import axios from 'axios';

const kwikUserAgent = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36";

export async function extractKwik(kwikUrl, referer) {
    if (!kwikUrl) {
        throw new Error("missing kwik URL");
    }

    try {
        const urlObj = new URL(kwikUrl);
        // Always use the origin of the kwik URL as Referer, regardless of passed-in value
        // mimicking: if u, err := url.Parse(kwikURL); err == nil { referer = u.Scheme + "://" + u.Host + "/" }
        const refinedReferer = `${urlObj.protocol}//${urlObj.host}/`;

        const response = await axios.get(kwikUrl, {
            headers: {
                'User-Agent': kwikUserAgent,
                'Referer': refinedReferer,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            }
        });

        const html = response.data;

        // Find the packed eval JS - look for eval(...) containing m3u8
        const jsMatch = html.match(/;(eval\(function\(p,a,c,k,e,d\).*?m3u8.*?\)\))/);
        if (!jsMatch || jsMatch.length < 2) {
            throw new Error("could not find eval JS pattern in Kwik page");
        }

        const jsCode = jsMatch[1];

        const lastBraceIdx = jsCode.lastIndexOf("}(");
        if (lastBraceIdx === -1) {
            throw new Error("could not find argument start marker '}('");
        }

        const endIdx = jsCode.lastIndexOf("))");
        if (endIdx === -1 || endIdx <= lastBraceIdx) {
            throw new Error("could not find argument end marker '))'");
        }

        const stripped = jsCode.substring(lastBraceIdx + 2, endIdx);

        const parts = parsePackedArgs(stripped);
        if (parts.length < 4) {
            throw new Error(`invalid packed data: expected at least 4 parts, got ${parts.length}`);
        }

        const p = parts[0];
        const a = parseInt(parts[1], 10);
        const c = parseInt(parts[2], 10);

        let kStr = parts[3];
        kStr = kStr.replace(/\.split\(['"]\|['"]\)$/, "");
        const k = kStr.split("|");

        let decoded = unpackKwik(p, a, c, k);

        decoded = decoded.replace(/\\/g, "");
        decoded = decoded.replace("https.split(://", "https://");
        decoded = decoded.replace("http.split(://", "http://");

        const srcMatch = decoded.match(/source=(https?:\/\/[^;]+)/);
        if (!srcMatch || srcMatch.length < 2) {
            throw new Error("could not find video URL in unpacked code");
        }

        const videoURL = cleanKwikURL(srcMatch[1]);
        return {
            url: videoURL,
            isM3U8: videoURL.includes(".m3u8"),
        };

    } catch (error) {
        throw error;
    }
}

function unpackKwik(p, a, c, k) {
    const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
    const dict = {};

    function baseEncode(n) {
        const rem = n % a;
        let digit;
        if (rem > 35) {
            digit = String.fromCharCode(rem + 29);
        } else {
            digit = digits[rem];
        }

        if (n < a) {
            return digit;
        }
        return baseEncode(Math.floor(n / a)) + digit;
    }

    for (let i = c - 1; i >= 0; i--) {
        const key = baseEncode(i);
        if (i < k.length && k[i] !== "") {
            dict[key] = k[i];
        } else {
            dict[key] = key;
        }
    }

    // Use regex to replace words
    return p.replace(/\b\w+\b/g, (w) => {
        if (Object.prototype.hasOwnProperty.call(dict, w)) {
            return dict[w];
        }
        return w;
    });
}

function parsePackedArgs(input) {
    const result = [];
    let inQuote = false;
    let quoteChar = null;
    let depth = 0;
    let current = "";

    for (let i = 0; i < input.length; i++) {
        const r = input[i];

        if (!inQuote) {
            if (r === '\'' || r === '"') {
                inQuote = true;
                quoteChar = r;
                // Don't add quote to current, mimicking Go logic 'continue'
                continue;
            }
            if (r === ',' && depth === 0) {
                result.push(current.trim());
                current = "";
                continue;
            }
            if (r === '(' || r === '[' || r === '{') {
                depth++;
            } else if (r === ')' || r === ']' || r === '}') {
                if (depth > 0) {
                    depth--;
                }
            }
        } else {
            if (r === quoteChar) {
                inQuote = false;
                // Don't add quote to current
                continue;
            }
        }
        current += r;
    }
    if (current !== "") {
        result.push(current.trim());
    }
    return result;
}

function cleanKwikURL(u) {
    u = u.replace(/\\\//g, "/");
    u = u.replace(/^["']|["']$/g, ''); // Trim quotes
    u = u.replace(/[\n\r\t ]/g, ''); // Trim whitespace chars

    // Remove semicolon and anything after it
    const idx = u.indexOf(";");
    if (idx !== -1) {
        u = u.substring(0, idx);
    }
    return u;
}
