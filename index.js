import express from "express";
import dotenv from "dotenv";
import { GoogleSpreadsheet } from "google-spreadsheet";
import pkg from "openai";
import bodyParser from "body-parser";
import axios from "axios";

dotenv.config();
const { OpenAI } = pkg;
const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
async function getSheetData(code) {
    try {
        await doc.useApiKey(process.env.GOOGLE_SHEETS_API_KEY);
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        const rows = await sheet.getRows();
        const result = rows.find((row) => row.codigo === code);
        return result ? rowToObject(result) : null;
    } catch (error) {
        console.error("Error al acceder a Google Sheets:", error);
        return null;
    }
}

function rowToObject(row) {
    return {
        codigo: row.codigo,
        enlace_youtube: row["enlace youtube"],
        ficha_tecnica: row["ENLACE FICHA TECNICA"],
        habitaciones: row["numero habitaciones"],
        banos: row["numero banos"],
        parqueadero: row.parqueadero,
        canon: row["valor canon"],
        estado: row.ESTADO,
        tipo: row.tipo
    };
}

async function callOpenAI(messages) {
    const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages,
        temperature: 0.4
    });
    return completion.choices[0].message.content;
}

async function enviarRespuestaAManyChat(userId, text) {
    try {
        await axios.post(`https://api.manychat.com/fb/sending/sendContent`, {
            subscriber_id: userId,
            message: { text },
        }, {
            headers: {
                Authorization: `Bearer ${process.env.MANYCHAT_API_KEY}`,
                "Content-Type": "application/json",
            }
        });
    } catch (error) {
        console.error("Error enviando mensaje a ManyChat:", error?.response?.data || error.message);
    }
}

const BLUEHOME_PROMPT = `Eres el asistente de Blue Home Inmobiliaria... (aquí va el prompt completo ya guardado).`;

const historial = {};

app.post("/api/chat", async (req, res) => {
    const { message, userId } = req.body;

    // Respuesta inmediata para evitar timeout
    res.status(200).json({ success: true });

    if (!historial[userId]) {
        historial[userId] = [
            { role: "system", content: BLUEHOME_PROMPT }
        ];
    }

    historial[userId].push({ role: "user", content: message });

    const codeMatch = message.trim().match(/^(\d{1,4})$/);
    if (codeMatch) {
        const code = codeMatch[1];
        const data = await getSheetData(code);
        if (!data || data.estado === "no_disponible") {
            await enviarRespuestaAManyChat(userId, `Ese inmueble ya no está disponible. ¿Te gustaría ver otras opciones?`);
        } else {
            const texto = `🏡 Código ${code}
📍 ${data.tipo}, ${data.habitaciones} habs, ${data.banos} baños, parqueadero: ${data.parqueadero}
Canon: $${data.canon}
🔗 Video: ${data.enlace_youtube}`;
            await enviarRespuestaAManyChat(userId, texto);
        }
        return;
    }

    try {
        const respuesta = await callOpenAI(historial[userId]);
        historial[userId].push({ role: "assistant", content: respuesta });
        await enviarRespuestaAManyChat(userId, respuesta);
    } catch (error) {
        console.error("Error procesando mensaje:", error);
        await enviarRespuestaAManyChat(userId, "Ocurrió un error procesando tu mensaje.");
    }
});

app.listen(port, () => {
    console.log(`Servidor iniciado en puerto ${port}`);
});