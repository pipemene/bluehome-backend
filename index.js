
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

const historial = {};
let propiedades = [];

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

async function cargarPropiedades() {
    try {
        const response = await axios.get(GOOGLE_SHEET_CSV_URL);
        const filas = response.data.split("\n").map(row => row.split(",").map(col => limpiarTexto(col)));

        const encabezados = filas[0].map(h => h.toLowerCase());
        const dataIndex = {};
        encabezados.forEach((h, i) => dataIndex[h] = i);

        propiedades = [];
        for (let i = 1; i < filas.length; i++) {
            const f = filas[i];
            if (f.length < encabezados.length) continue;

            try {
                propiedades.push({
                    codigo: f[0],
                    enlace_youtube: f[dataIndex["enlace youtube"]],
                    enlace_ficha: f[dataIndex["enlace ficha tecnica"]],
                    habitaciones: parseInt(f[dataIndex["numero habitaciones"]]) || 0,
                    banos: f[dataIndex["numero banos"]],
                    parqueadero: f[dataIndex["parqueadero"]],
                    canon_raw: f[dataIndex["valor canon"]],
                    canon: parseFloat(limpiarMoneda(f[dataIndex["valor canon"]])) || 0,
                    estado: limpiarTexto(f[dataIndex["estado"]]).toLowerCase()
                });
            } catch {}
        }
    } catch (err) {
        console.error("Error cargando propiedades:", err.message);
    }
}

function construirRespuestaPropiedad(p) {
    let r = `🏡 Inmueble código ${p.codigo}:
📍 Canon: ${formatearCOP(p.canon)}
🛏 Habitaciones: ${p.habitaciones} | 🚽 Baños: ${p.banos} | 🚗 Parqueadero: ${p.parqueadero}`;
    if (p.enlace_youtube) r += `\n🎥 Video: ${p.enlace_youtube}`;
    if (p.enlace_ficha) r += `\n📄 Ficha técnica: ${p.enlace_ficha}`;
    return r;
}

function extraerCodigo(mensaje) {
    const match = mensaje.match(/\b(\d{1,5})\b/);
    return match ? match[1] : null;
}

app.post('/api/chat', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(401).json({ error: "No autorizado" });
    }

    const { userId, pregunta } = req.body;
    if (!userId || !pregunta) return res.status(400).json({ error: "Faltan campos" });

    await cargarPropiedades();
    const mensaje = limpiarTexto(pregunta);
    const codigo = extraerCodigo(mensaje);

    historial[userId] = historial[userId] || { estado: "inicio", data: {} };
    const contexto = historial[userId];

    if (codigo) {
        const p = propiedades.find(p => p.codigo === codigo);
        if (!p) return res.json({ respuesta: `No encontramos información para el código ${codigo}.` });
        if (p.estado !== "disponible") return res.json({ respuesta: `El inmueble con código ${codigo} actualmente no está disponible.` });
        return res.json({ respuesta: construirRespuestaPropiedad(p) });
    }

    if (contexto.estado === "inicio") {
        contexto.estado = "esperando_presupuesto";
        return res.json({ respuesta: "¿Cuál es tu presupuesto máximo de arriendo?" });
    }

    if (contexto.estado === "esperando_presupuesto") {
        const valor = mensaje.replace(/[.$,]/g, "").match(/\d+/);
        if (!valor) return res.json({ respuesta: "No entendí el valor. ¿Podrías escribir el número sin palabras?" });
        contexto.data.presupuesto = parseInt(valor[0]);
        contexto.estado = "esperando_habitaciones";
        return res.json({ respuesta: "¿Cuántas habitaciones necesitas?" });
    }

    if (contexto.estado === "esperando_habitaciones") {
        const num = mensaje.match(/\d+/);
        if (!num) return res.json({ respuesta: "¿Podrías indicarme cuántas habitaciones necesitas?" });
        contexto.data.habitaciones = parseInt(num[0]);
        contexto.estado = "completo";
    }

    if (contexto.estado === "completo") {
        const presupuesto = contexto.data.presupuesto;
        const minHab = contexto.data.habitaciones;

        const resultados = propiedades
            .filter(p => p.estado === "disponible" && p.habitaciones >= minHab && p.canon <= presupuesto)
            .slice(0, 3);

        if (resultados.length === 0) {
            return res.json({ respuesta: `No encontramos inmuebles disponibles con ese presupuesto y número de habitaciones.` });
        }

        const respuesta = resultados.map(p => construirRespuestaPropiedad(p)).join("\n\n");
        contexto.estado = "inicio";
        contexto.data = {};
        return res.json({ respuesta });
    }

    return res.json({ respuesta: "¿Cómo puedo ayudarte hoy?" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor corriendo en puerto " + PORT));
