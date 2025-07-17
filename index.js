import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const prompt = process.env.BLUEHOME_PROMPT || "Eres el asistente de Blue Home Inmobiliaria...";

const history = {};

app.post('/api/chat', async (req, res) => {
  const { userId, pregunta } = req.body;
  if (!userId || !pregunta) return res.status(400).json({ error: "Missing fields" });

  history[userId] = history[userId] || [];
  history[userId].push({ role: "user", content: pregunta });

  const mensajes = [
    { role: "system", content: prompt },
    ...(history[userId] || [])
  ];

  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-4",
      messages: mensajes
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });

    const respuesta = response.data.choices[0].message.content;
    history[userId].push({ role: "assistant", content: respuesta });
    res.json({ respuesta });
  } catch (error) {
    res.status(500).json({ error: "Error en OpenAI", details: error.message });
  }
});

app.get('/api/simi/:code', async (req, res) => {
  const code = req.params.code;
  try {
    const response = await axios.get(
      `https://simi-api.com/iframeNvo/index.php`,
      {
        params: {
          inmo: '901',
          typebox: '1',
          numbbox: '3',
          viewtitlesearch: '1',
          titlesearch: 'Buscador de Inmuebles',
          colortitlesearch: 'FFFFFF',
          bgtitlesearch: '0076BD',
          secondct: '0076BD',
          primaryc: '0076BD',
          primaryct: 'ffff',
          token: process.env.SIMI_API_TOKEN,
          code: code
        }
      }
    );
    res.json({ data: response.data });
  } catch (error) {
    res.status(500).json({ error: "Error consultando API de Simi", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));