/**
 * VÊNUS & LUAR BOUTIQUE - GERADOR DE QR CODE OFICIAL NFC-e (SEFAZ-ES)
 * 
 * Padrão Técnico NFC-e Versão 2.0 (SEFAZ Espírito Santo)
 * Parâmetro: p=chNFe|2|tpAmb|cDest|dhEmi|vNF|vICMS|digVal|cIdToken|cHashQRCode
 */

const crypto = require('crypto');
const sefazConfig = require('../../config/sefaz-config');

class QrCodeGenerator {
  /**
   * Gera a URL e o payload oficial do QR Code da NFC-e Modelo 65
   * 
   * @param {Object} params
   * @param {string} params.accessKey Chave de 44 dígitos
   * @param {number} [params.tpAmb=2] 1 = Produção; 2 = Homologação / Sandbox
   * @param {string} [params.destDoc=''] CPF do destinatário se informado
   * @param {Date|string} params.issueDate Data e hora de emissão
   * @param {number} params.totalAmount Valor total da nota (vNF)
   * @param {number} [params.icmsAmount=0] Valor total do ICMS (vICMS)
   * @param {string} [params.digestValue=''] DigestValue do XML
   * @param {string} params.cscTokenId Identificador do CSC (ex: '000001')
   * @param {string} params.cscTokenCode Código de segurança alfanumérico do CSC
   * @returns {string} URL completa para impressão no cupom térmico 80mm
   */
  static generate({
    accessKey,
    tpAmb = 2,
    destDoc = '',
    issueDate = new Date(),
    totalAmount = 0,
    icmsAmount = 0,
    digestValue = '',
    cscTokenId = sefazConfig.DEFAULT_CSC.CSC_ID,
    cscTokenCode = sefazConfig.DEFAULT_CSC.CSC_TOKEN
  }) {
    const baseUrl = tpAmb === 1 
      ? sefazConfig.URLS.NFCE_QRCODE_PRODUCAO 
      : sefazConfig.URLS.NFCE_QRCODE_HOMOLOGACAO;

    const d = new Date(issueDate);
    const dhEmiHex = Buffer.from(d.toISOString()).toString('hex');
    const vNf = Number(totalAmount).toFixed(2);
    const vIcms = Number(icmsAmount).toFixed(2);
    const digValHex = digestValue ? Buffer.from(digestValue).toString('hex') : Buffer.from(accessKey.slice(-16)).toString('hex');
    const cIdTokenInt = parseInt(cscTokenId, 10) || 1;

    // Concatenação conforme manual técnico SEFAZ
    const preHash = `${accessKey}|2|${tpAmb}|${cIdTokenInt}`;
    const hashInput = `${preHash}${cscTokenCode}`;
    const cHashQrCode = crypto.createHash('sha1').update(hashInput).digest('hex').toUpperCase();

    const paramP = `${preHash}|${cHashQrCode}`;
    return `${baseUrl}?p=${paramP}`;
  }
}

module.exports = QrCodeGenerator;
