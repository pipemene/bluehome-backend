
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
    vip_admin: '¡claro que sí! Te daremos trato VIP: plataformas de publicación, seguimiento y reportes claros. Tu confianza es nuestro mayor compromiso.\n\nNota Interna: Este cliente está interesado en entregar su inmueble. ¡Atención personalizada inmediata!',
    ask_canon_value: 'para simular, dime el valor del canon (en números).',
    fallback: '¿Quieres ver inmuebles o vender uno? También puedo simular descuentos de tu canon, darte horarios, dirección o ponerte con un asesor.'
  }
};

let promptMeta = { source: PROMPT_FILE, mtimeMs: 0, loadedAt: 0, remote: false, ok: false, error: null };

async function fetchRemotePrompt(url) {
  try {
    const resp = await axios.get(url, { timeout: 8000 });
    if (typeof resp.data === 'object') return resp.data;
    return JSON.parse(resp.data);
  } catch (e) {
    throw new Error('PROMPT_URL fetch failed: ' + e.message);
  }
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

// initial load
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

// ---- Response templates based on prompt ----
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
  const name = st.name || user_name || '';

  // ---- Canon simulation intent
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
    return { messages: [{ type:'text', text: lines.join('\n') }], quick_replies: ['Quiero que administren mi inmueble','Ver inmuebles','Hablar con asesor'], context: { session_id: session } };
  }
  if (t.includes('canon')) {
    const ask = (promptCfg.messages && promptCfg.messages.ask_canon_value) || 'para simular, dime el valor del canon (en números).';
    return { messages: [{ type:'text', text: namePrefix(name) + ask }], context: { session_id: session } };
  }

  // ---- VIP seller intent
  if (/(administren ustedes|administrenlo|administre[n]? mi inmueble|administra[r]? mi inmueble|necesito que lo arrienden|entregarles el inmueble|quiero que lo administren|quiero que administren)/.test(t)) {
    const vip = (promptCfg.messages && promptCfg.messages.vip_admin) || 'Te daremos trato VIP. ¡Atención personalizada inmediata!';
    const msg = namePrefix(name) + vip;
    return { messages: [{ type:'text', text: msg }], quick_replies: ['Hablar con asesor','Simular canon','Ver inmuebles'], context: { session_id: session, lead: { intent: 'admin_service' } } };
  }

  // ---- General intents
  if (/(hola|buenas|buen d[ií]a|buena[s]? tardes?)/.test(t) || /(qu[ié]nes son|a qu[eé] se dedican|qu[eé] hacen)/.test(t)) {
    return { messages: [{ type:'text', text: namePrefix(name) + msgCompanyIntro() }], quick_replies: ['Ver inmuebles','Vender inmueble','Hablar con asesor'], context: { session_id: session } };
  }
  if (/(horario|abren|cierran|hora[s]? de atenci[oó]n)/.test(t)) {
    return { messages: [{ type:'text', text: namePrefix(name) + msgHours() }], quick_replies: ['Ver inmuebles','Hablar con asesor'], context: { session_id: session } };
  }
  if (/(ubicaci[oó]n|direccion|direcci[oó]n|donde estan|dónde est[áa]n|como llegar)/.test(t)) {
    return { messages: [{ type:'text', text: namePrefix(name) + msgAddress() }], quick_replies: ['Ver inmuebles','Hablar con asesor'], context: { session_id: session } };
  }
  if (/(servicio[s]?|que ofrecen|qu[eé] servicios)/.test(t)) {
    const C = cfgCompany();
    const s = `Servicios: ${C.services.join(', ')}.`;
    return { messages: [{ type:'text', text: namePrefix(name) + s }], quick_replies: ['Ver inmuebles','Vender inmueble','Hablar con asesor'], context: { session_id: session } };
  }
  if (/(financia|cr[eé]dito|leasing|hipoteca|cuota)/.test(t)) {
    const s = 'Manejamos opciones de financiación a través de aliados según tu perfil. ¿Quieres que un asesor te contacte para precalificación?';
    return { messages: [{ type:'text', text: namePrefix(name) + s }], quick_replies: ['Sí, que me contacten','Ver inmuebles'], context: { session_id: session } };
  }
  if (/(asesor|humano|agente|contacto|llamar)/.test(t)) {
    return { messages: [{ type:'text', text: namePrefix(name) + msgTalkToAgent() }], quick_replies: ['Ver inmuebles','Vender inmueble'], context: { session_id: session } };
  }
  if (/(habeas|datos personales|privacidad|tratamiento de datos)/.test(t)) {
    return { messages: [{ type:'text', text: namePrefix(name) + msgPrivacy() }], context: { session_id: session } };
  }

  // ---- Seller mini-form
  if (/(vender|quiero vender|publicar|tasaci[oó]n|avalu[oó])/.test(t) || st.expecting?.startsWith('seller_')) {
    st.seller = st.seller || {};
    if (!st.seller.tipo && !st.expecting) {
      st.expecting = 'seller_tipo'; await saveSession(session, st);
      return { messages: [{ type:'text', text: namePrefix(name) + '¡Perfecto! ¿Qué tipo de inmueble quieres vender? (casa, apartamento, local u otro)' }], context: { session_id: session } };
    }
    if (st.expecting === 'seller_tipo') {
      st.seller.tipo = normalizaTipo(text) || text;
      st.expecting = 'seller_ciudad'; await saveSession(session, st);
      return { messages: [{ type:'text', text: namePrefix(name) + '¿En qué ciudad/barrio está ubicado?' }], context: { session_id: session } };
    }
    if (st.expecting === 'seller_ciudad') {
      st.seller.ciudad = text;
      st.expecting = 'seller_telefono'; await saveSession(session, st);
      const C = cfgCompany();
      const hint = C.whatsapp ? ` (o escríbenos a ${C.whatsapp})` : '';
      return { messages: [{ type:'text', text: namePrefix(name) + '¿Cuál es tu número de contacto?' + hint }], context: { session_id: session } };
    }
    if (st.expecting === 'seller_telefono') {
      st.seller.telefono = text.replace(/[^\d+]/g,'');
      st.expecting = null; await saveSession(session, st);
      const resumen = `✔️ Tipo: ${st.seller.tipo}\n📍 Ciudad: ${st.seller.ciudad}\n📞 Tel: ${st.seller.telefono}`;
      return { messages: [
          { type:'text', text: namePrefix(name) + '¡Gracias! Un asesor te contactará para valoración y publicación de tu inmueble.' },
          { type:'text', text: resumen }
        ],
        quick_replies: ['Ver inmuebles','Hablar con asesor'],
        context: { session_id: session, lead: { seller: st.seller } }
      };
    }
  }

  // ---- Código de inmueble
  if (/\bc(ó|o)digo\b/.test(t) && !/\d{1,4}/.test(t)) {
    st.expecting = 'code'; await saveSession(session, st);
    return { messages: [{ type:'text', text: namePrefix(name) + 'Puedo consultar nuestro Google Sheets. Dime el código (1 a 4 dígitos) y te comparto la información.' }], context: { session_id: session } };
  }
  const code = extractCode(text, st.expecting === 'code');
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

  // ---- Fallback
  const fb = (promptCfg.messages && promptCfg.messages.fallback) || '¿Quieres ver inmuebles o vender uno?';
  st.expecting = null; await saveSession(session, st);
  return { messages: [{ type:'text', text: namePrefix(name) + fb }], quick_replies: ['Ver inmuebles','Tengo código','Simular canon','Hablar con asesor'], context: { session_id: session } };
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
