import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { db } from '../config/database'; // Instância de conexão com o PostgreSQL

const JWT_SECRET = process.env.JWT_SECRET || 'chave_super_secreta_aqui';

export class AuthController {
  
  // 1. REGISTRO (Criptografando a senha antes de salvar)
  static async registrar(req: Request, res: Response) {
    const { nome, email, senha } = req.body;

    if (!nome || !email || !senha) {
      return res.status(400).json({ erro: 'Nome, e-mail e senha são obrigatórios.' });
    }

    try {
      const saltRounds = 12; // Custo do algoritmo (protege contra força bruta)
      const senhaHash = await bcrypt.hash(senha, saltRounds);

      const result = await db.query(
        `INSERT INTO usuarios (nome_completo, email, senha_hash) 
         VALUES ($1, $2, $3) RETURNING id_usuario, nome_completo, email`,
        [nome, email, senhaHash]
      );

      const novoUsuario = result.rows[0];

      // Gera o Token JWT para logar imediatamente
      const token = jwt.sign(
        { id_usuario: novoUsuario.id_usuario, role: 'cliente' },
        JWT_SECRET,
        { expiresIn: '2h' }
      );

      return res.status(201).json({
        token,
        usuario: {
          id_usuario: novoUsuario.id_usuario,
          nome: novoUsuario.nome_completo,
          email: novoUsuario.email,
          role: 'cliente'
        }
      });
    } catch (error) {
      console.error('Erro ao registrar:', error);
      return res.status(500).json({ erro: 'Falha ao registrar usuário.' });
    }
  }

  // 2. LOGIN (Comparando o hash e gerando a Sessão/Token)
  static async login(req: Request, res: Response) {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ erro: 'E-mail e senha são obrigatórios.' });
    }

    try {
      // Busca o usuário no banco
      const userResult = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
      const user = userResult.rows[0];

      if (!user) {
        return res.status(401).json({ erro: 'Credenciais inválidas.' });
      }

      // Compara a senha digitada em texto puro com o hash do banco
      const senhaValida = await bcrypt.compare(senha, user.senha_hash);

      if (!senhaValida) {
        return res.status(401).json({ erro: 'Credenciais inválidas.' });
      }

      // Gera o Token JWT contendo apenas informações seguras (Payload)
      const token = jwt.sign(
        { id_usuario: user.id_usuario, role: user.role || 'cliente' }, 
        JWT_SECRET, 
        { expiresIn: '2h' } // Token expira em 2 horas
      );

      return res.json({ 
        token, 
        usuario: { 
          id_usuario: user.id_usuario,
          nome: user.nome_completo, 
          email: user.email,
          role: user.role || 'cliente'
        } 
      });
    } catch (error) {
      console.error('Erro no login:', error);
      return res.status(500).json({ erro: 'Erro interno no servidor.' });
    }
  }

  // 3. ME (Retorna dados do usuário autenticado)
  static async me(req: Request, res: Response) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ erro: 'Token não fornecido.' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { id_usuario: string; role: string };
      return res.json({ usuario: decoded });
    } catch (err) {
      return res.status(401).json({ erro: 'Token inválido ou expirado.' });
    }
  }
}
