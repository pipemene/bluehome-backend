
/**
 * BlueHome Backend – Monolito modular (single-file version)
 * Objetivo: corregir loop de pregunta inicial y priorizar "código {1-4 dígitos}"
 * Runtime: Node.js (CommonJS). Sin Redis para simplificar (usa memoria).
 */
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const morgan = require('morgan');
const { parse } = require('csv-parse');

const app = express();
app.use(express.json({limit: '1mb'}));
app.use(morgan('dev'));

// ---- Config ----
const PORT = process.env.PORT || 3000;
const SHEETS_CSV_URL = process.env.SHEETS_CSV_URL || '';

// ---- Estado en memoria (se puede reemplazar por Redis) ----
/**
 * stateByUser: {
 *   [sessionId]: {
 *      expecting: null | 'type' | 'budget' | 'rooms' | 'code',
 *      filters: { tipo?: string, presupuesto?: number, habitaciones?: number },
 *      lastIntent?: string
 *   }
 * }
 */
const stateByUser = new Map();

// ---- Utilidades ----
const toNumber = (txt='') => {
  const digits = (txt || '').toString().replace(/[^\d]/g, '');
  return digits.length ? Number(digits) : NaN;
};

const normalizaTipo = (txt='') => {
  const t = txt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (t.includes('apart') && t.includes('estud')) return 'apartaestudio';
  if (t.includes('apart')) return 'apartamento';
  if (t.includes('casa')) return 'casa';
  if (t.includes('local')) return 'local';
  return null;
};

// Detecta "codigo 18" / "código 1180" / "el 187" y también si el mensaje es solo 1-4 dígitos cuando se está esperando código.
const extractCode = (text, expectingCode=false) => {
  if (!text) return null;
  const t = text.toLowerCase();
  const reCod = /\b(c[oó]d(?:ig)?o|codigo)?\s*[:#-]?\s*(\d{1,4})\b/;
  const m = t.match(reCod);
  if (m && m[2]) return m[2];
  if (expectingCode) {
    // Si esperamos código y el usuario manda solo números 1-4 dígitos, úsalo
    const only = t.trim();
    if (/^\d{1,4}$/.test(only)) return only;
  }
  return null;
};

const wantsReset = (text='') => /\btest\b/i.test(text);

const isAffirm = (text='') => /\b(si|claro|ok|dale|de una)\b/i.test(text);

// ---- Cache CSV simple ----
let cacheCsv = { ts: 0, items: [] };
const CSV_TTL_MS = 60 * 1000; // 60s

async function fetchProperties() {
  const now = Date.now();
  if (cacheCsv.items.length && now - cacheCsv.ts < CSV_TTL_MS) return cacheCsv.items;
  if (!SHEETS_CSV_URL) return [];
  const resp = await axios.get(SHEETS_CSV_URL, { timeout: 8000 });
  const csv = resp.data;
  return new Promise((resolve, reject) => {
    const out = [];
    parse(csv, { columns: true, skip_empty_lines: true, trim: true }, (err, records) => {
      if (err) return reject(err);
      // Normaliza nombres esperados
      for (const r of records) {
        out.push({
          codigo: String(r['codigo'] || r['CODIGO'] || '').trim(),
          youtube: r['enlace youtube'] || r['ENLACE YOUTUBE'] || r['YOUTUBE'] || '',
          ficha: r['ENLACE FICHA TECNICA'] || r['ficha'] || '',
          habitaciones: Number(r['numero habitaciones'] || r['habitaciones'] || 0),
          banos: Number(r['numero banos'] || r['baños'] || r['banos'] || 0),
          parqueadero: String(r['parqueadero'] || '').trim(),
          canon: Number(String(r['valor canon'] || r['canon'] || '0').replace(/[^\d]/g, '')),
          tipo: (r['tipo'] || '').toString().toLowerCase(),
          estado: (r['ESTADO'] || r['estado'] || 'disponible').toString().toLowerCase(),
          direccion: r['direccion'] || r['DIRECCION'] || ''
        });
      }
      cacheCsv = { ts: now, items: out };
      resolve(out);
    });
  });
}

// ---- Búsquedas ----
async function propertyByCodeLoose(code) {
  const items = await fetchProperties();
  return items.find(p => p.codigo === String(code));
}

async function searchProperties({ tipo, presupuesto, habitaciones }) {
  const items = await fetchProperties();
  return items.filter(p => 
    p.estado === 'disponible' &&
    (!tipo || p.tipo.includes(tipo)) &&
    (!presupuesto || p.canon <= presupuesto) &&
    (!habitaciones || p.habitaciones >= habitaciones)
  ).slice(0, 5);
}

// ---- Mensajes ----
const fmtCurrency = (n) => n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

const renderProperty = (p) => {
  return [
    `🏠 Código ${p.codigo}`,
    p.direccion ? `📍 ${p.direccion}` : null,
    `💲 Canon: ${fmtCurrency(p.canon)}`,
    `🛏️ ${p.habitaciones} hab | 🚿 ${p.banos} baños | 🅿️ ${p.parqueadero || 'N/A'}`,
    p.youtube ? `🎥 Video: ${p.youtube}` : null,
    p.ficha ? `📄 Ficha: ${p.ficha}` : null
  ].filter(Boolean).join('\n');
};

const askTypeBudget = () => ({
  text: "¿Podrías decirme el tipo de inmueble que buscas (casa, apartamento, apartaestudio o local) y tu presupuesto máximo?"
});

// ---- API REST “clásica” ----
app.get('/health', (req,res)=> res.json({ ok:true }));

app.get('/api/property', async (req,res) => {
  try {
    const code = String(req.query.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Missing code' });
    const p = await propertyByCodeLoose(code);
    if (!p) return res.status(404).json({ error: 'Not found' });
    if (p.estado !== 'disponible') {
      return res.json({ available:false, message: 'No disponible', code });
    }
    res.json({ available:true, property: p, message: renderProperty(p) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/search', async (req,res) => {
  try {
    const { tipo, presupuesto, habitaciones } = req.body || {};
    const pres = Number(presupuesto || 0);
    const habs = Number(habitaciones || 0);
    const results = await searchProperties({ tipo, presupuesto: pres, habitaciones: habs });
    res.json({ results, count: results.length, messages: results.map(renderProperty) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Webhook estilo ManyChat simple ----
// Input esperado: { contact_id, user_name, text }

// ---- Shared handler for ManyChat-like payloads ----
async function handleWebhookPayload(payload) {
  const { contact_id, user_name, text } = payload || {};
  const session = String(contact_id || user_name || 'anon');
  if (!stateByUser.has(session)) stateByUser.set(session, { expecting: null, filters: {} });
  const st = stateByUser.get(session);

  // Reset comando
  if (wantsReset(text)) {
    stateByUser.set(session, { expecting: null, filters: {} });
    return {
      messages: [{ type: 'text', text: 'Contexto reiniciado. ¿Tienes código de inmueble o deseas buscar por filtros?' }],
      quick_replies: ['Tengo código', 'Buscar por filtros'],
      context: { session_id: session, reset: true }
    };
  }

  // 1) Prioridad: código de inmueble
  const code = extractCode(text, st.expecting === 'code');
  if (code) {
    const p = await propertyByCodeLoose(code);
    if (!p) {
      st.expecting = 'code';
      return {
        messages: [{ type: 'text', text: `No encuentro el código ${code}. Verifica el número o intenta otro.` }],
        quick_replies: ['Intentar otro código', 'Buscar por filtros'],
        context: { session_id: session }
      };
    }
    if (DEBUG_YT) console.log('[YOUTUBE_CHECK] webhook code=%s youtube=%s', code, p.youtube || '');
    if (p.estado !== 'disponible') {
      return {
        messages: [
          { type:'text', text:`El código ${code} no está disponible ahora.` },
          { type:'text', text:`¿Deseas buscar por filtros para mostrarte opciones similares?` }
        ],
        quick_replies: ['Sí, buscar por filtros','Hablar con asesor'],
        context: { session_id: session }
      };
    }
    // Respuesta propiedad encontrada
    st.expecting = null;
    st.lastIntent = 'property_by_code';
    return {
      messages: [{ type:'text', text: renderProperty(p) }],
      quick_replies: ['Agendar visita','Ver más opciones','Hablar con asesor'],
      context: { session_id: session }
    };
  }

  // 2) Router simple por palabras clave
  const t = (text || '').toLowerCase();
  if (t.includes('tengo codigo') || t.includes('tengo código') || t.includes('codigo') || t.includes('código')) {
    st.expecting = 'code';
    return {
      messages: [{ type: 'text', text: 'Perfecto, dime el código (1 a 4 dígitos).' }],
      context: { session_id: session }
    };
  }
  if (t.includes('buscar por filtros') || t.includes('filtros') || st.expecting === 'type' || st.expecting === 'budget' || st.expecting === 'rooms') {
    // Flujo por filtros
    let tipo = st.filters.tipo || normalizaTipo(text);
    if (!tipo) {
      st.expecting = 'type';
      return { messages: [{ type:'text', text: askTypeBudget().text }], context: { session_id: session } };
    }
    st.filters.tipo = tipo;
    const necesitaHabitaciones = !(tipo === 'apartaestudio' || tipo === 'local');

    const pres = st.filters.presupuesto || toNumber(text);
    if (!st.filters.presupuesto || (st.expecting==='budget' && !pres)) {
      if (toNumber(text)) st.filters.presupuesto = toNumber(text);
      else {
        st.expecting = 'budget';
        return { messages: [{ type:'text', text:'¿Cuál es tu presupuesto máximo (en pesos)?' }], context: { session_id: session } };
      }
    }

    if (necesitaHabitaciones) {
      const habs = st.filters.habitaciones || toNumber(text);
      if (!st.filters.habitaciones || (st.expecting==='rooms' && !habs)) {
        if (toNumber(text)) st.filters.habitaciones = toNumber(text);
        else {
          st.expecting = 'rooms';
          return { messages: [{ type:'text', text:'¿Cuántas habitaciones mínimo?' }], context: { session_id: session } };
        }
      }
    }

    const results = await searchProperties({
      tipo: st.filters.tipo,
      presupuesto: st.filters.presupuesto,
      habitaciones: necesitaHabitaciones ? st.filters.habitaciones : 0
    });
    st.expecting = null;
    st.lastIntent = 'search_by_filters';

    if (!results.length) {
      return {
        messages: [
          { type:'text', text:'No encontré inmuebles disponibles que coincidan con tu búsqueda.' },
          { type:'text', text:'¿Quieres ampliar el presupuesto (+10%) o cambiar de zona/tipo?' }
        ],
        quick_replies: ['Ampliar presupuesto','Cambiar tipo','Hablar con asesor'],
        context: { session_id: session }
      };
    }
    return {
      messages: results.map(p => ({ type:'text', text: renderProperty(p) })),
      quick_replies: ['Agendar visita','Ver más opciones','Hablar con asesor'],
      context: { session_id: session }
    };
  }

  // 3) Fallback
  st.expecting = null;
  return {
    messages: [{ type:'text', text:'¿Tienes código de inmueble o deseas buscar por filtros?' }],
    quick_replies: ['Tengo código','Buscar por filtros','Hablar con asesor'],
    context: { session_id: session }
  };
}

app.post('/manychat/webhook', async (req,res) => { try { const resp = await handleWebhookPayload(req.body || {});
    res.json(normalizeResponse(resp)); } catch(e){ console.error(e); res.status(500).json({error:e.message}); } });
app.listen(PORT, () => {
  console.log(`BlueHome backend running on :${PORT}`);
});



// Ensure flat 'respuesta' for ManyChat JSONPath mapping
function normalizeResponse(resp) {
  try {
    const msgs = (resp && resp.messages) ? resp.messages : [];
    const texts = msgs.map(m => (m && m.text) ? String(m.text) : '').filter(Boolean);
    const first = texts.length ? texts[0] : '';
    // Join up to 3 messages for convenience
    const joined = texts.slice(0,3).join('\n\n');
    return Object.assign({}, resp, { respuesta: joined || first || '' });
  } catch (e) {
    return Object.assign({}, resp, { respuesta: '' });
  }
}

// Alias /api/chat to be compatible with old flows

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
    const norm = normalizeResponse(resp);
    // For ManyChat mapping already configured to "respuesta",
    // return a minimal envelope to avoid any parsing inconsistencies.
    res.json({ respuesta: norm.respuesta });
  } catch (e) {
    console.error(e);
    res.json({ respuesta: '' });
  }
});


async function propertyByCodeLoose(code) {
  const items = await fetchProperties();
  const target = String(code || '').trim();
  const targetDigits = target.replace(/\D/g, '');
  return items.find(p => {
    const c = String(p.codigo || '').trim();
    if (!c) return false;
    if (c === target) return true;
    const cDigits = c.replace(/\D/g, '');
    return cDigits && cDigits === targetDigits;
  });
}

// ---- Debug endpoints ----
app.get('/api/debug/codes', async (req,res) => {
  try {
    const items = await fetchProperties();
    const sample = items.slice(0,10).map(p => p.codigo);
    res.json({ count: items.length, sample });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/debug/peek', async (req,res) => {
  try {
    const codeQ = String(req.query.code || '').trim();
    const p = await propertyByCodeLoose(codeQ);
    res.json({ input: codeQ, found: !!p, property: p || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
