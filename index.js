import express from 'express';
import { config } from 'dotenv';
import bodyParser from 'body-parser';
import { OpenAI } from 'openai';

config(); // Cargar variables del .env

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post('/api/chat', async (req, res) => {
  try {
    const { pregunta } = req.body;

    if (!pregunta) {
      return res.status(400).json({ error: 'Falta el campo "pregunta"' });
    }

    const completion = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: 'Eres un asistente de una inmobiliaria en Palmira. Responde claro y directo.' },
        { role: 'user', content: pregunta },
      ],
      model: 'gpt-4o',
    });

    const respuesta = completion.choices[0]?.message?.content || 'Sin respuesta';
    res.json({ respuesta });

  } catch (error) {
    console.error('[ERROR GPT]', error);
    res.status(500).json({ error: 'Error generando respuesta de ChatGPT', detalle: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});