
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

const promptBase = `Eres el asistente virtual de Blue Home Inmobiliaria. Si el usuario ingresa un código de inmueble, responde solo con la ficha del inmueble y no inventes nada. Si el mensaje no es un código, entonces responde normalmente como asistente de Blue Home.`

const historial = {};

function calcularValores(canon) {
    const canonNum = Number(canon);
    const admin = canonNum * 0.105;
    const iva = admin * 0.19;
    const amparoBasico = canonNum * 0.0205;
    const amparoIntegral = (canonNum + 1423500) * 0.1231;
    const primerPago = canonNum - (admin + iva + amparoBasico + amparoIntegral);
    const siguientePagos = canonNum - (admin + iva + amparoBasico);
    return {
        admin: admin.toFixed(0),
        iva: iva.toFixed(0),
        amparoBasico: amparoBasico.toFixed(0),
        amparoIntegral: amparoIntegral.toFixed(0),
        primerPago: primerPago.toFixed(0),
        siguientePagos: siguientePagos.toFixed(0)
    };
}

async function buscarInmueblePorCodigo(codigo) {
    try {
        const response = await axios.get(GOOGLE_SHEET_CSV_URL);
        const filas = response.data.split('\n').map(row => row.split(','));
        const headers = filas[0];
        const idx = headers.map(h => h.trim().toLowerCase());
        const fila = filas.find(f => f[0] === codigo);
        if (!fila) return null;

        const data = {};
        headers.forEach((h, i) => {
            data[h.trim().toLowerCase()] = fila[i];
        });

        return {
            direccion: data["direccion"] || "No disponible",
            canon: data["canon"] || "No disponible",
            habitaciones: data["habitaciones"] || "N/A",
            baños: data["baños"] || "N/A",
            parqueadero: data["parqueadero"] || "N/A",
            youtube: data["youtube"] || ""
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

    // Si es un código numérico de 3-5 dígitos, buscar en Google Sheets
    if (/^\d{3,5}$/.test(preguntaLimpia)) {
        const info = await buscarInmueblePorCodigo(preguntaLimpia);
        if (info) {
            return res.json({
                respuesta: `🏡 Inmueble código ${preguntaLimpia}:
📍 Dirección: ${info.direccion}
💰 Canon: ${info.canon}
🛏 Habitaciones: ${info.habitaciones} | 🚽 Baños: ${info.baños} | 🚗 Parqueadero: ${info.parqueadero}
🎥 Video: ${info.youtube ? info.youtube : "No disponible"}`
            });
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
