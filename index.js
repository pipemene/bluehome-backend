import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { AIMessage, HumanMessage } from "langchain/schema";
import { BufferMemory } from "langchain/memory";
import { RunnableSequence } from "langchain/schema/runnable";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

const memoryMap = {};

const sheetUrl = process.env.SHEET_CSV_URL;

async function fetchSheetData() {
    const response = await fetch(sheetUrl);
    const csv = await response.text();
    const lines = csv.split("\n");
    const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
    return lines.slice(1).map(line => {
        const values = line.split(",");
        return headers.reduce((acc, h, i) => {
            acc[h] = values[i]?.trim();
            return acc;
        }, {});
    });
}

function getPrompt(context) {
    return `Eres el asistente de Blue Home Inmobiliaria. Tu tarea es responder de forma concreta, profesional pero cercana. Si el usuario escribe "test", debes reiniciar la conversación. 
Recuerda que los inmuebles se administran desde $600.000 COP, que la comisión es 10.45% + IVA y que el amparo básico cuesta 2.05% sobre el canon mensual. Usa esta información siempre y no inventes datos.`;
}

app.post("/api/chat", async (req, res) => {
    try {
        const { message, user } = req.body;
        if (!user || !message) return res.status(400).send("Faltan datos");

        if (!memoryMap[user] || message.trim().toLowerCase() === "test") {
            memoryMap[user] = new BufferMemory({ returnMessages: true, memoryKey: "history" });
        }

        const memory = memoryMap[user];
        const model = new ChatOpenAI({
            modelName: "gpt-4",
            temperature: 0,
            openAIApiKey: process.env.OPENAI_API_KEY,
        });

        const prompt = getPrompt();
        const chain = RunnableSequence.from([
            async (input) => {
                const sheetData = await fetchSheetData();
                const code = input.match(/\b\d{1,4}\b/);
                if (code) {
                    const inmueble = sheetData.find((d) => d.codigo === code[0]);
                    if (inmueble && inmueble.estado !== "no_disponible") {
                        return `${prompt}\nInformación del código ${code[0]}: ${JSON.stringify(inmueble)}\nUsuario: ${input}`;
                    } else if (inmueble?.estado === "no_disponible") {
                        return `${prompt}\nEl inmueble con código ${code[0]} no está disponible.\nUsuario: ${input}`;
                    }
                }
                return `${prompt}\nUsuario: ${input}`;
            },
            model,
        ]);

        const history = await memory.loadMemoryVariables({});
        const response = await chain.invoke(message, { history: history.history || [] });

        await memory.saveContext({ input: message }, { output: response.content });

        return res.json({ reply: response.content });
    } catch (error) {
        console.error("Error:", error);
        return res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.listen(port, () => {
    console.log(`Servidor corriendo en el puerto ${port}`);
});
