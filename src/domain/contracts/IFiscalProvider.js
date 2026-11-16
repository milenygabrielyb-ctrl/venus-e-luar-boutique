/**
 * VÊNUS & LUAR BOUTIQUE - CONTRATO UNIVERSAL DO PROVEDOR FISCAL
 * 
 * Interface para desacoplamento de emissão fiscal.
 * Implementações:
 * - MockFiscalProvider: Fase atual pré-CNPJ / desenvolvimento
 * - SefazEsProvider: Fase futura com Certificado Digital e-CNPJ A1
 */

class IFiscalProvider {
  /**
   * Emite e autoriza um documento fiscal (NFC-e 65 ou NF-e 55)
   * @param {Object} order Pedido com itens tributados e totais
   * @param {Object} company Dados fiscais da empresa
   * @param {Object} options { model: '65'|'55', tpEmis: 1|9 }
   * @returns {Promise<Object>} Resultado da autorização (access_key, xml, protocol, qrcode)
   */
  async authorize(order, company, options = {}) {
    throw new Error('Método authorize() não implementado.');
  }

  /**
   * Cancela um documento fiscal previamente autorizado
   * @param {string} accessKey Chave de 44 dígitos
   * @param {string} justification Motivo do cancelamento (mínimo 15 caracteres)
   * @returns {Promise<Object>} Resultado do cancelamento
   */
  async cancel(accessKey, justification) {
    throw new Error('Método cancel() não implementado.');
  }

  /**
   * Consulta o status do serviço na SEFAZ-ES
   * @returns {Promise<Object>} Status do webservice
   */
  async checkStatus() {
    throw new Error('Método checkStatus() não implementado.');
  }
}

module.exports = IFiscalProvider;
