const express = require("express");
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

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
//  (Removed "to", "for", "ate" so normal English
//   words don't get mistaken for digits)
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

// Extract all digits from a sentence
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

// Specifically look for "press [digit]" (e.g. "press nine" or "press 9")
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

  // Ignore non-message events
  const event = body.event || "";
  if (event && !/message/i.test(event)) {
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
    // 1. Try to find "press X" first
    let firstDigit = extractPressDigit(transcript);
    const allDigits = extractDigits(transcript);

    // 2. Fallback: if IVR just said a number without "press", grab the first digit
    if (!firstDigit && allDigits.length > 0) {
      firstDigit = allDigits[0];
    }

    // No digit heard yet — stay silent and wait
    if (!firstDigit) {
      return res.json({});
    }

    state.pressedFirst = true;
    return res.json({ digits: firstDigit });
  }

  // ── PHASE 2: Capture the next 6 digits & speak encoded ──
  const digits = extractDigits(transcript);
  if (!digits) {
    return res.json({});
  }

  state.codeDigits += digits;

  if (state.codeDigits.length >= 6) {
    const sixDigits = state.codeDigits.slice(0, 6);
    state.codeDigits = ""; // reset in case IVR repeats the code
    return res.json({ text: speakEncoded(sixDigits) });
  }

  // Still waiting for all 6 digits
  return res.json({});
});

// ──────────────────────────────────────────────
//  HEALTH CHECK
// ──────────────────────────────────────────────
app.get("/", (_, res) => res.send("OK"));

app.listen(PORT, () => console.log(`Webhook running on port ${PORT}`));
