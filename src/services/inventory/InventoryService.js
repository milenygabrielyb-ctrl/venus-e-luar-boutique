/**
 * VÊNUS & LUAR BOUTIQUE - SERVIÇO DE ESTOQUE HÍBRIDO OMNICHANNEL
 * 
 * Controla os 3 estados de saldo:
 * - physical_stock: Quantidade física real presente na loja
 * - reserved_stock: Quantidade bloqueada por pedidos e-commerce
 * - available_stock: Saldo livre para venda imediata (physical - reserved)
 * 
 * Registra movimentações no Kardex contínuo auditável (`inventory_movements`),
 * incluindo baixas para uso interno / mostruário / provador (`OUT_INTERNAL_USE`).
 */

const { getDb, transaction, queryOne, query, execute } = require('../../config/database');

class InventoryService {
  /**
   * Obtém o saldo atual consolidado em 3 estados de um produto ou variação
   */
  static getBalance(productId, variantId = null, location = 'LOJA-VILA-VELHA') {
    const db = getDb();
    let row;
    if (variantId) {
      row = db.prepare(`
        SELECT * FROM inventory_balances
        WHERE product_id = ? AND variant_id = ? AND location = ?
      `).get(productId, variantId, location);
    } else {
      row = db.prepare(`
        SELECT * FROM inventory_balances
        WHERE product_id = ? AND variant_id IS NULL AND location = ?
      `).get(productId, location);
    }

    if (!row) {
      return {
        product_id: productId,
        variant_id: variantId,
        physical_stock: 0,
        reserved_stock: 0,
        available_stock: 0,
        min_stock_alert: 2,
        location
      };
    }

    return {
      id: row.id,
      product_id: row.product_id,
      variant_id: row.variant_id,
      physical_stock: Number(row.physical_stock),
      reserved_stock: Number(row.reserved_stock),
      available_stock: Number(row.physical_stock) - Number(row.reserved_stock),
      min_stock_alert: Number(row.min_stock_alert),
      location: row.location,
      updated_at: row.updated_at
    };
  }

  /**
   * Reserva estoque para um pedido do E-commerce
   */
  static reserveStock(productId, quantity, variantId = null, location = 'LOJA-VILA-VELHA') {
    const qty = Number(quantity);
    if (qty <= 0) throw new Error('Quantidade a reservar deve ser positiva.');

    return transaction(db => {
      const current = this.getBalance(productId, variantId, location);
      if (current.available_stock < qty) {
        throw new Error(`Saldo insuficiente para reserva. Disponível: ${current.available_stock}, Solicitado: ${qty}`);
      }

      const newReserved = current.reserved_stock + qty;
      if (variantId) {
        db.prepare(`
          UPDATE inventory_balances
          SET reserved_stock = ?, updated_at = CURRENT_TIMESTAMP
          WHERE product_id = ? AND variant_id = ? AND location = ?
        `).run(newReserved, productId, variantId, location);
      } else {
        db.prepare(`
          UPDATE inventory_balances
          SET reserved_stock = ?, updated_at = CURRENT_TIMESTAMP
          WHERE product_id = ? AND variant_id IS NULL AND location = ?
        `).run(newReserved, productId, location);
      }

      return {
        product_id: productId,
        variant_id: variantId,
        reserved: qty,
        new_reserved_stock: newReserved,
        available_stock: current.physical_stock - newReserved
      };
    });
  }

  /**
   * Libera reserva de estoque (ex: carrinho expirou ou pedido cancelado)
   */
  static releaseReservation(productId, quantity, variantId = null, location = 'LOJA-VILA-VELHA') {
    const qty = Number(quantity);
    return transaction(db => {
      const current = this.getBalance(productId, variantId, location);
      const newReserved = Math.max(0, current.reserved_stock - qty);

      if (variantId) {
        db.prepare(`
          UPDATE inventory_balances
          SET reserved_stock = ?, updated_at = CURRENT_TIMESTAMP
          WHERE product_id = ? AND variant_id = ? AND location = ?
        `).run(newReserved, productId, variantId, location);
      } else {
        db.prepare(`
          UPDATE inventory_balances
          SET reserved_stock = ?, updated_at = CURRENT_TIMESTAMP
          WHERE product_id = ? AND variant_id IS NULL AND location = ?
        `).run(newReserved, productId, location);
      }

      return {
        product_id: productId,
        variant_id: variantId,
        released: qty,
        new_reserved_stock: newReserved,
        available_stock: current.physical_stock - newReserved
      };
    });
  }

  /**
   * Registra uma movimentação no estoque físico e grava no Kardex auditável
   */
  static recordMovement({
    productId,
    variantId = null,
    batchId = null,
    movementType, // 'IN_PURCHASE' | 'OUT_SALE' | 'OUT_RECIPE_BISTRO' | 'OUT_RETURN' | 'OUT_INTERNAL_USE' | 'ADJUST_LOSS'
    quantity,     // positivo para entrada, negativo para saída
    orderId = null,
    invoiceId = null,
    notes = '',
    operatorName = 'Sistema',
    location = 'LOJA-VILA-VELHA'
  }) {
    const qty = Number(quantity);

    return transaction(db => {
      const current = this.getBalance(productId, variantId, location);
      const newPhysical = Math.max(0, current.physical_stock + qty);
      
      // Se for saída de venda confirmada que estava reservada, diminuir a reserva proporcionalmente
      let newReserved = current.reserved_stock;
      if (movementType === 'OUT_SALE' && newReserved > 0) {
        newReserved = Math.max(0, newReserved - Math.abs(qty));
      }

      // Atualiza saldo
      if (variantId) {
        db.prepare(`
          UPDATE inventory_balances
          SET physical_stock = ?, reserved_stock = ?, updated_at = CURRENT_TIMESTAMP
          WHERE product_id = ? AND variant_id = ? AND location = ?
        `).run(newPhysical, newReserved, productId, variantId, location);
      } else {
        db.prepare(`
          UPDATE inventory_balances
          SET physical_stock = ?, reserved_stock = ?, updated_at = CURRENT_TIMESTAMP
          WHERE product_id = ? AND variant_id IS NULL AND location = ?
        `).run(newPhysical, newReserved, productId, location);
      }

      // Registra no Kardex
      const movId = 'mov_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      db.prepare(`
        INSERT INTO inventory_movements (
          id, product_id, variant_id, batch_id, movement_type, quantity,
          balance_after, reference_order_id, reference_invoice_id, notes, operator_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        movId,
        productId,
        variantId,
        batchId,
        movementType,
        qty,
        newPhysical,
        orderId,
        invoiceId,
        notes,
        operatorName
      );

      return {
        movement_id: movId,
        product_id: productId,
        movement_type: movementType,
        quantity_moved: qty,
        physical_stock_after: newPhysical,
        available_stock_after: newPhysical - newReserved
      };
    });
  }

  /**
   * Baixa especial para Uso Interno / Provador / Mostruário (`OUT_INTERNAL_USE`)
   * Separa 1 unidade de cosmético/perfume para provador no balcão sem distorcer perdas.
   */
  static separateInternalUseTester(productId, quantity = 1, operatorName = 'Mileny Gabriely', notes = 'Separado para provador de balcão') {
    return this.recordMovement({
      productId,
      movementType: 'OUT_INTERNAL_USE',
      quantity: -Math.abs(quantity),
      operatorName,
      notes
    });
  }
}

module.exports = InventoryService;
