/**
 * VÊNUS & LUAR BOUTIQUE - SERVIÇO DE COMANDAS E MESAS DO BISTRÔ (KDS COPA/COZINHA)
 * 
 * Gerencia a abertura de comandas, adição contínua de pedidos, status de preparo
 * na cozinha/barista e permite o fechamento conjunto com itens da boutique (NFC-e unificada).
 */

const { getDb, transaction } = require('../../config/database');

class BistroTabService {
  /**
   * Abre uma nova comanda / mesa no bistrô
   */
  static openTab({ tabNumber, customerId = null, customerName = 'Cliente Bistrô', openedBy = 'Mileny Gabriely' }) {
    return transaction(db => {
      const tabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      
      db.prepare(`
        INSERT INTO bistro_tabs (id, tab_number, customer_id, customer_name, status, opened_by)
        VALUES (?, ?, ?, ?, 'open', ?)
      `).run(tabId, tabNumber, customerId, customerName, openedBy);

      return {
        id: tabId,
        tab_number: tabNumber,
        customer_name: customerName,
        status: 'open',
        opened_by: openedBy,
        opened_at: new Date().toISOString()
      };
    });
  }

  /**
   * Adiciona itens à comanda e despacha para a copa/cozinha
   */
  static addItemToTab(tabId, { productId, quantity = 1, unitPrice, observations = '' }) {
    const qty = Number(quantity || 1);
    const price = Number(unitPrice);
    const total = Number((qty * price).toFixed(2));

    return transaction(db => {
      const tab = db.prepare('SELECT * FROM bistro_tabs WHERE id = ?').get(tabId);
      if (!tab) throw new Error('Comanda não encontrada.');
      if (tab.status !== 'open') throw new Error(`Comanda não está aberta (Status atual: ${tab.status}).`);

      const itemId = 'tab_it_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      db.prepare(`
        INSERT INTO bistro_tab_items (
          id, tab_id, product_id, quantity, unit_price, total_price, observations, kitchen_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(itemId, tabId, productId, qty, price, total, observations);

      return {
        item_id: itemId,
        tab_id: tabId,
        product_id: productId,
        quantity: qty,
        unit_price: price,
        total_price: total,
        kitchen_status: 'pending'
      };
    });
  }

  /**
   * Atualiza o status do pedido na cozinha/copa (KDS)
   */
  static updateKitchenStatus(itemId, newStatus) {
    const validStatuses = ['pending', 'preparing', 'ready', 'served'];
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Status de cozinha inválido: ${newStatus}`);
    }

    const db = getDb();
    db.prepare(`
      UPDATE bistro_tab_items
      SET kitchen_status = ?
      WHERE id = ?
    `).run(newStatus, itemId);

    return { item_id: itemId, kitchen_status: newStatus };
  }

  /**
   * Lista todas as comandas abertas com seus itens e totais calculados
   */
  static listOpenTabs() {
    const db = getDb();
    const tabs = db.prepare(`
      SELECT t.*, c.cpf_cnpj as customer_cpf
      FROM bistro_tabs t
      LEFT JOIN customers c ON c.id = t.customer_id
      WHERE t.status = 'open'
      ORDER BY t.opened_at ASC
    `).all();

    const stmtItems = db.prepare(`
      SELECT ti.*, p.name as product_name, p.category, p.image_url
      FROM bistro_tab_items ti
      JOIN products p ON p.id = ti.product_id
      WHERE ti.tab_id = ?
      ORDER BY ti.added_at ASC
    `);

    return tabs.map(tab => {
      const items = stmtItems.all(tab.id);
      const totalAmount = items.reduce((acc, it) => acc + Number(it.total_price), 0);
      return {
        ...tab,
        total_amount: Number(totalAmount.toFixed(2)),
        items: items.map(it => ({
          id_produto: it.product_id,
          nome_item: it.product_name,
          preco: Number(it.unit_price),
          quantidade: Number(it.quantity),
          categoria: it.category,
          imagem_url: it.image_url,
          observacoes: it.observations,
          status_cozinha: it.kitchen_status
        }))
      };
    });
  }

  /**
   * Fecha a comanda após o faturamento no PDV
   */
  static closeTab(tabId) {
    const db = getDb();
    db.prepare(`
      UPDATE bistro_tabs
      SET status = 'closed', closed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(tabId);
    return { success: true, tab_id: tabId, status: 'closed' };
  }
}

module.exports = BistroTabService;
