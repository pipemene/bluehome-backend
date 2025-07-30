import express from 'express';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { Configuration, OpenAIApi } from 'openai';
import fetch from 'node-fetch';
import fs from 'fs';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const doc = new GoogleSpreadsheet(process.env.SHEET_ID);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const configuration = new Configuration({ apiKey: OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

const history = {};

async function fetchSheetRows() {
    await doc.useServiceAccountAuth({
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\n/g, '\n')
    });
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    return rows;
}

function resetContext(userId) {
    history[userId] = [];
}

function addToHistory(userId, role, content) {
    if (!history[userId]) history[userId] = [];
    history[userId].push({ role, content });
}

app.post('/api/chat', async (req, res) => {
    const { userId, message } = req.body;

    if (message.toLowerCase().trim() === 'test') {
        resetContext(userId);
        return res.json({ reply: '¡Conversación reiniciada! ¿En qué puedo ayudarte?' });
    }

    const rows = await fetchSheetRows();
    const lowerMessage = message.toLowerCase();

    // Buscar código exacto
    const matched = rows.find(row => row.codigo?.toString().toLowerCase() === lowerMessage);
    if (matched) {
        if (matched.ESTADO === 'no_disponible') {
            return res.json({ reply: `El inmueble con código ${matched.codigo} actualmente no está disponible.
¿Tienes alguna duda?` });
        }
        return res.json({ reply:
            `🏠 Código ${matched.codigo}:
` +
            `- Habitaciones: ${matched['numero habitaciones']}
` +
            `- Baños: ${matched['numero banos']}
` +
            `- Parqueadero: ${matched['parqueadero']}
` +
            `- Canon: ${matched['valor canon']}
` +
            `🎥 Video: ${matched['enlace youtube']}

¿Tienes alguna duda?` });
    }

    addToHistory(userId, 'user', message);

    const completion = await openai.createChatCompletion({
        model: 'gpt-4',
        messages: [{ role: 'system', content: 'Eres el asistente de Blue Home Inmobiliaria. Solo responde con información real.' }, ...history[userId]]
    });

    const reply = completion.data.choices[0].message.content;
    addToHistory(userId, 'assistant', reply);

    res.json({ reply });
});

app.listen(3000, () => {
    console.log('Servidor backend Blue Home corriendo en puerto 3000');
});
