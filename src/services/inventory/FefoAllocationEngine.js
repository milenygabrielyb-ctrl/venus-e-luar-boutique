/**
 * VÊNUS & LUAR BOUTIQUE - MOTOR FEFO (FIRST EXPIRED, FIRST OUT)
 * 
 * Aloca e consome lotes de Cosméticos, Higiene e Alimentos Pet
 * ordenados compulsoriamente pela data de validade mais próxima.
 */

const { getDb, transaction } = require('../../config/database');
const InventoryService = require('./InventoryService');

class FefoAllocationEngine {
  /**
   * Aloca e consome a quantidade solicitada utilizando o critério FEFO
   * 
   * @param {string} productId ID do produto
   * @param {number} quantity Quantidade necessária
   * @param {Object} options { orderId, operatorName, notes, movementType }
   * @returns {Object} { success, allocations: [{ batch_id, batch_number, expiration_date, quantity_allocated }] }
   */
  static allocateAndConsume(productId, quantity, options = {}) {
    const needed = Number(quantity);
    if (needed <= 0) throw new Error('Quantidade para alocação FEFO deve ser maior que zero.');

    return transaction(db => {
      // 1. Buscar lotes ativos ordenados por data de validade crescente (FEFO)
      const batches = db.prepare(`
        SELECT * FROM product_batches
        WHERE product_id = ? AND status = 'active' AND current_quantity > 0
        ORDER BY expiration_date ASC
      `).all(productId);

      const totalInBatches = batches.reduce((acc, b) => acc + Number(b.current_quantity), 0);
      if (totalInBatches < needed) {
        throw new Error(`Estoque insuficiente em lotes ativos para FEFO. Disponível em lotes: ${totalInBatches}, Solicitado: ${needed}`);
      }

      let remainingToAllocate = needed;
      const allocations = [];

      for (const batch of batches) {
        if (remainingToAllocate <= 0) break;

        const currentQty = Number(batch.current_quantity);
        const qtyToTake = Math.min(currentQty, remainingToAllocate);
        const newBatchQty = currentQty - qtyToTake;
        const newStatus = newBatchQty === 0 ? 'depleted' : 'active';

        // Atualizar saldo do lote
        db.prepare(`
          UPDATE product_batches
          SET current_quantity = ?, status = ?
          WHERE id = ?
        `).run(newBatchQty, newStatus, batch.id);

        allocations.push({
          batch_id: batch.id,
          batch_number: batch.batch_number,
          expiration_date: batch.expiration_date,
          quantity_allocated: qtyToTake,
          batch_depleted: newStatus === 'depleted'
        });

        // Registrar saída no Kardex vinculado ao lote
        InventoryService.recordMovement({
          productId,
          batchId: batch.id,
          movementType: options.movementType || 'OUT_SALE',
          quantity: -qtyToTake,
          orderId: options.orderId || null,
          operatorName: options.operatorName || 'Sistema FEFO',
          notes: options.notes || `Alocação FEFO - Lote ${batch.batch_number} (Val: ${batch.expiration_date})`
        });

        remainingToAllocate -= qtyToTake;
      }

      return {
        success: true,
        product_id: productId,
        total_requested: needed,
        allocations
      };
    });
  }

  /**
   * Consulta os próximos lotes a vencer (para relatórios de validade e promoções de giro rápido)
   */
  static getExpiringSoon(daysThreshold = 60) {
    const db = getDb();
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() + daysThreshold);
    const dateStr = thresholdDate.toISOString().slice(0, 10);

    return db.prepare(`
      SELECT b.*, p.name as product_name, p.category
      FROM product_batches b
      JOIN products p ON p.id = b.product_id
      WHERE b.status = 'active' AND b.current_quantity > 0 AND b.expiration_date <= ?
      ORDER BY b.expiration_date ASC
    `).all(dateStr);
  }
}

module.exports = FefoAllocationEngine;
