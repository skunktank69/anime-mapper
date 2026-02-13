import axios from 'axios';
import { client } from '../utils/client.js';

class MegaCloudExtractor {
    constructor() {
        this.mainUrl = "https://megacloud.blog";
        this.scriptUrl = "https://script.google.com/macros/s/AKfycbxHbYHbrGMXYD2-bC-C43D3njIbU-wGiYQuJL61H4vyy6YVXkybMNNEPJNPPuZrD1gRVA/exec";
        this.keysUrl = "https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json";
    }

    async extract(videoUrl) {
        try {
            const embedUrl = new URL(videoUrl);
            const headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.5",
                "Origin": this.mainUrl,
                "Referer": `${this.mainUrl}/`,
            };

            // 1. Fetch Embed Page
            const { data: html } = await client.get(videoUrl, { headers });

            // 2. Extract Nonce
            let nonce = null;
            const match1 = html.match(/\b[a-zA-Z0-9]{48}\b/);
            if (match1) {
                nonce = match1[0];
            } else {
                const match2 = html.match(/\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b/);
                if (match2) {
                    nonce = match2[1] + match2[2] + match2[3];
                }
            }

            if (!nonce) throw new Error("Nonce not found");

            // 3. Get Sources
            // e.g. https://megacloud.blog/embed-2/e-1/VJq4nDSaJyzH?k=1 -> ID: VJq4nDSaJyzH
            const id = embedUrl.pathname.split('/').pop();

            const apiUrl = `${this.mainUrl}/embed-2/v3/e-1/getSources?id=${id}&_k=${nonce}`;
            const { data: response } = await client.get(apiUrl, {
                headers: {
                    ...headers,
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": this.mainUrl
                }
            });

            if (!response.sources || response.sources.length === 0) {
                throw new Error("No sources found");
            }

            const encodedFile = response.sources[0].file;
            let m3u8Url = "";

            if (encodedFile.includes(".m3u8")) {
                m3u8Url = encodedFile;
            } else {
                // 4. Decrypt via Google Script
                const { data: keyData } = await axios.get(this.keysUrl);
                const secret = keyData.mega;

                const params = new URLSearchParams();
                params.append("encrypted_data", encodedFile);
                params.append("nonce", nonce);
                params.append("secret", secret);

                const decryptUrl = `${this.scriptUrl}?${params.toString()}`;

                // Fetch text response
                const { data: decryptedResponse } = await axios.get(decryptUrl, { responseType: 'text' });

                // Kotlin Regex: "\"file\":\"(.*?)\""
                // Handling potentially weird JSON structure or escaped strings
                const textContent = typeof decryptedResponse === 'string' ? decryptedResponse : JSON.stringify(decryptedResponse);
                const fileMatch = textContent.match(/"file":"(.*?)"/);

                if (fileMatch && fileMatch[1]) {
                    // Clean up URL if needed (remove escape slashes)
                    m3u8Url = fileMatch[1].replace(/\\/g, '');
                } else {
                    throw new Error("Video URL not found in decrypted response");
                }
            }

            // 5. Build Result
            const tracks = [];
            if (response.tracks) {
                response.tracks.forEach(track => {
                    if (track.kind === "captions" || track.kind === "subtitles") {
                        tracks.push({
                            url: track.file,
                            lang: track.label || track.kind,
                            label: track.label
                        });
                    }
                });
            }

            return {
                sources: [{
                    url: m3u8Url,
                    isM3U8: true
                }],
                tracks: tracks,
                intro: response.intro || { start: 0, end: 0 },
                outro: response.outro || { start: 0, end: 0 },
                headers: {
                    Referer: this.mainUrl,
                    "User-Agent": headers["User-Agent"]
                }
            };

        } catch (error) {
            console.error("MegaCloud extraction failed:", error.message);
            throw error;
        }
    }
}

export const megaCloudExtractor = new MegaCloudExtractor();
