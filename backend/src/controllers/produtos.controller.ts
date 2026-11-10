import { Request, Response } from 'express';
import { db } from '../config/database';

export class ProdutosController {
  // Listar produtos com filtros opcionais (categoria, busca, filtros de atributos JSONB)
  static async listar(req: Request, res: Response) {
    try {
      const { categoria, busca, tamanho, tipo_leite, tamanho_pet } = req.query;

      let sql = 'SELECT * FROM produtos WHERE ativo = true';
      const params: any[] = [];

      if (categoria && typeof categoria === 'string' && categoria.toLowerCase() !== 'todos') {
        params.push(categoria);
        sql += ` AND LOWER(categoria) = LOWER($${params.length})`;
      }

      const result = await db.query(sql, params);
      let itens = result.rows;

      // Filtros em memória adicionais caso os atributos JSONB venham na query
      if (busca && typeof busca === 'string') {
        const termo = busca.toLowerCase();
        itens = itens.filter(p =>
          p.nome_item.toLowerCase().includes(termo) ||
          p.descricao.toLowerCase().includes(termo) ||
          JSON.stringify(p.atributos).toLowerCase().includes(termo)
        );
      }

      if (tamanho && typeof tamanho === 'string') {
        itens = itens.filter(p =>
          p.atributos?.tamanho?.toLowerCase() === tamanho.toLowerCase() ||
          p.atributos?.grades_disponiveis?.includes(tamanho)
        );
      }

      if (tipo_leite && typeof tipo_leite === 'string') {
        itens = itens.filter(p =>
          p.atributos?.tipo_leite?.toLowerCase().includes(tipo_leite.toLowerCase()) ||
          p.atributos?.opcoes_leite?.some((op: string) => op.toLowerCase().includes(tipo_leite.toLowerCase()))
        );
      }

      if (tamanho_pet && typeof tamanho_pet === 'string') {
        itens = itens.filter(p =>
          p.atributos?.tamanho_pet?.toLowerCase().includes(tamanho_pet.toLowerCase())
        );
      }

      return res.json(itens);
    } catch (error) {
      console.error('Erro ao listar produtos:', error);
      return res.status(500).json({ erro: 'Falha ao buscar produtos.' });
    }
  }

  // Criar novo produto com atributos dinâmicos JSONB
  static async criar(req: Request, res: Response) {
    const { nome_item, categoria, preco, estoque, atributos, imagem_url, descricao } = req.body;

    if (!nome_item || !categoria || preco === undefined) {
      return res.status(400).json({ erro: 'Nome, categoria e preço são obrigatórios.' });
    }

    try {
      const result = await db.query(
        `INSERT INTO produtos (nome_item, categoria, preco, estoque, atributos, imagem_url, descricao) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          nome_item,
          categoria,
          preco,
          estoque || 0,
          atributos || {},
          imagem_url,
          descricao || '',
        ]
      );

      return res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('Erro ao criar produto:', error);
      return res.status(500).json({ erro: 'Falha ao cadastrar produto.' });
    }
  }
}
