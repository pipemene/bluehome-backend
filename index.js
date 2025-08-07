
import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";
import { createContextHandler } from "./utils/context.js";
import { getInmuebleInfo, getInmueblesByFiltro } from "./utils/sheets.js";
import { generatePrompt } from "./utils/prompt.js";
import { chatWithGPT } from "./utils/openai.js";

const app = express();
app.use(bodyParser.json());

const contextHandler = createContextHandler();

app.post("/api/chat", async (req, res) => {
    try {
        const { user, message } = req.body;
        if (!user || !message) return res.status(400).json({ error: "Faltan datos" });

        // Reinicio de contexto si el mensaje es "test"
        if (message.trim().toLowerCase() === "test") {
            contextHandler.clear(user);
            return res.json({ reply: "¡Contexto reiniciado!" });
        }

        const inmuebleInfo = await getInmuebleInfo(message);
        let sheetResponse = inmuebleInfo?.respuesta || "";

        if (!sheetResponse) {
            const sugerencias = await getInmueblesByFiltro(message);
            sheetResponse = sugerencias || "";
        }

        const systemPrompt = generatePrompt();
        const history = contextHandler.get(user);
        const fullHistory = [...history, { role: "user", content: message }];

        const aiResponse = await chatWithGPT(systemPrompt, fullHistory, sheetResponse);
        contextHandler.add(user, { role: "user", content: message });
        contextHandler.add(user, { role: "assistant", content: aiResponse });

        res.json({ reply: aiResponse });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.listen(8080, () => console.log("Servidor corriendo en puerto 8080"));
