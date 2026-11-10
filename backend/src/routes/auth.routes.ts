import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';

const router = Router();

router.post('/registrar', AuthController.registrar);
router.post('/login', AuthController.login);
router.get('/me', AuthController.me);

export default router;
