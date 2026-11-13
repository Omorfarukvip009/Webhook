const express = require("express");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

/* ============================================================
   ENCODED DIGIT WORDS (0-9)
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

function encodeDigits(digits) {
  return digits
    .split("")
    .map((d) => ENCODED[d] || d)
    .join(", ");
}

/* ============================================================
   TRANSCRIPT → DIGITS
   Extracts digits from natural IVR speech like:
     "press nine"                  → "9"
     "your code is 4 8 2 7 1 3"   → "482713"
     "press one"                   → "1"
     "dial five"                   → "5"
   ============================================================ */
const WORD_TO_DIGIT = {
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
  // encoded words (in case they echo back)
  zuri: "0", uni: "1", tuwi: "2", thuri: "3",
  furi: "4", fivi: "5", siji: "6", sivini: "7",
  eigti: "8", nini: "9",
};

function extractDigits(text) {
  if (!text) return "";
  const tokens = String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let out = "";
  for (const t of tokens) {
    const nums = t.match(/\d/g);
    if (nums) { out += nums.join(""); continue; }
    if (WORD_TO_DIGIT[t]) out += WORD_TO_DIGIT[t];
  }
  return out;
}

/* ============================================================
   PER-CALL STATE
   ============================================================ */
const calls = new Map();

function getState(callId) {
  if (!calls.has(callId)) {
    calls.set(callId, {
      firstPressed: false,
      capturedDigits: "",   // digits after the first press
      ts: Date.now(),
    });
  }
  const s = calls.get(callId);
  s.ts = Date.now();
  return s;
}

// Evict stale calls every 5 min
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [id, s] of calls) {
    if (s.ts < cutoff) calls.delete(id);
  }
}, 60 * 1000);

/* ============================================================
   WEBHOOK  POST /webhook

   REAL-WORLD FLOW:
   ─────────────────────────────────────────────
   IVR: "To receive your WhatsApp verification
         code, press nine"
   → transcript contains "nine"
   → extractDigits → "9"
   → firstPressed = false → PRESS "9"
   → response: { "digits": "9" }

   IVR: "Your verification code is
         four eight two seven one three"
   → transcript contains "four eight two seven one three"
   → extractDigits → "482713"
   → firstPressed = true → SPEAK encoded
   → response: { "text": "Furi, Eigti, Tuwi, Sivini, Uni, Thuri" }
   ─────────────────────────────────────────────
   ============================================================ */
app.post("/webhook", (req, res) => {
  const body = req.body || {};

  // Ignore non-message events
  const event = body.event || body.type || "";
  if (event && !/message/i.test(event)) {
    return res.json({});
  }

  const data = body.data || body;
  const callId =
    data.callId || data.call_id || body.callId || body.sessionId || "default";
  const transcript = data.transcript || data.text || "";
  const rawDigits = data.digits || "";

  let digits = extractDigits(transcript);
  if (!digits && rawDigits) digits = rawDigits.replace(/\D/g, "");

  // No digits in this utterance — stay silent, keep listening
  if (!digits) {
    return res.json({});
  }

  const state = getState(callId);

  /* ----------------------------------------------------------
     PHASE 1: IVR says "press nine" (or any first digit)
     → Press that digit via DTMF
     → If more digits follow in same utterance, capture them
     ---------------------------------------------------------- */
  if (!state.firstPressed) {
    const firstDigit = digits[0];
    state.firstPressed = true;

    const remaining = digits.slice(1);

    // Case A: "press nine" → only 1 digit → just press it
    if (remaining.length === 0) {
      return res.json({ digits: firstDigit });
    }

    // Case B: all 7 digits in one utterance → press first, speak next 6
    if (remaining.length >= 6) {
      const six = remaining.slice(0, 6);
      state.capturedDigits = six;
      return res.json({
        digits: firstDigit,
        text: encodeDigits(six),
      });
    }

    // Case C: some extra digits but not 6 yet → press first, store rest
    state.capturedDigits = remaining;
    return res.json({ digits: firstDigit });
  }

  /* ----------------------------------------------------------
     PHASE 2: IVR reads the verification code
     → Accumulate digits until we have 6
     → Speak all 6 as encoded words
     ---------------------------------------------------------- */
  state.capturedDigits += digits;

  if (state.capturedDigits.length >= 6) {
    const six = state.capturedDigits.slice(0, 6);
    return res.json({ text: encodeDigits(six) });
  }

  // Not 6 yet — stay silent, keep listening for more
  return res.json({});
});

/* ============================================================
   HEALTH CHECK
   ============================================================ */
app.get("/", (_req, res) => res.send("AgentPhone webhook OK"));
app.get("/webhook", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Webhook listening on port ${PORT}`);
});
