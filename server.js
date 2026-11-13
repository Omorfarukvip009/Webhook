const express = require('express');
const app = express();
app.use(express.json());

// Track active call states
const callStates = {};

const ENCODING_TABLE = {
    "0": "Zuri", "1": "Uni", "2": "Tuwi", "3": "Thuri", "4": "Furi",
    "5": "Fivi", "6": "Siji", "7": "Sivini", "8": "Eigti", "9": "Nini"
};

const WORD_TO_DIGIT = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9"
};

function extractAllDigits(text) {
    if (!text) return [];
    const textLower = text.toLowerCase();
    const regex = /\b(zero|one|two|three|four|five|six|seven|eight|nine|[0-9])\b/g;
    const matches = textLower.match(regex) || [];
    const digits = [];
    for (const m of matches) {
        if (!isNaN(m)) {
            digits.push(m);
        } else if (WORD_TO_DIGIT[m]) {
            digits.push(WORD_TO_DIGIT[m]);
        }
    }
    return digits;
}

app.post('/webhook', (req, res) => {
    try {
        const payload = req.body || {};
        const data = payload.data || payload;
        
        const callId = data.call_id || data.id;
        const transcript = data.transcript || data.text || "";
        
        if (!callId) {
            return res.json({ status: "ignored" });
        }

        const timestamp = new Date().toISOString();

        if (!callStates[callId]) {
            callStates[callId] = {
                call_id: callId,
                phase: 1, // Start strictly at Phase 1
                captured_digits: [],
                last_processed_text: "",
                transcript: transcript,
                status: "In Progress",
                updated_at: timestamp
            };
        }

        const state = callStates[callId];
        state.transcript = transcript;
        state.updated_at = timestamp;

        if (transcript === state.last_processed_text) {
            return res.json({ status: "no_change" });
        }
        
        state.last_processed_text = transcript;
        const allFoundDigits = extractAllDigits(transcript);

        // -------------------------------------------------------------
        // PHASE 1: DETECT AND PRESS THE FIRST DIGIT
        // -------------------------------------------------------------
        if (state.phase === 1) {
            if (allFoundDigits.length > 0) {
                const firstDigit = allFoundDigits[0];
                state.phase = 2; // Advance to Phase 2 ONLY after capturing/pressing the first digit
                
                // If extra digits were spoken in the same sentence, queue them for Phase 2
                const remainingDigits = allFoundDigits.slice(1);
                if (remainingDigits.length > 0) {
                    state.captured_digits.push(...remainingDigits);
                }

                console.log(`[Phase 1] Pressing first digit: ${firstDigit}`);

                // Return ONLY the press_digit action. DO NOT include end_call here.
                return res.json({
                    action: "press_digit",
                    digit: firstDigit,
                    text: ""
                });
            }
            // Keep listening silently if no digit is found yet
            return res.json({ text: "" });
        }

        // -------------------------------------------------------------
        // PHASE 2 & 3: CAPTURE NEXT 6 DIGITS & ENCODE
        // -------------------------------------------------------------
        else if (state.phase === 2) {
            const currentCount = state.captured_digits.length;
            const needed = 6 - currentCount;
            
            if (needed > 0 && allFoundDigits.length > 0) {
                // Ensure we pull new digits beyond what was already gathered
                const newDigits = allFoundDigits.slice(currentCount);
                if (newDigits.length > 0) {
                    state.captured_digits.push(...newDigits.slice(0, needed));
                }
            }

            console.log(`[Phase 2] Captured digits count: ${state.captured_digits.length}/6 -> [${state.captured_digits.join('')}]`);

            // Only trigger encoding and hanging up once we have EXACTLY 6 digits
            if (state.captured_digits.length >= 6) {
                const sixDigits = state.captured_digits.slice(0, 6);
                state.phase = 3;
                state.status = "Completed & Hung Up";
                
                const encodedWords = sixDigits.map(d => ENCODING_TABLE[d]).filter(Boolean);
                const responseText = encodedWords.join(" ");
                state.final_response = responseText;
                
                console.log(`[Phase 3] Speaking words and ending call: ${responseText}`);

                return res.json({
                    text: responseText,
                    end_call: true
                });
            } else {
                // Still collecting digits, stay silent
                return res.json({ text: "" });
            }
        }

        return res.json({ status: "ok" });

    } catch (e) {
        console.error("Webhook Error:", e);
        return res.status(500).json({ status: "error", message: e.message });
    }
});

// --- URL LOG VIEWER ENDPOINTS ---
app.get('/logs', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>AgentPhone Webhook Logs</title>
        <meta http-equiv="refresh" content="5">
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
            h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
            p { color: #94a3b8; font-size: 0.875rem; margin-bottom: 1.5rem; }
            table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }
            th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #334155; font-size: 0.9rem; }
            th { background: #334155; color: #e2e8f0; font-weight: 600; }
            tr:hover { background: #273548; }
            .badge-completed { background: #065f46; color: #34d399; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; }
            .badge-progress { background: #1e3a8a; color: #60a5fa; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; }
        </style>
    </head>
    <body>
        <h1>Live Webhook Call Logs (System Operational)</h1>
        <p>Auto-refreshes every 5 seconds. Showing active and recent call states.</p>
        <table>
            <thead>
                <tr>
                    <th>Call ID</th>
                    <th>Status / Phase</th>
                    <th>Captured Digits</th>
                    <th>Latest Transcript</th>
                    <th>Final Response Spoken</th>
                    <th>Last Updated</th>
                </tr>
            </thead>
            <tbody>
                ${Object.keys(callStates).length === 0 ? '<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 2rem;">No calls recorded yet. Place a test call to see logs here.</td></tr>' : 
                Object.entries(callStates).map(([cid, data]) => `
                    <tr>
                        <td><code>${cid}</code></td>
                        <td><span class="${data.phase === 3 ? 'badge-completed' : 'badge-progress'}">${data.status}</span></td>
                        <td><strong>${data.captured_digits.join('')}</strong></td>
                        <td>${data.transcript}</td>
                        <td><span style="color: #38bdf8;">${data.final_response || '-'}</span></td>
                        <td>${data.updated_at}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    </body>
    </html>
    `;
    res.send(html);
});

app.get('/logs/json', (req, res) => {
    res.json(callStates);
});

app.get('/health', (req, res) => {
    res.json({ status: "healthy", system: "operational" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
