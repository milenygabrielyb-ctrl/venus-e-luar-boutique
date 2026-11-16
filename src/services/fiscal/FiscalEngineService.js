/**
 * VÊNUS & LUAR BOUTIQUE - MOTOR FISCAL E TRIBUTÁRIO (NÍVEL DO ITEM)
 * 
 * Regras tributárias segregadas item a item para Simples Nacional (CRT 1)
 * Estado do Espírito Santo (ES) - Vila Velha (IBGE 3205200)
 * 
 * Conformidade com:
 * 1. CSOSN 102 (Tributação normal Simples Nacional)
 * 2. CSOSN 500 (ICMS cobrado anteriormente por Substituição Tributária - Cosméticos/Rações)
 * 3. PIS/COFINS Monofásico CST 04 (Alíquota zero no varejo - Cosméticos e Bebidas frias)
 * 4. Anexo I do Simples Nacional (Comércio 4%) para Cafeteria/Bistrô (CFOP 5102 padrão)
 * 5. Reforma Tributária 2026 (LC 214/2025): CBS 0,9% e IBS 0,1% com dispensa de destaque para CRT 1
 */

class FiscalEngineService {
  /**
   * Calcula a tributação e enquadramento fiscal individual de um item do pedido
   * 
   * @param {Object} item Dados do item (product_id, quantity, unit_price, etc.)
   * @param {Object} product Atributos fiscais cadastrados do produto (ncm, cest, has_icms_st, etc.)
   * @param {Object} order Cabeçalho do pedido (destination_uf, channel, customer_is_contributor)
   * @param {Object} company Dados da empresa matriz (uf = 'ES', crt = 1, enable_ibs_cbs_highlight)
   * @returns {Object} Snapshot tributário completo
   */
  static determineItemTaxation(item, product, order, company) {
    const companyUf = company?.uf || 'ES';
    const destUf = order?.destination_uf || 'ES';
    const isInternal = destUf.toUpperCase() === companyUf.toUpperCase();
    const isContributor = Boolean(order?.customer_is_contributor);
    
    const quantity = Number(item.quantity || 1);
    const unitPrice = Number(item.unit_price || item.price || 0);
    const itemTotal = Number((quantity * unitPrice).toFixed(2));

    let cfop = '5102';
    let csosn = '102';
    let pisCst = '49';
    let cofinsCst = '49';

    // 1. ANÁLISE DE VENDA INTERNA (ESPÍRITO SANTO -> ESPÍRITO SANTO)
    if (isInternal) {
      if (product.has_icms_st) {
        // Cosméticos, Rações Pet e Bebidas Frias com ICMS-ST já retido na fonte
        cfop = '5405';
        csosn = '500'; // Evita pagamento duplicado de ICMS no DAS!
      } else if (product.default_cfop) {
        // CFOP configurado no cadastro (ex: 5102 para cafeteria no Anexo I)
        cfop = product.default_cfop;
        csosn = '102';
      } else {
        // Moda, Acessórios Pet e Mercadorias normais de revenda
        cfop = '5102';
        csosn = '102';
      }
    } 
    // 2. ANÁLISE DE VENDA INTERESTADUAL (E-COMMERCE PARA FORA DO ES)
    else {
      if (isContributor) {
        // Venda para PJ contribuinte com Inscrição Estadual
        cfop = product.has_icms_st ? '6403' : '6102';
        csosn = product.has_icms_st ? '500' : '102';
      } else {
        // Venda para Consumidor Final Não Contribuinte (Pessoa Física no Site)
        cfop = product.has_icms_st ? '6404' : '6108';
        csosn = product.has_icms_st ? '500' : '102';
      }
    }

    // 3. PIS E COFINS MONOFÁSICO (COSMÉTICOS E BEBIDAS FRIAS)
    if (product.is_monophasic_pis_cofins) {
      // CST 04: Operação Tributável Monofásica - Revenda a Alíquota Zero
      pisCst = '04';
      cofinsCst = '04';
    } else {
      // CST 49: Outras Operações de Saída (Padrão Simples Nacional)
      pisCst = '49';
      cofinsCst = '49';
    }

    // 4. ICMS DO SIMPLES NACIONAL
    // No Simples Nacional com CSOSN 102/500, a alíquota não é destacada no corpo do item
    // exceto para fins de crédito fiscal quando permitido (CSOSN 101/201).
    const icmsBase = csosn === '500' ? 0 : itemTotal;
    const icmsRate = csosn === '500' ? 0 : 0.00; // Alíquota embutida no DAS da faixa do Simples
    const icmsAmount = 0.00;
    const icmsStAmount = 0.00;

    // 5. REFORMA TRIBUTÁRIA 2026 (LEI COMPLEMENTAR 214/2025)
    // Projeção teórica: CBS (0,90%) e IBS (0,10%)
    const cbsRate = 0.90;
    const cbsAmount = Number((itemTotal * (cbsRate / 100)).toFixed(2));
    const ibsRate = 0.10;
    const ibsAmount = Number((itemTotal * (ibsRate / 100)).toFixed(2));

    // Trava inteligente: empresas no Simples Nacional (CRT 1) estão dispensadas de destaque
    const shouldHighlightIbsCbs = Boolean(
      company?.enable_ibs_cbs_highlight === 1 || company?.crt === 3
    );

    return {
      product_id: product.id,
      product_name: product.name,
      quantity,
      unit_price: unitPrice,
      total_price: itemTotal,
      ncm: product.ncm || '61044300',
      cest: product.cest || null,
      cfop,
      csosn,
      pis_cst: pisCst,
      cofins_cst: cofinsCst,
      icms_base: icmsBase,
      icms_rate: icmsRate,
      icms_amount: icmsAmount,
      icms_st_amount: icmsStAmount,
      cbs_rate: cbsRate,
      cbs_amount: cbsAmount,
      ibs_rate: ibsRate,
      ibs_amount: ibsAmount,
      should_highlight_ibs_cbs: shouldHighlightIbsCbs
    };
  }

  /**
   * Consolida a tributação de todos os itens de um pedido
   */
  static processOrderTaxes(orderItems, productsMap, order, company) {
    const processedItems = orderItems.map(it => {
      const prod = productsMap[it.product_id] || it;
      return this.determineItemTaxation(it, prod, order, company);
    });

    const totalOrder = processedItems.reduce((acc, curr) => acc + curr.total_price, 0);
    const totalStItems = processedItems.filter(it => it.csosn === '500').reduce((acc, curr) => acc + curr.total_price, 0);
    const totalMonophasicItems = processedItems.filter(it => it.pis_cst === '04').reduce((acc, curr) => acc + curr.total_price, 0);
    const totalCbs = processedItems.reduce((acc, curr) => acc + curr.cbs_amount, 0);
    const totalIbs = processedItems.reduce((acc, curr) => acc + curr.ibs_amount, 0);

    return {
      items: processedItems,
      summary: {
        total_order_amount: Number(totalOrder.toFixed(2)),
        total_icms_st_amount: Number(totalStItems.toFixed(2)),
        total_monophasic_amount: Number(totalMonophasicItems.toFixed(2)),
        projected_cbs_2026: Number(totalCbs.toFixed(2)),
        projected_ibs_2026: Number(totalIbs.toFixed(2)),
        highlight_ibs_cbs: company?.enable_ibs_cbs_highlight === 1 || company?.crt === 3
      }
    };
  }
}

module.exports = FiscalEngineService;
