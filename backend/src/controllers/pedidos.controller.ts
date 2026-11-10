import { Request, Response } from 'express';
import { db } from '../config/database';

export class PedidosController {
  // Criar novo pedido unificado
  static async criar(req: Request, res: Response) {
    const { id_usuario, itens, dados_entrega, forma_pagamento } = req.body;

    if (!itens || !Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ erro: 'O carrinho está vazio.' });
    }

    try {
      // Calcula o total com precisão
      const total = itens.reduce((acc, item) => {
        const preco = Number(item.preco) || 0;
        const qtd = Number(item.quantidade) || 1;
        return acc + (preco * qtd);
      }, 0);

      const result = await db.query(
        `INSERT INTO pedidos (id_usuario, total, itens, dados_entrega) 
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [
          id_usuario || null,
          total.toFixed(2),
          JSON.stringify(itens),
          JSON.stringify({ ...dados_entrega, forma_pagamento: forma_pagamento || 'Cartão de Crédito' }),
        ]
      );

      const pedidoCriado = result.rows[0];

      return res.status(201).json({
        mensagem: 'Pedido realizado com sucesso!',
        pedido: pedidoCriado,
      });
    } catch (error) {
      console.error('Erro ao processar pedido:', error);
      return res.status(500).json({ erro: 'Falha ao finalizar o pedido.' });
    }
  }
}
