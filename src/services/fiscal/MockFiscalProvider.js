/**
 * VÊNUS & LUAR BOUTIQUE - MOCK FISCAL PROVIDER (SANDBOX / PRÉ-CNPJ)
 * 
 * Simula emissão, assinatura, validação de regras fiscais e autorização
 * de NFC-e (65) e NF-e (55) com geração real de XML, chaves e QR Code.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const IFiscalProvider = require('../../domain/contracts/IFiscalProvider');
const AccessKeyGenerator = require('./AccessKeyGenerator');
const QrCodeGenerator = require('./QrCodeGenerator');
const FiscalEngineService = require('./FiscalEngineService');
const { getDb, transaction, queryOne, execute } = require('../../config/database');
const sefazConfig = require('../../config/sefaz-config');

class MockFiscalProvider extends IFiscalProvider {
  constructor() {
    super();
    this.storageDir = path.join(__dirname, '..', '..', '..', 'storage', 'xml');
    this.authorizedDir = path.join(this.storageDir, 'authorized');
    this.contingencyDir = path.join(this.storageDir, 'contingency');

    [this.authorizedDir, this.contingencyDir].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
  }

  /**
   * Emite e autoriza a nota fiscal
   */
  async authorize(order, company, options = {}) {
    const model = options.model || (order.channel === 'ECOMMERCE' ? sefazConfig.MODEL_NFE : sefazConfig.MODEL_NFCE);
    const series = options.series || 1;
    const tpEmis = options.tpEmis || sefazConfig.TP_EMIS_NORMAL; // 1 = Normal, 9 = Contingência
    const companyId = company?.id || sefazConfig.COMPANY_DEFAULT_ID;

    return transaction(db => {
      // 1. Obter e incrementar número contínuo sem saltos
      const seriesRow = db.prepare(`
        SELECT current_number FROM fiscal_series_control
        WHERE company_id = ? AND model = ? AND series = ?
      `).get(companyId, model, series);

      const nextNumber = ((seriesRow?.current_number) || 0) + 1;

      db.prepare(`
        UPDATE fiscal_series_control
        SET current_number = ?
        WHERE company_id = ? AND model = ? AND series = ?
      `).run(nextNumber, companyId, model, series);

      // 2. Gerar Chave de Acesso Oficial de 44 dígitos
      const issueDate = new Date();
      const accessKey = AccessKeyGenerator.generate({
        cUF: company.city_code ? company.city_code.slice(0, 2) : 32,
        issueDate,
        cnpj: company.cnpj || '00000000000191',
        model,
        series,
        number: nextNumber,
        tpEmis
      });

      // 3. Gerar QR Code para NFC-e (65)
      let qrCodeUrl = null;
      if (model === sefazConfig.MODEL_NFCE) {
        qrCodeUrl = QrCodeGenerator.generate({
          accessKey,
          tpAmb: 2, // Homologação / Mock
          destDoc: order.customer_cpf_snapshot || '',
          issueDate,
          totalAmount: order.total_amount,
          cscTokenId: company.nfce_csc_token_id || sefazConfig.DEFAULT_CSC.CSC_ID,
          cscTokenCode: company.nfce_csc_token_code || sefazConfig.DEFAULT_CSC.CSC_TOKEN
        });
      }

      // 4. Montar XML Mock Estruturado conforme SEFAZ MOC
      const protocolNumber = `13226${String(Math.floor(100000000 + Math.random() * 900000000))}`;
      const xmlContent = this._generateXml({
        order,
        company,
        model,
        series,
        number: nextNumber,
        accessKey,
        tpEmis,
        issueDate,
        protocolNumber,
        qrCodeUrl
      });

      // 5. Salvar arquivo XML em disco
      const targetDir = tpEmis === sefazConfig.TP_EMIS_CONTINGENCY_OFFLINE ? this.contingencyDir : this.authorizedDir;
      const fileName = `${accessKey}-procNFe.xml`;
      const filePath = path.join(targetDir, fileName);
      fs.writeFileSync(filePath, xmlContent, 'utf-8');

      // 6. Persistir na tabela `fiscal_documents`
      const docId = 'fisc_' + accessKey;
      db.prepare(`
        INSERT INTO fiscal_documents (
          id, company_id, order_id, model, series, document_number, access_key,
          emission_type, status, status_code, status_reason, xml_content,
          protocol_number, qr_code_url, issued_at, contingency_reason
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?
        )
      `).run(
        docId,
        companyId,
        order.id,
        model,
        series,
        nextNumber,
        accessKey,
        tpEmis,
        tpEmis === sefazConfig.TP_EMIS_CONTINGENCY_OFFLINE ? 'contingency' : 'authorized',
        tpEmis === sefazConfig.TP_EMIS_CONTINGENCY_OFFLINE ? 999 : 100,
        tpEmis === sefazConfig.TP_EMIS_CONTINGENCY_OFFLINE ? 'Emitido em contingência off-line' : 'Autorizado o uso da NF-e/NFC-e',
        xmlContent,
        tpEmis === sefazConfig.TP_EMIS_CONTINGENCY_OFFLINE ? null : protocolNumber,
        qrCodeUrl,
        issueDate.toISOString(),
        options.contingency_reason || null
      );

      // 7. Atualizar status do pedido
      db.prepare(`
        UPDATE orders
        SET status = 'invoiced'
        WHERE id = ?
      `).run(order.id);

      return {
        success: true,
        document_id: docId,
        model,
        series,
        document_number: nextNumber,
        access_key: accessKey,
        protocol_number: protocolNumber,
        qr_code_url: qrCodeUrl,
        xml_file: filePath,
        is_contingency: tpEmis === sefazConfig.TP_EMIS_CONTINGENCY_OFFLINE,
        status: tpEmis === sefazConfig.TP_EMIS_CONTINGENCY_OFFLINE ? 'contingency' : 'authorized',
        status_message: 'Autorizado com Sucesso (Ambiente de Homologação/Sandbox)'
      };
    });
  }

  /**
   * Cancelamento de Documento Fiscal
   */
  async cancel(accessKey, justification) {
    if (!justification || justification.trim().length < 15) {
      throw new Error('A justificativa de cancelamento deve ter no mínimo 15 caracteres.');
    }

    const db = getDb();
    const doc = db.prepare('SELECT * FROM fiscal_documents WHERE access_key = ?').get(accessKey);
    if (!doc) {
      throw new Error(`Documento fiscal com chave ${accessKey} não encontrado.`);
    }

    if (doc.status === 'cancelled') {
      return { success: true, message: 'Documento já estava cancelado.' };
    }

    const cancelProtocol = `13226${String(Math.floor(100000000 + Math.random() * 900000000))}`;
    db.prepare(`
      UPDATE fiscal_documents
      SET status = 'cancelled',
          status_code = 135,
          status_reason = 'Cancelamento de NF-e homologado',
          protocol_number = ?
      WHERE access_key = ?
    `).run(cancelProtocol, accessKey);

    return {
      success: true,
      access_key: accessKey,
      status: 'cancelled',
      protocol_number: cancelProtocol,
      message: 'Cancelamento homologado com sucesso.'
    };
  }

  /**
   * Consulta de Status
   */
  async checkStatus() {
    return {
      online: true,
      status_code: 107,
      message: 'Serviço em Operação (SEFAZ-ES Mock/Sandbox)',
      tMed: 1,
      ambiente: 'Homologação'
    };
  }

  /**
   * Construtor de XML Mock
   */
  _generateXml({ order, company, model, series, number, accessKey, tpEmis, issueDate, protocolNumber, qrCodeUrl }) {
    const isNfce = model === '65';
    const highlightIbsCbs = company?.enable_ibs_cbs_highlight === 1 || company?.crt === 3;

    return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe${accessKey}" versao="4.00">
      <ide>
        <cUF>32</cUF>
        <cNF>${accessKey.slice(35, 43)}</cNF>
        <natOp>VENDA DE MERCADORIAS</natOp>
        <mod>${model}</mod>
        <serie>${series}</serie>
        <nNF>${number}</nNF>
        <dhEmi>${issueDate.toISOString()}</dhEmi>
        <tpNF>1</tpNF>
        <idDest>1</idDest>
        <cMunFG>${company.city_code || '3205200'}</cMunFG>
        <tpImp>${isNfce ? '4' : '1'}</tpImp>
        <tpEmis>${tpEmis}</tpEmis>
        <cDV>${accessKey.slice(-1)}</cDV>
        <tpAmb>2</tpAmb>
        <finNFe>1</finNFe>
        <indFinal>1</indFinal>
        <indPres>${isNfce ? '1' : '2'}</indPres>
        <procEmi>0</procEmi>
        <verProc>VenusLuar-Omni-2.0</verProc>
      </ide>
      <emit>
        <CNPJ>${(company.cnpj || '00000000000191').replace(/\\D/g, '')}</CNPJ>
        <xNome>${company.legal_name || 'Vênus & Luar Boutique Ltda'}</xNome>
        <xFant>${company.trade_name || 'Vênus & Luar Boutique'}</xFant>
        <enderEmit>
          <xLgr>${company.address_street || 'Rua Santa Rosa'}</xLgr>
          <nro>${company.address_number || '123'}</nro>
          <xBairro>${company.address_neighborhood || 'Glória'}</xBairro>
          <cMun>${company.city_code || '3205200'}</cMun>
          <xMun>Vila Velha</xMun>
          <UF>${company.uf || 'ES'}</UF>
          <CEP>${(company.address_zip || '29122000').replace(/\\D/g, '')}</CEP>
          <cPais>1058</cPais>
          <xPais>BRASIL</xPais>
        </enderEmit>
        <IE>${company.state_registration || 'ISENTO'}</IE>
        <CRT>${company.crt || 1}</CRT>
      </emit>
      <dest>
        ${order.customer_cpf_snapshot ? `<CPF>${order.customer_cpf_snapshot.replace(/\\D/g, '')}</CPF>` : ''}
        <xNome>${order.customer_name_snapshot || 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'}</xNome>
        <indIEDest>9</indIEDest>
      </dest>
      <total>
        <ICMSTot>
          <vBC>0.00</vBC>
          <vICMS>0.00</vICMS>
          <vICMSDeson>0.00</vICMSDeson>
          <vFCP>0.00</vFCP>
          <vBCST>0.00</vBCST>
          <vST>0.00</vST>
          <vFCPST>0.00</vFCPST>
          <vFCPSTRet>0.00</vFCPSTRet>
          <vProd>${Number(order.subtotal || order.total_amount).toFixed(2)}</vProd>
          <vFrete>${Number(order.shipping_amount || 0).toFixed(2)}</vFrete>
          <vSeg>0.00</vSeg>
          <vDesc>${Number(order.discount_amount || 0).toFixed(2)}</vDesc>
          <vII>0.00</vII>
          <vIPI>0.00</vIPI>
          <vIPIDevol>0.00</vIPIDevol>
          <vPIS>0.00</vPIS>
          <vCOFINS>0.00</vCOFINS>
          <vOutro>0.00</vOutro>
          <vNF>${Number(order.total_amount).toFixed(2)}</vNF>
        </ICMSTot>
        ${highlightIbsCbs ? `
        <IBSCBSTot>
          <vCBS>${Number(order.total_amount * 0.009).toFixed(2)}</vCBS>
          <vIBS>${Number(order.total_amount * 0.001).toFixed(2)}</vIBS>
        </IBSCBSTot>` : ''}
      </total>
      <pag>
        <detPag>
          <tPag>01</tPag>
          <vPag>${Number(order.total_amount).toFixed(2)}</vPag>
        </detPag>
      </pag>
      ${qrCodeUrl ? `
      <infNFeSupl>
        <qrCode><![CDATA[${qrCodeUrl}]]></qrCode>
        <urlChave>https://app.sefaz.es.gov.br/ConsultaNFCe/</urlChave>
      </infNFeSupl>` : ''}
    </infNFe>
  </NFe>
  <protNFe versao="4.00">
    <infProt>
      <tpAmb>2</tpAmb>
      <verAplic>ES_NFE_2.0</verAplic>
      <chNFe>${accessKey}</chNFe>
      <dhRecbto>${issueDate.toISOString()}</dhRecbto>
      <nProt>${protocolNumber}</nProt>
      <digVal>${crypto.createHash('sha1').update(accessKey).digest('base64')}</digVal>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e</xMotivo>
    </infProt>
  </protNFe>
</nfeProc>`;
  }
}

module.exports = MockFiscalProvider;
