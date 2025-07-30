
import express from 'express';
import bodyParser from 'body-parser';
import fetch from 'node-fetch';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(bodyParser.json());

const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
let sheet;

async function loadSheet() {
  await doc.useApiKey(process.env.GOOGLE_API_KEY);
  await doc.loadInfo();
  sheet = doc.sheetsByIndex[0];
}
await loadSheet();

const sessions = {};

function resetContext(userId) {
  sessions[userId] = { step: 'inicio', tipo: null, presupuesto: null, habitaciones: null };
}

function sanitizeCanon(value) {
  return parseInt(String(value).replace(/[^0-9]/g, ''));
}

function formatNumber(num) {
  return num.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
}

app.post('/api/chat', async (req, res) => {
  const { userId, pregunta } = req.body;
  if (!userId || !pregunta) return res.status(400).json({ error: 'Faltan datos.' });

  if (!sessions[userId]) resetContext(userId);
  if (pregunta.toLowerCase().trim() === 'test') {
    resetContext(userId);
    return res.json({ respuesta: '¡Listo! Reiniciamos todo desde cero. ¿Qué tipo de inmueble estás buscando? (casa, apartamento, aparta estudio o local)' });
  }

  const session = sessions[userId];

  const rows = await sheet.getRows();
  const inmuebles = rows.map(row => ({
    codigo: row.codigo,
    estado: row.ESTADO,
    tipo: (row.tipo || '').toLowerCase().trim(),
    canon: sanitizeCanon(row['valor canon']),
    habitaciones: parseInt(row['numero habitaciones'] || '0'),
    banos: row['numero banos'],
    parqueadero: row.parqueadero,
    enlace: row['enlace youtube'],
  }));

  const codigoDetectado = pregunta.match(/\b\d{1,4}\b/);
  if (codigoDetectado) {
    const codigo = codigoDetectado[0];
    const inmueble = inmuebles.find(i => i.codigo == codigo);
    if (inmueble) {
      if ((inmueble.estado || '').toLowerCase() === 'disponible') {
        return res.json({
          respuesta: `El inmueble con código ${codigo} está disponible. Tiene ${inmueble.habitaciones} habitaciones y un canon de ${formatNumber(inmueble.canon)}. Mira el video aquí: ${inmueble.enlace}`,
        });
      } else {
        return res.json({ respuesta: `Este inmueble ya no se encuentra disponible.` });
      }
    }
  }

  // Flujo guiado
  if (session.step === 'inicio') {
    session.step = 'tipo';
    return res.json({ respuesta: '¿Qué tipo de inmueble estás buscando? (casa, apartamento, aparta estudio o local)' });
  }

  if (session.step === 'tipo') {
    const tipo = pregunta.toLowerCase().trim();
    if (!['casa', 'apartamento', 'aparta estudio', 'local'].includes(tipo)) {
      return res.json({ respuesta: 'Por favor escribe un tipo válido: casa, apartamento, aparta estudio o local.' });
    }
    session.tipo = tipo;
    session.step = 'presupuesto';
    return res.json({ respuesta: '¿Cuál es tu presupuesto máximo de arriendo?' });
  }

  if (session.step === 'presupuesto') {
    const match = pregunta.replace(/[^0-9]/g, '');
    if (!match) return res.json({ respuesta: 'Por favor indícame un valor numérico para el presupuesto.' });
    session.presupuesto = parseInt(match);
    if (['casa', 'apartamento'].includes(session.tipo)) {
      session.step = 'habitaciones';
      return res.json({ respuesta: '¿Cuántas habitaciones necesitas?' });
    } else {
      session.step = 'listo';
    }
  }

  if (session.step === 'habitaciones') {
    const hab = parseInt(pregunta);
    if (isNaN(hab)) return res.json({ respuesta: 'Por favor indica un número válido de habitaciones.' });
    session.habitaciones = hab;
    session.step = 'listo';
  }

  if (session.step === 'listo') {
    const resultados = inmuebles.filter(i =>
      (i.estado || '').toLowerCase() === 'disponible' &&
      (i.tipo === session.tipo) &&
      (i.canon <= session.presupuesto) &&
      (['casa', 'apartamento'].includes(session.tipo) ? i.habitaciones >= session.habitaciones : true)
    ).slice(0, 3);

    if (resultados.length === 0) {
      return res.json({ respuesta: 'No encontré inmuebles que coincidan con tu búsqueda. ¿Deseas intentar con otros criterios?' });
    }

    const respuesta = resultados.map(i =>
      `Código ${i.codigo}: ${i.habitaciones} habitaciones - Canon ${formatNumber(i.canon)} - [Ver video](${i.enlace})`
    ).join('\n');

    resetContext(userId);
    return res.json({ respuesta: `Encontré estas opciones para ti:\n${respuesta}` });
  }

  // Pregunta libre
  const completion = await openai.chat.completions.create({
    messages: [{ role: 'user', content: pregunta }],
    model: 'gpt-4',
  });
  return res.json({ respuesta: completion.choices[0].message.content });
});

app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
