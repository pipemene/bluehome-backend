
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

const promptBase = `Eres el asistente virtual de Blue Home Inmobiliaria. Si el usuario escribe un código de inmueble (como 1123), primero intenta buscarlo en la base de datos de inmuebles. Si existe y está disponible, responde solo con la información real. Si el inmueble está marcado como no_disponible, indícaselo al cliente. Si no hay código, pregunta por presupuesto máximo y habitaciones requeridas y sugiere mínimo 3 inmuebles disponibles. No inventes información.`;

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
        const separador = response.data.includes(";") ? ";" : ",";
        const filas = response.data.split("\n").map(row => row.split(separador).map(col => limpiarTexto(col)));

        const encabezados = filas[0].map(h => h.toLowerCase());
        const dataIndex = {};
        encabezados.forEach((h, i) => dataIndex[h] = i);

        propiedades = [];
        for (let i = 1; i < filas.length; i++) {
            const f = filas[i];
            if (f.length < encabezados.length) {
                console.warn(`Fila ${i + 1} ignorada por tener menos columnas de las esperadas`);
                continue;
            }

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
                    estado: (f[dataIndex["estado"]] || "").toLowerCase()
                });
            } catch (e) {
                console.warn(`Fila ${i + 1} ignorada por error: ${e.message}`);
            }
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

    if (codigo) {
        const p = propiedades.find(p => p.codigo === codigo);
        if (!p) return res.json({ respuesta: `No encontramos información para el código ${codigo}.` });
        if (p.estado !== "disponible") return res.json({ respuesta: `El inmueble con código ${codigo} actualmente no está disponible.` });
        return res.json({ respuesta: construirRespuestaPropiedad(p) });
    }

    const historialUsuario = historial[userId] || [];
    historial[userId] = historialUsuario;

    historialUsuario.push({ role: "user", content: mensaje });

    const ultima = historialUsuario[historialUsuario.length - 1].content.toLowerCase();

    if (ultima.includes("mill") || ultima.includes("$") || ultima.includes("habitac")) {
        const matchCanon = ultima.match(/\$?(\d+[.,]?\d{0,3})/g);
        const matchHab = ultima.match(/(\d+)\s*habitac/);

        const presupuesto = matchCanon ? parseFloat(matchCanon[0].replace(/[.$,]/g, "")) : 0;
        const minHab = matchHab ? parseInt(matchHab[1]) : 1;

        const resultados = propiedades
            .filter(p => p.estado === "disponible" && p.habitaciones >= minHab && p.canon <= presupuesto)
            .slice(0, 3);

        if (resultados.length === 0) {
            return res.json({ respuesta: `No encontramos inmuebles disponibles con ese presupuesto y número de habitaciones.` });
        }

        const respuesta = resultados.map(p => construirRespuestaPropiedad(p)).join("\n\n");
        return res.json({ respuesta });
    }

    historialUsuario.push({ role: "assistant", content: "¿Cuál es tu presupuesto máximo de arriendo y cuántas habitaciones necesitas?" });
    return res.json({ respuesta: "¿Cuál es tu presupuesto máximo de arriendo y cuántas habitaciones necesitas?" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor corriendo en puerto " + PORT));
