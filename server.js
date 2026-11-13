const express = require("express");
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// Wait 1000ms (1 second) before pressing the digit so the IVR finishes talking
const DTMF_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ──────────────────────────────────────────────
//  STRUCTURED LOG STORAGE (Last 100 events)
// ──────────────────────────────────────────────
const logHistory = [];
const stats = {
  totalRequests: 0,
  digitsPressed: 0,
  codesSpoken: 0,
};

function addLog({
  badge,
  color,
  title,
  callId = "—",
  transcript = "",
  pressedDigit = "",
  collectedDigits = "",
  encodedText = "",
  raw = {},
}) {
  const entry = {
    id: Date.now() + Math.random().toString(36).slice(2, 6),
    time: new Date().toISOString(),
    badge,
    color,
    title,
    callId,
    transcript,
    pressedDigit,
    collectedDigits,
    encodedText,
    raw,
  };

  console.log(`[${entry.time}] [${badge}] ${title} (Call: ${callId})`);
  logHistory.unshift(entry);
  if (logHistory.length > 100) logHistory.pop();
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

// Detects "press nine", "press 9", "dial 1", etc.
function extractPressDigit(transcript) {
  if (!transcript) return null;
  const match = transcript
    .toLowerCase()
    .match(
      /\b(?:press|dial|enter|push|key)\s+(?:number\s+|digit\s+|the\s+)?([0-9]|zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/
    );

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
app.post("/webhook", async (req, res) => {
  const body = req.body || {};
  stats.totalRequests++;

  const event = body.event || "";
  const data = body.data || body;
  const callId =
    data.callId ||
    data.call_id ||
    body.callId ||
    body.sessionId ||
    "default";

  // Ignore non-message events
  if (event && !/message/i.test(event)) {
    addLog({
      badge: "EVENT",
      color: "gray",
      title: `System Event: ${event}`,
      callId,
      raw: body,
    });
    return res.json({});
  }

  const transcript = data.transcript || data.text || "";
  const state = getState(callId);

  // ── 1. ALWAYS check if IVR explicitly says "press [digit]" ──
  // (Even if it repeats the prompt, we will press it again!)
  const explicitPressDigit = extractPressDigit(transcript);

  if (explicitPressDigit) {
    state.pressedFirst = true;
    stats.digitsPressed++;

    // Wait 1 second so the IVR finishes its sentence and listens for DTMF
    await sleep(DTMF_DELAY_MS);

    // Send all 3 valid AgentPhone DTMF fields for maximum compatibility
    const response = {
      digits: explicitPressDigit,
      press_digit: explicitPressDigit,
      dtmf: explicitPressDigit,
    };

    addLog({
      badge: "DTMF PRESSED",
      color: "amber",
      title: `Pressed keypad digit "${explicitPressDigit}" (after ${DTMF_DELAY_MS}ms delay)`,
      callId,
      transcript,
      pressedDigit: explicitPressDigit,
      raw: { request: body, response },
    });

    return res.json(response);
  }

  // ── 2. Fallback: If first digit hasn't been pressed yet & caller/IVR just said a number ──
  if (!state.pressedFirst) {
    const allDigits = extractDigits(transcript);

    if (allDigits.length === 0) {
      addLog({
        badge: "LISTENING",
        color: "blue",
        title: "Speech received (waiting for first digit to press)",
        callId,
        transcript,
        raw: body,
      });
      return res.json({});
    }

    const firstDigit = allDigits[0];
    state.pressedFirst = true;
    stats.digitsPressed++;

    await sleep(DTMF_DELAY_MS);

    const response = {
      digits: firstDigit,
      press_digit: firstDigit,
      dtmf: firstDigit,
    };

    addLog({
      badge: "DTMF PRESSED",
      color: "amber",
      title: `Pressed keypad digit "${firstDigit}" (after ${DTMF_DELAY_MS}ms delay)`,
      callId,
      transcript,
      pressedDigit: firstDigit,
      raw: { request: body, response },
    });

    return res.json(response);
  }

  // ── 3. PHASE 2: Capture the next 6 digits & speak encoded ──
  const digits = extractDigits(transcript);
  if (!digits) {
    addLog({
      badge: "LISTENING",
      color: "blue",
      title: "Speech received (no code digits detected)",
      callId,
      transcript,
      raw: body,
    });
    return res.json({});
  }

  state.codeDigits += digits;

  if (state.codeDigits.length >= 6) {
    const sixDigits = state.codeDigits.slice(0, 6);
    state.codeDigits = "";
    const encodedText = speakEncoded(sixDigits);
    const response = { text: encodedText };
    stats.codesSpoken++;

    addLog({
      badge: "SPOKE ENCODED",
      color: "green",
      title: "Captured 6-digit code & spoke encoded words",
      callId,
      transcript,
      collectedDigits: sixDigits,
      encodedText,
      raw: { request: body, response },
    });

    return res.json(response);
  }

  addLog({
    badge: "COLLECTING",
    color: "purple",
    title: `Collecting code digits (${state.codeDigits.length}/6 captured)`,
    callId,
    transcript,
    collectedDigits: state.codeDigits,
    raw: body,
  });

  return res.json({});
});

// ──────────────────────────────────────────────
//  PROFESSIONAL DASHBOARD:  GET /logs
// ──────────────────────────────────────────────
app.get("/logs", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AgentPhone Webhook Dashboard</title>
  <style>
    :root {
      --bg: #09090b;
      --card: #121216;
      --card-border: #27272a;
      --text: #f4f4f5;
      --muted: #a1a1aa;
      --blue: #3b82f6;
      --amber: #f59e0b;
      --green: #10b981;
      --purple: #8b5cf6;
      --gray: #71717a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 28px 20px;
      max-width: 1050px;
      margin: 0 auto;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      padding-bottom: 22px;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 24px;
    }
    .title-group h1 {
      font-size: 22px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      background: var(--green);
      border-radius: 50%;
      box-shadow: 0 0 10px var(--green);
    }
    .title-group p { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .actions { display: flex; gap: 10px; }
    .btn {
      padding: 9px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      border: 1px solid var(--card-border);
      transition: 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-refresh { background: #1d4ed8; border-color: #2563eb; color: #fff; }
    .btn-refresh:hover { background: #2563eb; }
    .btn-clear { background: #18181b; color: #f87171; border-color: #3f1d1d; }
    .btn-clear:hover { background: #271515; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 14px;
      margin-bottom: 26px;
    }
    .stat-card {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px 18px;
    }
    .stat-label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 26px; font-weight: 700; margin-top: 6px; }
    .feed { display: flex; flex-direction: column; gap: 14px; }
    .log-card {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 18px 20px;
    }
    .log-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }
    .log-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .badge {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 9px;
      border-radius: 6px;
      letter-spacing: 0.4px;
    }
    .badge-blue   { background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
    .badge-amber  { background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3); }
    .badge-green  { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3); }
    .badge-purple { background: rgba(139,92,246,0.15); color: #a78bfa; border: 1px solid rgba(139,92,246,0.3); }
    .badge-gray   { background: rgba(113,113,122,0.15); color: #a1a1aa; border: 1px solid rgba(113,113,122,0.3); }
    .log-title { font-size: 15px; font-weight: 600; color: #fff; }
    .meta { font-size: 12px; color: var(--muted); font-family: monospace; }
    .info-grid { display: grid; gap: 10px; margin-top: 10px; }
    .info-row {
      background: #0c0c0e;
      border: 1px solid #1f1f23;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .info-label { color: var(--muted); font-size: 12px; min-width: 110px; font-weight: 500; }
    .transcript-text { color: #e4e4e7; font-style: italic; }
    .key-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      background: #27272a;
      border: 1px solid #3f3f46;
      border-radius: 6px;
      font-family: monospace;
      font-size: 15px;
      font-weight: 700;
      color: #fbbf24;
    }
    .encoded-pill {
      background: rgba(16,185,129,0.12);
      border: 1px solid rgba(16,185,129,0.3);
      color: #34d399;
      padding: 5px 10px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 14px;
    }
    details { margin-top: 10px; }
    summary { font-size: 12px; color: var(--muted); cursor: pointer; user-select: none; }
    summary:hover { color: #fff; }
    pre {
      margin-top: 8px;
      background: #09090b;
      border: 1px solid #222;
      padding: 12px;
      border-radius: 8px;
      font-size: 12px;
      color: #a1a1aa;
      overflow-x: auto;
    }
    .empty {
      text-align: center;
      padding: 60px 20px;
      background: var(--card);
      border: 1px dashed var(--card-border);
      border-radius: 12px;
      color: var(--muted);
    }
  </style>
</head>
<body>

  <div class="header">
    <div class="title-group">
      <h1><span class="status-dot"></span> AgentPhone Webhook Activity</h1>
      <p>Real-time IVR DTMF press & encoded verification code monitor</p>
    </div>
    <div class="actions">
      <a href="/logs" class="btn btn-refresh">🔄 Refresh Logs</a>
      <a href="/logs/clear" class="btn btn-clear">🗑️ Clear Logs</a>
    </div>
  </div>

  <div class="stats">
    <div class="stat-card">
      <div class="stat-label">Total Webhook Events</div>
      <div class="stat-value">${stats.totalRequests}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Active Calls in Memory</div>
      <div class="stat-value">${calls.size}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">First Digits Pressed</div>
      <div class="stat-value" style="color: var(--amber)">${stats.digitsPressed}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Encoded Codes Spoken</div>
      <div class="stat-value" style="color: var(--green)">${stats.codesSpoken}</div>
    </div>
  </div>

  <div class="feed">
    ${
      logHistory.length === 0
        ? `<div class="empty">
             <h3>No webhook activity yet</h3>
             <p style="margin-top:6px;font-size:13px;">Make a call and click "Refresh Logs" to inspect incoming events.</p>
           </div>`
        : logHistory
            .map((l) => {
              const formattedTime = new Date(l.time).toLocaleTimeString();
              const digitPills = l.collectedDigits
                ? l.collectedDigits
                    .split("")
                    .map((d) => `<span class="key-pill">${escapeHtml(d)}</span>`)
                    .join("")
                : "";

              return `
        <div class="log-card">
          <div class="log-top">
            <div class="log-left">
              <span class="badge badge-${l.color}">${escapeHtml(l.badge)}</span>
              <span class="log-title">${escapeHtml(l.title)}</span>
            </div>
            <div class="meta">Call: ${escapeHtml(l.callId)} • ${formattedTime}</div>
          </div>

          <div class="info-grid">
            ${
              l.transcript
                ? `<div class="info-row">
                     <span class="info-label">🎙️ IVR Heard:</span>
                     <span class="transcript-text">"${escapeHtml(l.transcript)}"</span>
                   </div>`
                : ""
            }
            ${
              l.pressedDigit
                ? `<div class="info-row">
                     <span class="info-label">🔢 Keypad Sent:</span>
                     <span class="key-pill">${escapeHtml(l.pressedDigit)}</span>
                   </div>`
                : ""
            }
            ${
              l.collectedDigits
                ? `<div class="info-row">
                     <span class="info-label">🔐 Captured Code:</span>
                     <div style="display:flex;gap:6px;">${digitPills}</div>
                   </div>`
                : ""
            }
            ${
              l.encodedText
                ? `<div class="info-row">
                     <span class="info-label">🗣️ Agent Spoke:</span>
                     <span class="encoded-pill">${escapeHtml(l.encodedText)}</span>
                   </div>`
                : ""
            }
          </div>

          <details>
            <summary>View Raw Payload</summary>
            <pre>${escapeHtml(JSON.stringify(l.raw, null, 2))}</pre>
          </details>
        </div>`;
            })
            .join("")
    }
  </div>

</body>
</html>`);
});

app.get("/logs/clear", (req, res) => {
  logHistory.length = 0;
  stats.totalRequests = 0;
  stats.digitsPressed = 0;
  stats.codesSpoken = 0;
  res.redirect("/logs");
});

app.get("/", (_, res) => res.redirect("/logs"));

app.listen(PORT, () => console.log(`Webhook running on port ${PORT}`));
