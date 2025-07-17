import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const prompt = process.env.BLUEHOME_PROMPT || "Eres el asistente de Blue Home Inmobiliaria...";
const historiales = {};

app.post('/api/chat', async (req, res) => {
  const { userId, pregunta } = req.body;
  if (!userId || !pregunta) return res.status(400).json({ error: "Missing fields" });

  if (!historiales[userId]) {
    historiales[userId] = [{ role: "system", content: prompt }];
  }

  historiales[userId].push({ role: "user", content: pregunta });

  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-4",
      messages: historiales[userId],
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });

    const respuesta = response.data.choices[0].message.content;
    historiales[userId].push({ role: "assistant", content: respuesta });

    res.json({ respuesta });
  } catch (error) {
    res.status(500).json({ error: "Error en OpenAI", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));