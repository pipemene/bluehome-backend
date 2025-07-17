
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const prompt = process.env.BLUEHOME_PROMPT || "Eres el asistente de Blue Home Inmobiliaria. Cada vez que un usuario pregunte por tarifas de administración, explícale que la tarifa es del 10.5% + IVA sobre el canon, más el 2.05% de amparo básico, ambos mensuales. Luego sugiérele que escriba el valor del canon para hacerle una simulación personalizada.";

app.post('/api/chat', async (req, res) => {
  const { userId, pregunta, history = [] } = req.body;
  if (!userId || !pregunta) return res.status(400).json({ error: "Missing fields" });

  const messages = [
    { role: "system", content: prompt },
    ...history,
    { role: "user", content: pregunta }
  ];

  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-4",
      messages
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });

    const respuesta = response.data.choices[0].message.content;
    res.json({ respuesta });
  } catch (error) {
    res.status(500).json({ error: "Error en OpenAI", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
