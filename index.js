
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { handleChat } from './src/chatHandler.js';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/chat', handleChat);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
