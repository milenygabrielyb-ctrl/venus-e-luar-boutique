/**
 * VÊNUS & LUAR BOUTIQUE - CONFIGURAÇÕES SEFAZ ESPÍRITO SANTO (ES)
 * 
 * Parâmetros oficiais de emissão fiscal (NFC-e Modelo 65 e NF-e Modelo 55)
 * Suporte a Mock/Sandbox e contingência off-line.
 */

module.exports = {
  // Dados de Matriz
  COMPANY_DEFAULT_ID: 'comp_matriz_es',
  STATE_CODE_ES: '32',
  CITY_CODE_VILA_VELHA: '3205200',
  STATE_ABBR_ES: 'ES',
  
  // Modelos de Documento Fiscal
  MODEL_NFE: '55',
  MODEL_NFCE: '65',
  
  // Tipos de Emissão
  TP_EMIS_NORMAL: 1,
  TP_EMIS_CONTINGENCY_OFFLINE: 9,
  
  // CRT (Código de Regime Tributário)
  CRT_SIMPLES_NACIONAL: 1,
  CRT_REGIME_NORMAL: 3,
  
  // URLs Oficiais de Consulta NFC-e SEFAZ-ES (QR Code Versão 2.0)
  URLS: {
    NFCE_QRCODE_HOMOLOGACAO: 'https://homologacao.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx',
    NFCE_QRCODE_PRODUCAO: 'https://app.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx',
    PORTAL_NACIONAL_NFE_HOMOLOGACAO: 'https://hom.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx',
    PORTAL_NACIONAL_NFE_PRODUCAO: 'https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx'
  },
  
  // Valores Padrão de CSC Token (Ambiente Homologação / Mock)
  DEFAULT_CSC: {
    CSC_ID: '000001',
    CSC_TOKEN: 'HOMOLOGACAO_CSC_VENUS_LUAR_TOKEN_2026'
  }
};
