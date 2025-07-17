import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const prompt = process.env.BLUEHOME_PROMPT || "Eres el asistente de Blue Home Inmobiliaria...";

// Historial en memoria
const historial = new Map();

app.post('/api/chat', async (req, res) => {
  const { userId, pregunta, nombre, etiquetas } = req.body;
  if (!userId || !pregunta) return res.status(400).json({ error: "Faltan datos" });

  // Guardar historial por usuario
  if (!historial.has(userId)) historial.set(userId, []);
  const mensajes = historial.get(userId);
  mensajes.push({ role: "user", content: pregunta });
  if (mensajes.length > 10) mensajes.shift(); // limitar a 10 mensajes

  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-4",
      messages: [
        { role: "system", content: prompt },
        ...mensajes
      ]
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });

    const respuesta = response.data.choices[0].message.content;
    mensajes.push({ role: "assistant", content: respuesta });

    // Notificación VIP si aplica
    if (etiquetas && etiquetas.includes("Interes_Administracion")) {
      await axios.post(process.env.MANYCHAT_NOTIFICATION_URL, {
        mensaje: `🚨 Cliente VIP interesado en entregar su inmueble en administración.
👤 Nombre: ${nombre || "Sin nombre"}
🗣️ Pregunta: ${pregunta}`,
        whatsapp: process.env.COMERCIAL_WHATSAPP,
        correo: process.env.COMERCIAL_EMAIL
      });
    }

    res.json({ respuesta });
  } catch (error) {
    res.status(500).json({ error: "Error OpenAI", detalle: error.message });
  }
});

app.post('/api/sheets', async (req, res) => {
  const { codigo } = req.body;
  if (!codigo) return res.status(400).json({ error: "Falta el código" });

  try {
    const response = await axios.get(`${process.env.SHEETS_API_URL}?codigo=${codigo}`);
    res.json({ resultado: response.data });
  } catch (error) {
    res.status(500).json({ error: "Error Google Sheets", detalle: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ Backend corriendo en puerto " + PORT));
