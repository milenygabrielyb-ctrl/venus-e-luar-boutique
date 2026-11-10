import express from 'express';
import cors from 'cors';
import routes from './routes';

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Rotas da API
app.use('/api', routes);

// Rota raiz informativa
app.get('/', (req, res) => {
  res.json({
    mensagem: 'Bem-vindo à API da Boutique Conceito (Moda, Pet & Cafeteria)',
    documentacao_endpoints: {
      health: 'GET /api/health',
      auth: {
        registrar: 'POST /api/auth/registrar',
        login: 'POST /api/auth/login',
        me: 'GET /api/auth/me',
      },
      produtos: {
        listar: 'GET /api/produtos?categoria=Moda|Pet|Cafeteria&busca=...',
        criar: 'POST /api/produtos',
      },
      pets: {
        listar: 'GET /api/pets?especie=Cachorro|Gato',
        adotar: 'POST /api/pets/adotar',
        criar: 'POST /api/pets',
      },
      pedidos: {
        criar: 'POST /api/pedidos',
      },
    },
  });
});

export default app;
