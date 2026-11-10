import { Router } from 'express';
import { PetsController } from '../controllers/pets.controller';

const router = Router();

router.get('/', PetsController.listar);
router.post('/adotar', PetsController.solicitarAdocao);
router.post('/', PetsController.criar);

export default router;
