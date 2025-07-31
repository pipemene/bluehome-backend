import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { GoogleSpreadsheet } from "google-spreadsheet";
import OpenAI from "openai";
import fetch from "node-fetch";
import { config } from "node-config-ts";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sendToManychat = async (userId, message) => {
  const url = `https://api.manychat.com/fb/sending/sendContent`;
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MANYCHAT_API_KEY}`,
    },
    body: JSON.stringify({
      subscriber_id: userId,
      data: {
        version: "v2",
        content: {
          messages: [
            {
              type: "text",
              text: message,
            },
          ],
        },
      },
    }),
  });
};

const fetchSheetData = async (code) => {
  const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\n/g, "\n"),
  });
  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();
  const result = rows.find((row) => row.codigo === code);
  return result ? {
    enlaceYoutube: row["enlace youtube"],
    habitaciones: row["numero habitaciones"],
    banos: row["numero banos"],
    parqueadero: row["parqueadero"],
    canon: row["valor canon"],
    estado: row["ESTADO"],
  } : null;
};

app.post("/api/chat", async (req, res) => {
  const userMessage = req.body.message?.text;
  const userId = req.body.subscriber_id;

  // 1. Responder de inmediato a ManyChat
  res.end();

  if (!userMessage || !userId) return;

  // 2. Procesar en segundo plano
  try {
    if (userMessage.toLowerCase().trim() === "test") {
      await sendToManychat(userId, "✅ Se reinició el contexto. ¿Cómo puedo ayudarte?");
      return;
    }

    const codeMatch = userMessage.match(/\b\d{1,4}\b/);
    if (codeMatch) {
      const inmueble = await fetchSheetData(codeMatch[0]);
      if (!inmueble || inmueble.estado === "no_disponible") {
        await sendToManychat(userId, `El inmueble con código ${codeMatch[0]} actualmente no está disponible.
¿Tienes alguna duda?`);
        return;
      }
      await sendToManychat(userId,
        `🏡 Inmueble código ${codeMatch[0]}:

- Habitaciones: ${inmueble.habitaciones}
- Baños: ${inmueble.banos}
- Parqueadero: ${inmueble.parqueadero}
- Canon: ${inmueble.canon}

🎥 Video: ${inmueble.enlaceYoutube}`
      );
      return;
    }

    const completion = await openai.chat.completions.create({
      messages: [{ role: "user", content: userMessage }],
      model: "gpt-4",
    });

    const response = completion.choices[0]?.message?.content?.trim();
    await sendToManychat(userId, response || "No entendí bien. ¿Podrías repetirlo?");
  } catch (error) {
    console.error("❌ Error:", error);
    await sendToManychat(userId, "Ocurrió un error procesando tu solicitud. Intenta más tarde.");
  }
});

app.listen(PORT, () => {
  console.log("✅ Servidor activo en el puerto", PORT);
});