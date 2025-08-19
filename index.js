
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Papa = require('papaparse');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SHEETS_CSV_URL = process.env.SHEETS_CSV_URL || '';
const DEBUG_YT = String(process.env.DEBUG_YT || 'false').toLowerCase() === 'true';

// ---- PROMPT Loader ----
const PROMPT_FILE = process.env.PROMPT_FILE || path.join(__dirname, 'PROMPT.json');
const PROMPT_AUTO_RELOAD = String(process.env.PROMPT_AUTO_RELOAD || 'true').toLowerCase() === 'true';
const PROMPT_URL = process.env.PROMPT_URL || '';

let promptCfg = {
  identity: { assistant_name: 'MarianAI', company_name: 'Blue Home Inmobiliaria', description: 'Empresa premium en administración de propiedades.', location: 'Palmira, Colombia' },
  tone: 'breve, profesional y cercana',
  services: ['Administración','Arriendo','Venta','Avalúos'],
  contact: { cities: ['Palmira','Cali'], hours: 'Lun-Vie 9:00-18:00, Sáb 9:00-13:00', address: 'Palmira, Valle del Cauca', whatsapp: '', phone: '', email: '', website: '', privacy_url: '' },
  simulation: { smmlv: 1423500, admin_base_pct: 10.5, iva_pct: 19, amparo_basico_pct: 2.05, amparo_integral_pct: 12.31 },
  messages: {
    ask_canon_value: 'Para simular, dime el valor del canon (en números).',
    admin_pitch: '',
    admin_fee: '',
    fallback: '¿Deseas que administremos tu inmueble, simular tu canon o consultar un código para ver la ficha?'
  }
};

let promptMeta = { source: PROMPT_FILE, mtimeMs: 0, loadedAt: 0, remote: false, ok: false, error: null };

async function fetchRemotePrompt(url) {
  const resp = await axios.get(url, { timeout: 8000 });
  if (typeof resp.data === 'object') return resp.data;
  return JSON.parse(resp.data);
}
function mergeDeep(target, source) {
  for (const k of Object.keys(source || {})) {
    if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
      target[k] = mergeDeep(target[k] || {}, source[k]);
    } else {
      target[k] = source[k];
    }
  }
  return target;
}
async function loadPrompt(force=false) {
  try {
    if (PROMPT_URL) {
      const data = await fetchRemotePrompt(PROMPT_URL);
      promptCfg = mergeDeep(promptCfg, data || {});
      promptMeta = { source: PROMPT_URL, mtimeMs: Date.now(), loadedAt: Date.now(), remote: true, ok: true, error: null };
      return;
    }
    const p = PROMPT_FILE;
    if (!fs.existsSync(p)) throw new Error('PROMPT_FILE not found: ' + p);
    const stat = fs.statSync(p);
    if (!force && promptMeta.mtimeMs === stat.mtimeMs) return;
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    promptCfg = mergeDeep(promptCfg, data || {});
    promptMeta = { source: p, mtimeMs: stat.mtimeMs, loadedAt: Date.now(), remote: false, ok: true, error: null };
  } catch (e) {
    promptMeta = { ...promptMeta, ok: false, error: e.message, loadedAt: Date.now() };
    console.error('[prompt] load error:', e.message);
  }
}
function maybeReloadPrompt() {
  if (!PROMPT_AUTO_RELOAD || PROMPT_URL) return;
  try {
    const p = PROMPT_FILE;
    if (!fs.existsSync(p)) return;
    const stat = fs.statSync(p);
    if (promptMeta.mtimeMs !== stat.mtimeMs) loadPrompt(true);
  } catch {}
}
loadPrompt(true);

// ---- Optional Redis for persistent sessions ----
const REDIS_URL = process.env.REDIS_URL || '';
const SESSION_TTL_SECONDS = parseInt(process.env.SESSION_TTL_SECONDS || '86400', 10);
let redis = null;
if (REDIS_URL) {
  try {
    const IORedis = require('ioredis');
    redis = new IORedis(REDIS_URL, { lazyConnect: true });
    redis.on('error', (e) => console.error('[redis] error', e.message));
    redis.connect().catch(()=>{});
    console.log('[redis] enabled');
  } catch (e) {
    console.error('[redis] not enabled:', e.message);
  }
}

// ---- Company & simulation values (from prompt, env overrides) ----
function cfgCompany() {
  const c = promptCfg.contact || {};
  const id = promptCfg.identity || {};
  const services = Array.isArray(promptCfg.services) ? promptCfg.services : [];
  return {
    name: process.env.COMPANY_NAME || id.company_name || 'Blue Home Inmobiliaria',
    desc: process.env.COMPANY_SHORT_DESC || id.description || '',
    services,
    cities: (process.env.CITIES ? process.env.CITIES.split(',').map(s=>s.trim()) : (c.cities || [])),
    hours: process.env.HOURS || c.hours || '',
    address: process.env.ADDRESS || c.address || '',
    whatsapp: process.env.WHATSAPP || c.whatsapp || '',
    phone: process.env.PHONE || c.phone || '',
    email: process.env.EMAIL || c.email || '',
    website: process.env.WEBSITE || c.website || '',
    privacy: process.env.PRIVACY_URL || c.privacy_url || ''
  };
}
function cfgSim() {
  const s = promptCfg.simulation || {};
  return {
    SMMLV: parseInt(process.env.SMMLV || s.smmlv || 1423500, 10),
    ADMIN_BASE_PCT: parseFloat(process.env.ADMIN_BASE_PCT || s.admin_base_pct || 10.5),
    IVA_PCT: parseFloat(process.env.IVA_PCT || s.iva_pct || 19),
    AMPARO_BASICO_PCT: parseFloat(process.env.AMPARO_BASICO_PCT || s.amparo_basico_pct || 2.05),
    AMPARO_INTEGRAL_PCT: parseFloat(process.env.AMPARO_INTEGRAL_PCT || s.amparo_integral_pct || 12.31),
  };
}

// ---- Session helpers ----
const stateByUser = new Map();
async function loadSession(sessionId) {
  try { if (redis) { const raw = await redis.get(`sess:${sessionId}`); if (raw) return JSON.parse(raw); } }
  catch (e) { console.error('[redis] load error', e.message); }
  return stateByUser.get(sessionId) || { expecting: null, filters: {}, seller: {}, name: '' };
}
async function saveSession(sessionId, state) {
  try { if (redis) await redis.set(`sess:${sessionId}`, JSON.stringify(state), 'EX', SESSION_TTL_SECONDS); }
  catch (e) { console.error('[redis] save error', e.message); }
  stateByUser.set(sessionId, state);
}
async function resetSession(sessionId) {
  try { if (redis) await redis.del(`sess:${sessionId}`); } catch (e) { console.error('[redis] del error', e.message); }
  stateByUser.delete(sessionId);
}

// ---- CSV + parsing ----
let cacheCsv = { ts: 0, items: [] };
let lastFetchInfo = { ts: 0, url: SHEETS_CSV_URL, ok: false, error: null, contentType: null, head: null, length: 0 };

function normalizeEstado(v='') {
  const t = String(v || '').toLowerCase().trim();
  if (['disponible','yes','si','sí','available','true','1','ok'].includes(t)) return 'disponible';
  if (['no','ocupado','rentado','retirado','vendido','indisponible','false','0','n/a'].includes(t)) return 'no_disponible';
  return t || 'no_disponible';
}

async function fetchProperties() {
  const now = Date.now();
  if (now - cacheCsv.ts < 60_000 && cacheCsv.items.length) return cacheCsv.items;
  if (!SHEETS_CSV_URL) return [];
  try {
    const resp = await axios.get(SHEETS_CSV_URL, { timeout: 10000 });
    const csv = resp.data;
    const ct = (resp.headers && (resp.headers['content-type'] || resp.headers['Content-Type'])) || '';
    lastFetchInfo = { ts: now, url: SHEETS_CSV_URL, ok: true, error: null, contentType: ct, head: String(csv).slice(0,300), length: String(csv).length };
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
    const rows = (parsed.data || []).map(r => {
      const get = (k) => r[k] ?? r[k?.toUpperCase?.()] ?? r[k?.toLowerCase?.()];
      const codigo = get('codigo') ?? get('código') ?? get('Codigo') ?? get('Código');
      const yt = get('enlace youtube') ?? get('youtube') ?? get('enlace_youtube');
      const ficha = get('ENLACE FICHA TECNICA') ?? get('ficha') ?? get('enlace ficha tecnica');
      const hab = get('numero habitaciones') ?? get('habitaciones') ?? get('habs');
      const banos = get('numero banos') ?? get('baños') ?? get('banos');
      const parque = get('parqueadero') ?? get('parqueo') ?? get('parqueaderos');
      const canon = get('valor canon') ?? get('canon') ?? get('precio') ?? get('valor');
      const estado = (get('ESTADO') ?? get('estado') ?? '').toString();
      const tipo = get('TIPO') ?? get('tipo') ?? '';
      return {
        codigo: (codigo ?? '').toString().trim(),
        youtube: (yt ?? '').toString().trim(),
        ficha: (ficha ?? '').toString().trim(),
        habitaciones: parseInt((hab ?? '0').toString().replace(/\D/g,'')) || 0,
        banos: parseInt((banos ?? '0').toString().replace(/\D/g,'')) || 0,
        parqueadero: parseInt((parque ?? '0').toString().replace(/\D/g,'')) || 0,
        canon: (canon ?? '').toString().trim(),
        estado: estado.toLowerCase(),
        estadoNorm: normalizeEstado(estado),
        tipo: (tipo ?? '').toString().toLowerCase().trim(),
      };
    }).filter(r => r.codigo);
    cacheCsv = { ts: now, items: rows };
    return rows;
  } catch (e) {
    lastFetchInfo = { ts: now, url: SHEETS_CSV_URL, ok: false, error: e.message, contentType: null, head: null, length: 0 };
    return [];
  }
}

async function propertyByCodeLoose(code) {
  const items = await fetchProperties();
  const c = String(code||'').trim();
  if (!c) return null;
  return items.find(p => String(p.codigo) === c) || null;
}
async function searchProperties({ tipo='', presupuesto=0, habitaciones=0 }) {
  const items = await fetchProperties();
  const presNum = parseInt(presupuesto || 0, 10) || 0;
  const habs = parseInt(habitaciones || 0, 10) || 0;
  const t = String(tipo||'').toLowerCase().trim();
  const result = items.filter(p => {
    if (t && p.tipo !== t) return false;
    if (presNum && p.canon) {
      const v = parseInt(String(p.canon).replace(/[^\d]/g,''),10) || 0;
      if (v > presNum) return false;
    }
    if (habs && p.habitaciones < habs) return false;
    return (p.estadoNorm || p.estado) === 'disponible';
  }).slice(0,5);
  return result;
}

// ---- Utils ----
function wantsReset(text='') {
  const t = String(text || '').toLowerCase();
  return ['reset','reiniciar','/reset','/start','test'].some(k => t.includes(k));
}
function toNumber(x) {
  const n = String(x || '').replace(/[^\d]/g,'');
  return n ? parseInt(n,10) : 0;
}
function normalizaTipo(text='') {
  const t = String(text||'').toLowerCase();
  if (t.includes('apartamento')) return 'apartamento';
  if (t.includes('casa')) return 'casa';
  if (t.includes('apartaestudio') || t.includes('apartestudio')) return 'apartaestudio';
  if (t.includes('local')) return 'local';
  return '';
}
function extractCode(text, force=false) {
  const d = String(text||'').match(/\d{1,4}/);
  return force && !d ? '' : (d ? d[0] : '');
}
function renderProperty(p) {
  let lines = [];
  lines.push(`🏠 Código ${p.codigo}${(p.estadoNorm||p.estado)!=='disponible' ? ' (no disponible)' : ''}`);
  if (p.tipo) lines.push(`Tipo: ${p.tipo}`);
  if (p.habitaciones) lines.push(`Habitaciones: ${p.habitaciones}`);
  if (p.banos) lines.push(`Baños: ${p.banos}`);
  if (p.parqueadero) lines.push(`Parqueaderos: ${p.parqueadero}`);
  if (p.canon) lines.push(`Canon: ${p.canon}`);
  if (p.ficha) lines.push(`📄 Ficha técnica: ${p.ficha}`);
  if (p.youtube) lines.push(`▶️ Video: ${p.youtube}`);
  return lines.join('\n');
}
function fmtCOP(n) { const v = Math.round(n || 0); return '$' + v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function namePrefix(name) { const n = (name||'').trim(); return n ? (n + ', ') : ''; }

// ---- Canon simulation ----
function detectCanonValue(text='') {
  const t = String(text||'').toLowerCase();
  if (!t.includes('canon')) return null;
  const m = t.replace(/[.,]/g,'').match(/(\d{5,9})/);
  return m ? parseInt(m[1],10) : null;
}
function extractAmount(text='') {
  const digits = String(text||'').replace(/[.,]/g,'').match(/\d{5,9}/);
  return digits ? parseInt(digits[0],10) : null;
}
function simulateCanon(canon) {
  const sim = cfgSim();
  const adminRate = (sim.ADMIN_BASE_PCT/100) * (1 + sim.IVA_PCT/100);
  const admin = Math.round(canon * adminRate);
  const amparoBasico = Math.round(canon * (sim.AMPARO_BASICO_PCT/100));
  const amparoIntegral = Math.round((canon + sim.SMMLV) * (sim.AMPARO_INTEGRAL_PCT/100));
  const descMes1 = admin + amparoBasico + amparoIntegral;
  const descMesesSig = admin + amparoBasico;
  const netoMes1 = canon - descMes1;
  const netoMesesSig = canon - descMesesSig;
  return { admin, amparoBasico, amparoIntegral, descMes1, descMesesSig, netoMes1, netoMesesSig };
}

// ---- Response templates ----
function msgCompanyIntro() {
  const C = cfgCompany();
  const s = `Somos ${C.name}. ${C.desc}\nServicios: ${C.services.join(', ')}.\nOperamos en: ${C.cities.join(', ')}.`;
  const contact = [C.whatsapp && `WhatsApp: ${C.whatsapp}`, C.phone && `Tel: ${C.phone}`, C.email && `Email: ${C.email}`, C.website && `Web: ${C.website}`].filter(Boolean).join(' | ');
  return [s, contact].filter(Boolean).join('\n');
}
function msgHours() { return `⏰ Horarios: ${cfgCompany().hours}`; }
function msgAddress() { const C = cfgCompany(); return C.address ? `📍 Dirección: ${C.address}` : '📍 Atendemos principalmente en línea. ¿En qué ciudad estás?'; }
function msgTalkToAgent() { const C = cfgCompany(); const lines = ['Te conecto con un asesor.']; if (C.whatsapp) lines.push(`WhatsApp: ${C.whatsapp}`); if (C.phone) lines.push(`Tel: ${C.phone}`); return lines.join('\n'); }
function msgPrivacy() { const C = cfgCompany(); return C.privacy ? `🔐 Tratamiento de datos: ${C.privacy}` : '🔐 Tratamiento de datos según ley 1581 de 2012.'; }


// ---- Admin staged helpers ----

// ---- Entry role menu
function entryMenu() {
  const m = promptCfg.messages || {};
  const title = m.entry_menu_title || '¿Cómo puedo ayudarte hoy?';
  const opts = m.entry_menu_options || ['Soy propietario','Soy inquilino','Tengo código','Buscar por filtros','Simular canon'];
  return { messages: [{type:'text', text: title}], quick_replies: opts };
}

function adminMenu() {
  const m = promptCfg.messages || {};
  const intro = m.admin_intro_short || 'Nos encargamos de todo.';
  const menu = m.admin_menu || '¿Qué te gustaría saber primero?';
  const opts = m.admin_menu_options || ['Costos','Cómo trabajamos','Oficina Virtual','Simular canon'];
  return {
    messages: [{ type:'text', text: intro }, { type:'text', text: menu }],
    quick_replies: opts
  };
}
function adminChunk(which) {
  const m = promptCfg.messages || {};
  if (/costos|precio|tarifa|comisi/.test(which)) return m.admin_chunk_costos || (m.admin_fee || '');
  if (/oficina|virtual|cuenta|factura/.test(which)) return m.admin_chunk_oficina || '';
  // default to operacion
  return m.admin_chunk_operacion || (m.admin_pitch || '');
}

// ---- Main controller ----
async function handleWebhookPayload(payload) {
  maybeReloadPrompt();

  const { contact_id, user_name, text } = payload || {};
  const session = String(contact_id || user_name || 'anon');
  const st = await loadSession(session);
  if (user_name && !st.name) { st.name = user_name; await saveSession(session, st); }

  if (wantsReset(text)) {
    await resetSession(session);
    return {
      messages: [{ type: 'text', text: 'Contexto reiniciado. ¿Tienes código de inmueble o deseas buscar por filtros?' }],
      quick_replies: ['Tengo código', 'Buscar por filtros', 'Hablar con asesor'],
      context: { session_id: session, reset: true }
    };
  }

  const t = (text || '').toLowerCase().trim();

  // Role quick replies / entry routing
  if (t === 'soy propietario') {
    st.lastIntent = 'admin'; st.adminStage = 'menu'; await saveSession(session, st);
    const menu = adminMenu();
    return { messages: menu.messages, quick_replies: menu.quick_replies, context: { session_id: session } };
  }
  if (t === 'soy inquilino') {
    st.expecting = 'type'; await saveSession(session, st);
    return { messages: [{ type:'text', text: namePrefix(name) + '¿Tienes código o prefieres buscar por filtros?' }], quick_replies: ['Tengo código','Buscar por filtros'] , context: { session_id: session } };
  }

  const name = st.name || user_name || '';

  
  // ---- Admin-service interest (staged)
  if (/(administraci[oó]n.*inmueble|administren ustedes|administrenlo|administre[n]? mi inmueble|administra[r]? mi inmueble|necesito que lo arrienden|entregarles el inmueble|quiero que lo administren|quiero que administren|que lo administren|que administren|manejen mi inmueble|se encarguen de mi inmueble)/.test(t)) {
    st.lastIntent = 'admin'; st.adminStage = 'menu'; await saveSession(session, st);
    const menu = adminMenu();
    return { messages: menu.messages, quick_replies: menu.quick_replies, context: { session_id: session, lead: { intent: 'admin_service' } } };
  }


  // ---- Pricing / fees intent (cuánto cobran / comisión / tarifa)
  if (/(cu[aá]nt[oa]\s*(cobran|cobra|vale|cuesta|cuestan)|tarifa|honorari[oa]s|porcentaje|%|comisi[oó]n)/.test(t)) {
    const amount = extractAmount(text || '');
    const feeTxt = (promptCfg.messages && promptCfg.messages.admin_fee) || '';
    if (amount) {
      const sim = simulateCanon(amount);
      const lines = [
        `${namePrefix(name)}${feeTxt ? feeTxt + '\n\n' : ''}Simulación sobre ${fmtCOP(amount)}:`,
        `• Administración (${cfgSim().ADMIN_BASE_PCT}% + IVA ${cfgSim().IVA_PCT}%): ${fmtCOP(sim.admin)}`,
        `• Amparo básico (${cfgSim().AMPARO_BASICO_PCT}%): ${fmtCOP(sim.amparoBasico)}`,
        `• Primer mes, Amparo integral (${cfgSim().AMPARO_INTEGRAL_PCT}% de canon + SMMLV): ${fmtCOP(sim.amparoIntegral)}`,
        `\nPrimer mes → Descuento total: ${fmtCOP(sim.descMes1)} | Te quedan: ${fmtCOP(sim.netoMes1)}`,
        `Meses siguientes → Descuento: ${fmtCOP(sim.descMesesSig)} | Te quedan: ${fmtCOP(sim.netoMesesSig)}`
      ];
      return { messages: [{ type:'text', text: lines.join('\n') }], quick_replies: ['Hablar con asesor','Ver inmuebles'], context: { session_id: session } };
    }
    const explain = `Nuestra administración se liquida así: Administración ${cfgSim().ADMIN_BASE_PCT}% + IVA ${cfgSim().IVA_PCT}%, Amparo básico ${cfgSim().AMPARO_BASICO_PCT}%, y solo en el primer mes Amparo integral ${cfgSim().AMPARO_INTEGRAL_PCT}% sobre (canon + SMMLV).`;
    const ask = (promptCfg.messages && promptCfg.messages.ask_canon_value) || 'para simular, dime el valor del canon (en números).';
    const txt = [namePrefix(name) + feeTxt, explain, ask].filter(Boolean).join(' ');
    return { messages: [{ type:'text', text: txt }], context: { session_id: session } };
  }

  
  // ---- Admin staged follow-ups
  if (/(^|)(ver ejemplos|ejemplos|ejemplo)(\b|$)/.test(t) && st.lastIntent === 'admin') {
    st.adminStage = 'after_insurance'; saveSession(session, st);
    const title = (promptCfg.messages && promptCfg.messages.admin_insurance_examples_title) || 'Ejemplos:';
    const body = (promptCfg.messages && promptCfg.messages.admin_insurance_examples) || '';
    return { messages: [{ type:'text', text: namePrefix(name) + title + '\n' + body }], quick_replies: ['Ver costos','Simular canon','Cómo trabajamos'], context: { session_id: session } };
  }

  if (st.adminStage === 'menu') {
    if (/(ver ejemplos|ejemplos|ejemplo)/.test(t)) {
      st.adminStage = 'after_insurance'; saveSession(session, st);
      const title = (promptCfg.messages && promptCfg.messages.admin_insurance_examples_title) || 'Ejemplos:';
      const body = (promptCfg.messages && promptCfg.messages.admin_insurance_examples) || '';
      return { messages: [{ type:'text', text: namePrefix(name) + title + '\n' + body }], quick_replies: ['Ver costos','Simular canon','Cómo trabajamos'], context: { session_id: session } };
    }

    if (/(seguro|amparo|cobertura|cubre)/.test(t)) {
      st.adminStage = 'after_insurance'; saveSession(session, st);
      const info = (promptCfg.messages && promptCfg.messages.admin_insurance_explain_short) || 'Amparo básico e integral explicados.';
      return { messages: [{ type:'text', text: namePrefix(name) + info }], quick_replies: ['Ver ejemplos','Ver costos','Simular canon','Cómo trabajamos'], context: { session_id: session } };
    }

  if (st.adminStage === 'pre_costs') {
  if (/(ver ejemplos|ejemplos|ejemplo)/.test(t)) {
    st.adminStage = 'after_insurance'; saveSession(session, st);
    const title = (promptCfg.messages && promptCfg.messages.admin_insurance_examples_title) || 'Ejemplos:';
    const body = (promptCfg.messages && promptCfg.messages.admin_insurance_examples) || '';
    return { messages: [{ type:'text', text: namePrefix(name) + title + '\n' + body }], quick_replies: ['Ver costos','Simular canon','Cómo trabajamos'], context: { session_id: session } };
  }

    const yes = /(s[ií]|si,|sí,|cu[eé]ntame|explicar|explicame|explícame|seguro|amparo)/.test(t);
    const direct = /(ver costos|costos directo|costos ya|ver costo)/.test(t);
    if (yes) {
      st.adminStage = 'after_insurance'; saveSession(session, st);
      const info = (promptCfg.messages && promptCfg.messages.admin_insurance_explain_short) || 'Amparo básico e integral explicados.';
      return { messages: [{ type:'text', text: namePrefix(name) + info }], quick_replies: ['Ver ejemplos','Ver costos','Simular canon','Cómo trabajamos'], context: { session_id: session } };
    }
    if (direct) {
      st.adminStage = 'after_costos'; saveSession(session, st);
      const chunk = adminChunk('costos');
      return { messages: [{ type:'text', text: namePrefix(name) + chunk }], quick_replies: ['Simular canon','Cómo trabajamos','Oficina Virtual','Hablar con asesor'], context: { session_id: session } };
    }
    // If type something else, re-ask
    const q = (promptCfg.messages && promptCfg.messages.admin_pre_costs_question) || '¿Quieres ver qué cubren los seguros antes de los costos?';
    const opts = (promptCfg.messages && promptCfg.messages.admin_pre_costs_options) || ['Sí, cuéntame','Ver costos directo','Simular canon'];
    return { messages: [{ type:'text', text: namePrefix(name) + q }], quick_replies: opts, context: { session_id: session } };
  }

    if (/(costos|precio|tarifa|comisi[oó]n)/.test(t)) {
      st.adminStage = 'after_costos'; await saveSession(session, st);
      const chunk = adminChunk('costos');
      return { messages: [{ type:'text', text: namePrefix(name) + chunk }], quick_replies: ['Simular canon','Cómo trabajamos','Oficina Virtual','Hablar con asesor'], context: { session_id: session } };
    }
    if (/(c[oó]mo trabaj|operaci[oó]n|publicaci[oó]n|qr|video)/.test(t)) {
      st.adminStage = 'after_operacion'; await saveSession(session, st);
      const chunk = adminChunk('operacion');
      return { messages: [{ type:'text', text: namePrefix(name) + chunk }], quick_replies: ['Costos','Oficina Virtual','Simular canon','Hablar con asesor'], context: { session_id: session } };
    }
    if (/(oficina|virtual|cuenta|factura|estado)/.test(t)) {
      st.adminStage = 'after_oficina'; await saveSession(session, st);
      const chunk = adminChunk('oficina');
      return { messages: [{ type:'text', text: namePrefix(name) + chunk }], quick_replies: ['Costos','Cómo trabajamos','Simular canon','Hablar con asesor'], context: { session_id: session } };
    }
    if (/(simulaci[oó]n|simular|canon)/.test(t)) {
      st.adminStage = 'ask_canon'; await saveSession(session, st);
      const ask = (promptCfg.messages && promptCfg.messages.ask_canon_value) || 'para simular, dime el valor del canon (en números).';
      return { messages: [{ type:'text', text: namePrefix(name) + ask }], context: { session_id: session } };
    }
    // If the user clicks one of the menu quick replies exactly
    const m = (promptCfg.messages && promptCfg.messages.admin_menu_options) || ['Costos','Cómo trabajamos','Oficina Virtual','Simular canon'];
    if (m.some(x => t === String(x).toLowerCase())) {
      if (t.includes('costos')) { st.adminStage = 'after_costos'; await saveSession(session, st); const chunk = adminChunk('costos'); return { messages: [{type:'text', text: namePrefix(name)+chunk}], quick_replies: ['Simular canon','Cómo trabajamos','Oficina Virtual','Hablar con asesor'], context: { session_id: session } }; }
      if (t.includes('trabaj')) { st.adminStage = 'after_operacion'; await saveSession(session, st); const chunk = adminChunk('operacion'); return { messages: [{type:'text', text: namePrefix(name)+chunk}], quick_replies: ['Costos','Oficina Virtual','Simular canon','Hablar con asesor'], context: { session_id: session } }; }
      if (t.includes('oficina')) { st.adminStage = 'after_oficina'; await saveSession(session, st); const chunk = adminChunk('oficina'); return { messages: [{type:'text', text: namePrefix(name)+chunk}], quick_replies: ['Costos','Cómo trabajamos','Simular canon','Hablar con asesor'], context: { session_id: session } }; }
      if (t.includes('simular')) { st.adminStage = 'ask_canon'; await saveSession(session, st); const ask = (promptCfg.messages && promptCfg.messages.ask_canon_value) || 'para simular, dime el valor del canon (en números).'; return { messages: [{type:'text', text: namePrefix(name)+ask}], context: { session_id: session } }; }
    }
  }
    if (/^ver costos$/.test(t)) {
    st.adminStage = 'after_costos'; saveSession(session, st);
    const chunk = adminChunk('costos');
    return { messages: [{ type:'text', text: namePrefix(name) + chunk }], quick_replies: ['Simular canon','Cómo trabajamos','Oficina Virtual','Hablar con asesor'], context: { session_id: session } };
  }
  if (st.adminStage === 'ask_canon') {
    const amount = extractAmount(text || '');
    if (!amount) { const ask = (promptCfg.messages && promptCfg.messages.ask_canon_value) || 'para simular, dime el valor del canon (en números).'; return { messages: [{ type:'text', text: namePrefix(name) + ask }], context: { session_id: session } }; }
    const sim = simulateCanon(amount);
    const lines = [
      `${namePrefix(name)}Simulación sobre ${fmtCOP(amount)}:`,
      `• Administración (${cfgSim().ADMIN_BASE_PCT}% + IVA ${cfgSim().IVA_PCT}%): ${fmtCOP(sim.admin)}`,
      `• Amparo básico (${cfgSim().AMPARO_BASICO_PCT}%): ${fmtCOP(sim.amparoBasico)}`,
      `• Primer mes, Amparo integral (${cfgSim().AMPARO_INTEGRAL_PCT}% de canon + SMMLV): ${fmtCOP(sim.amparoIntegral)}`,
      `\nPrimer mes → Descuento total: ${fmtCOP(sim.descMes1)} | Te quedan: ${fmtCOP(sim.netoMes1)}`,
      `Meses siguientes → Descuento: ${fmtCOP(sim.descMesesSig)} | Te quedan: ${fmtCOP(sim.netoMesesSig)}`
    ];
    st.adminStage = 'menu'; await saveSession(session, st);
    const menu = adminMenu();
    return { messages: [{ type:'text', text: lines.join('\n') }], quick_replies: menu.quick_replies, context: { session_id: session } };
  }

// ---- Simulation keyword (e.g., "simular")
  if (/(simulaci[oó]n|simular|simulo|simulemos)/.test(t)) {
    const amount = extractAmount(text || '');
    if (amount) {
      const sim = simulateCanon(amount);
      const lines = [
        `${namePrefix(name)}Simulación sobre ${fmtCOP(amount)}:`,
        `• Administración (${cfgSim().ADMIN_BASE_PCT}% + IVA ${cfgSim().IVA_PCT}%): ${fmtCOP(sim.admin)}`,
        `• Amparo básico (${cfgSim().AMPARO_BASICO_PCT}%): ${fmtCOP(sim.amparoBasico)}`,
        `• Primer mes, Amparo integral (${cfgSim().AMPARO_INTEGRAL_PCT}% de canon + SMMLV): ${fmtCOP(sim.amparoIntegral)}`,
        `\nPrimer mes → Descuento total: ${fmtCOP(sim.descMes1)} | Te quedan: ${fmtCOP(sim.netoMes1)}`,
        `Meses siguientes → Descuento: ${fmtCOP(sim.descMesesSig)} | Te quedan: ${fmtCOP(sim.netoMesesSig)}`
      ];
      return { messages: [{ type:'text', text: lines.join('\n') }], quick_replies: ['Hablar con asesor','Ver inmuebles'], context: { session_id: session } };
    }
    const ask = (promptCfg.messages && promptCfg.messages.ask_canon_value) || 'para simular, dime el valor del canon (en números).';
    return { messages: [{ type:'text', text: namePrefix(name) + ask }], context: { session_id: session } };
  }

  // ---- Canon simulation (when "canon" + number)
  const canonVal = detectCanonValue(text || '');
  if (canonVal) {
    const sim = simulateCanon(canonVal);
    const lines = [
      `${namePrefix(name)}te dejo la simulación sobre un canon de ${fmtCOP(canonVal)}:`,
      `• Administración (${cfgSim().ADMIN_BASE_PCT}% + IVA ${cfgSim().IVA_PCT}%): ${fmtCOP(sim.admin)}`,
      `• Amparo básico (${cfgSim().AMPARO_BASICO_PCT}%): ${fmtCOP(sim.amparoBasico)}`,
      `• Primer mes, Amparo integral (${cfgSim().AMPARO_INTEGRAL_PCT}% de canon + SMMLV): ${fmtCOP(sim.amparoIntegral)}`,
      `\nPrimer mes → Descuento total: ${fmtCOP(sim.descMes1)} | Te quedan: ${fmtCOP(sim.netoMes1)}`,
      `Meses siguientes → Descuento: ${fmtCOP(sim.descMesesSig)} | Te quedan: ${fmtCOP(sim.netoMesesSig)}`
    ];
    return { messages: [{ type:'text', text: lines.join('\n') }], quick_replies: ['Hablar con asesor','Ver inmuebles'], context: { session_id: session } };
  }
  if (t.includes('canon')) {
    const ask = (promptCfg.messages && promptCfg.messages.ask_canon_value) || 'para simular, dime el valor del canon (en números).';
    return { messages: [{ type:'text', text: namePrefix(name) + ask }], context: { session_id: session } };
  }

  // ---- Código de inmueble
  if (/\bc(ó|o)digo\b/.test(t) && !/\d{1,4}/.test(t)) {
    st.expecting = 'code'; await saveSession(session, st);
    return { messages: [{ type:'text', text: namePrefix(name) + 'Puedo consultar nuestro Google Sheets. Dime el código (1 a 4 dígitos) y te comparto la información.' }], context: { session_id: session } };
  }
  const code = (st.adminStage ? '' : extractCode(text, st.expecting === 'code'));
  if (code) {
    const p = await propertyByCodeLoose(code);
    if (!p) {
      st.expecting = 'code'; await saveSession(session, st);
      return { messages: [{ type:'text', text: namePrefix(name) + `No encuentro el código ${code}. Verifica el número o intenta otro.` }], quick_replies: ['Intentar otro código','Buscar por filtros'], context: { session_id: session } };
    }
    if (DEBUG_YT) console.log('[YOUTUBE_CHECK] webhook code=%s youtube=%s', code, p.youtube || '');
    if ((p.estadoNorm || p.estado) !== 'disponible') {
      return { messages: [
          { type:'text', text: namePrefix(name) + `El código ${code} no está disponible ahora.` },
          { type:'text', text: '¿Deseas buscar por filtros para mostrarte opciones similares?' }
        ], quick_replies: ['Sí, buscar por filtros','Hablar con asesor'], context: { session_id: session } };
    }
    st.expecting = null; st.lastIntent = 'property_by_code'; await saveSession(session, st);
    return { messages: [{ type:'text', text: renderProperty(p) }], quick_replies: ['Agendar visita','Ver más opciones','Hablar con asesor'], context: { session_id: session } };
  }

  // ---- Filters/catalog
  if (/(buscar|busco|filtrar|filtro|filtros|otro inmueble|otra opcion|otra opción|mas opciones|más opciones|ver mas|ver más|siguiente|otro|ver inmuebles|portafolio)/.test(t) || st.expecting === 'type' || st.expecting === 'budget' || st.expecting === 'rooms') {
    let tipo = st.filters.tipo || normalizaTipo(text);
    if (!tipo) { st.expecting = 'type'; await saveSession(session, st); return { messages: [{ type:'text', text: namePrefix(name) + '¿Qué tipo buscas? (casa, apartamento, apartaestudio o local)' }], context: { session_id: session } }; }
    st.filters.tipo = tipo; await saveSession(session, st);
    if (!st.filters.presupuesto || st.expecting === 'budget') {
      const pres = toNumber(text);
      if (pres) { st.filters.presupuesto = pres; await saveSession(session, st); }
      else { st.expecting = 'budget'; await saveSession(session, st); return { messages: [{ type:'text', text: namePrefix(name) + '¿Cuál es tu presupuesto máximo (en pesos)?' }], context: { session_id: session } }; }
    }
    const necesitaHabs = !(st.filters.tipo === 'apartaestudio' || st.filters.tipo === 'local');
    if (necesitaHabs && (!st.filters.habitaciones || st.expecting === 'rooms')) {
      const habs = toNumber(text);
      if (habs) { st.filters.habitaciones = habs; await saveSession(session, st); }
      else { st.expecting = 'rooms'; await saveSession(session, st); return { messages: [{ type:'text', text: namePrefix(name) + '¿Cuántas habitaciones mínimo?' }], context: { session_id: session } }; }
    }
    const results = await searchProperties({ tipo: st.filters.tipo, presupuesto: st.filters.presupuesto, habitaciones: necesitaHabs ? st.filters.habitaciones : 0 });
    st.expecting = null; st.lastIntent = 'search_by_filters'; await saveSession(session, st);
    if (!results.length) {
      return { messages: [
        { type:'text', text: namePrefix(name) + 'No encontré inmuebles disponibles que coincidan con tu búsqueda.' },
        { type:'text', text: '¿Quieres ampliar el presupuesto (+10%) o cambiar de zona/tipo?' }
      ], quick_replies: ['Ampliar presupuesto','Cambiar tipo','Hablar con asesor'], context: { session_id: session } };
    }
    return { messages: results.map(p => ({ type:'text', text: renderProperty(p) })), quick_replies: ['Agendar visita','Ver más opciones','Hablar con asesor'], context: { session_id: session } };
  }

  
  // ---- Fallback -> entry menu
  const menu = entryMenu();
  return { messages: [{type:'text', text: (promptCfg.messages && promptCfg.messages.entry_menu_title) || 'Elige una opción:'}], quick_replies: menu.quick_replies, context: { session_id: session } };

}

const app = express();
app.use(express.json());

// Health
app.get('/health', (req,res) => res.json({ ok: true }));

// Prompt debug
app.get('/api/debug/prompt', (req,res) => res.json({ meta: promptMeta, prompt: promptCfg, company: cfgCompany(), sim: cfgSim() }));
app.post('/api/debug/prompt/reload', async (req,res) => { try { await loadPrompt(true); res.json({ ok: promptMeta.ok, meta: promptMeta }); } catch (e) { res.status(500).json({ error: e.message }); } });

// Property API
app.get('/api/property', async (req,res) => {
  try {
    const code = String(req.query.code || '').trim();
    const p = await propertyByCodeLoose(code);
    if (!p) return res.json({ available: false, message: `No encuentro el código ${code}.` });
    if (DEBUG_YT) console.log('[YOUTUBE_CHECK] api code=%s youtube=%s', code, p.youtube || '');
    const available = (p.estadoNorm || p.estado) === 'disponible';
    res.json({ available, property: p, message: renderProperty(p), hasYoutube: !!p.youtube, youtube: p.youtube || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/search', async (req,res) => {
  try {
    const { tipo='', presupuesto=0, habitaciones=0 } = req.body || {};
    const results = await searchProperties({ tipo, presupuesto, habitaciones });
    res.json({ results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ManyChat-like webhook
app.post('/manychat/webhook', async (req,res) => {
  try {
    const resp = await handleWebhookPayload(req.body || {});
    const msgs = (resp && resp.messages) ? resp.messages : [];
    const texts = msgs.map(m => (m && m.text) ? String(m.text) : '').filter(Boolean);
    const joined = texts.slice(0,3).join('\n\n');
    res.json(Object.assign({}, resp, { respuesta: joined || '' }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Alias /api/chat compatible con distintos cuerpos y devuelve {respuesta}
app.post('/api/chat', async (req,res) => {
  try {
    const b = req.body || {};
    const text = b.text || b.pregunta || b.message || (b.input && (b.input.text || b.input)) || b.content || b.last_input || '';
    const payload = {
      contact_id: b.contact_id || b.contact || b.user_id || b.session_id || b.contactId || b.userId || 'anon',
      user_name:  b.user_name  || b.name     || b.full_name || b.username || '',
      text
    };
    const resp = await handleWebhookPayload(payload);
    const msgs = (resp && resp.messages) ? resp.messages : [];
    const texts = msgs.map(m => (m && m.text) ? String(m.text) : '').filter(Boolean);
    const joined = texts.slice(0,3).join('\n\n');
    res.json({ respuesta: joined || '' });
  } catch (e) {
    res.json({ respuesta: '' });
  }
});

// CSV Debug
app.get('/api/debug/env', (req,res) => res.json({ SHEETS_CSV_URL, promptMeta }));
app.get('/api/debug/raw', async (req,res) => {
  try {
    if (String(req.query.refresh || '') === '1') { cacheCsv = { ts:0, items:[] }; await fetchProperties(); }
    res.json(lastFetchInfo);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/debug/codes', async (req,res) => {
  try {
    const items = await fetchProperties();
    res.json({ count: items.length, sample: items.slice(0,10).map(p=>p.codigo) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/debug/peek', async (req,res) => {
  try {
    const code = String(req.query.code || '').trim();
    const p = await propertyByCodeLoose(code);
    res.json({ input: code, found: !!p, property: p || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Server on :${PORT}`));
