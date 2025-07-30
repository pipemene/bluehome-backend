import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import bodyParser from 'body-parser';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from 'dotenv';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;
app.use(bodyParser.json());

const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const SHEET_NAME = 'Hoja 1';

let sessionHistory = {};

function resetSession(userId) {
  sessionHistory[userId] = {
    stage: 'start',
    tipo: null,
    presupuesto: null,
    habitaciones: null,
  };
}

app.post('/api/chat', async (req, res) => {
  const { userId, pregunta } = req.body;
  if (!userId || !pregunta) return res.status(400).json({ error: 'Faltan datos.' });

  if (!sessionHistory[userId]) resetSession(userId);

  const input = pregunta.toLowerCase().trim();

  if (input === 'test') {
    resetSession(userId);
    return res.json({ respuesta: 'Reinicié la conversación. ¿En qué puedo ayudarte?' });
  }

  try {
    await doc.useAuthClient(serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle[SHEET_NAME];
    const rows = await sheet.getRows();

    const cleanedRows = rows.map(r => ({
      codigo: r['codigo']?.toString().trim(),
      youtube: r['enlace youtube'],
      ficha: r['ENLACE FICHA TECNICA'],
      habitaciones: r['numero habitaciones'],
      banos: r['numero banos'],
      parqueadero: r['parqueadero'],
      canon: r['valor canon'],
      estado: r['ESTADO']?.toLowerCase().trim(),
      tipo: r['tipo']?.toLowerCase().trim(),
    }));

    const codigoEncontrado = cleanedRows.find(r => input.includes(r.codigo));

    if (codigoEncontrado) {
      if (codigoEncontrado.estado === 'disponible') {
        return res.json({
          respuesta: `📍 Inmueble disponible
Habitaciones: ${codigoEncontrado.habitaciones}, Baños: ${codigoEncontrado.banos}, Parqueadero: ${codigoEncontrado.parqueadero}, Canon: ${codigoEncontrado.canon}
🔗 YouTube: ${codigoEncontrado.youtube}
📄 Ficha técnica: ${codigoEncontrado.ficha}`,
        });
      } else {
        return res.json({ respuesta: `Este inmueble ya no se encuentra disponible.` });
      }
    }

    const session = sessionHistory[userId];

    if (session.stage === 'start') {
      session.stage = 'tipo';
      return res.json({ respuesta: '¿Qué tipo de inmueble estás buscando? (casa, apartamento, apartaestudio o local)' });
    }

    if (session.stage === 'tipo') {
      if (!['casa', 'apartamento', 'aparta estudio', 'local'].includes(input)) {
        return res.json({ respuesta: 'Por favor escribe un tipo válido: casa, apartamento, aparta estudio o local.' });
      }
      session.tipo = input;
      session.stage = ['aparta estudio', 'local'].includes(input) ? 'presupuesto' : 'habitaciones';
      return res.json({ respuesta: session.stage === 'presupuesto' ? '¿Cuál es tu presupuesto máximo de arriendo?' : '¿Cuántas habitaciones necesitas?' });
    }

    if (session.stage === 'habitaciones') {
      const num = parseInt(input);
      if (isNaN(num)) return res.json({ respuesta: 'Por favor ingresa un número válido de habitaciones.' });
      session.habitaciones = num;
      session.stage = 'presupuesto';
      return res.json({ respuesta: '¿Cuál es tu presupuesto máximo de arriendo?' });
    }

    if (session.stage === 'presupuesto') {
      const clean = input.replace(/[.$,]/g, '').replace(/\s/g, '');
      const budget = parseInt(clean.match(/\d+/)?.[0] || '0');
      if (isNaN(budget)) return res.json({ respuesta: 'Por favor ingresa un valor numérico válido.' });
      session.presupuesto = budget;

      let resultados = cleanedRows.filter(r =>
        r.estado === 'disponible' &&
        r.tipo === session.tipo &&
        parseInt(r['canon'].replace(/[.$,]/g, '')) <= budget
      );

      if (session.habitaciones !== null) {
        resultados = resultados.filter(r => parseInt(r.habitaciones) >= session.habitaciones);
      }

      if (resultados.length === 0) {
        return res.json({ respuesta: 'No encontramos inmuebles disponibles con esos criterios. ¿Quieres intentar con otro presupuesto o tipo?' });
      }

      const respuesta = resultados.slice(0, 3).map(r =>
        `Código ${r.codigo} - ${r.tipo}, ${r.habitaciones} hab, ${r.banos} baños, Canon ${r.canon}
🔗 ${r.youtube}`
      ).join('

');

      resetSession(userId);
      return res.json({ respuesta: `Te presento algunas opciones:

${respuesta}` });
    }

    return res.json({ respuesta: '¿Tienes alguna duda?' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
});