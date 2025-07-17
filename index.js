import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as dotenv from 'dotenv';
import nodemailer from 'nodemailer';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const prompt = process.env.BLUEHOME_PROMPT || "Eres el asistente de Blue Home Inmobiliaria...";

let userContexts = {};

app.post('/api/chat', async (req, res) => {
  const { userId, pregunta } = req.body;
  if (!userId || !pregunta) return res.status(400).json({ error: "Missing fields" });

  if (!userContexts[userId]) userContexts[userId] = [];
  userContexts[userId].push({ role: "user", content: pregunta });

  if (userContexts[userId].length > 10) {
    userContexts[userId] = userContexts[userId].slice(-10);
  }

  try {
    const response = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: "gpt-4",
      messages: [
        { role: "system", content: prompt },
        ...userContexts[userId]
      ]
    }, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });

    const respuesta = response.data.choices[0].message.content;
    userContexts[userId].push({ role: "assistant", content: respuesta });

    if (respuesta.includes("entregar tu inmueble") || respuesta.includes("administración de tu inmueble")) {
      await axios.post("https://api.manychat.com/fb/sending/sendContent", {
        subscriber_id: userId,
        data: { "version": "v2", "content": { "actions": [{ "action": "set_field_value", "field_name": "etiqueta", "field_value": "Interes_Administracion" }] } }
      }, {
        headers: {
          "Authorization": `Bearer ${process.env.MANYCHAT_API_KEY}`,
          "Content-Type": "application/json"
        }
      });

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.NOTIFY_EMAIL,
          pass: process.env.NOTIFY_EMAIL_PASS
        }
      });

      await transporter.sendMail({
        from: process.env.NOTIFY_EMAIL,
        to: process.env.NOTIFY_ALERT_TO,
        subject: "Nuevo cliente interesado en administración",
        text: `Usuario ${userId} mostró interés en entregar su inmueble en administración. Atención personalizada inmediata.`
      });

      await axios.post(`https://api.callmebot.com/whatsapp.php?phone=${process.env.NOTIFY_ALERT_WHATSAPP}&text=${encodeURIComponent("🚨 Cliente interesado en entregar su inmueble. Atención personalizada inmediata.")}&apikey=${process.env.CALLMEBOT_API_KEY}`);
    }

    res.json({ respuesta });
  } catch (error) {
    res.status(500).json({ error: "Error en OpenAI", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));