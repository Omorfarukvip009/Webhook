const express = require("express");
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// ── ENCODED WORDS ──
const ENC = {
  "0":"Zuri","1":"Uni","2":"Tuwi","3":"Thuri","4":"Furi",
  "5":"Fivi","6":"Siji","7":"Sivini","8":"Eigti","9":"Nini"
};
function encoded(d) { return d.split("").map(c => ENC[c]||c).join(", "); }

// ── DIGIT EXTRACTION ──
const W = {
  zero:"0",oh:"0",one:"1",two:"2",three:"3",
  four:"4",five:"5",six:"6",seven:"7",eight:"8",nine:"9"
};
function getDigits(text) {
  if (!text) return "";
  let out = "";
  for (const t of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    if (/^\d+$/.test(t)) out += t;
    else if (W[t]) out += W[t];
  }
  return out;
}
function getPressDigit(text) {
  if (!text) return null;
  const m = text.toLowerCase().match(
    /\b(?:press|dial|enter|push)\s+(?:number\s+|digit\s+|the\s+)?([0-9]|zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/
  );
  if (!m) return null;
  const t = m[1];
  return /^\d$/.test(t) ? t : (W[t] || null);
}

// ── CALL STATE ──
const calls = new Map();
function getState(id) {
  if (!calls.has(id)) calls.set(id, { pressCount: 0, pressDigit: "", code: "", ts: Date.now() });
  const s = calls.get(id); s.ts = Date.now(); return s;
}
setInterval(() => { const c = Date.now()-300000; for (const [id,s] of calls) if (s.ts<c) calls.delete(id); }, 60000);

// ── LOGS ──
const logs = [];
const stats = { total:0, pressed:0, spoken:0 };
function log(badge,color,title,d={}) {
  const e = { time:new Date().toISOString(), badge, color, title, ...d };
  console.log(`[${e.time}] [${badge}] ${title}`);
  logs.unshift(e); if (logs.length>100) logs.pop();
}
function esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

// ══════════════════════════════════════════════
//  WEBHOOK
//  Phase 1: Press digit 3 times
//  Phase 2: Capture 6 digits & speak encoded
// ══════════════════════════════════════════════
app.post("/webhook", (req, res) => {
  const body = req.body || {};
  stats.total++;
  if (body.event !== "agent.message") return res.json({});

  const data = body.data || {};
  const callId = data.callId || "default";
  const transcript = data.transcript || "";
  const state = getState(callId);

  // ── PHASE 1: PRESS digit (3 times) ──
  if (state.pressCount < 3) {
    const digit = getPressDigit(transcript) || getDigits(transcript)[0] || null;
    if (!digit) return res.json({ text: "Listening." });

    state.pressCount++;
    state.pressDigit = digit;
    stats.pressed++;

    log("PRESSED","amber",`Pressed ${digit} (${state.pressCount}/3)`,{
      callId, transcript, digit, pressCount:state.pressCount, raw:body
    });

    return res.json({ text: `Pressing ${digit}.`, digits: digit });
  }

  // ── PHASE 2: CAPTURE & SPEAK encoded digits ──
  const digits = getDigits(transcript);
  if (!digits) return res.json({ text: "Listening for code." });

  state.code += digits;

  if (state.code.length >= 6) {
    const six = state.code.slice(0, 6);
    state.code = "";
    stats.spoken++;
    const spoken = encoded(six);

    log("SPOKE","green",`${six} → ${spoken}`,{
      callId, transcript, digits:six, spoken, raw:body
    });

    return res.json({ text: spoken });
  }

  log("WAITING","blue",`Code ${state.code.length}/6`,{ callId, transcript, raw:body });
  return res.json({ text: "Listening." });
});

// ══════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════
app.get("/logs", (req, res) => {
  res.setHeader("Content-Type","text/html");
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AgentPhone Logs</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#09090b;color:#f4f4f5;font-family:-apple-system,sans-serif;padding:24px;max-width:900px;margin:0 auto}
h1{font-size:20px;margin-bottom:16px;display:flex;align-items:center;gap:8px}
.dot{width:9px;height:9px;background:#10b981;border-radius:50%;box-shadow:0 0 8px #10b981}
.bar{display:flex;gap:8px;margin-bottom:20px}
.btn{padding:8px 14px;border-radius:7px;font-size:12px;font-weight:600;text-decoration:none;border:1px solid #27272a}
.b1{background:#1d4ed8;color:#fff}.b2{background:#18181b;color:#f87171}
.stats{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap}
.sc{background:#121216;border:1px solid #27272a;border-radius:10px;padding:12px 16px;min-width:120px}
.sl{font-size:10px;color:#a1a1aa;text-transform:uppercase}.sv{font-size:22px;font-weight:700;margin-top:2px}
.card{background:#121216;border:1px solid #27272a;border-radius:10px;padding:14px;margin-bottom:10px}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px}
.badge{font-size:10px;font-weight:700;padding:3px 8px;border-radius:5px}
.amber{background:rgba(245,158,11,.15);color:#fbbf24;border:1px solid rgba(245,158,11,.3)}
.green{background:rgba(16,185,129,.15);color:#34d399;border:1px solid rgba(16,185,129,.3)}
.blue{background:rgba(59,130,246,.15);color:#60a5fa;border:1px solid rgba(59,130,246,.3)}
.row{background:#0c0c0e;border:1px solid #1a1a1e;border-radius:6px;padding:8px 12px;font-size:12px;margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.lbl{color:#a1a1aa;min-width:80px}
.txt{color:#e4e4e7;font-style:italic}
.key{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;background:#27272a;border:1px solid #3f3f46;border-radius:5px;font-family:monospace;font-size:14px;font-weight:700;color:#fbbf24}
.enc{background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.3);color:#34d399;padding:4px 8px;border-radius:5px;font-weight:600}
code{background:#1a1a2e;color:#fbbf24;padding:2px 6px;border-radius:4px;font-size:12px}
.meta{font-size:11px;color:#71717a;font-family:monospace}
details{margin-top:6px}summary{font-size:11px;color:#71717a;cursor:pointer}
pre{margin-top:4px;background:#09090b;border:1px solid #1a1a1e;padding:8px;border-radius:6px;font-size:11px;color:#71717a;overflow-x:auto}
</style></head><body>
<h1><span class="dot"></span>AgentPhone — Press (×3) & Speak</h1>
<div class="bar">
  <a href="/logs" class="btn b1">🔄 Refresh</a>
  <a href="/logs/clear" class="btn b2">🗑️ Clear</a>
</div>
<div class="stats">
  <div class="sc"><div class="sl">Events</div><div class="sv">${stats.total}</div></div>
  <div class="sc"><div class="sl">Pressed</div><div class="sv" style="color:#fbbf24">${stats.pressed}</div></div>
  <div class="sc"><div class="sl">Spoken</div><div class="sv" style="color:#34d399">${stats.spoken}</div></div>
</div>
${logs.length===0?'<p style="color:#71717a;text-align:center;padding:40px">No activity yet. Make a call and refresh.</p>'
:logs.map(l=>{
  const t=new Date(l.time).toLocaleTimeString();
  const pills=l.digits?l.digits.split("").map(d=>`<span class="key">${esc(d)}</span>`).join(""):"";
  return `<div class="card">
    <div class="top">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="badge ${l.color}">${esc(l.badge)}</span>
        <strong>${esc(l.title)}</strong>
      </div>
      <span class="meta">${t}</span>
    </div>
    ${l.transcript?`<div class="row"><span class="lbl">🎙️ Heard:</span><span class="txt">"${esc(l.transcript)}"</span></div>`:""}
    ${l.digit?`<div class="row"><span class="lbl">📤 Sent:</span><code>{"text":"Pressing ${esc(l.digit)}.","digits":"${esc(l.digit)}"}</code> <span style="color:#fbbf24">(${l.pressCount}/3)</span></div>`:""}
    ${l.digits?`<div class="row"><span class="lbl">🔐 Code:</span><div style="display:flex;gap:4px">${pills}</div></div>`:""}
    ${l.spoken?`<div class="row"><span class="lbl">🗣️ Spoke:</span><span class="enc">${esc(l.spoken)}</span></div>`:""}
    <details><summary>Raw</summary><pre>${esc(JSON.stringify(l.raw,null,2))}</pre></details>
  </div>`;
}).join("")}
</body></html>`);
});

app.get("/logs/clear",(req,res)=>{ logs.length=0; stats.total=0; stats.pressed=0; stats.spoken=0; res.redirect("/logs"); });
app.get("/",(_,res)=>res.redirect("/logs"));
app.listen(PORT,()=>console.log(`Webhook on port ${PORT}`));
