import { Request, Response } from 'express';
import { db } from '../config/database';

export class PetsController {
  // Listar pets para adoção
  static async listar(req: Request, res: Response) {
    try {
      const { especie, status } = req.query;
      let sql = 'SELECT * FROM pets_adocao WHERE 1=1';
      const params: any[] = [];

      const result = await db.query(sql, params);
      let pets = result.rows;

      if (especie && typeof especie === 'string' && especie.toLowerCase() !== 'todos') {
        pets = pets.filter(p => p.especie.toLowerCase() === especie.toLowerCase());
      }

      if (status && typeof status === 'string') {
        pets = pets.filter(p => p.status.toLowerCase() === status.toLowerCase());
      }

      return res.json(pets);
    } catch (error) {
      console.error('Erro ao listar pets:', error);
      return res.status(500).json({ erro: 'Falha ao buscar pets para adoção.' });
    }
  }

  // Solicitar adoção responsável
  static async solicitarAdocao(req: Request, res: Response) {
    const { id_pet, nome_candidato, email, telefone, experiencia, motivo } = req.body;

    if (!id_pet || !nome_candidato || !email) {
      return res.status(400).json({ erro: 'ID do pet, nome e e-mail são obrigatórios.' });
    }

    try {
      // Atualiza o status do pet para "Triagem"
      await db.query(
        'UPDATE pets_adocao SET status = $1 WHERE id_pet = $2',
        ['Triagem', id_pet]
      );

      return res.status(200).json({
        mensagem: 'Candidatura de adoção recebida com carinho! Nossa equipe entrará em contato para a entrevista.',
        dados: {
          id_pet,
          nome_candidato,
          email,
          status: 'Em Triagem Responsável'
        }
      });
    } catch (error) {
      console.error('Erro ao processar adoção:', error);
      return res.status(500).json({ erro: 'Falha ao enviar candidatura de adoção.' });
    }
  }

  // Criar novo pet (Admin)
  static async criar(req: Request, res: Response) {
    const { nome_pet, especie, perfil, imagem_url, historia } = req.body;

    if (!nome_pet || !especie) {
      return res.status(400).json({ erro: 'Nome e espécie são obrigatórios.' });
    }

    try {
      const result = await db.query(
        `INSERT INTO pets_adocao (nome_pet, especie, perfil, imagem_url, historia) 
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          nome_pet,
          especie,
          perfil || {},
          imagem_url,
          historia || '',
        ]
      );

      return res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Erro ao cadastrar pet:', error);
      return res.status(500).json({ erro: 'Falha ao cadastrar pet.' });
    }
  }
}
