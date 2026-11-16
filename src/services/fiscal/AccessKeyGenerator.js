/**
 * VÊNUS & LUAR BOUTIQUE - GERADOR DA CHAVE DE ACESSO OFICIAL (44 DÍGITOS)
 * 
 * Regra do Manual de Orientação do Contribuinte (MOC SEFAZ):
 * cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + serie(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1)
 */

class AccessKeyGenerator {
  /**
   * Calcula o Dígito Verificador Módulo 11 da chave de 43 dígitos
   * Ponderação de 2 a 9 da direita para a esquerda.
   */
  static calculateCheckDigit(key43) {
    if (typeof key43 !== 'string' || key43.length !== 43) {
      throw new Error(`A chave base para cálculo do DV deve ter exatamente 43 dígitos. Recebido: ${key43}`);
    }

    let sum = 0;
    let weight = 2;

    for (let i = key43.length - 1; i >= 0; i--) {
      sum += parseInt(key43[i], 10) * weight;
      weight++;
      if (weight > 9) weight = 2;
    }

    const remainder = sum % 11;
    if (remainder === 0 || remainder === 1) {
      return 0;
    }
    return 11 - remainder;
  }

  /**
   * Gera a Chave de Acesso Oficial de 44 dígitos
   * 
   * @param {Object} params
   * @param {string|number} params.cUF Código da UF (ES = 32)
   * @param {Date|string} params.issueDate Data de emissão da nota
   * @param {string} params.cnpj CNPJ do emitente (apenas números, 14 dígitos)
   * @param {string} params.model Modelo da nota ('55' para NF-e, '65' para NFC-e)
   * @param {number} params.series Série do documento (ex: 1)
   * @param {number} params.number Número sequencial da nota (ex: 105)
   * @param {number} params.tpEmis Tipo de emissão (1 = normal, 9 = contingência off-line)
   * @param {number|string} [params.cNF] Código numérico aleatório de 8 dígitos
   * @returns {string} Chave de 44 dígitos validada
   */
  static generate({
    cUF = 32,
    issueDate = new Date(),
    cnpj = '00000000000191',
    model = '65',
    series = 1,
    number = 1,
    tpEmis = 1,
    cNF = null
  }) {
    const d = new Date(issueDate);
    const aa = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const aamm = `${aa}${mm}`;

    const cUfStr = String(cUF).padStart(2, '0');
    const cnpjStr = String(cnpj).replace(/\D/g, '').padStart(14, '0').slice(0, 14);
    const modStr = String(model).padStart(2, '0');
    const serieStr = String(series).padStart(3, '0');
    const nNfStr = String(number).padStart(9, '0');
    const tpEmisStr = String(tpEmis);

    // Código numérico aleatório de 8 dígitos (evita previsibilidade da nota)
    const cNfStr = cNF 
      ? String(cNF).padStart(8, '0') 
      : String(Math.floor(10000000 + Math.random() * 90000000));

    const key43 = `${cUfStr}${aamm}${cnpjStr}${modStr}${serieStr}${nNfStr}${tpEmisStr}${cNfStr}`;
    const dv = this.calculateCheckDigit(key43);

    return `${key43}${dv}`;
  }

  /**
   * Valida se uma chave de 44 dígitos possui Dígito Verificador correto
   */
  static validate(key44) {
    if (typeof key44 !== 'string') return false;
    const clean = key44.replace(/\D/g, '');
    if (clean.length !== 44) return false;

    const base43 = clean.slice(0, 43);
    const expectedDv = parseInt(clean[43], 10);
    const calculatedDv = this.calculateCheckDigit(base43);

    return expectedDv === calculatedDv;
  }
}

module.exports = AccessKeyGenerator;
