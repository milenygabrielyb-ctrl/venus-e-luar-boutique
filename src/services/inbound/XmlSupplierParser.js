/**
 * VÊNUS & LUAR BOUTIQUE - IMPORTADOR E PARSER DE XML DE FORNECEDORES (INBOUND)
 * 
 * Processa XMLs de NF-e (Modelo 55) recebidos de distribuidores e confecções:
 * 1. Extrai cabeçalho (chave de acesso 44 dígitos, fornecedor, número, emissão, valor total);
 * 2. Faz o parsing dos itens (`<det>`), capturando NCM, CEST, CFOP de entrada e CST/CSOSN;
 * 3. Identifica automaticamente a incidência de Substituição Tributária (`has_st_detected = true`)
 *    se o CST/CSOSN for 10, 60, 70, 201, 202, 500 ou se houver destaque de ICMS-ST;
 * 4. Alimenta o estoque e registra na tabela `inbound_invoices` e `inbound_invoice_items`.
 */

const { getDb, transaction } = require('../../config/database');
const InventoryService = require('../inventory/InventoryService');

class XmlSupplierParser {
  /**
   * Faz o parsing de uma string XML de NF-e do fornecedor
   * (Parser regex nativo leve e seguro, sem dependências externas)
   */
  static parse(xmlString) {
    if (!xmlString || typeof xmlString !== 'string') {
      throw new Error('Conteúdo XML inválido ou vazio.');
    }

    // 1. Chave de acesso de 44 dígitos
    const keyMatch = xmlString.match(/Id="NFe(\d{44})"/i) || xmlString.match(/<chNFe>(\d{44})<\/chNFe>/i);
    const accessKey = keyMatch ? keyMatch[1] : null;
    if (!accessKey) {
      throw new Error('Não foi possível localizar a chave de acesso oficial de 44 dígitos no XML.');
    }

    // 2. Dados do emitente (Fornecedor)
    const emitMatch = xmlString.match(/<emit>([\s\S]*?)<\/emit>/i);
    const emitContent = emitMatch ? emitMatch[1] : '';
    const supplierCnpjMatch = emitContent.match(/<CNPJ>(\d+)<\/CNPJ>/i);
    const supplierNameMatch = emitContent.match(/<xNome>(.*?)<\/xNome>/i);
    const supplierCnpj = supplierCnpjMatch ? supplierCnpjMatch[1] : '00000000000000';
    const supplierName = supplierNameMatch ? supplierNameMatch[1].trim() : 'Fornecedor Desconhecido';

    // 3. Dados da nota (<ide>)
    const ideMatch = xmlString.match(/<ide>([\s\S]*?)<\/ide>/i);
    const ideContent = ideMatch ? ideMatch[1] : '';
    const nNfMatch = ideContent.match(/<nNF>(\d+)<\/nNF>/i);
    const serieMatch = ideContent.match(/<serie>(\d+)<\/serie>/i);
    const dhEmiMatch = ideContent.match(/<dhEmi>(.*?)<\/dhEmi>/i) || ideContent.match(/<dEmi>(.*?)<\/dEmi>/i);

    const invoiceNumber = nNfMatch ? parseInt(nNfMatch[1], 10) : 0;
    const invoiceSeries = serieMatch ? parseInt(serieMatch[1], 10) : 1;
    const issueDate = dhEmiMatch ? dhEmiMatch[1].trim() : new Date().toISOString();

    // 4. Valor total (<total><ICMSTot><vNF>)
    const vNfMatch = xmlString.match(/<vNF>([\d.]+)<\/vNF>/i);
    const totalAmount = vNfMatch ? parseFloat(vNfMatch[1]) : 0;

    // 5. Itens da nota (<det>)
    const detRegex = /<det nItem="\d+">([\s\S]*?)<\/det>/gi;
    let detMatch;
    const items = [];

    while ((detMatch = detRegex.exec(xmlString)) !== null) {
      const detXml = detMatch[1];

      const cProd = (detXml.match(/<cProd>(.*?)<\/cProd>/i) || [])[1] || '';
      const xProd = (detXml.match(/<xProd>(.*?)<\/xProd>/i) || [])[1] || '';
      const ncm = (detXml.match(/<NCM>(\d+)<\/NCM>/i) || [])[1] || '';
      const cest = (detXml.match(/<CEST>(\d+)<\/CEST>/i) || [])[1] || null;
      const cfop = (detXml.match(/<CFOP>(\d+)<\/CFOP>/i) || [])[1] || '';
      const qCom = parseFloat((detXml.match(/<qCom>([\d.]+)<\/qCom>/i) || [])[1] || '1');
      const vUnCom = parseFloat((detXml.match(/<vUnCom>([\d.]+)<\/vUnCom>/i) || [])[1] || '0');

      // Detectar CST ou CSOSN do ICMS
      const icmsBlockMatch = detXml.match(/<ICMS>([\s\S]*?)<\/ICMS>/i);
      const icmsBlock = icmsBlockMatch ? icmsBlockMatch[1] : '';
      const cstMatch = icmsBlock.match(/<CST>(\d+)<\/CST>/i) || icmsBlock.match(/<CSOSN>(\d+)<\/CSOSN>/i);
      const cstCsosn = cstMatch ? cstMatch[1] : '00';

      // Detectar se há valor de ST destacado no item
      const vIcmsStMatch = detXml.match(/<vICMSST>([\d.]+)<\/vICMSST>/i);
      const vIcmsSt = vIcmsStMatch ? parseFloat(vIcmsStMatch[1]) : 0;

      // Regra de Detecção Automática de ST:
      // CSTs com ST: 10, 60, 70, 90 (com ST) | CSOSNs com ST: 201, 202, 500
      const stCsts = ['10', '60', '70', '201', '202', '500'];
      const hasStDetected = stCsts.includes(cstCsosn) || vIcmsSt > 0;

      // Lote e validade se presentes nas tags <rastro>
      const nLoteMatch = detXml.match(/<nLote>(.*?)<\/nLote>/i);
      const dValMatch = detXml.match(/<dVal>(.*?)<\/dVal>/i);
      const batchNumber = nLoteMatch ? nLoteMatch[1].trim() : null;
      const expirationDate = dValMatch ? dValMatch[1].trim() : null;

      items.push({
        supplier_item_code: cProd,
        supplier_item_name: xProd,
        ncm,
        cest,
        cfop_entry: cfop,
        cst_csosn_entry: cstCsosn,
        has_st_detected: hasStDetected,
        quantity: qCom,
        unit_cost: vUnCom,
        batch_number: batchNumber,
        expiration_date: expirationDate
      });
    }

    return {
      access_key: accessKey,
      supplier_cnpj: supplierCnpj,
      supplier_name: supplierName,
      invoice_number: invoiceNumber,
      invoice_series: invoiceSeries,
      issue_date: issueDate,
      total_invoice_amount: totalAmount,
      items,
      raw_xml: xmlString
    };
  }

  /**
   * Importa o XML, salva no banco e atualiza o estoque
   */
  static importInvoice(xmlString, options = {}) {
    const parsed = this.parse(xmlString);

    return transaction(db => {
      // Verificar se a nota já foi importada
      const existing = db.prepare('SELECT id FROM inbound_invoices WHERE access_key = ?').get(parsed.access_key);
      if (existing) {
        throw new Error(`A nota fiscal com chave ${parsed.access_key} já foi importada anteriormente.`);
      }

      const invoiceId = 'inb_' + parsed.access_key;

      // 1. Inserir cabeçalho
      db.prepare(`
        INSERT INTO inbound_invoices (
          id, access_key, supplier_cnpj, supplier_name, invoice_number, invoice_series,
          issue_date, total_invoice_amount, raw_xml
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        invoiceId,
        parsed.access_key,
        parsed.supplier_cnpj,
        parsed.supplier_name,
        parsed.invoice_number,
        parsed.invoice_series,
        parsed.issue_date,
        parsed.total_invoice_amount,
        parsed.raw_xml
      );

      // 2. Inserir itens
      const stmtItem = db.prepare(`
        INSERT INTO inbound_invoice_items (
          id, inbound_invoice_id, supplier_item_code, supplier_item_name,
          ncm, cest, cfop_entry, cst_csosn_entry, has_st_detected,
          quantity, unit_cost, batch_number, expiration_date, matched_product_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < parsed.items.length; i++) {
        const it = parsed.items[i];
        const itemId = `${invoiceId}_it_${i}`;

        // Tentar vincular automaticamente a produto existente pelo NCM ou nome
        let matchedProductId = null;
        const match = db.prepare(`
          SELECT id FROM products
          WHERE (ncm = ? AND ncm != '') OR (lower(name) = lower(?))
          LIMIT 1
        `).get(it.ncm, it.supplier_item_name);
        
        if (match) {
          matchedProductId = match.id;
          // Se detectou ST, atualizar a flag do produto para evitar bitributação futura
          if (it.has_st_detected) {
            db.prepare("UPDATE products SET has_icms_st = 1, default_cfop = '5405' WHERE id = ?").run(match.id);
          }
          // Alimentar estoque físico
          if (options.autoRestock !== false) {
            InventoryService.recordMovement({
              productId: match.id,
              movementType: 'IN_PURCHASE',
              quantity: it.quantity,
              invoiceId: invoiceId,
              operatorName: options.operatorName || 'Importador XML',
              notes: `Entrada NF-e Fornecedor: ${parsed.supplier_name} (#${parsed.invoice_number})`
            });
          }
        }

        stmtItem.run(
          itemId,
          invoiceId,
          it.supplier_item_code,
          it.supplier_item_name,
          it.ncm,
          it.cest,
          it.cfop_entry,
          it.cst_csosn_entry,
          it.has_st_detected ? 1 : 0,
          it.quantity,
          it.unit_cost,
          it.batch_number,
          it.expiration_date,
          matchedProductId
        );
      }

      return {
        success: true,
        invoice_id: invoiceId,
        access_key: parsed.access_key,
        supplier_name: parsed.supplier_name,
        total_items: parsed.items.length,
        items_with_st_detected: parsed.items.filter(it => it.has_st_detected).length
      };
    });
  }
}

module.exports = XmlSupplierParser;
