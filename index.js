import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as dotenv from 'dotenv';
import fs from 'fs';
import csv from 'csv-parser';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const prompt = process.env.BLUEHOME_PROMPT || "Eres el asistente de Blue Home Inmobiliaria...";
const GOOGLE_SHEET_CSV = process.env.GOOGLE_SHEET_CSV;

const historial = {};

function calcularTarifas(canon) {
  const canonNum = parseInt(canon, 10);
  if (isNaN(canonNum)) return null;

  const admin = canonNum * 0.105;
  const iva = admin * 0.19;
  const amparo = canonNum * 0.0205;
  const total = admin + iva + amparo;

  return {
    admin: admin.toFixed(0),
    iva: iva.toFixed(0),
    amparo: amparo.toFixed(0),
    total: total.toFixed(0),
    neto: (canonNum - total).toFixed(0)
  };
}

async function buscarInmueblePorCodigo(codigo) {
  return new Promise((resolve, reject) => {
    const resultados = [];
    fs.createReadStream(GOOGLE_SHEET_CSV)
      .pipe(csv())
      .on('data', (data) => resultados.push(data))
      .on('end', () => {
        const encontrado = resultados.find(row => row.CODIGO === codigo);
        resolve(encontrado || null);
      })
      .on('error', reject);
  });
}

app.post('/api/chat', async (req, res) => {
  const { userId, pregunta } = req.body;
  if (!userId || !pregunta) return res.status(400).json({ error: "Missing fields" });

  const historialUsuario = historial[userId] || [];
  historialUsuario.push({ role: "user", content: pregunta });

  try {
    let contextMessage = { role: "user", content: pregunta };

    const matchCanon = pregunta.match(/canon.*?(\d{6,})/i);
    if (matchCanon) {
      const valor = matchCanon[1];
      const calculo = calcularTarifas(valor);
      if (calculo) {
        contextMessage.content += ` El canon es ${valor}. Cálculo automático: Administración ${calculo.admin}, IVA ${calculo.iva}, Amparo Básico ${calculo.amparo}. Total ${calculo.total}. Neto ${calculo.neto}.`;
      }
    }

    const matchCodigo = pregunta.match(/\b(\d{4,6})\b/);
    if (matchCodigo) {
      const info = await buscarInmueblePorCodigo(matchCodigo[1]);
      if (info) {
        contextMessage.content += ` Información del inmueble ${info.CODIGO}: ${info.DIRECCION}, ${info.ESTRATO}, ${info.HABITACIONES} habitaciones, ${info.BANOS} baños, valor ${info.VALOR}, video: ${info.YOUTUBE}`;
      }
    }

    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: prompt },
        ...historialUsuario,
        contextMessage
      ]
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });

    const respuesta = response.data.choices[0].message.content;
    historialUsuario.push({ role: "assistant", content: respuesta });
    historial[userId] = historialUsuario.slice(-10);

    res.json({ respuesta });
  } catch (error) {
    res.status(500).json({ error: "Error en OpenAI", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));