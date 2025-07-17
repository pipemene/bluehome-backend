
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const prompt = process.env.BLUEHOME_PROMPT || "Eres el asistente de Blue Home Inmobiliaria...";

// Función para enviar respuesta a ManyChat
const enviarRespuestaManychat = async (userId, respuesta) => {
  try {
    await axios.post("https://api.manychat.com/fb/sendContent", {
      subscriber_id: userId,
      data: {
        version: "v2",
        content: {
          messages: [
            { type: "text", text: respuesta }
          ]
        }
      }
    }, {
      headers: {
        "Authorization": `Bearer ${process.env.MANYCHAT_API_KEY}`,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error al enviar a ManyChat:", error.message);
  }
};

app.post('/api/chat', async (req, res) => {
  const { userId, pregunta } = req.body;
  if (!userId || !pregunta) return res.status(400).json({ error: "Faltan campos" });

  res.json({ message: "Procesando..." }); // Respuesta inmediata para evitar timeout

  try {
    const context = `Usuario ${userId}: ${pregunta}`;
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-4",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: context }
      ]
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });

    const respuesta = response.data.choices[0].message.content;
    await enviarRespuestaManychat(userId, respuesta);
  } catch (error) {
    console.error("Error al procesar mensaje:", error.message);
    await enviarRespuestaManychat(userId, "Lo siento, ocurrió un error al procesar tu mensaje.");
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
