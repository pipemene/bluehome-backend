import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const prompt = process.env.BLUEHOME_PROMPT || "Eres el asistente de Blue Home Inmobiliaria...";
const SHEETS_CSV_URL = process.env.SHEETS_CSV_URL;

const historial = {};

function calcularCostos(canon) {
  const administracion = canon * 0.105;
  const iva = administracion * 0.19;
  const amparoBasico = canon * 0.0205;
  const total = administracion + iva + amparoBasico;
  const primerMes = total + ((canon + 1423500) * 0.1231);
  return {
    mensual: total.toFixed(0),
    primerMes: primerMes.toFixed(0)
  };
}

async function consultarCodigo(codigo) {
  try {
    const response = await fetch(SHEETS_CSV_URL);
    const csv = await response.text();
    const records = parse(csv, { columns: true, skip_empty_lines: true });
    const inmueble = records.find(row => row.Codigo.trim() === codigo.trim());

    if (!inmueble) return "No encontré un inmueble con ese código. Verifica si está bien escrito.";

    return `🏡 Inmueble código ${codigo}:
- ${inmueble.Habitaciones} habitaciones
- ${inmueble.Banos} baños
- Parqueadero: ${inmueble.Parqueadero}
- Canon: $${Number(inmueble.Canon).toLocaleString()}
🎥 Video: ${inmueble.YouTube}`;
  } catch (error) {
    return "Hubo un problema consultando la base de datos. Intenta nuevamente.";
  }
}

app.post('/api/chat', async (req, res) => {
  const { userId, pregunta } = req.body;
  if (!userId || !pregunta) return res.status(400).json({ error: "Faltan datos" });

  historial[userId] = historial[userId] || [];
  historial[userId].push({ role: "user", content: pregunta });

  const trimmed = pregunta.trim();
  if (/^\d{3,5}$/.test(trimmed)) {
    const respuesta = await consultarCodigo(trimmed);
    historial[userId].push({ role: "assistant", content: respuesta });
    return res.json({ respuesta });
  }

  const mensajes = [
    { role: "system", content: prompt },
    ...historial[userId]
  ];

  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-3.5-turbo",
      messages,
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });

    const respuesta = response.data.choices[0].message.content;
    historial[userId].push({ role: "assistant", content: respuesta });
    res.json({ respuesta });
  } catch (error) {
    res.status(500).json({ error: "Error en OpenAI", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
