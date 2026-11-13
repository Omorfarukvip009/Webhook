const express = require("express");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

/* ============================================================
   ENCODED DIGIT WORDS  (0–9)
   ============================================================ */
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

/* Convert a digit string → encoded spoken phrase
   "5123" → "Fivi, Uni, Tuwi, Thuri" */
function encodeDigits(digits) {
  return digits
    .split("")
    .map((d) => ENCODED[d] || d)
    .join(", ");
}

/* ============================================================
   TRANSCRIPT → DIGITS EXTRACTION
   Handles digits ("5123"), spoken numbers ("five one two"),
   and even the encoded words themselves ("Fivi Uni Tuwi")
   ============================================================ */
const WORD_TO_DIGIT = {
  // standard spoken numbers
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  // encoded words (in case IVR/system speaks them back)
  zuri: "0",
  uni: "1",
  tuwi: "2",
  thuri: "3",
  furi: "4",
  fivi: "5",
  siji: "6",
  sivini: "7",
  eigti: "8",
  nini: "9",
};

function extractDigits(text) {
  if (!text) return "";
  const tokens = String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let out = "";
  for (const t of tokens) {
    const nums = t.match(/\d/g);          // "5" or "12"
    if (nums) { out += nums.join(""); continue; }
    if (WORD_TO_DIGIT[t]) out += WORD_TO_DIGIT[t];
  }
  return out;
}

/* ============================================================
   PER-CALL STATE  (in-memory; see README for Redis note)
   ============================================================ */
const calls = new Map();

function getState(callId) {
  if (!calls.has(callId)) {
    calls.set(callId, { pressedFirst: false, ts: Date.now() });
  }
  const s = calls.get(callId);
  s.ts = Date.now();
  return s;
}

// Evict stale calls every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [id, s] of calls) {
    if (s.ts < cutoff) calls.delete(id);
  }
}, 60 * 1000);

/* ============================================================
   WEBHOOK  POST /webhook
   AgentPhone sends agent.message events with data.transcript
   ============================================================ */
app.post("/webhook", (req, res) => {
  const body = req.body || {};

  // Ignore non-message events (call.start, call.end, etc.)
  const event = body.event || body.type || "";
  if (event && !/message/i.test(event)) {
    return res.json({});
  }

  const data = body.data || body;
  const callId =
    data.callId || data.call_id || body.callId || body.sessionId || "default-call";
  const transcript = data.transcript || data.text || "";
  const rawDigits = data.digits || ""; // in case platform sends keypad digits directly

  let digits = extractDigits(transcript);
  if (!digits && rawDigits) digits = rawDigits.replace(/\D/g, "");

  // No digits heard — nudge the caller
  if (!digits) {
    return res.json({ text: "Please say the digits." });
  }

  const state = getState(callId);

  /* ----------------------------------------------------------
     PHASE 1 — first digits heard:
     PRESS the first digit (DTMF) and SPEAK the rest encoded
     ---------------------------------------------------------- */
  if (!state.pressedFirst) {
    const first = digits[0];
    const rest = digits.slice(1);
    state.pressedFirst = true;

    const response = { digits: first };        // ← press first digit
    if (rest.length > 0) {
      response.text = encodeDigits(rest);      // ← speak the NEXT digits
    }
    return res.json(response);
  }

  /* ----------------------------------------------------------
     PHASE 2 — more digits arrive later:
     speak them encoded (first digit already pressed)
     ---------------------------------------------------------- */
  return res.json({ text: encodeDigits(digits) });
});

/* ============================================================
   HEALTH CHECKS  (Render requires / to respond 200)
   ============================================================ */
app.get("/", (_req, res) => res.send("AgentPhone encoded-digits webhook OK"));
app.get("/webhook", (_req, res) => res.json({ ok: true })); // platform verification

app.listen(PORT, () => {
  console.log(`Webhook listening on port ${PORT}`);
});
