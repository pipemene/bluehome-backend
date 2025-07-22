
import express from 'express';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import chatHandler from './src/chatHandler.js';

dotenv.config();
const app = express();
app.use(bodyParser.json());

app.post('/api/chat', async (req, res) => {
    const { userId, pregunta } = req.body;
    try {
        const respuesta = await chatHandler(userId, pregunta);
        res.json({ respuesta });
    } catch (error) {
        res.json({ respuesta: 'Hubo un problema consultando la base de datos. Intenta nuevamente.' });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
