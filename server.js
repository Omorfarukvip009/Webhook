const express = require("express");
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// ──────────────────────────────────────────────
//  IN-MEMORY LOG STORAGE (Last 100 logs)
// ──────────────────────────────────────────────
const logHistory = [];

function addLog(type, data) {
  const entry = {
    time: new Date().toISOString(),
    type,
    data,
  };
  // 1. Print to Render Console Logs
  console.log(`[${entry.time}] [${type}]`, JSON.stringify(data));

  // 2. Save for /logs webpage
  logHistory.unshift(entry);
  if (logHistory.length > 100) logHistory.pop();
}

// ──────────────────────────────────────────────
//  ENCODED WORDS (0–9)
// ──────────────────────────────────────────────
const ENCODED = {
  "0": "Zuri",
  "1": "Uni",
  "2": "Tuwi",
  "3": "Thuri",
  "4": "Furi",
  "5": "Fivi",
  "6": "Siji",
  "7": "Sivini",
  "8": "Eigti",
  "9": "Nini",
};

function speakEncoded(digits) {
  return digits
    .split("")
    .map((d) => ENCODED[d] || d)
    .join(", ");
}

// ──────────────────────────────────────────────
//  STRICT NUMBER WORDS ONLY
// ──────────────────────────────────────────────
const WORDS = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

function extractDigits(transcript) {
  if (!transcript) return "";
  const tokens = transcript.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let out = "";
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      out += t;
    } else if (WORDS[t]) {
      out += WORDS[t];
    }
  }
  return out;
}

function extractPressDigit(transcript) {
  if (!transcript) return null;
  const match = transcript
    .toLowerCase()
    .match(/\b(?:press|dial|enter|push)\s+([0-9]|zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/);

  if (match && match[1]) {
    const token = match[1];
    return /^\d$/.test(token) ? token : WORDS[token] || null;
  }
  return null;
}

// ──────────────────────────────────────────────
//  CALL STATE
// ──────────────────────────────────────────────
const calls = new Map();

function getState(callId) {
  if (!calls.has(callId)) {
    calls.set(callId, {
      pressedFirst: false,
      codeDigits: "",
      ts: Date.now(),
    });
  }
  const s = calls.get(callId);
  s.ts = Date.now();
  return s;
}

setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [id, s] of calls) {
    if (s.ts < cutoff) calls.delete(id);
  }
}, 60 * 1000);

// ──────────────────────────────────────────────
//  MAIN WEBHOOK  POST /webhook
// ──────────────────────────────────────────────
app.post("/webhook", (req, res) => {
  const body = req.body || {};

  // Log raw incoming request from AgentPhone
  addLog("INCOMING_WEBHOOK", body);

  const event = body.event || "";
  if (event && !/message/i.test(event)) {
    addLog("IGNORED_EVENT", { event });
    return res.json({});
  }

  const data = body.data || body;
  const callId =
    data.callId ||
    data.call_id ||
    body.callId ||
    body.sessionId ||
    "default";

  const transcript = data.transcript || data.text || "";
  const state = getState(callId);

  // ── PHASE 1: Press the first digit the IVR asks for ──
  if (!state.pressedFirst) {
    let firstDigit = extractPressDigit(transcript);
    const allDigits = extractDigits(transcript);

    if (!firstDigit && allDigits.length > 0) {
      firstDigit = allDigits[0];
    }

    if (!firstDigit) {
      addLog("NO_DIGIT_FOUND_PHASE_1", { callId, transcript });
      return res.json({});
    }

    state.pressedFirst = true;
    const response = { digits: firstDigit };

    addLog("PRESSED_FIRST_DIGIT", { callId, transcript, response });
    return res.json(response);
  }

  // ── PHASE 2: Capture the next 6 digits & speak encoded ──
  const digits = extractDigits(transcript);
  if (!digits) {
    addLog("NO_DIGIT_FOUND_PHASE_2", { callId, transcript });
    return res.json({});
  }

  state.codeDigits += digits;
  addLog("ACCUMULATING_DIGITS", {
    callId,
    transcript,
    newDigits: digits,
    totalCollected: state.codeDigits,
  });

  if (state.codeDigits.length >= 6) {
    const sixDigits = state.codeDigits.slice(0, 6);
    state.codeDigits = "";
    const response = { text: speakEncoded(sixDigits) };

    addLog("SPOKE_ENCODED_DIGITS", { callId, sixDigits, response });
    return res.json(response);
  }

  return res.json({});
});

// ──────────────────────────────────────────────
//  VIEW LOGS IN BROWSER:  GET /logs
// ──────────────────────────────────────────────
app.get("/logs", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Webhook Logs</title>
      <meta http-equiv="refresh" content="3">
      <style>
        body { background: #111; color: #0f0; font-family: monospace; padding: 20px; }
        .entry { border-bottom: 1px solid #333; padding: 10px 0; }
        .time { color: #888; }
        .type { color: #ff0; font-weight: bold; }
        pre { margin: 5px 0 0 0; color: #fff; white-space: pre-wrap; }
      </style>
    </head>
    <body>
      <h2>📡 AgentPhone Webhook Live Logs (Auto-refreshes every 3s)</h2>
      <p><a href="/logs/clear" style="color:#f55;">[Clear Logs]</a></p>
      ${
        logHistory.length === 0
          ? "<p>No webhook requests received yet...</p>"
          : logHistory
              .map(
                (l) => `
          <div class="entry">
            <span class="time">${l.time}</span> 
            <span class="type">[${l.type}]</span>
            <pre>${JSON.stringify(l.data, null, 2)}</pre>
          </div>`
              )
              .join("")
      }
    </body>
    </html>
  `);
});

// Clear logs endpoint
app.get("/logs/clear", (req, res) => {
  logHistory.length = 0;
  res.redirect("/logs");
});

// ──────────────────────────────────────────────
//  HEALTH CHECK
// ──────────────────────────────────────────────
app.get("/", (_, res) => res.send("OK - Visit /logs to see webhook activity"));

app.listen(PORT, () => console.log(`Webhook running on port ${PORT}`));
