require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// ---------------- Config simulación ----------------
function cfgSim() {
  return {
    ADMIN_BASE_PCT: 10.5,
    IVA_PCT: 19,
    AMPARO_BASICO_PCT: 2.05,
    AMPARO_INTEGRAL_PCT: 12.31,
    SMMLV: 1423500
  };
}

function fmtCOP(n) {
  try {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.round(n));
  } catch {
    return '$' + Math.round(n).toLocaleString('es-CO');
  }
}

function extractAmount(s) {
  if (!s) return null;
  const clean = String(s).replace(/[^0-9]/g, '');
  if (!clean) return null;
  const num = parseInt(clean, 10);
  if (!Number.isFinite(num)) return null;
  return num >= 10000 ? num : null; // 5+ dígitos
}

function simulateCanon(canon) {
  const cfg = cfgSim();
  const adminPct = cfg.ADMIN_BASE_PCT * (1 + cfg.IVA_PCT / 100);
  const admin = Math.round(canon * (adminPct/100));
  const amparoBasico = Math.round(canon * (cfg.AMPARO_BASICO_PCT/100));
  const amparoIntegral = Math.round((canon + cfg.SMMLV) * (cfg.AMPARO_INTEGRAL_PCT/100));
  const descMes1 = admin + amparoBasico + amparoIntegral;
  const descMesesSig = admin + amparoBasico;
  return {
    admin, amparoBasico, amparoIntegral, descMes1, descMesesSig,
    netoMes1: Math.round(canon - descMes1),
    netoMesesSig: Math.round(canon - descMesesSig)
  };
}

// ---------------- Prompt / mensajes ----------------
let promptCfg = require('./PROMPT.json');

// LLM knobs (debug/lectura desde prompt o ENV; no hacemos llamada a LLM aquí)
function llmKnobs() {
  const ls = (promptCfg.llm_style || {});
  const tempFromEnv = process.env.OPENAI_TEMPERATURE;
  const presFromEnv = process.env.OPENAI_PRESENCE_PENALTY;
  const freqFromEnv = process.env.OPENAI_FREQUENCY_PENALTY;
  let temperature = Number(tempFromEnv ?? ls.temperature_suggested ?? 0.55);
  let presence_penalty = Number(presFromEnv ?? ls.presence_penalty ?? 0.0);
  let frequency_penalty = Number(freqFromEnv ?? ls.frequency_penalty ?? 0.0);
  if (Number.isNaN(temperature)) temperature = 0.55;
  if (Number.isNaN(presence_penalty)) presence_penalty = 0.0;
  if (Number.isNaN(frequency_penalty)) frequency_penalty = 0.0;
  const mode = process.env.LLM_MODE || ls.mode || 'flex';
  return { mode, temperature, presence_penalty, frequency_penalty, source: {
    mode: process.env.LLM_MODE ? 'env' : (ls.mode ? 'prompt' : 'default'),
    temperature: tempFromEnv ? 'env' : (ls.temperature_suggested !== undefined ? 'prompt' : 'default'),
    presence_penalty: presFromEnv ? 'env' : (ls.presence_penalty !== undefined ? 'prompt' : 'default'),
    frequency_penalty: freqFromEnv ? 'env' : (ls.frequency_penalty !== undefined ? 'prompt' : 'default'),
  }};
}

// --- menus ---
function adminMenu() {
  const lines = [
    "Elige una opción (responde con el número):",
    "1) Costos y simulación",
    "2) ¿Cómo trabajamos?",
    "3) Oficina Virtual (propietarios)",
    "4) Simular mi canon"
  ];
  return {
    messages: [{ type: "text", text: lines.join("\n") }],
    quick_replies: ["1","2","3","4"]
  };
}

function entryMenu() {
  const lines = [
    "¿Qué te gustaría hacer? (responde con el número):",
    "1) Ver inmuebles por código",
    "2) Buscar por filtros",
    "3) Hablar con un asesor"
  ];
  return {
    messages: [{ type: "text", text: lines.join("\n") }],
    quick_replies: ["1","2","3"]
  };
}

// ---------------- Estado simple en memoria ----------------
const SESSIONS = new Map();
function getSession(id) {
  if (!id) return { id:"anon" };
  if (!SESSIONS.has(id)) SESSIONS.set(id, { adminStage: 'menu', lastIntent: null });
  return SESSIONS.get(id);
}
function saveSession(id, st) {
  SESSIONS.set(id, st);
}

// ---------------- Utilidades ----------------
function norm(s) {
  return (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g,' ').replace(/\s+/g,' ').trim();
}

function namePrefix(name) {
  return name ? `${name}, ` : '';
}

function adminChunk(which) {
  const m = promptCfg.messages || {};
  if (which === 'costos') return m.admin_chunk_costos || 'Comisión 10.5% + IVA (≈12.5%) del canon.';
  if (which === 'operacion') return m.admin_chunk_operacion || 'Publicamos, QR a chatbot 24/7, video 4K, estudio digital.';
  if (which === 'oficina') return m.admin_chunk_oficina || 'Oficina Virtual 24/7: estados y facturas.';
  return '';
}

// ---------------- Búsqueda código (CSV publicado) ----------------
let _sheetCache = { rows: [], ts: 0 };
async function loadSheet() {
  const url = process.env.SHEETS_CSV_URL;
  if (!url) return [];
  const now = Date.now();
  if (_sheetCache.rows.length && now - _sheetCache.ts < 5*60*1000) return _sheetCache.rows;
  const res = await axios.get(url);
  const lines = res.data.split(/\r?\n/);
  const headers = lines.shift().split(',');
  const rows = lines.filter(Boolean).map(line => {
    const cols = line.split(',');
    const obj = {};
    headers.forEach((h,i)=> obj[h.trim()] = (cols[i]||'').trim());
    return obj;
  });
  _sheetCache = { rows, ts: now };
  return rows;
}

async function propertyByCodeLoose(code) {
  const rows = await loadSheet();
  if (!rows.length) return null;
  const cx = String(code).trim();
  const found = rows.find(r => Object.values(r).some(v => String(v).trim() === cx));
  return found || null;
}

// ---------------- Handler principal ----------------
async function handleWebhookPayload(payload) {
  const session = (payload && (payload.session || payload.session_id || payload.user_id)) || 'anon';
  const text = (payload && (payload.text || payload.input || payload.message)) || '';
  const name = (payload && (payload.name || payload.user_name || payload.first_name)) || '';
  const t = norm(text);
  const st = getSession(session);
  st.lastIntent = st.lastIntent || 'admin'; // default al menú admin
  saveSession(session, st);

  // Shortcuts por número (1-4)
  if (/^\s*(1|uno)\b/.test(t)) { st.adminStage='after_costos'; saveSession(session, st); return { messages:[{type:'text', text: namePrefix(name) + adminChunk('costos')}], quick_replies: adminMenu().quick_replies }; }
  if (/^\s*(2|dos)\b/.test(t)) { st.adminStage='after_operacion'; saveSession(session, st); return { messages:[{type:'text', text: namePrefix(name) + adminChunk('operacion')}], quick_replies: adminMenu().quick_replies }; }
  if (/^\s*(3|tres)\b/.test(t)) { st.adminStage='after_oficina'; saveSession(session, st); return { messages:[{type:'text', text: namePrefix(name) + adminChunk('oficina')}], quick_replies: adminMenu().quick_replies }; }
  if (/^\s*(4|cuatro)\b/.test(t)) {
    st.adminStage = 'ask_canon'; saveSession(session, st);
    const ask = (promptCfg.messages && promptCfg.messages.ask_canon_value) || 'Escríbeme el valor del canon (solo números).';
    return { messages:[{type:'text', text: namePrefix(name)+ask}], quick_replies: [] };
  }

  // Detectar canon en cualquier momento y simular
  const amountInline = extractAmount(text);
  if (amountInline) {
    st.adminStage = 'after_costos'; saveSession(session, st);
    const sim = simulateCanon(amountInline);
    const lines = [
      `${namePrefix(name)}Simulación sobre ${fmtCOP(amountInline)}:`,
      `• Administración (${cfgSim().ADMIN_BASE_PCT}% + IVA ${cfgSim().IVA_PCT}%): ${fmtCOP(sim.admin)}`,
      `• Amparo básico (${cfgSim().AMPARO_BASICO_PCT}%): ${fmtCOP(sim.amparoBasico)}`,
      `• Primer mes, Amparo integral (${cfgSim().AMPARO_INTEGRAL_PCT}% de canon + SMMLV): ${fmtCOP(sim.amparoIntegral)}`,
      ``,
      `Primer mes → Descuento total: ${fmtCOP(sim.descMes1)} | Te quedan: ${fmtCOP(sim.netoMes1)}`,
      `Meses siguientes → Descuento: ${fmtCOP(sim.descMesesSig)} | Te quedan: ${fmtCOP(sim.netoMesesSig)}`
    ];
    return { messages:[{type:'text', text: lines.join('\n')}], quick_replies: ["Cómo trabajamos","Ver ejemplos","Hablar con asesor"] };
  }

  // Intents por palabras
  if (/(costos?|comisi[oó]n|precio|tarifa|cobr(?:ar|an|o|a)?|cu[aá]nto(?:\s+me)?\s+(?:cobran|cobrar|cobro)|cu[aá]nt[oa]\s+(?:vale|valen|cuesta|cuestan)|valor)/.test(t)) {
    st.adminStage = 'pre_costs'; saveSession(session, st);
    const q = (promptCfg.messages && promptCfg.messages.admin_pre_costs_question) || '¿Quieres ver qué cubren los seguros antes de los costos?';
    const opts = (promptCfg.messages && promptCfg.messages.admin_pre_costs_options) || ['Sí, cuéntame','Ver costos directo','Simular canon','Ver ejemplos'];
    return { messages:[{type:'text', text: namePrefix(name)+q}], quick_replies: opts };
  }
  if (/(seguro|amparo|cobertura|cubre)/.test(t)) {
    st.adminStage = 'after_insurance'; saveSession(session, st);
    const info = (promptCfg.messages && promptCfg.messages.admin_insurance_explain_short) || 'Amparo básico e integral explicados.';
    return { messages:[{type:'text', text: namePrefix(name)+info}], quick_replies: ['Ver ejemplos','Ver costos','Simular canon','Cómo trabajamos'] };
  }
  if (/(ver ejemplos|ejemplos|ejemplo)/.test(t)) {
    st.adminStage = 'after_insurance'; saveSession(session, st);
    const title = (promptCfg.messages && promptCfg.messages.admin_insurance_examples_title) || 'Ejemplos:';
    const body = (promptCfg.messages && promptCfg.messages.admin_insurance_examples) || '';
    return { messages:[{type:'text', text: namePrefix(name)+title+'\n'+body}], quick_replies: ['Ver costos','Simular canon','Cómo trabajamos'] };
  }
  if (/(como funcionan|c[oó]mo trabajan|que hacen|proceso|metodologia)/.test(t)) {
    st.adminStage = 'after_operacion'; saveSession(session, st);
    return { messages:[{type:'text', text: namePrefix(name)+adminChunk('operacion')}], quick_replies: ['Costos','Oficina Virtual','Simular canon'] };
  }
  if (/(oficina|estados de cuenta|facturas)/.test(t)) {
    st.adminStage = 'after_oficina'; saveSession(session, st);
    return { messages:[{type:'text', text: namePrefix(name)+adminChunk('oficina')}], quick_replies: ['Costos','Simular canon','Cómo trabajamos'] };
  }
  if (/\bsimular\b/.test(t)) {
    st.adminStage = 'ask_canon'; saveSession(session, st);
    const ask = (promptCfg.messages && promptCfg.messages.ask_canon_value) || 'Escríbeme el valor del canon (solo números).';
    return { messages:[{type:'text', text: namePrefix(name)+ask}], quick_replies: [] };
  }

  // Etapa pre_costs
  if (st.adminStage === 'pre_costs') {
    if (/(s[ií]|si,|sí,|cuentame|cuéntame|explicar|explicame|explícame)/.test(t)) {
      st.adminStage = 'after_insurance'; saveSession(session, st);
      const info = (promptCfg.messages && promptCfg.messages.admin_insurance_explain_short) || 'Amparo básico e integral explicados.';
      return { messages:[{type:'text', text: namePrefix(name)+info}], quick_replies: ['Ver ejemplos','Ver costos','Simular canon','Cómo trabajamos'] };
    }
    if (/(ver costos|costos directo|costos ya|ver costo)/.test(t)) {
      st.adminStage = 'after_costos'; saveSession(session, st);
      return { messages:[{type:'text', text: namePrefix(name)+adminChunk('costos')}], quick_replies: ['Simular canon','Cómo trabajamos','Oficina Virtual'] };
    }
    const q = (promptCfg.messages && promptCfg.messages.admin_pre_costs_question) || '¿Quieres ver qué cubren los seguros antes de los costos?';
    const opts = (promptCfg.messages && promptCfg.messages.admin_pre_costs_options) || ['Sí, cuéntame','Ver costos directo','Simular canon','Ver ejemplos'];
    return { messages:[{type:'text', text: namePrefix(name)+q}], quick_replies: opts };
  }

  // Si está en admin (por defecto) o no hay match claro, mostrar menú admin numerado
  const menuText = (promptCfg.messages && promptCfg.messages.admin_menu_numbered) || "Elige una opción:\n1) Costos\n2) Cómo trabajamos\n3) Oficina Virtual\n4) Simular canon\nResponde con 1-4 o palabra clave.";
  return { messages:[{type:'text', text: namePrefix(name)+menuText}], quick_replies: adminMenu().quick_replies };
}

// ---------------- Rutas ----------------
app.get('/health', (req,res)=> res.json({ ok: true }));

// Prompt debug
app.get('/api/debug/prompt', (req,res)=> res.json(promptCfg));
app.post('/api/debug/prompt/reload', (req,res)=> {
  delete require.cache[require.resolve('./PROMPT.json')];
  promptCfg = require('./PROMPT.json');
  res.json({ reloaded: true, messages: Object.keys(promptCfg.messages||{}) });
});
// Env debug
app.get('/api/debug/env', (req,res)=> {
  const allow = ['SHEETS_CSV_URL'];
  const env = Object.fromEntries(allow.map(k=>[k, process.env[k] || null]));
  res.json(env);
});
// LLM debug
app.get('/api/debug/llm', (req,res)=> res.json({ knobs: llmKnobs() }));

// Menus debug
app.get('/api/debug/menu/admin', (req,res)=> res.json(adminMenu()));
app.get('/api/debug/menu/entry', (req,res)=> res.json(entryMenu()));

// Propiedad por código (simple via CSV publicado)
app.get('/api/property', async (req,res) => {
  try {
    const code = req.query.code || req.query.input;
    if (!code) return res.json({ ok:true, found:false, property:null });
    const p = await propertyByCodeLoose(code);
    if (p) return res.json({ ok:true, found:true, property: p });
    return res.json({ ok:true, found:false, property:null });
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e) });
  }
});

// Webhook / chat (ManyChat)

// Quick test in browser: /api/chat/try?text=hola&user=123&name=Pipe
app.get('/api/chat/try', async (req,res) => {
  try {
    const payload = {
      session: req.query.user || 'try',
      text: req.query.text || '',
      name: req.query.name || ''
    };
    const out = await handleWebhookPayload(payload);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Debug: detect intent without invoking ManyChat mapping
app.get('/api/debug/intent', (req,res) => {
  try {
    const t = norm(req.query.text || '');
    let intent = 'menu';
    if (/(costos?|comisi[oó]n|precio|tarifa|cobr(?:ar|an|o|a)?|cu[aá]nto(?:\s+me)?\s+(?:cobran|cobrar|cobro)|cu[aá]nt[oa]\s+(?:vale|valen|cuesta|cuestan)|valor)/.test(t)) intent='costos';
    else if (/(seguro|amparo|cobertura|cubre)/.test(t)) intent='seguros';
    else if (/(ver ejemplos|ejemplos|ejemplo)/.test(t)) intent='ejemplos';
    else if (/(como funcionan|c[oó]mo trabajan|que hacen|proceso|metodologia)/.test(t)) intent='operacion';
    else if (/(oficina|estado|factura|virtual)/.test(t)) intent='oficina';
    else if (/(simul|canon|cu[aá]nto me queda)/.test(t)) intent='simular';
    res.json({ intent, t });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});
app.post('/api/chat', async (req,res) => {
  try {
    const out = await handleWebhookPayload(req.body || {});
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log("BlueHome backend listening on", PORT));