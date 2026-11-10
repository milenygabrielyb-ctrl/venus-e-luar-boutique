import { Router } from 'express';
import authRoutes from './auth.routes';
import produtosRoutes from './produtos.routes';
import petsRoutes from './pets.routes';
import pedidosRoutes from './pedidos.routes';
import { db } from '../config/database';

const router = Router();

router.get('/health', async (req, res) => {
  const dbStatus = await db.checkConnection();
  res.json({
    status: 'ok',
    aplicacao: 'Boutique Conceito API',
    database: dbStatus,
    timestamp: new Date(),
  });
});

router.use('/auth', authRoutes);
router.use('/produtos', produtosRoutes);
router.use('/pets', petsRoutes);
router.use('/pedidos', pedidosRoutes);

export default router;
