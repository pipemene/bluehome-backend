
import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { GoogleSpreadsheet } from "google-spreadsheet";
import OpenAI from "openai";
import fetch from "node-fetch";

dotenv.config();
const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
const contextMemory = {};

async function loadGoogleSheet() {
    await doc.useApiKey(process.env.GOOGLE_API_KEY);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    return rows.map(row => ({
        codigo: row["codigo"],
        enlace_youtube: row["enlace youtube"],
        enlace_ficha: row["ENLACE FICHA TECNICA"],
        habitaciones: row["numero habitaciones"],
        banos: row["numero banos"],
        parqueadero: row["parqueadero"],
        canon: row["valor canon"],
        estado: row["ESTADO"],
        tipo: row["tipo"]
    }));
}

function resetUserContext(userId) {
    contextMemory[userId] = [];
}

function getUserContext(userId) {
    if (!contextMemory[userId]) {
        contextMemory[userId] = [];
    }
    return contextMemory[userId];
}

app.post("/api/chat", async (req, res) => {
    const { userId, pregunta } = req.body;
    res.status(200).json({ message: "Procesando..." });

    try {
        if (pregunta.toLowerCase().trim() === "test") {
            resetUserContext(userId);
            await sendToManyChat(userId, "¡Hola! Soy marianAI, ¿en qué puedo ayudarte?");
            return;
        }

        const rows = await loadGoogleSheet();
        const codigos = rows.map(r => r.codigo.toLowerCase());
        const matchCodigo = codigos.find(c => pregunta.toLowerCase().includes(c));

        if (matchCodigo) {
            const row = rows.find(r => r.codigo.toLowerCase() === matchCodigo);
            if (row.estado !== "disponible") {
                await sendToManyChat(userId, `El inmueble con código ${matchCodigo} actualmente no está disponible.`);
                return;
            } else {
                const info = `Este inmueble tiene ${row.habitaciones} habitaciones, ${row.banos} baños, parqueadero ${row.parqueadero == "1" ? "sí" : "no"}, y un canon de ${row.canon}. Mira el video aquí: ${row.enlace_youtube}`;
                await sendToManyChat(userId, info);
                return;
            }
        }

        const context = getUserContext(userId);
        context.push({ role: "user", content: pregunta });

        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                { role: "system", content: process.env.SYSTEM_PROMPT },
                ...context
            ],
        });

        const respuesta = completion.choices[0].message.content;
        context.push({ role: "assistant", content: respuesta });

        await sendToManyChat(userId, respuesta);
    } catch (error) {
        await sendToManyChat(userId, "Lo siento, ocurrió un error procesando tu solicitud.");
    }
});

async function sendToManyChat(userId, mensaje) {
    await fetch("https://api.manychat.com/fb/sending/sendContent", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.MANYCHAT_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            subscriber_id: userId,
            data: { version: "v2", content: { messages: [{ type: "text", text: mensaje }] } }
        })
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
