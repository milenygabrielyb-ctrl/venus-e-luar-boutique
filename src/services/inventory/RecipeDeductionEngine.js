/**
 * VÊNUS & LUAR BOUTIQUE - MOTOR DE BAIXA DE FICHAS TÉCNICAS (BISTRÔ / CAFETERIA)
 * 
 * Ao vender um item preparado (ex: Cappuccino, Toast, Cold Brew),
 * calcula a perda técnica e dá baixa automática nos insumos brutos do estoque.
 */

const { getDb, transaction } = require('../../config/database');
const InventoryService = require('./InventoryService');

class RecipeDeductionEngine {
  /**
   * Processa a baixa de insumos para um produto composto vendido
   * 
   * @param {string} compositeProductId ID do produto acabado (ex: prod_9 Cappuccino)
   * @param {number} quantitySold Quantidade de porções vendidas
   * @param {Object} options { orderId, operatorName }
   * @returns {Object} Detalhes das baixas realizadas nos insumos
   */
  static deductRecipeIngredients(compositeProductId, quantitySold = 1, options = {}) {
    const portions = Number(quantitySold);
    if (portions <= 0) return { success: true, deductions: [] };

    return transaction(db => {
      // 1. Buscar a ficha técnica do produto composto
      const recipes = db.prepare(`
        SELECT r.*, p.name as ingredient_name
        FROM product_recipes r
        JOIN products p ON p.id = r.ingredient_product_id
        WHERE r.composite_product_id = ?
      `).all(compositeProductId);

      if (!recipes || recipes.length === 0) {
        // Se não tiver ficha técnica cadastrada, não há insumos a baixar
        return {
          success: true,
          composite_product_id: compositeProductId,
          deductions: [],
          message: 'Produto sem ingredientes de ficha técnica cadastrados.'
        };
      }

      const deductions = [];

      for (const rec of recipes) {
        const baseQty = Number(rec.quantity_required);
        const lossFactor = Number(rec.loss_factor || 0);
        // Quantidade total considerando perda / quebra técnica
        const totalDeduction = Number((portions * baseQty * (1 + (lossFactor / 100))).toFixed(4));

        // Registrar saída do insumo bruto
        const mov = InventoryService.recordMovement({
          productId: rec.ingredient_product_id,
          movementType: 'OUT_RECIPE_BISTRO',
          quantity: -totalDeduction,
          orderId: options.orderId || null,
          operatorName: options.operatorName || 'Bistrô KDS',
          notes: `Baixa Ficha Técnica: ${portions}x porção de ${compositeProductId} (Insumo: ${rec.ingredient_name})`
        });

        deductions.push({
          ingredient_id: rec.ingredient_product_id,
          ingredient_name: rec.ingredient_name,
          unit_of_measure: rec.unit_of_measure,
          quantity_deducted: totalDeduction,
          loss_factor_applied: lossFactor,
          stock_after: mov.physical_stock_after
        });
      }

      return {
        success: true,
        composite_product_id: compositeProductId,
        portions_sold: portions,
        deductions
      };
    });
  }
}

module.exports = RecipeDeductionEngine;
