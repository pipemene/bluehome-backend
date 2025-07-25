
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const AUTH_TOKEN = process.env.AUTH_TOKEN || "bluehome123";
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTe5bAfaAIJDsDj6Hgz43yQ7gQ9TSm77Pp-g-3zBby_PuCknOfOta_3KsQX0-ofmG7hY6zDcxU3qBcS/pub?gid=0&single=true&output=csv";

const promptBase = `Eres el asistente virtual de Blue Home Inmobiliaria. Si el usuario escribe un código de inmueble (como 1123), primero intenta buscarlo en la base de datos de inmuebles. Si existe, responde solo con la información real. No inventes datos ni detalles. Si no se trata de un código, responde como asistente normal.`;

const historial = {};

function limpiarTexto(texto) {
    return String(texto || "").trim().replace(/\r|\n|\t/g, "");
}

function limpiarMoneda(valor) {
    return valor.replace(/["$]/g, "").replace(/,/g, "").trim();
}

function formatearCOP(numeroStr) {
    const num = parseFloat(numeroStr);
    return isNaN(num) ? "No disponible" : `$${num.toLocaleString("es-CO")}`;
}

async function buscarInmueblePorCodigo(codigo) {
    try {
        const response = await axios.get(GOOGLE_SHEET_CSV_URL);
        const separador = response.data.includes(";") ? ";" : ",";
        const filas = response.data.split("\n").map(row => row.split(separador).map(col => limpiarTexto(col)));

        const encabezados = filas[0].map(h => h.toLowerCase());
        const dataIndex = {};
        encabezados.forEach((h, i) => dataIndex[h] = i);

        const fila = filas.find(f => limpiarTexto(f[0]) === codigo);
        if (!fila) return null;

        const canonLimpio = limpiarMoneda(fila[dataIndex["valor canon"]] || "");
        const canonFormateado = formatearCOP(canonLimpio);

        return {
            codigo,
            enlace_youtube: fila[dataIndex["enlace youtube"]] || "",
            enlace_ficha: fila[dataIndex["enlace ficha tecnica"]] || "",
            habitaciones: fila[dataIndex["numero habitaciones"]] || "N/A",
            banos: fila[dataIndex["numero banos"]] || "N/A",
            parqueadero: fila[dataIndex["parqueadero"]] || "N/A",
            canon: canonFormateado
        };
    } catch (err) {
        console.error("Error leyendo la hoja:", err.message);
        return null;
    }
}

app.post('/api/chat', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(401).json({ error: "No autorizado" });
    }

    const { userId, pregunta } = req.body;
    if (!userId || !pregunta) return res.status(400).json({ error: "Faltan campos" });

    const preguntaLimpia = String(pregunta).replace(/\n/g, ' ').replace(/"/g, "'").trim();
    const match = preguntaLimpia.match(/\b(\d{1,5})\b/);

    if (match) {
        const codigo = match[1];
        const info = await buscarInmueblePorCodigo(codigo);
        if (info) {
            let respuesta = `🏡 Inmueble código ${info.codigo}:
📍 Canon: ${info.canon}
🛏 Habitaciones: ${info.habitaciones} | 🚽 Baños: ${info.banos} | 🚗 Parqueadero: ${info.parqueadero}`;
            if (info.enlace_youtube) respuesta += `\n🎥 Video: ${info.enlace_youtube}`;
            if (info.enlace_ficha) respuesta += `\n📄 Ficha técnica: ${info.enlace_ficha}`;
            return res.json({ respuesta });
        }
    }

    historial[userId] = historial[userId] || [];
    historial[userId].push({ role: "user", content: preguntaLimpia });

    const prompt = [
        { role: "system", content: promptBase },
        ...historial[userId]
    ];

    try {
        const completion = await axios.post("https://api.openai.com/v1/chat/completions", {
            model: "gpt-3.5-turbo",
            messages: prompt
        }, {
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
            }
        });

        const respuesta = completion.data.choices[0].message.content;
        historial[userId].push({ role: "assistant", content: respuesta });

        res.json({ respuesta });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Error en OpenAI", detail: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor corriendo en puerto " + PORT));
