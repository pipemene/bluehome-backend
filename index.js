
const express = require('express');
const app = express();
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  const pregunta = req.body.pregunta || 'No se envió pregunta';
  res.json({ respuesta: `Recibí tu mensaje: ${pregunta}` });
});

app.listen(8080, () => {
  console.log('Servidor escuchando en http://localhost:8080');
});
