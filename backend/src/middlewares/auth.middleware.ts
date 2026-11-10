import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'chave_super_secreta_aqui';

export interface AuthRequest extends Request {
  usuario?: {
    id_usuario: string;
    role: string;
  };
}

export function autenticarJWT(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ erro: 'Token de autenticação não fornecido.' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ erro: 'Formato de token inválido. Use: Bearer <token>' });
  }

  const token = parts[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET) as { id_usuario: string; role: string };
    req.usuario = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

export function apenasAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.usuario || req.usuario.role !== 'admin') {
    return res.status(403).json({ erro: 'Acesso restrito para administradores.' });
  }
  return next();
}
