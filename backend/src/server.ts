import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { db } from './config/database';

const PORT = process.env.PORT || 3001;

async function startServer() {
  const dbInfo = await db.checkConnection();
  console.log(`[Banco de Dados] Status: ${dbInfo.type} - ${dbInfo.status}`);

  app.listen(PORT, () => {
    console.log(`[Boutique Server] Rodando na porta ${PORT}`);
    console.log(`[API URL] http://localhost:${PORT}`);
  });
}

startServer();
