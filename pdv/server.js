/**
 * VÊNUS & LUAR BOUTIQUE - SISTEMA INDEPENDENTE DE PDV (FRENTE DE CAIXA PROFISSIONAL)
 * 
 * - Porta Dedicada: 3001 (http://localhost:3001)
 * - Módulos:
 *   1. Cadastro de novos produtos e gestão rápida de estoque físico/preços
 *   2. Monitor e auditoria de vendas da Boutique em tempo real (Site E-commerce, Bistrô e PDV)
 *   3. Fluxo obrigatório de faturamento em 4 etapas guiadas:
 *      Passo 1: Selecionar ou cadastrar Cliente (Pessoa Física obrigatório com CPF de 11 dígitos)
 *      Passo 2: Selecionar produtos a comprar (catálogo físico ou comanda puxada do bistrô)
 *      Passo 3: Forma de pagamento (Dinheiro com cálculo de troco, Cartões, PIX)
 *      Passo 4: Faturar Pedido & Emitir Nota Fiscal / Cupom 80mm (FAT-PDV-2026-XXXX com chave SHA-256)
 *   4. Regras unificadas de faturamento exclusivo para Pessoa Física
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

// Garantir Fuso Horário Oficial de Brasília (UTC-3) em qualquer ambiente (inclusive Render / Nuvem)
process.env.TZ = 'America/Sao_Paulo';

// Utilitários de Data e Hora no Horário Oficial de Brasília (SEFAZ / Fiscal)
function getBrasiliaIsoString(date = new Date()) {
  const d = new Date(date);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(d);
  const getPart = (type) => parts.find(p => p.type === type).value;
  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  let hour = getPart('hour');
  if (hour === '24') hour = '00';
  const minute = getPart('minute');
  const second = getPart('second');
  return `${year}-${month}-${day}T${hour}:${minute}:${second}-03:00`;
}

function formatarDataHoraBrasilia(date = new Date()) {
  const d = new Date(date);
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

const PORT = process.env.PORT || 3001;
const BOUTIQUE_URL = process.env.BOUTIQUE_URL || 'http://localhost:3000';

// Módulos Relacionais e Motores Fiscais Omnichannel (Fases 1 a 5)
const { getDb, queryOne, query, execute, transaction } = require('../src/config/database');
const FiscalEngineService = require('../src/services/fiscal/FiscalEngineService');
const MockFiscalProvider = require('../src/services/fiscal/MockFiscalProvider');
const InventoryService = require('../src/services/inventory/InventoryService');
const FefoAllocationEngine = require('../src/services/inventory/FefoAllocationEngine');
const RecipeDeductionEngine = require('../src/services/inventory/RecipeDeductionEngine');
const BistroTabService = require('../src/services/bistro/BistroTabService');
const mockFiscalProvider = new MockFiscalProvider();

// Acesso aos dados persistidos compartilhados
const DATA_DIR = path.join(__dirname, '..', 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'produtos.json');
const ORDERS_FILE = path.join(DATA_DIR, 'pedidos.json');
const USERS_FILE = path.join(DATA_DIR, 'usuarios.json');
const CAIXA_FILE = path.join(DATA_DIR, 'caixa_turnos.json');

function carregarJson(arquivo, fallback) {
  try {
    if (fs.existsSync(arquivo)) {
      return JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
    }
  } catch (e) {
    console.error('Erro ao ler ' + arquivo + ':', e);
  }
  return fallback;
}

function salvarJson(arquivo, dados) {
  try {
    fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2), 'utf-8');
  } catch (e) {
    console.error('Erro ao salvar ' + arquivo + ':', e);
  }
}

function carregarTurnoCaixa() {
  return carregarJson(CAIXA_FILE, {
    turnoAtual: null,
    historicoTurnos: []
  });
}

function salvarTurnoCaixa(dados) {
  salvarJson(CAIXA_FILE, dados);
}

// Validação oficial de Pessoa Física (CPF de 11 dígitos, rejeita vazios, fictícios e sequências repetidas)
function validarCpf(cpf) {
  if (!cpf) return false;
  const limpo = String(cpf).replace(/\D/g, '');
  if (limpo.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(limpo)) return false;
  return true;
}

function formatarCpf(cpf) {
  const d = (cpf || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return d.slice(0, 3) + '.' + d.slice(3);
  if (d.length <= 9) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
}

function formatarTelefone(tel) {
  const d = (tel || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
  if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
}

function getPdvHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
  <meta http-equiv="Pragma" content="no-cache" />
  <meta http-equiv="Expires" content="0" />
  <title>Vênus & Luar • Frente de Caixa & PDV Profissional</title>
  <link rel="icon" type="image/jpeg" href="/logo.jpg" />
  <!-- Tailwind CSS -->
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- React 18 e ReactDOM -->
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <!-- Babel Standalone -->
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <!-- Fontes Oficiais -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800;900&family=Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=JetBrains+Mono:wght@400;600;800&display=swap" rel="stylesheet">
  
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            celestial: {
              950: '#03060E',
              900: '#080E1E',
              800: '#0D172E',
              700: '#142244'
            },
            ouro: {
              DEFAULT: '#DFB15B',
              light: '#FFE8A3',
              dark: '#9E7422'
            },
            luar: {
              100: '#FFFFFF',
              200: '#EAE6DF',
              300: '#B0A898'
            }
          },
          fontFamily: {
            serif: ['Cinzel', 'serif'],
            sans: ['Montserrat', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace']
          }
        }
      }
    };
  </script>
  <style>
    body {
      background-color: #03060E;
      color: #EAE6DF;
      font-family: 'Montserrat', sans-serif;
      margin: 0;
      padding: 0;
      overflow: hidden;
      user-select: none;
    }
    .gold-gradient-text {
      background: linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    /* Layout Responsivo Profissional do PDV */
    .pdv-layout-body {
      height: 100vh;
      width: 100vw;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background-color: #03060E;
    }
    .pdv-main-content {
      flex: 1 1 0%;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      padding: 8px 10px 10px 10px;
    }

    /* Telas >= 850px: 3 Colunas Lado a Lado (Perfeito para 1014px, 1024px, 1366px, 1920px) */
    @media (min-width: 850px) {
      .pdv-mobile-nav {
        display: none !important;
      }
      .pdv-columns-wrapper {
        display: flex !important;
        flex-direction: row !important;
        gap: 10px !important;
        height: 100% !important;
        min-height: 0 !important;
        overflow: hidden !important;
      }
      .pdv-col-comandas {
        display: flex !important;
        flex-direction: column !important;
        width: 270px !important;
        min-width: 240px !important;
        max-width: 290px !important;
        flex-shrink: 0 !important;
        height: 100% !important;
        min-height: 0 !important;
      }
      .pdv-col-catalogo {
        display: flex !important;
        flex-direction: column !important;
        flex: 1 1 0% !important;
        min-width: 320px !important;
        height: 100% !important;
        min-height: 0 !important;
      }
      .pdv-col-caixa {
        display: flex !important;
        flex-direction: column !important;
        justify-content: space-between !important;
        width: 380px !important;
        min-width: 350px !important;
        max-width: 410px !important;
        flex-shrink: 0 !important;
        height: 100% !important;
        min-height: 0 !important;
      }
    }

    /* Telas < 850px (Tablets e Celulares): Abas */
    @media (max-width: 849px) {
      .pdv-mobile-nav {
        display: flex !important;
      }
      .pdv-columns-wrapper {
        display: flex !important;
        flex-direction: column !important;
        height: 100% !important;
        min-height: 0 !important;
        overflow: hidden !important;
      }
      .pdv-col-comandas, .pdv-col-catalogo, .pdv-col-caixa {
        width: 100% !important;
        height: 100% !important;
        min-height: 0 !important;
      }
    }

    /* Estilos de Impressão Térmica 80mm */
    @media print {
      body * { visibility: hidden; }
      #area-cupom-impressao, #area-cupom-impressao * { visibility: visible; }
      #area-cupom-impressao {
        position: absolute;
        left: 0;
        top: 0;
        width: 80mm !important;
        margin: 0 !important;
        padding: 4mm !important;
        font-family: monospace !important;
        color: #000 !important;
        background: #fff !important;
      }
      .nao-imprimir { display: none !important; }
    }
    /* Custom Scrollbar */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: #080E1E; }
    ::-webkit-scrollbar-thumb { background: #DFB15B33; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #DFB15B66; }
  </style>
</head>
<body>
  <div id="root"></div>

  <script type="text/babel">
    const { useState, useEffect, useRef } = React;
    const BOUTIQUE_URL = 'http://localhost:3000';

    function formatBRL(val) {
      return Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    function formatarDataHora(val) {
      if (!val) return '';
      try {
        return new Date(val).toLocaleString('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      } catch(e) {
        return String(val);
      }
    }

    function formatarCpf(cpf) {
      const d = (cpf || '').replace(/[^0-9]/g, '').slice(0, 11);
      if (d.length <= 3) return d;
      if (d.length <= 6) return d.slice(0, 3) + '.' + d.slice(3);
      if (d.length <= 9) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
      return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    }

    function formatarTelefone(tel) {
      const d = (tel || '').replace(/[^0-9]/g, '').slice(0, 11);
      if (d.length <= 2) return d;
      if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
      if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
      return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    }

    function validarCpf(cpf) {
      if (!cpf) return false;
      const limpo = String(cpf).replace(/[^0-9]/g, '');
      if (limpo.length !== 11) return false;
      if (limpo.split('').every(c => c === limpo[0])) return false;
      return true;
    }

    function PdvApp() {
      // Operador Atual (Salvo ou null para exibir tela de Login/Cadastro Inicial)
      const [operador, setOperador] = useState(() => {
        const salvo = localStorage.getItem('venus_pdv_operador');
        if (salvo) {
          try { return JSON.parse(salvo); } catch(e) {}
        }
        return null;
      });

      // Aba da Tela Inicial de Autenticação do Usuário: 'login' | 'cadastro' | 'rapido'
      const [abaLogin, setAbaLogin] = useState('login');
      const [loginEmail, setLoginEmail] = useState('');
      const [loginSenha, setLoginSenha] = useState('');
      const [processandoLogin, setProcessandoLogin] = useState(false);

      // Campos da Aba de Cadastro Inicial de Usuário
      const [cadNome, setCadNome] = useState('');
      const [cadCargo, setCadCargo] = useState('Operadora de Caixa');
      const [cadEmail, setCadEmail] = useState('');
      const [cadSenha, setCadSenha] = useState('');
      const [cadConfirmarSenha, setCadConfirmarSenha] = useState('');
      const [processandoCadastro, setProcessandoCadastro] = useState(false);
      const [listaOperadores, setListaOperadores] = useState([]);

      // Dados Principais
      const [produtos, setProdutos] = useState([]);
      const [comandas, setComandas] = useState([]);
      const [colaboradores, setColaboradores] = useState([]);
      const [clientes, setClientes] = useState([]);
      const [statusConexao, setStatusConexao] = useState('online');

      // Venda Ativa no Caixa (Fluxo Guiado em 4 Etapas)
      // PASSO 1: Cliente Pessoa Física (Obrigatório)
      const [clienteSelecionado, setClienteSelecionado] = useState(null);
      const [buscaCliente, setBuscaCliente] = useState('');
      const [mostrarSugestoesCliente, setMostrarSugestoesCliente] = useState(false);

      // PASSO 2: Itens do Pedido
      const [comandaSelecionada, setComandaSelecionada] = useState(null);
      const [itensCaixa, setItensCaixa] = useState([]);
      const [localConsumo, setLocalConsumo] = useState('Venda Balcão / Loja Física');

      // PASSO 3: Forma de Pagamento & Desconto
      const [desconto, setDesconto] = useState(0);
      const [formaPagamento, setFormaPagamento] = useState('Dinheiro');
      const [valorRecebido, setValorRecebido] = useState('');

      // PASSO 4: Faturamento e Cupom
      const [finalizando, setFinalizando] = useState(false);
      const [cupomEmitido, setCupomEmitido] = useState(null);

      // Filtros e Visualização Responsiva
      const [busca, setBusca] = useState('');
      const [abaCat, setAbaCat] = useState('Todos');
      const [abaAtivaMobile, setAbaAtivaMobile] = useState('catalogo');

      // Aba Principal do PDV: 'caixa' (Frente de Caixa 3 Colunas) | 'cadastro_inicial' (Aba de Cadastros Iniciais)
      const [abaPrincipal, setAbaPrincipal] = useState('caixa');
      const [subAbaCadastro, setSubAbaCadastro] = useState('clientes'); // 'clientes' | 'produtos' | 'loja'
      const [buscaCadastroCli, setBuscaCadastroCli] = useState('');
      const [buscaCadastroProd, setBuscaCadastroProd] = useState('');

      // Modais do Sistema
      const [modalEquipeAberto, setModalEquipeAberto] = useState(false);
      const [modalProdutosEstoqueAberto, setModalProdutosEstoqueAberto] = useState(false);
      const [modalVendasBoutiqueAberto, setModalVendasBoutiqueAberto] = useState(false);
      const [modalNovoClienteAberto, setModalNovoClienteAberto] = useState(false);

      // Módulo: Turno de Caixa (Abertura, Sangria, Suprimento e Fechamento)
      const [modalCaixaAberto, setModalCaixaAberto] = useState(false);
      const [turnoCaixa, setTurnoCaixa] = useState(null);
      const [caixaAbaModal, setCaixaAbaModal] = useState('status'); // 'status' | 'abrir' | 'suprimento' | 'sangria' | 'fechar'
      const [caixaFundoInicial, setCaixaFundoInicial] = useState('100.00');
      const [caixaMovValor, setCaixaMovValor] = useState('');
      const [caixaMovMotivo, setCaixaMovMotivo] = useState('');
      const [caixaDinheiroContado, setCaixaDinheiroContado] = useState('');
      const [caixaRelatorioFechamento, setCaixaRelatorioFechamento] = useState(null);
      const [processandoCaixa, setProcessandoCaixa] = useState(false);

      // Módulo: Monitor KDS da Cafeteria & Bistrô (Copa em tempo real)
      const [modalKdsAberto, setModalKdsAberto] = useState(false);
      const [kdsPedidos, setKdsPedidos] = useState([]);
      const [carregandoKds, setCarregandoKds] = useState(false);

      // Sub-aba do Modal de Produtos
      const [abaModalProdutos, setAbaModalProdutos] = useState('estoque'); // 'estoque' | 'cadastrar'
      const [salvandoEstoqueId, setSalvandoEstoqueId] = useState(null);

      // Form Novo Produto
      const [novoProdNome, setNovoProdNome] = useState('');
      const [novoProdCat, setNovoProdCat] = useState('Moda');
      const [novoProdPreco, setNovoProdPreco] = useState('');
      const [novoProdEstoque, setNovoProdEstoque] = useState('10');
      const [novoProdImg, setNovoProdImg] = useState('');
      const [novoProdDesc, setNovoProdDesc] = useState('');
      const [salvandoProduto, setSalvandoProduto] = useState(false);

      // Form Novo Cliente Pessoa Física
      const [novoCliNome, setNovoCliNome] = useState('');
      const [novoCliCpf, setNovoCliCpf] = useState('');
      const [novoCliEmail, setNovoCliEmail] = useState('');
      const [novoCliTel, setNovoCliTel] = useState('');
      const [salvandoCliente, setSalvandoCliente] = useState(false);

      // Dados de Vendas da Boutique & Auditoria
      const [vendasBoutique, setVendasBoutique] = useState({ kpis: {}, pedidos: [] });
      const [filtroOrigemVendas, setFiltroOrigemVendas] = useState('Todos');
      const [carregandoVendas, setCarregandoVendas] = useState(false);
      const [pedidoDetalhesModal, setPedidoDetalhesModal] = useState(null);

      // Form Novo Colaborador
      const [formNovoColab, setFormNovoColab] = useState(false);
      const [novoNome, setNovoNome] = useState('');
      const [novoCargo, setNovoCargo] = useState('Vendedor');
      const [novoEmail, setNovoEmail] = useState('');
      const [novoSenha, setNovoSenha] = useState('');
      const [novoPerms, setNovoPerms] = useState({ pdv: true, estoque: false, produtos: false, faturamento: false, adocao: false });

      // Notificação Toast
      const [notificacao, setNotificacao] = useState(null);
      const avisar = (msg) => {
        setNotificacao(msg);
        setTimeout(() => setNotificacao(null), 3500);
      };

      // Carregar dados gerais
      const carregarDados = async () => {
        try {
          const [resP, resC, resE, resCli] = await Promise.all([
            fetch('/api/pdv/produtos'),
            fetch('/api/pdv/comandas'),
            fetch('/api/pdv/equipe'),
            fetch('/api/pdv/clientes')
          ]);
          if (resP.ok) setProdutos(await resP.json());
          if (resC.ok) setComandas(await resC.json());
          if (resE.ok) {
            const data = await resE.json();
            setColaboradores(data.colaboradores || []);
          }
          if (resCli.ok) setClientes(await resCli.json());
          carregarStatusCaixa();
          setStatusConexao('online');
        } catch (e) {
          setStatusConexao('offline');
        }
      };

      // Carregar Vendas da Boutique em tempo real
      const carregarVendasBoutique = async () => {
        setCarregandoVendas(true);
        try {
          const res = await fetch('/api/pdv/vendas-boutique');
          if (res.ok) {
            const data = await res.json();
            setVendasBoutique(data);
          }
        } catch (e) {
          console.error(e);
        } finally {
          setCarregandoVendas(false);
        }
      };

      // Áudio e Leitor Rápido de Código de Barras (EAN-13 / Bip)
      const tocarBeepPdv = () => {
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (!AudioContextClass) return;
          const ctx = new AudioContextClass();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(1400, ctx.currentTime);
          gain.gain.setValueAtTime(0.18, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.12);
        } catch(_) {}
      };

      const biparCodigoBarras = (codigo) => {
        if (!codigo || !codigo.trim()) return;
        const codLimpo = codigo.trim();
        const produto = produtos.find(p => 
          String(p.codigo_barras || '') === codLimpo ||
          String(p.id_produto) === codLimpo ||
          String(p.sku || '') === codLimpo ||
          (p.nome && p.nome.toLowerCase() === codLimpo.toLowerCase())
        );
        if (produto) {
          adicionarItem(produto);
          tocarBeepPdv();
          avisar('🔔 Bip! ' + produto.nome + ' adicionado ao caixa!');
          setBusca('');
        } else {
          avisar('⚠️ Código de barras ou produto não encontrado: ' + codLimpo);
        }
      };

      // Gestão de Turno de Caixa
      const carregarStatusCaixa = async () => {
        try {
          const res = await fetch('/api/pdv/caixa/status');
          if (res.ok) {
            const data = await res.json();
            setTurnoCaixa(data.turno);
          }
        } catch(e) {}
      };

      const abrirTurnoCaixa = async (e) => {
        if (e) e.preventDefault();
        try {
          setProcessandoCaixa(true);
          const res = await fetch('/api/pdv/caixa/abrir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operador_nome: operador?.nome || 'Operador Caixa',
              operador_id: operador?.id || 1,
              fundo_troco_inicial: Number(caixaFundoInicial) || 0
            })
          });
          const data = await res.json();
          if (res.ok && data.sucesso) {
            setTurnoCaixa(data.turno);
            setCaixaAbaModal('status');
            avisar('💵 Caixa aberto com sucesso! Fundo: R$ ' + Number(caixaFundoInicial).toFixed(2));
          } else {
            alert(data.erro || 'Erro ao abrir caixa.');
          }
        } catch(err) {
          alert('Erro de conexão ao abrir caixa.');
        } finally {
          setProcessandoCaixa(false);
        }
      };

      const registrarMovimentoCaixa = async (tipo) => {
        const valNum = Number(caixaMovValor);
        if (!valNum || valNum <= 0) {
          alert('Informe um valor válido maior que zero.');
          return;
        }
        try {
          setProcessandoCaixa(true);
          const res = await fetch('/api/pdv/caixa/movimento', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tipo,
              valor: valNum,
              motivo: caixaMovMotivo || (tipo === 'sangria' ? 'Retirada de segurança' : 'Suprimento de troco'),
              operador_nome: operador?.nome || 'Operador'
            })
          });
          const data = await res.json();
          if (res.ok && data.sucesso) {
            setTurnoCaixa(data.turno);
            setCaixaMovValor('');
            setCaixaMovMotivo('');
            setCaixaAbaModal('status');
            avisar('✓ ' + (tipo === 'sangria' ? 'Sangria' : 'Suprimento') + ' registrado: R$ ' + valNum.toFixed(2));
          } else {
            alert(data.erro || 'Erro ao registrar movimentação.');
          }
        } catch(err) {
          alert('Erro ao registrar movimentação.');
        } finally {
          setProcessandoCaixa(false);
        }
      };

      const fecharTurnoCaixa = async (e) => {
        if (e) e.preventDefault();
        if (!window.confirm('Confirma o fechamento deste turno de caixa?')) return;
        try {
          setProcessandoCaixa(true);
          const res = await fetch('/api/pdv/caixa/fechar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operador_nome: operador?.nome || 'Operador',
              dinheiro_contado: Number(caixaDinheiroContado) || 0
            })
          });
          const data = await res.json();
          if (res.ok && data.sucesso) {
            setCaixaRelatorioFechamento(data.relatorio);
            setTurnoCaixa(null);
            setCaixaDinheiroContado('');
            setCaixaAbaModal('relatorio');
            avisar('🔒 Turno de caixa fechado com sucesso!');
          } else {
            alert(data.erro || 'Erro ao fechar caixa.');
          }
        } catch(err) {
          alert('Erro ao fechar caixa.');
        } finally {
          setProcessandoCaixa(false);
        }
      };

      // Gestão KDS (Copa & Bistrô)
      const carregarKdsPedidos = async () => {
        setCarregandoKds(true);
        try {
          const res = await fetch('/api/pdv/kds/pedidos');
          if (res.ok) {
            const data = await res.json();
            setKdsPedidos(data.pedidos || []);
          }
        } catch(e) {}
        finally { setCarregandoKds(false); }
      };

      const atualizarStatusKds = async (idPedido, novoStatus) => {
        try {
          const res = await fetch('/api/pdv/kds/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_pedido: idPedido, status_kds: novoStatus })
          });
          if (res.ok) {
            carregarKdsPedidos();
            avisar('☕ Status KDS atualizado!');
          }
        } catch(e) {}
      };

      const carregarOperadores = async () => {
        try {
          const res = await fetch('/api/pdv/auth/operadores');
          if (res.ok) {
            setListaOperadores(await res.json());
          }
        } catch(e) {}
      };

      useEffect(() => {
        if (!operador) {
          carregarOperadores();
        }
      }, [operador]);

      const handleLogin = async (e) => {
        e.preventDefault();
        if (!loginEmail.trim()) {
          alert('Informe o seu e-mail de login.');
          return;
        }
        try {
          setProcessandoLogin(true);
          const res = await fetch('/api/pdv/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: loginEmail, senha: loginSenha })
          });
          const data = await res.json();
          if (res.ok && data.sucesso) {
            setOperador(data.operador);
            localStorage.setItem('venus_pdv_operador', JSON.stringify(data.operador));
            avisar('✨ Bem-vinda ao PDV, ' + data.operador.nome + '!');
          } else {
            alert(data.erro || 'Falha ao autenticar.');
          }
        } catch(e) {
          alert('Erro de conexão ao realizar login.');
        } finally {
          setProcessandoLogin(false);
        }
      };

      const handleCadastroUsuario = async (e) => {
        e.preventDefault();
        if (!cadNome.trim() || !cadEmail.trim()) {
          alert('Preencha o nome completo e o e-mail.');
          return;
        }
        if (!cadSenha || cadSenha.length < 6) {
          alert('A senha deve conter no mínimo 6 caracteres.');
          return;
        }
        if (cadSenha !== cadConfirmarSenha) {
          alert('A confirmação da senha não confere.');
          return;
        }

        try {
          setProcessandoCadastro(true);
          const res = await fetch('/api/pdv/auth/registrar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nome: cadNome.trim(),
              email: cadEmail.trim(),
              senha: cadSenha,
              cargo: cadCargo
            })
          });
          const data = await res.json();
          if (res.ok && data.sucesso) {
            setOperador(data.operador);
            localStorage.setItem('venus_pdv_operador', JSON.stringify(data.operador));
            avisar('✨ Conta de usuário criada! Bem-vinda, ' + data.operador.nome + '!');
          } else {
            alert(data.erro || 'Erro ao criar conta.');
          }
        } catch(e) {
          alert('Erro ao conectar com o servidor.');
        } finally {
          setProcessandoCadastro(false);
        }
      };

      const handleEntrarComo = (op) => {
        setOperador(op);
        localStorage.setItem('venus_pdv_operador', JSON.stringify(op));
        avisar('✨ Sessão iniciada como ' + op.nome + '!');
      };

      const handleLogout = () => {
        if (confirm('Deseja realmente sair da sessão do caixa?')) {
          localStorage.removeItem('venus_pdv_operador');
          setOperador(null);
          setAbaLogin('login');
          avisar('🔒 Sessão encerrada.');
        }
      };

      useEffect(() => {
        carregarDados();
        const interval = setInterval(async () => {
          try {
            const [resC, resCli] = await Promise.all([
              fetch('/api/pdv/comandas'),
              fetch('/api/pdv/clientes')
            ]);
            if (resC.ok) {
              const data = await resC.json();
              setComandas(data);
            }
            if (resCli.ok) {
              const cliData = await resCli.json();
              setClientes(cliData);
            }
            setStatusConexao('online');
          } catch(e) {
            setStatusConexao('offline');
          }
        }, 3000);
        return () => clearInterval(interval);
      }, []);

      // Atalhos de Teclado Profissionais (F2 Faturar, F3 Bipar, F4 Caixa, F6 KDS, Esc Fechar)
      useEffect(() => {
        const handleKeys = (e) => {
          if (e.key === 'F2') {
            e.preventDefault();
            const btn = document.getElementById('btn-faturar-pedido-pdv');
            if (btn && !btn.disabled) btn.click();
          } else if (e.key === 'F3') {
            e.preventDefault();
            document.getElementById('input-busca-pdv')?.focus();
          } else if (e.key === 'F4') {
            e.preventDefault();
            setModalCaixaAberto(prev => !prev);
          } else if (e.key === 'F6') {
            e.preventDefault();
            setModalKdsAberto(prev => !prev);
          } else if (e.key === 'Escape') {
            setCupomEmitido(null);
            setModalCaixaAberto(false);
            setModalKdsAberto(false);
            setModalEquipeAberto(false);
            setModalProdutosEstoqueAberto(false);
            setModalVendasBoutiqueAberto(false);
            setModalNovoClienteAberto(false);
            setPedidoDetalhesModal(null);
          }
        };
        window.addEventListener('keydown', handleKeys);
        return () => window.removeEventListener('keydown', handleKeys);
      }, []);

      // Seleção rápida de operadora
      const selecionarOperador = (colab) => {
        const info = {
          id_usuario: colab.id_usuario,
          nome: colab.nome_completo || colab.nome,
          cargo: colab.cargo || (colab.role === 'admin' ? 'Administradora' : 'Operadora')
        };
        setOperador(info);
        localStorage.setItem('venus_pdv_operador', JSON.stringify(info));
        setModalEquipeAberto(false);
        avisar('Operador ativo alterado para ' + info.nome + '!');
      };

      // Adicionar produto do catálogo ao carrinho com validação estrita de estoque
      const adicionarItem = (prod) => {
        const estoqueDisp = prod.estoque !== undefined ? Number(prod.estoque) : 999;
        const existe = itensCaixa.find(it => it.id_produto === prod.id_produto);
        const qtdAtual = existe ? existe.quantidade : 0;

        if (estoqueDisp <= 0) {
          avisar('⚠️ Produto esgotado no estoque físico: ' + (prod.nome_item || prod.nome));
          return;
        }

        if (qtdAtual + 1 > estoqueDisp) {
          avisar('⚠️ Limite de estoque atingido (' + estoqueDisp + ' un) para: ' + (prod.nome_item || prod.nome));
          return;
        }

        if (existe) {
          setItensCaixa(itensCaixa.map(it => it.id_produto === prod.id_produto ? { ...it, quantidade: it.quantidade + 1 } : it));
        } else {
          setItensCaixa([...itensCaixa, {
            id_produto: prod.id_produto,
            nome_item: prod.nome_item || prod.nome,
            preco: Number(prod.preco),
            quantidade: 1,
            categoria: prod.categoria,
            imagem_url: prod.imagem_url
          }]);
        }
        avisar('+1 ' + (prod.nome_item || prod.nome) + ' adicionado ao pedido!');
      };

      // Alterar quantidade com limite de estoque
      const alterarQtd = (idProd, delta) => {
        const prodRef = produtos.find(p => p.id_produto === idProd);
        const estoqueMax = prodRef && prodRef.estoque !== undefined ? Number(prodRef.estoque) : 999;

        setItensCaixa(itensCaixa.map(it => {
          if (it.id_produto === idProd) {
            const nova = it.quantidade + delta;
            if (delta > 0 && nova > estoqueMax) {
              avisar('⚠️ Estoque máximo disponível: ' + estoqueMax + ' unidades.');
              return it;
            }
            return nova > 0 ? { ...it, quantidade: nova } : null;
          }
          return it;
        }).filter(Boolean));
      };

      // Puxar comanda do bistrô para o caixa
      const puxarComanda = (cmd) => {
        setComandaSelecionada(cmd);
        setItensCaixa([...cmd.itens]);
        setLocalConsumo(cmd.local_consumo || 'Mesa Bistrô');
        setDesconto(0);
        setValorRecebido('');
        setAbaAtivaMobile('caixa');

        // Tentar localizar cliente na base se houver nome ou CPF
        if (cmd.cpf_cliente && cmd.cpf_cliente !== 'Pagamento no Caixa' && cmd.cpf_cliente.replace(/[^0-9]/g, '').length === 11) {
          const cliExistente = clientes.find(c => c.cpf && c.cpf.replace(/[^0-9]/g, '') === cmd.cpf_cliente.replace(/[^0-9]/g, ''));
          if (cliExistente) {
            setClienteSelecionado(cliExistente);
          } else {
            setClienteSelecionado({
              id_usuario: cmd.id_usuario || 'cli_temp',
              nome: cmd.nome_cliente || 'Cliente Bistrô',
              cpf: formatarCpf(cmd.cpf_cliente),
              email: 'cliente@bistro.com'
            });
          }
        } else if (cmd.nome_cliente) {
          const cliPorNome = clientes.find(c => (c.nome || c.nome_completo || '').toLowerCase() === cmd.nome_cliente.toLowerCase());
          if (cliPorNome) {
            setClienteSelecionado(cliPorNome);
          } else {
            setBuscaCliente(cmd.nome_cliente);
          }
        }
        avisar('Comanda #' + (cmd.numero_comanda || cmd.id_pedido) + ' carregada no caixa!');
      };

      // Limpar Venda Atual
      const limparVenda = () => {
        setClienteSelecionado(null);
        setBuscaCliente('');
        setComandaSelecionada(null);
        setItensCaixa([]);
        setLocalConsumo('Venda Balcão / Loja Física');
        setDesconto(0);
        setValorRecebido('');
        avisar('Caixa limpo para novo atendimento.');
      };

      // Totais e Troco
      const subtotal = itensCaixa.reduce((acc, it) => acc + (Number(it.preco) * Number(it.quantidade)), 0);
      const totalFinal = Math.max(0, subtotal - (Number(desconto) || 0));
      const troco = formaPagamento === 'Dinheiro' && Number(valorRecebido) > totalFinal ? Number(valorRecebido) - totalFinal : 0;

      // =====================================================================
      // PASSO 4: FATURAR PEDIDO & EMITIR NOTA FISCAL (REGRA PESSOA FÍSICA)
      // =====================================================================
      const faturarPedidoPdv = async () => {
        // Validação de Segurança: Turno de Caixa Aberto Obrigatório
        if (!turnoCaixa) {
          avisar('🔒 O Turno de Caixa está FECHADO! Abra o caixa com o fundo de troco antes de faturar.');
          setModalCaixaAberto(true);
          return;
        }

        // Validação Estrita do Passo 1: Cliente Pessoa Física Obrigatório
        if (!clienteSelecionado || !clienteSelecionado.cpf || clienteSelecionado.cpf.replace(/[^0-9]/g, '').length !== 11) {
          avisar('⚠️ PASSO 1: Selecione ou cadastre o Cliente com CPF válido (11 dígitos).');
          return;
        }

        // Validação do Passo 2: Produtos
        if (itensCaixa.length === 0) {
          avisar('⚠️ PASSO 2: Adicione ao menos um produto ou puxe uma comanda.');
          return;
        }

        // Validação do Passo 3: Pagamento em Dinheiro
        if (formaPagamento === 'Dinheiro') {
          const vr = Number(valorRecebido) || 0;
          if (vr < totalFinal) {
            avisar('⚠️ Valor recebido (R$ ' + vr.toFixed(2) + ') é menor que o total.');
            return;
          }
        }

        try {
          setFinalizando(true);
          const payload = {
            id_pedido: comandaSelecionada ? comandaSelecionada.id_pedido : null,
            itens: itensCaixa,
            desconto: Number(desconto) || 0,
            forma_pagamento: formaPagamento === 'Dinheiro' ? 'Dinheiro Físico' : formaPagamento,
            valor_recebido: formaPagamento === 'Dinheiro' ? Number(valorRecebido) : totalFinal,
            troco: troco,
            cliente_id: clienteSelecionado.id_usuario,
            nome_cliente: clienteSelecionado.nome || clienteSelecionado.nome_completo,
            cpf_cliente: clienteSelecionado.cpf,
            email_cliente: clienteSelecionado.email || '',
            telefone_cliente: clienteSelecionado.telefone || '',
            local_consumo: localConsumo,
            nome_operador: operador.nome
          };

          const res = await fetch('/api/pdv/faturar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const data = await res.json();
          if (res.ok && data.sucesso) {
            setCupomEmitido(data.cupom);
            limparVenda();
            carregarDados();
            avisar('⚡ Pedido Faturado com Sucesso! Fatura: ' + data.cupom.numero_fatura);
          } else {
            alert(data.erro || 'Falha ao faturar pedido.');
          }
        } catch (e) {
          alert('Erro de conexão ao processar faturamento no PDV.');
        } finally {
          setFinalizando(false);
        }
      };

      // =====================================================================
      // CADASTRAR NOVO CLIENTE PESSOA FÍSICA
      // =====================================================================
      const cadastrarClientePessoaFisica = async (e, redirecionarParaCaixa = false) => {
        if (e && e.preventDefault) e.preventDefault();
        const cpfLimpo = (novoCliCpf || '').replace(/[^0-9]/g, '');
        if (cpfLimpo.length !== 11 || !validarCpf(cpfLimpo)) {
          alert('O CPF é obrigatório e deve conter exatamente 11 dígitos válidos de Pessoa Física.');
          return;
        }
        if (!novoCliNome.trim()) {
          alert('Informe o nome completo do cliente.');
          return;
        }

        try {
          setSalvandoCliente(true);
          const res = await fetch('/api/pdv/clientes/cadastrar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nome_completo: novoCliNome.trim(),
              cpf: cpfLimpo,
              email: novoCliEmail.trim() || (novoCliNome.trim().toLowerCase().replace(/\s+/g, '.') + '@cliente.venus.com'),
              telefone: novoCliTel.trim()
            })
          });

          const data = await res.json();
          if (res.ok && data.sucesso) {
            avisar('✨ Cliente ' + data.cliente.nome + ' cadastrado(a) com sucesso!');
            setClienteSelecionado(data.cliente);
            setNovoCliNome('');
            setNovoCliCpf('');
            setNovoCliEmail('');
            setNovoCliTel('');
            setModalNovoClienteAberto(false);
            carregarDados();
            if (redirecionarParaCaixa) {
              setAbaPrincipal('caixa');
            }
          } else {
            alert(data.erro || 'Erro ao cadastrar cliente.');
          }
        } catch(e) {
          alert('Erro ao conectar com o servidor.');
        } finally {
          setSalvandoCliente(false);
        }
      };

      const selecionarClienteVenda = (cli) => {
        setClienteSelecionado(cli);
        setAbaPrincipal('caixa');
        avisar('👤 Cliente ' + (cli.nome || cli.nome_completo) + ' selecionado(a) para o caixa!');
      };

      // =====================================================================
      // CADASTRAR NOVO PRODUTO NO SISTEMA ATRAVÉS DO PDV
      // =====================================================================
      const cadastrarNovoProduto = async (e) => {
        e.preventDefault();
        if (!novoProdNome.trim() || !novoProdPreco) {
          alert('Preencha o nome e o preço do produto.');
          return;
        }

        try {
          setSalvandoProduto(true);
          const res = await fetch('/api/pdv/produtos/cadastrar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nome_item: novoProdNome.trim(),
              categoria: novoProdCat,
              preco: parseFloat(novoProdPreco),
              estoque: novoProdCat === 'Cafeteria' ? 0 : parseInt(novoProdEstoque || '0', 10),
              descricao: novoProdDesc.trim() || 'Item autoral da coleção Vênus & Luar Boutique.',
              imagem_url: novoProdImg.trim() || (novoProdCat === 'Moda' ? 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=80' : (novoProdCat === 'Pet' ? 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?auto=format&fit=crop&w=800&q=80' : 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=800&q=80'))
            })
          });

          const data = await res.json();
          if (res.ok && data.sucesso) {
            avisar('✨ Produto "' + data.produto.nome_item + '" cadastrado no sistema!');
            setNovoProdNome('');
            setNovoProdPreco('');
            setNovoProdEstoque('10');
            setNovoProdDesc('');
            setNovoProdImg('');
            setAbaModalProdutos('estoque');
            carregarDados();
          } else {
            alert(data.erro || 'Erro ao cadastrar produto.');
          }
        } catch (e) {
          alert('Erro de conexão ao salvar produto.');
        } finally {
          setSalvandoProduto(false);
        }
      };

      // =====================================================================
      // GESTÃO RÁPIDA DE ESTOQUE E PREÇO
      // =====================================================================
      const ajustarEstoque = async (idProduto, delta, valorDireto, novoPreco) => {
        try {
          setSalvandoEstoqueId(idProduto);
          const prodAtual = produtos.find(p => p.id_produto === idProduto);
          if (!prodAtual) return;

          let novoEstoque = valorDireto !== undefined ? Math.max(0, parseInt(valorDireto, 10)) : Math.max(0, (Number(prodAtual.estoque) || 0) + delta);
          let precoFinal = novoPreco !== undefined ? parseFloat(novoPreco) : prodAtual.preco;

          const res = await fetch('/api/pdv/produtos/estoque', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id_produto: idProduto,
              estoque: novoEstoque,
              preco: precoFinal
            })
          });

          const data = await res.json();
          if (res.ok && data.sucesso) {
            setProdutos(produtos.map(p => p.id_produto === idProduto ? { ...p, estoque: novoEstoque, preco: precoFinal } : p));
            avisar('Estoque atualizado: ' + prodAtual.nome_item + ' → ' + novoEstoque + ' un');
          } else {
            alert(data.erro || 'Erro ao atualizar estoque.');
          }
        } catch(e) {
          alert('Erro de conexão.');
        } finally {
          setSalvandoEstoqueId(null);
        }
      };

      // Clientes filtrados na busca inteligente (busca instantânea por Nome, E-mail ou CPF)
      const clientesFiltrados = buscaCliente.trim()
        ? clientes.filter(c => {
            const bCpf = buscaCliente.toLowerCase().replace(/[^0-9]/g, '');
            const bTexto = buscaCliente.toLowerCase().trim();
            const matchNome = (c.nome || c.nome_completo || '').toLowerCase().includes(bTexto);
            const matchEmail = (c.email || '').toLowerCase().includes(bTexto);
            const matchCpf = bCpf.length > 0 && (c.cpf || '').replace(/[^0-9]/g, '').includes(bCpf);
            return matchNome || matchEmail || matchCpf;
          })
        : [];

      if (!operador) {
        return (
          <div className="h-screen w-screen flex items-center justify-center bg-[#03060E] text-[#EAE6DF] p-4 relative overflow-hidden">
            {/* Efeito Glow Dourado */}
            <div className="absolute w-[500px] h-[500px] bg-amber-500/10 rounded-full blur-3xl pointer-events-none animate-pulse"></div>

            <div className="relative w-full max-w-md bg-celestial-900 border-2 border-ouro/50 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-5 text-center animate-fadeIn">
              {/* Header com Logo Oficial */}
              <div className="flex flex-col items-center gap-2">
                <div className="w-16 h-16 rounded-full border-2 border-ouro bg-celestial-950 p-1 shadow-xl overflow-hidden flex items-center justify-center">
                  <img src="/logo.jpg" alt="Vênus & Luar" className="w-full h-full object-cover rounded-full" />
                </div>
                <h1 className="font-serif text-lg font-bold gold-gradient-text tracking-wide mt-1">
                  Vênus &amp; Luar Boutique
                </h1>
                <p className="text-[11px] text-ouro/80 font-medium">
                  Frente de Caixa &amp; PDV Profissional • #CAIXA-01
                </p>
              </div>

              {/* Seletor de Abas: Login vs Cadastro Inicial do Usuário */}
              <div className="flex items-center gap-1 bg-celestial-950 p-1 rounded-xl border border-ouro/30 shadow-inner">
                <button
                  type="button"
                  id="tab-login-entrar"
                  onClick={() => setAbaLogin('login')}
                  className={"flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer " + (abaLogin === 'login' ? 'bg-gradient-to-r from-amber-500 to-ouro text-celestial-950 font-extrabold shadow-md' : 'text-luar-200 hover:text-ouro')}
                >
                  <span>🔑</span>
                  <span>Entrar (Login)</span>
                </button>
                <button
                  type="button"
                  id="tab-login-cadastrar"
                  onClick={() => setAbaLogin('cadastro')}
                  className={"flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer " + (abaLogin === 'cadastro' ? 'bg-gradient-to-r from-amber-500 to-ouro text-celestial-950 font-extrabold shadow-md' : 'text-luar-200 hover:text-ouro')}
                >
                  <span>📝</span>
                  <span>Cadastro Inicial</span>
                </button>
                <button
                  type="button"
                  id="tab-login-rapido"
                  onClick={() => setAbaLogin('rapido')}
                  className={"flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer " + (abaLogin === 'rapido' ? 'bg-gradient-to-r from-amber-500 to-ouro text-celestial-950 font-extrabold shadow-md' : 'text-luar-200 hover:text-ouro')}
                >
                  <span>⚡</span>
                  <span>Equipe</span>
                </button>
              </div>

              {/* ABA 1: LOGIN DO USUÁRIO */}
              {abaLogin === 'login' && (
                <form onSubmit={handleLogin} className="space-y-3.5 text-left">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-ouro/90 block">
                      E-mail do Usuário / Operadora *
                    </label>
                    <input
                      type="email"
                      required
                      value={loginEmail}
                      onChange={e => setLoginEmail(e.target.value)}
                      placeholder="mileny@venus.com ou admin@butique.com"
                      className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-ouro/90 block">
                      Senha *
                    </label>
                    <input
                      type="password"
                      required
                      value={loginSenha}
                      onChange={e => setLoginSenha(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={processandoLogin}
                    id="btn-submit-login-pdv"
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-ouro to-amber-500 hover:brightness-110 text-celestial-950 font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 active:scale-98"
                  >
                    <span>⚡</span>
                    <span>{processandoLogin ? 'Autenticando...' : 'Entrar no Caixa (PDV)'}</span>
                  </button>

                  <p className="text-[10px] text-center text-luar-300/60 pt-1">
                    Não tem login ainda? Clique na aba <strong>Cadastro Inicial</strong> acima.
                  </p>
                </form>
              )}

              {/* ABA 2: CADASTRO INICIAL DO USUÁRIO / OPERADORA */}
              {abaLogin === 'cadastro' && (
                <form onSubmit={handleCadastroUsuario} className="space-y-3 text-left">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-ouro/90 block">
                      Nome Completo do Usuário *
                    </label>
                    <input
                      type="text"
                      required
                      value={cadNome}
                      onChange={e => setCadNome(e.target.value)}
                      placeholder="Ex: Mileny Gabriely"
                      className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-ouro/90 block">
                      Cargo / Função no PDV *
                    </label>
                    <select
                      value={cadCargo}
                      onChange={e => setCadCargo(e.target.value)}
                      className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 focus:outline-none focus:border-ouro"
                    >
                      <option value="Administradora & Proprietária">👑 Administradora &amp; Proprietária</option>
                      <option value="Operadora de Caixa">🧾 Operadora de Caixa</option>
                      <option value="Vendedora & Consultora">👗 Vendedora &amp; Consultora de Moda</option>
                      <option value="Gerente de Loja">💼 Gerente de Loja</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-ouro/90 block">
                      E-mail de Acesso *
                    </label>
                    <input
                      type="email"
                      required
                      value={cadEmail}
                      onChange={e => setCadEmail(e.target.value)}
                      placeholder="seuemail@butique.com"
                      className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-ouro/90 block">
                        Senha (min 6) *
                      </label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={cadSenha}
                        onChange={e => setCadSenha(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-ouro/90 block">
                        Confirmar Senha *
                      </label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={cadConfirmarSenha}
                        onChange={e => setCadConfirmarSenha(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={processandoCadastro}
                    id="btn-submit-cadastro-pdv"
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-ouro to-amber-500 hover:brightness-110 text-celestial-950 font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 active:scale-98"
                  >
                    <span>✨</span>
                    <span>{processandoCadastro ? 'Cadastrando...' : 'Cadastrar Usuário e Acessar PDV'}</span>
                  </button>
                </form>
              )}

              {/* ABA 3: SELEÇÃO RÁPIDA DE OPERADORES DA EQUIPE */}
              {abaLogin === 'rapido' && (
                <div className="space-y-2.5 text-left max-h-64 overflow-y-auto pr-1">
                  <p className="text-[11px] text-ouro/80 font-semibold mb-2">
                    Selecione uma colaboradora cadastrada para login rápido com 1 clique:
                  </p>
                  {listaOperadores.map(op => (
                    <button
                      key={op.id_usuario || op.email}
                      type="button"
                      onClick={() => handleEntrarComo(op)}
                      className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 hover:border-ouro hover:bg-ouro/10 transition-all flex items-center justify-between gap-3 text-left cursor-pointer group"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-xs shrink-0">
                          👤
                        </div>
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-luar-100 block truncate group-hover:text-ouro">
                            {op.nome}
                          </span>
                          <span className="text-[10px] text-luar-300/70 block">
                            {op.cargo || (op.role === 'admin' ? 'Administradora' : 'Operadora')}
                          </span>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 text-[10.5px] font-bold shrink-0">
                        Entrar →
                      </span>
                    </button>
                  ))}
                </div>
              )}

            </div>
          </div>
        );
      }

      return (
        <div className="h-screen w-screen flex flex-col bg-[#03060E] text-[#EAE6DF] overflow-hidden">
          
          {/* TOPO: BARRA DE OPERAÇÃO PROFISSIONAL */}
          <header className="bg-celestial-900 border-b border-ouro/30 px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2 shadow-lg shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full border border-ouro/60 bg-celestial-950 p-0.5 flex items-center justify-center shadow-md shrink-0 overflow-hidden">
                <img
                  src="/logo.jpg"
                  alt="Vênus & Luar"
                  className="w-full h-full object-cover rounded-full"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                  }}
                />
                <div className="w-full h-full rounded-full bg-celestial-900 border border-ouro/40 items-center justify-center text-ouro text-xs hidden">
                  🌙
                </div>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h1 className="font-serif text-sm sm:text-base font-bold gold-gradient-text tracking-wide whitespace-nowrap">
                    Vênus &amp; Luar • PDV
                  </h1>
                  <span className={"px-2 py-0.5 rounded-full text-[9.5px] font-bold border whitespace-nowrap " + (statusConexao === 'online' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'bg-rose-500/20 text-rose-400 border-rose-500/40')}>
                    {statusConexao === 'online' ? '🟢 Conectado' : '🔴 Offline'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] sm:text-[11px] text-ouro/80 truncate">
                    Operadora: <strong className="text-ouro">{operador?.nome}</strong> • #CAIXA-01
                  </p>
                  <button
                    type="button"
                    id="btn-trocar-operador"
                    onClick={handleLogout}
                    className="px-2 py-0.5 rounded-lg bg-stone-800 hover:bg-rose-950 text-stone-300 hover:text-rose-300 border border-stone-600 text-[9.5px] font-bold cursor-pointer transition-all flex items-center gap-1"
                    title="Encerrar sessão ou trocar operadora"
                  >
                    <span>🚪</span>
                    <span>Sair</span>
                  </button>
                </div>
              </div>
            </div>

            {/* SELETOR DE ABAS PRINCIPAIS DO PDV: FRENTE DE CAIXA VS CADASTRO INICIAL */}
            <div className="flex items-center gap-1 bg-celestial-950 p-1 rounded-xl border border-ouro/40 shadow-inner">
              <button
                type="button"
                id="tab-nav-frente-caixa"
                onClick={() => setAbaPrincipal('caixa')}
                className={"px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer " + (abaPrincipal === 'caixa' ? 'bg-gradient-to-r from-amber-500 to-ouro text-celestial-950 shadow-md font-extrabold' : 'text-luar-200 hover:text-ouro hover:bg-celestial-900')}
              >
                <span>🧾</span>
                <span>Frente de Caixa</span>
              </button>
              <button
                type="button"
                id="tab-nav-cadastro-inicial"
                onClick={() => setAbaPrincipal('cadastro_inicial')}
                className={"px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer " + (abaPrincipal === 'cadastro_inicial' ? 'bg-gradient-to-r from-amber-500 to-ouro text-celestial-950 shadow-md font-extrabold' : 'text-luar-200 hover:text-ouro hover:bg-celestial-900')}
              >
                <span>📝</span>
                <span>Aba de Cadastro Inicial</span>
                <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                  {clientes.length}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Botão Controle de Turno de Caixa */}
              <button
                type="button"
                id="btn-turno-caixa"
                onClick={() => {
                  setModalCaixaAberto(true);
                  carregarStatusCaixa();
                }}
                className={"px-2.5 sm:px-3 py-1.5 rounded-xl border text-[11px] sm:text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm whitespace-nowrap " + (turnoCaixa ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300 hover:bg-emerald-900' : 'bg-rose-950/80 border-rose-500/60 text-rose-300 hover:bg-rose-900')}
                title="Gestão de Turno de Caixa (Abertura, Sangria, Suprimento e Fechamento)"
              >
                <span>{turnoCaixa ? '💵' : '🔒'}</span>
                <span>{turnoCaixa ? ('Caixa Aberto (R$ ' + (turnoCaixa.fundo_troco_inicial || 0).toFixed(2) + ')') : 'Caixa Fechado'}</span>
              </button>

              {/* Botão KDS Copa / Bistrô */}
              <button
                type="button"
                id="btn-abrir-kds"
                onClick={() => {
                  setModalKdsAberto(true);
                  carregarKdsPedidos();
                }}
                className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-celestial-950 border border-amber-500/50 hover:bg-amber-950/60 text-amber-300 text-[11px] sm:text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm whitespace-nowrap"
                title="Monitor da Copa / Cafeteria Bistrô (KDS)"
              >
                <span>☕</span>
                <span>KDS Copa</span>
              </button>

              {/* Botão Módulo de Produtos & Estoque */}
              <button
                type="button"
                id="btn-abrir-produtos-estoque"
                onClick={() => setModalProdutosEstoqueAberto(true)}
                className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-celestial-950 border border-amber-400/50 hover:bg-amber-950/60 text-amber-200 text-[11px] sm:text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-sm whitespace-nowrap"
                title="Cadastrar novos produtos e gerenciar estoque físico"
              >
                <span>📦</span>
                <span>Produtos &amp; Estoque</span>
              </button>

              {/* Botão Módulo Vendas da Boutique */}
              <button
                type="button"
                id="btn-abrir-vendas-boutique"
                onClick={() => {
                  setModalVendasBoutiqueAberto(true);
                  carregarVendasBoutique();
                }}
                className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-celestial-950 border border-blue-400/50 hover:bg-blue-950/60 text-blue-200 text-[11px] sm:text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-sm whitespace-nowrap"
                title="Verificar o que o site da boutique está vendendo em tempo real"
              >
                <span>📊</span>
                <span>Vendas da Boutique</span>
              </button>

              {/* Botão Operadores & Permissões */}
              <button
                type="button"
                id="btn-abrir-equipe"
                onClick={() => setModalEquipeAberto(true)}
                className="px-2 sm:px-2.5 py-1.5 rounded-xl bg-celestial-950 border border-purple-400/50 hover:bg-purple-950 text-purple-200 text-[11px] sm:text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-sm whitespace-nowrap"
              >
                <span>👥</span>
                <span className="hidden sm:inline">Equipe</span>
              </button>

              {/* Botão Download Backup SQLite */}
              <a
                href="/api/pdv/backup"
                download
                className="px-2 sm:px-2.5 py-1.5 rounded-xl bg-celestial-950 border border-ouro/40 hover:bg-ouro/10 text-ouro text-[11px] sm:text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-sm whitespace-nowrap"
                title="Fazer download de backup do banco de dados relacional SQLite"
              >
                <span>💾</span>
                <span className="hidden md:inline">Backup</span>
              </a>

              {/* Botão Limpar Venda */}
              <button
                type="button"
                onClick={limparVenda}
                className="px-2 sm:px-2.5 py-1.5 rounded-xl bg-stone-800/80 border border-stone-600 hover:border-rose-500 text-stone-300 hover:text-rose-400 text-[11px] sm:text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap"
                title="Limpar campos e cancelar venda em andamento"
              >
                <span>🧹</span>
                <span>Limpar</span>
              </button>

              {/* Link para o Site da Boutique */}
              <a
                href={BOUTIQUE_URL}
                target="_blank"
                rel="noreferrer"
                className="px-2 sm:px-2.5 py-1.5 rounded-xl bg-celestial-950 border border-ouro/40 text-ouro hover:bg-ouro/15 text-[11px] sm:text-xs font-bold transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap"
                title="Abrir site da boutique"
              >
                <span>🌐</span>
                <span className="hidden sm:inline">Site</span>
              </a>
            </div>
          </header>

          {/* BARRA DE NAVEGAÇÃO DE ABAS PARA TELAS < 850px */}
          {abaPrincipal === 'caixa' && (
            <div className="pdv-mobile-nav items-center justify-between gap-1.5 px-3 py-2 bg-celestial-900 border-b border-ouro/30 shrink-0">
              <button
                type="button"
                onClick={() => setAbaAtivaMobile('comandas')}
                className={"flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer " + (abaAtivaMobile === 'comandas' ? 'bg-amber-500 text-celestial-950 shadow-md' : 'bg-celestial-950 text-amber-300 border border-amber-500/30')}
              >
                <span>☕ Comandas</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-950 text-amber-200 font-extrabold">{comandas.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setAbaAtivaMobile('catalogo')}
                className={"flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer " + (abaAtivaMobile === 'catalogo' ? 'bg-ouro text-celestial-950 shadow-md' : 'bg-celestial-950 text-ouro border border-ouro/30')}
              >
                <span>🛍️ Catálogo</span>
              </button>
              <button
                type="button"
                onClick={() => setAbaAtivaMobile('caixa')}
                className={"flex-1 py-1.5 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer " + (abaAtivaMobile === 'caixa' ? 'bg-emerald-500 text-celestial-950 shadow-md' : 'bg-celestial-950 text-emerald-300 border border-emerald-500/30')}
              >
                <span>🧾 Caixa</span>
                {itensCaixa.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-950 text-emerald-200 font-extrabold">
                    {itensCaixa.reduce((acc, x) => acc + x.quantidade, 0)}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* CORPO DO PDV: FRENTE DE CAIXA OU ABA DE CADASTRO INICIAL */}
          {abaPrincipal === 'caixa' ? (
            <div className="pdv-main-content">
              <div className="pdv-columns-wrapper">
              
              {/* ============================================================ */}
              {/* COLUNA 1: COMANDAS DIGITAIS DO BISTRÔ (RECEPTOR DIGITAL) */}
              {/* ============================================================ */}
              <div className={"pdv-col-comandas bg-celestial-900/90 border border-amber-500/30 rounded-2xl p-2.5 sm:p-3 flex flex-col overflow-hidden shadow-xl " + (abaAtivaMobile !== 'comandas' ? 'hidden' : 'flex')}>
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-amber-500/30 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">☕</span>
                    <h2 className="font-serif text-sm font-bold text-amber-300 tracking-wide">
                      Comandas do Bistrô
                    </h2>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      {comandas.length}
                    </span>
                  </div>
                  <span className="text-[9.5px] font-bold text-amber-400/80 uppercase">Receptor Digital</span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
                  {comandas.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-4 text-luar-300/60">
                      <span className="text-3xl mb-2">✨</span>
                      <p className="text-xs font-semibold">Nenhum pedido pendente.</p>
                      <p className="text-[10px] text-luar-300/40 mt-1">Pedidos de mesas/balcão entrarão aqui automaticamente em tempo real.</p>
                    </div>
                  ) : (
                    comandas.map(cmd => (
                      <div
                        key={cmd.id_pedido}
                        className={"p-2.5 rounded-xl border transition-all text-left " + (comandaSelecionada?.id_pedido === cmd.id_pedido ? 'bg-amber-950/70 border-amber-400 ring-1 ring-amber-400/60 shadow-md' : 'bg-celestial-950/90 border-amber-500/25 hover:border-amber-400/60')}
                      >
                        <div className="flex items-start justify-between gap-1 mb-1">
                          <div>
                            <span className="text-[10.5px] font-mono font-bold text-amber-300 block">
                              #{cmd.numero_comanda || ('BISTRO-' + cmd.id_pedido)}
                            </span>
                            <span className="text-xs font-bold text-luar-100 block">
                              {cmd.nome_cliente || 'Consumidor'}
                            </span>
                          </div>
                          <span className="px-2 py-0.5 rounded-md text-[9.5px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 whitespace-nowrap">
                            {cmd.local_consumo || 'Balcão'}
                          </span>
                        </div>

                        <div className="text-[11px] text-luar-200/80 mb-2 line-clamp-2 leading-tight">
                          {cmd.itens?.map(it => it.quantidade + 'x ' + it.nome_item).join(', ')}
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-ouro/15">
                          <span className="font-serif font-bold text-sm text-ouro">
                            {formatBRL(cmd.total)}
                          </span>
                          <button
                            type="button"
                            id={'btn-puxar-' + cmd.id_pedido}
                            onClick={() => puxarComanda(cmd)}
                            className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500 to-ouro hover:from-ouro hover:to-amber-500 text-celestial-950 text-[10.5px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-sm flex items-center gap-1 active:scale-95"
                          >
                            <span>⚡</span>
                            <span>Puxar</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* ============================================================ */}
              {/* COLUNA 2: CATÁLOGO DE PRODUTOS & GESTÃO RÁPIDA */}
              {/* ============================================================ */}
              <div className={"pdv-col-catalogo bg-celestial-900/90 border border-ouro/30 rounded-2xl p-2.5 sm:p-3 flex flex-col overflow-hidden shadow-xl " + (abaAtivaMobile !== 'catalogo' ? 'hidden' : 'flex')}>
                {/* Busca e Filtros */}
                <div className="space-y-2 pb-2 mb-2 border-b border-ouro/20 shrink-0">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      id="input-busca-pdv"
                      value={busca}
                      onChange={e => setBusca(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          biparCodigoBarras(busca);
                        }
                      }}
                      placeholder="🔍 Buscar produto ou bipar código de barras (Enter)..."
                      className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-1.5 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                    />
                    {busca && (
                      <button type="button" onClick={() => setBusca('')} className="text-xs text-ouro px-2 cursor-pointer font-bold">×</button>
                    )}
                    <button
                      type="button"
                      id="btn-atalho-cadastrar-prod"
                      onClick={() => {
                        setAbaModalProdutos('cadastrar');
                        setModalProdutosEstoqueAberto(true);
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-ouro text-celestial-950 font-bold text-xs whitespace-nowrap cursor-pointer shadow flex items-center gap-1 shrink-0"
                      title="Cadastrar novo produto no catálogo"
                    >
                      <span>+</span>
                      <span className="hidden sm:inline">Novo Produto</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
                    {['Todos', 'Cafeteria', 'Moda', 'Pet'].map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setAbaCat(c)}
                        className={"px-2.5 py-1 rounded-lg text-[10.5px] font-bold uppercase tracking-wider transition-all whitespace-nowrap cursor-pointer " + (abaCat === c ? 'bg-ouro text-celestial-950 shadow-sm' : 'bg-celestial-950 text-luar-200 hover:text-ouro border border-ouro/20')}
                      >
                        {c === 'Cafeteria' ? '☕ Bistrô' : (c === 'Moda' ? '👗 Moda' : (c === 'Pet' ? '🐾 Pet' : '✨ Todos'))}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Grid de Produtos */}
                <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2 pr-1 min-h-0">
                  {produtos
                    .filter(p => {
                      const matchCat = abaCat === 'Todos' || p.categoria === abaCat;
                      const matchBusca = !busca || p.nome_item.toLowerCase().includes(busca.toLowerCase());
                      return matchCat && matchBusca;
                    })
                    .map(p => {
                      const ehAlimento = p.categoria === 'Cafeteria';
                      const estoqueNum = p.estoque !== undefined ? Number(p.estoque) : 10;
                      const esgotado = !ehAlimento && estoqueNum <= 0;

                      return (
                        <div
                          key={p.id_produto}
                          id={'prod-card-' + p.id_produto}
                          onClick={() => !esgotado && adicionarItem(p)}
                          className={"group p-2 rounded-xl border transition-all flex flex-col justify-between text-left " + (esgotado ? 'opacity-40 cursor-not-allowed bg-stone-900 border-stone-800' : 'cursor-pointer bg-celestial-950/80 border-ouro/25 hover:border-ouro hover:bg-celestial-950 hover:shadow-md')}
                        >
                          <div className="space-y-1.5">
                            <div className="w-full h-24 rounded-lg overflow-hidden bg-celestial-900 relative">
                              <img src={p.imagem_url} alt={p.nome_item} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                              <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-black/80 text-ouro border border-ouro/30 backdrop-blur-sm">
                                {p.categoria === 'Cafeteria' ? 'Bistrô' : p.categoria}
                              </span>
                              {ehAlimento ? (
                                <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-950/90 text-amber-300 border border-amber-500/40">
                                  ☕ Sob Demanda
                                </span>
                              ) : esgotado ? (
                                <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-bold bg-rose-950/90 text-rose-300 border border-rose-500/40">
                                  Esgotado
                                </span>
                              ) : estoqueNum <= 3 ? (
                                <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-950/90 text-amber-300 border border-amber-400 animate-pulse">
                                  ⚠️ Restam {estoqueNum}
                                </span>
                              ) : (
                                <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-bold bg-celestial-950/90 text-emerald-400 border border-emerald-500/30">
                                  📦 {estoqueNum} un
                                </span>
                              )}
                            </div>
                            <h3 className="text-[11px] font-bold text-luar-100 line-clamp-1 leading-snug group-hover:text-ouro">
                              {p.nome_item}
                            </h3>
                          </div>

                          <div className="mt-1.5 pt-1.5 border-t border-ouro/15 flex items-center justify-between">
                            <span className="font-serif font-bold text-xs text-ouro">
                              {formatBRL(p.preco)}
                            </span>
                            <span className="text-[9.5px] text-ouro/70 group-hover:text-ouro font-bold">+ Caixa</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* ============================================================ */}
              {/* COLUNA 3: FRENTE DE CAIXA • FLUXO GUIADO EM 4 ETAPAS */}
              {/* ============================================================ */}
              <div className={"pdv-col-caixa bg-celestial-900/95 border-2 border-ouro/50 rounded-2xl p-2.5 sm:p-3 flex flex-col justify-between overflow-hidden shadow-2xl " + (abaAtivaMobile !== 'caixa' ? 'hidden' : 'flex')}>
                
                {/* PARTE SUPERIOR: PASSO 1 (CLIENTE PF) & PASSO 2 (ITENS) */}
                <div className="space-y-2 pb-2 border-b border-ouro/30 shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">⚡</span>
                      <h2 className="font-serif text-sm font-bold gold-gradient-text tracking-wide">
                        Faturamento PDV
                      </h2>
                    </div>
                    {comandaSelecionada && (
                      <div className="flex items-center gap-1">
                        <span className="px-2 py-0.5 rounded-full text-[9.5px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          #{comandaSelecionada.numero_comanda || comandaSelecionada.id_pedido}
                        </span>
                        <button type="button" onClick={() => setComandaSelecionada(null)} className="text-stone-400 hover:text-rose-400 text-xs px-1 cursor-pointer">×</button>
                      </div>
                    )}
                  </div>

                  {/* ======================================================== */}
                  {/* PASSO 1: IDENTIFICAÇÃO DO CLIENTE PESSOA FÍSICA */}
                  {/* ======================================================== */}
                  <div className="p-2 rounded-xl bg-celestial-950/80 border border-ouro/30 space-y-1.5 text-left relative">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          Passo 1
                        </span>
                        <span className="text-[10px] font-bold text-ouro uppercase tracking-wider">
                          Cliente (Pessoa Física)
                        </span>
                      </div>
                      <button
                        type="button"
                        id="btn-abrir-novo-cliente"
                        onClick={() => setModalNovoClienteAberto(true)}
                        className="text-[10px] font-bold text-ouro hover:text-ouro-light cursor-pointer underline flex items-center gap-1"
                      >
                        <span>+ Novo Cliente PF</span>
                      </button>
                    </div>

                    {clienteSelecionado ? (
                      /* Card do Cliente Selecionado */
                      (() => {
                        const cpfLimpo = (clienteSelecionado.cpf || '').replace(/[^0-9]/g, '');
                        const cpfValido = cpfLimpo.length === 11;
                        return (
                          <div className={"p-2 rounded-lg border flex flex-col gap-1.5 animate-fadeIn " + (cpfValido ? 'bg-emerald-950/40 border-emerald-500/40' : 'bg-amber-950/40 border-amber-500/50')}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-xs">👤</span>
                                <span className={"text-xs font-bold truncate " + (cpfValido ? 'text-emerald-300' : 'text-amber-300')} id="card-cliente-nome">
                                  {clienteSelecionado.nome || clienteSelecionado.nome_completo}
                                </span>
                                <span className={"text-[9px] px-1.5 py-0.2 rounded-full border whitespace-nowrap " + (cpfValido ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border-amber-500/30')}>
                                  {cpfValido ? '✓ PF Válida' : '⚠️ CPF Pendente'}
                                </span>
                              </div>
                              <button
                                type="button"
                                id="btn-trocar-cliente"
                                onClick={() => {
                                  setClienteSelecionado(null);
                                  setBuscaCliente('');
                                }}
                                className="px-2 py-0.5 rounded-md bg-stone-800 text-stone-300 hover:bg-rose-950 hover:text-rose-300 text-[10px] font-bold cursor-pointer transition-all shrink-0"
                                title="Remover ou trocar cliente"
                              >
                                Trocar
                              </button>
                            </div>

                            {cpfValido ? (
                              <p className="text-[10.5px] font-mono text-emerald-400/90 ml-5" id="card-cliente-cpf">
                                CPF: {formatarCpf(clienteSelecionado.cpf)}
                              </p>
                            ) : (
                              <div className="flex items-center gap-1.5 ml-5">
                                <label className="text-[9.5px] text-amber-300/90 uppercase font-bold shrink-0">CPF (11 dígitos):</label>
                                <input
                                  type="text"
                                  id="input-inline-cpf"
                                  placeholder="000.000.000-00"
                                  maxLength={14}
                                  value={clienteSelecionado.cpf || ''}
                                  onChange={e => {
                                    const val = formatarCpf(e.target.value);
                                    setClienteSelecionado({ ...clienteSelecionado, cpf: val });
                                  }}
                                  className="w-32 bg-celestial-900 border border-amber-400/50 rounded px-1.5 py-0.5 text-[10.5px] font-mono text-amber-200 focus:outline-none focus:border-amber-400"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      /* Campo de Busca de Clientes com Autocomplete */
                      <div className="space-y-1 relative">
                        <div className="relative">
                          <input
                            type="text"
                            id="input-busca-cliente"
                            value={buscaCliente}
                            onChange={e => {
                              setBuscaCliente(e.target.value);
                              setMostrarSugestoesCliente(true);
                            }}
                            onFocus={() => {
                              setMostrarSugestoesCliente(true);
                              fetch('/api/pdv/clientes').then(r => r.ok && r.json()).then(d => d && setClientes(d));
                            }}
                            placeholder="🔍 Buscar cliente por Nome, E-mail ou CPF..."
                            className="w-full bg-celestial-900 border border-amber-500/40 rounded-lg px-2.5 py-1.5 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                          />
                          {buscaCliente && (
                            <button
                              type="button"
                              onClick={() => {
                                setBuscaCliente('');
                                setMostrarSugestoesCliente(false);
                              }}
                              className="absolute right-2 top-1.5 text-xs text-stone-400 hover:text-ouro cursor-pointer"
                            >
                              ×
                            </button>
                          )}
                        </div>

                        {/* Dropdown de Clientes Encontrados */}
                        {mostrarSugestoesCliente && buscaCliente && (
                          <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-celestial-900 border border-ouro/50 rounded-xl shadow-2xl max-h-52 overflow-y-auto divide-y divide-ouro/15">
                            {clientesFiltrados.length === 0 ? (
                              <div className="p-2.5 text-center text-xs text-luar-300/70">
                                <p>Nenhum cliente PF encontrado.</p>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const limpo = buscaCliente.replace(/[^0-9]/g, '');
                                    if (limpo.length >= 9) {
                                      setNovoCliCpf(formatarCpf(buscaCliente));
                                      setNovoCliNome('');
                                    } else {
                                      setNovoCliNome(buscaCliente);
                                      setNovoCliCpf('');
                                    }
                                    setModalNovoClienteAberto(true);
                                    setMostrarSugestoesCliente(false);
                                  }}
                                  className="mt-1 text-ouro font-bold underline cursor-pointer text-[11px]"
                                >
                                  + Cadastrar "{buscaCliente}" agora
                                </button>
                              </div>
                            ) : (
                              clientesFiltrados.map(c => (
                                <div
                                  key={c.id_usuario}
                                  id={'opcao-cliente-' + c.id_usuario}
                                  onClick={() => {
                                    setClienteSelecionado(c);
                                    setMostrarSugestoesCliente(false);
                                    setBuscaCliente('');
                                    avisar('Cliente ' + (c.nome || c.nome_completo) + ' selecionado(a)!');
                                  }}
                                  className="p-2 hover:bg-ouro/15 cursor-pointer flex items-center justify-between transition-all"
                                >
                                  <div className="min-w-0 pr-2">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-xs font-bold text-luar-100">{c.nome || c.nome_completo}</span>
                                      <span className="text-[8.5px] px-1.5 py-0.2 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/40 font-semibold whitespace-nowrap">
                                        🌐 Boutique
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-luar-300/80">
                                      {c.cpf ? (
                                        <span className="font-mono text-ouro font-semibold">CPF: {formatarCpf(c.cpf)}</span>
                                      ) : (
                                        <span className="text-amber-400 font-semibold">⚠️ CPF Pendente</span>
                                      )}
                                      <span className="text-luar-300/50 truncate max-w-[130px]">{c.email}</span>
                                    </div>
                                  </div>
                                  <span className="text-[10px] text-emerald-400 font-bold shrink-0">Selecionar →</span>
                                </div>
                              ))
                            )}
                          </div>
                        )}

                        <p className="text-[9.5px] text-amber-300/70">
                          ⚠️ Faturamento requer cliente Pessoa Física (CPF de 11 dígitos).
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* ======================================================== */}
                {/* PASSO 2: ITENS DA VENDA / COMANDA */}
                {/* ======================================================== */}
                <div className="flex-1 overflow-y-auto space-y-1 my-1.5 pr-1 min-h-[80px]">
                  <div className="flex items-center justify-between text-[10px] text-ouro/70 uppercase font-bold px-1 mb-0.5">
                    <span>Passo 2: Itens ({itensCaixa.reduce((acc, x) => acc + x.quantidade, 0)} un)</span>
                    <span>Subtotal</span>
                  </div>

                  {itensCaixa.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-3 text-luar-300/60">
                      <span className="text-2xl mb-1">🛒</span>
                      <p className="text-xs font-semibold">Nenhum item na venda atual.</p>
                      <p className="text-[10px] text-luar-300/40 mt-0.5">Puxe uma comanda do bistrô ou clique nos produtos ao lado.</p>
                    </div>
                  ) : (
                    itensCaixa.map(it => (
                      <div key={it.id_produto} className="flex items-center justify-between p-1.5 rounded-xl bg-celestial-950/70 border border-ouro/20 text-xs">
                        <div className="flex-1 pr-2 text-left">
                          <span className="font-semibold text-luar-100 block line-clamp-1">{it.nome_item}</span>
                          <span className="text-[10px] text-ouro/70">{formatBRL(it.preco)} cada</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button type="button" onClick={() => alterarQtd(it.id_produto, -1)} className="w-5 h-5 rounded bg-celestial-900 border border-ouro/40 text-ouro flex items-center justify-center font-bold text-xs cursor-pointer">-</button>
                          <span className="font-bold text-xs w-4 text-center">{it.quantidade}</span>
                          <button type="button" onClick={() => alterarQtd(it.id_produto, 1)} className="w-5 h-5 rounded bg-celestial-900 border border-ouro/40 text-ouro flex items-center justify-center font-bold text-xs cursor-pointer">+</button>
                        </div>
                        <span className="font-serif font-bold text-ouro text-xs w-16 text-right">
                          {formatBRL(Number(it.preco) * Number(it.quantidade))}
                        </span>
                        <button type="button" onClick={() => setItensCaixa(itensCaixa.filter(x => x.id_produto !== it.id_produto))} className="text-stone-400 hover:text-rose-400 ml-1.5 text-xs font-bold cursor-pointer">×</button>
                      </div>
                    ))
                  )}
                </div>

                {/* ======================================================== */}
                {/* PASSO 3 & 4: PAGAMENTO, TOTAIS E FATURAR */}
                {/* ======================================================== */}
                <div className="space-y-1.5 pt-2 border-t border-ouro/30 bg-celestial-950/90 -mx-2.5 sm:-mx-3 -mb-2.5 sm:-mb-3 p-2.5 sm:p-3 rounded-b-2xl shrink-0">
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between items-center text-luar-300">
                      <span>Subtotal:</span>
                      <span>{formatBRL(subtotal)}</span>
                    </div>
                    <div className="flex justify-between items-center text-luar-300">
                      <span>Desconto (R$):</span>
                      <input
                        type="number"
                        id="input-desconto"
                        value={desconto}
                        onChange={e => setDesconto(Math.max(0, Number(e.target.value)))}
                        min="0"
                        step="0.5"
                        className="w-20 bg-celestial-900 border border-ouro/30 rounded px-1.5 py-0.5 text-right text-xs text-ouro focus:outline-none focus:border-ouro"
                      />
                    </div>
                    <div className="flex justify-between items-center pt-1 border-t border-ouro/20 font-bold">
                      <span className="text-xs uppercase text-ouro/90">Total a Faturar:</span>
                      <span className="text-base text-ouro font-serif" id="mostrador-total-final">
                        {formatBRL(totalFinal)}
                      </span>
                    </div>
                  </div>

                  {/* Seletor do Passo 3: Forma de Pagamento */}
                  <div className="space-y-1 pt-0.5 text-left">
                    <span className="text-[9.5px] uppercase font-bold text-ouro/70 block">
                      Passo 3: Forma de Pagamento
                    </span>
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { id: 'Dinheiro', label: 'Dinheiro', icone: '💵' },
                        { id: 'Cartão de Crédito', label: 'Crédito', icone: '💳' },
                        { id: 'Cartão de Débito', label: 'Débito', icone: '💳' },
                        { id: 'PIX Instantâneo', label: 'PIX', icone: '📱' }
                      ].map(fp => (
                        <button
                          key={fp.id}
                          type="button"
                          id={'btn-fp-' + fp.id.replace(/ /g, '')}
                          onClick={() => setFormaPagamento(fp.id)}
                          className={"py-1 px-1 rounded-lg text-[9.5px] font-bold flex flex-col items-center justify-center transition-all cursor-pointer " + (formaPagamento === fp.id ? 'bg-ouro text-celestial-950 ring-2 ring-ouro-light shadow-md' : 'bg-celestial-900 border border-ouro/30 text-luar-200 hover:text-ouro')}
                        >
                          <span className="text-xs">{fp.icone}</span>
                          <span>{fp.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Se Dinheiro: Campo Valor Recebido e Troco em Tempo Real */}
                  {formaPagamento === 'Dinheiro' && (
                    <div className="p-2 rounded-xl bg-celestial-900 border border-amber-500/30 space-y-1 text-left animate-fadeIn">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[9.5px] font-bold uppercase text-amber-300">Recebido (R$):</label>
                        <input
                          type="number"
                          id="input-valor-recebido"
                          value={valorRecebido}
                          onChange={e => setValorRecebido(e.target.value)}
                          placeholder="0,00"
                          step="any"
                          className="w-24 bg-celestial-950 border border-amber-400/50 rounded-lg px-2 py-0.5 text-right text-xs font-bold text-amber-300 focus:outline-none focus:border-amber-400"
                        />
                      </div>

                      <div className="flex items-center gap-1 justify-end text-[9.5px]">
                        <button type="button" id="btn-atalho-exato" onClick={() => setValorRecebido(totalFinal.toFixed(2))} className="px-1.5 py-0.5 rounded bg-celestial-950 border border-ouro/30 text-ouro hover:bg-ouro/20 cursor-pointer">Exato</button>
                        <button type="button" id="btn-atalho-dez" onClick={() => setValorRecebido((Math.ceil(totalFinal / 10) * 10).toFixed(2))} className="px-1.5 py-0.5 rounded bg-celestial-950 border border-ouro/30 text-ouro hover:bg-ouro/20 cursor-pointer">+10</button>
                        <button type="button" id="btn-atalho-cinquenta" onClick={() => setValorRecebido('50.00')} className="px-1.5 py-0.5 rounded bg-celestial-950 border border-ouro/30 text-ouro hover:bg-ouro/20 cursor-pointer">R$ 50</button>
                        <button type="button" id="btn-atalho-cem" onClick={() => setValorRecebido('100.00')} className="px-1.5 py-0.5 rounded bg-celestial-950 border border-ouro/30 text-ouro hover:bg-ouro/20 cursor-pointer">R$ 100</button>
                      </div>

                      <div className="pt-1 flex items-center justify-between text-xs font-bold border-t border-ouro/15">
                        <span className="text-[11px] text-amber-200">Troco a Devolver:</span>
                        <span id="mostrador-troco" className={"text-base font-serif font-bold " + (troco > 0 ? 'text-emerald-400 animate-pulse' : 'text-luar-300')}>
                          {formatBRL(troco)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* ======================================================== */}
                  {/* PASSO 4: BOTÃO FINAL - FATURAR O PEDIDO */}
                  {/* ======================================================== */}
                  <button
                    type="button"
                    id="btn-faturar-pedido-pdv"
                    onClick={faturarPedidoPdv}
                    disabled={finalizando || itensCaixa.length === 0 || !clienteSelecionado}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-ouro to-amber-500 hover:brightness-110 text-celestial-950 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-98"
                  >
                    {finalizando ? (
                      <span>⏳ Faturando Pedido &amp; Baixando Estoque...</span>
                    ) : !clienteSelecionado ? (
                      <span>⚠️ Passo 1: Selecione o Cliente PF para Faturar</span>
                    ) : itensCaixa.length === 0 ? (
                      <span>⚠️ Passo 2: Adicione Itens ao Pedido</span>
                    ) : (
                      <>
                        <span>⚡ FATURAR PEDIDO &amp; EMITIR NOTA FISCAL</span>
                        <span className="px-1.5 py-0.5 rounded bg-celestial-950/20 text-[10px] font-mono">(F2)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

            </div>
          </div>
          ) : (
            /* ============================================================ */
            /* ABA DEDICADA: CADASTRO INICIAL (CLIENTES, PRODUTOS, ESTABELECIMENTO) */
            /* ============================================================ */
            <div className="pdv-main-content">
              <div className="h-full flex flex-col gap-2.5 overflow-hidden">
                
                {/* SUB-HEADER DA ABA DE CADASTRO INICIAL */}
                <div className="bg-celestial-900 border border-ouro/30 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-lg shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-ouro/30 border border-ouro/50 flex items-center justify-center text-xl shadow-inner">
                      📝
                    </div>
                    <div>
                      <h2 className="font-serif text-base font-bold gold-gradient-text tracking-wide">
                        Módulo de Cadastro Inicial da Boutique
                      </h2>
                      <p className="text-xs text-luar-300/80">
                        Cadastre clientes Pessoa Física, novos produtos e estoque inicial antes ou durante o faturamento no caixa.
                      </p>
                    </div>
                  </div>

                  {/* SUB-ABAS DE NAVEGAÇÃO: CLIENTES | PRODUTOS | ESTABELECIMENTO */}
                  <div className="flex items-center gap-1.5 bg-celestial-950 p-1 rounded-xl border border-ouro/30">
                    <button
                      type="button"
                      id="subtab-btn-clientes"
                      onClick={() => setSubAbaCadastro('clientes')}
                      className={"px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer " + (subAbaCadastro === 'clientes' ? 'bg-ouro text-celestial-950 shadow-md font-extrabold' : 'text-luar-200 hover:text-ouro')}
                    >
                      <span>👤</span>
                      <span>Clientes (Pessoa Física)</span>
                      <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-celestial-900 text-amber-300 font-extrabold border border-amber-500/30">
                        {clientes.length}
                      </span>
                    </button>

                    <button
                      type="button"
                      id="subtab-btn-produtos"
                      onClick={() => setSubAbaCadastro('produtos')}
                      className={"px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer " + (subAbaCadastro === 'produtos' ? 'bg-ouro text-celestial-950 shadow-md font-extrabold' : 'text-luar-200 hover:text-ouro')}
                    >
                      <span>🛍️</span>
                      <span>Produtos &amp; Estoque</span>
                      <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-celestial-900 text-amber-300 font-extrabold border border-amber-500/30">
                        {produtos.length}
                      </span>
                    </button>

                    <button
                      type="button"
                      id="subtab-btn-loja"
                      onClick={() => setSubAbaCadastro('loja')}
                      className={"px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer " + (subAbaCadastro === 'loja' ? 'bg-ouro text-celestial-950 shadow-md font-extrabold' : 'text-luar-200 hover:text-ouro')}
                    >
                      <span>🏢</span>
                      <span>Dados da Loja &amp; Fiscal</span>
                    </button>
                  </div>
                </div>

                {/* SUB-ABA 1: CADASTRO DE CLIENTES PESSOA FÍSICA */}
                {subAbaCadastro === 'clientes' && (
                  <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3 overflow-hidden">
                    
                    {/* COLUNA ESQUERDA: FORMULÁRIO DE CADASTRO INICIAL (5 colunas) */}
                    <div className="lg:col-span-5 bg-celestial-900/90 border border-ouro/40 rounded-2xl p-4 flex flex-col justify-between overflow-y-auto shadow-xl">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b border-ouro/20">
                          <div className="flex items-center gap-2">
                            <span className="text-base">👤</span>
                            <h3 className="font-serif text-sm font-bold text-amber-300 uppercase tracking-wide">
                              Novo Cliente Pessoa Física
                            </h3>
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold">
                            Exclusivo PF
                          </span>
                        </div>

                        <div className="space-y-2.5">
                          {/* Nome Completo */}
                          <div>
                            <label className="text-[11px] font-bold text-ouro/90 block mb-1">
                              Nome Completo do Cliente *
                            </label>
                            <input
                              type="text"
                              value={novoCliNome}
                              onChange={e => setNovoCliNome(e.target.value)}
                              placeholder="Ex: Amanda Vasconcelos"
                              className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                            />
                          </div>

                          {/* CPF com validação visual instantânea */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[11px] font-bold text-ouro/90 block">
                                CPF (11 dígitos) *
                              </label>
                              {(() => {
                                const limpo = (novoCliCpf || '').replace(/[^0-9]/g, '');
                                if (limpo.length === 11 && validarCpf(limpo)) {
                                  return <span className="text-[9.5px] font-bold text-emerald-400">✓ Válido (Pessoa Física)</span>;
                                }
                                if (limpo.length > 0 && limpo.length < 11) {
                                  return <span className="text-[9.5px] font-bold text-amber-400">Faltam {11 - limpo.length} dígitos</span>;
                                }
                                if (limpo.length === 11 && !validarCpf(limpo)) {
                                  return <span className="text-[9.5px] font-bold text-rose-400">CPF inválido</span>;
                                }
                                return null;
                              })()}
                            </div>
                            <input
                              type="text"
                              maxLength={14}
                              value={novoCliCpf}
                              onChange={e => setNovoCliCpf(formatarCpf(e.target.value))}
                              placeholder="000.000.000-00"
                              className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs font-mono text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                            />
                          </div>

                          {/* Telefone e E-mail */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label className="text-[11px] font-bold text-ouro/90 block mb-1">
                                WhatsApp / Telefone
                              </label>
                              <input
                                type="text"
                                maxLength={15}
                                value={novoCliTel}
                                onChange={e => setNovoCliTel(formatarTelefone(e.target.value))}
                                placeholder="(27) 99999-0000"
                                className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-bold text-ouro/90 block mb-1">
                                E-mail
                              </label>
                              <input
                                type="email"
                                value={novoCliEmail}
                                onChange={e => setNovoCliEmail(e.target.value)}
                                placeholder="amanda@email.com"
                                className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                              />
                            </div>
                          </div>

                          {/* Localização da Loja */}
                          <div className="p-2.5 rounded-xl bg-celestial-950/80 border border-ouro/20 text-[11px] text-luar-300 flex items-center justify-between">
                            <span>📍 Município de Emissão:</span>
                            <span className="font-bold text-ouro">Vila Velha - ES (IBGE: 3205200)</span>
                          </div>

                          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[10.5px] text-amber-200/90 leading-relaxed">
                            💡 <strong>Dica da Boutique:</strong> O cadastro é unificado em tempo real. Os clientes cadastrados aqui ficam imediatamente disponíveis para busca na Frente de Caixa e no sistema do site!
                          </div>
                        </div>
                      </div>

                      {/* Botões de Ação */}
                      <div className="pt-3 border-t border-ouro/20 space-y-2 mt-3">
                        <button
                          type="button"
                          id="btn-cadastrar-cli-tab"
                          onClick={e => cadastrarClientePessoaFisica(e, false)}
                          disabled={salvandoCliente}
                          className="w-full py-2.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-luar-100 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow border border-ouro/30 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          <span>💾</span>
                          <span>{salvandoCliente ? 'Cadastrando...' : 'Salvar Cadastro do Cliente'}</span>
                        </button>

                        <button
                          type="button"
                          id="btn-cadastrar-cli-e-vender"
                          onClick={e => cadastrarClientePessoaFisica(e, true)}
                          disabled={salvandoCliente}
                          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-ouro hover:brightness-110 text-celestial-950 font-extrabold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 active:scale-98"
                        >
                          <span>⚡</span>
                          <span>Salvar e Ir para o Caixa (Iniciar Venda)</span>
                        </button>
                      </div>
                    </div>

                    {/* COLUNA DIREITA: BASE DE CLIENTES CADASTRADOS (7 colunas) */}
                    <div className="lg:col-span-7 bg-celestial-900/90 border border-ouro/30 rounded-2xl p-4 flex flex-col min-h-0 shadow-xl overflow-hidden">
                      <div className="flex items-center justify-between pb-2 mb-3 border-b border-ouro/20 shrink-0">
                        <div className="flex items-center gap-2">
                          <span className="text-base">📋</span>
                          <h3 className="font-serif text-sm font-bold text-amber-300 uppercase tracking-wide">
                            Clientes Cadastrados no Sistema
                          </h3>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            {clientes.length}
                          </span>
                        </div>

                        {/* Campo de Busca de Clientes */}
                        <div className="w-60">
                          <input
                            type="text"
                            value={buscaCadastroCli}
                            onChange={e => setBuscaCadastroCli(e.target.value)}
                            placeholder="🔍 Buscar por nome, CPF ou e-mail..."
                            className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-2.5 py-1 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                          />
                        </div>
                      </div>

                      {/* Lista com scroll dos clientes */}
                      <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
                        {clientes.length === 0 ? (
                          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-luar-300/60">
                            <span className="text-3xl mb-2">👤</span>
                            <p className="text-xs font-semibold">Nenhum cliente cadastrado ainda.</p>
                            <p className="text-[10px] text-luar-300/40 mt-1">Preencha o formulário ao lado para realizar o primeiro cadastro.</p>
                          </div>
                        ) : (
                          clientes
                            .filter(c => {
                              if (!buscaCadastroCli) return true;
                              const q = buscaCadastroCli.toLowerCase();
                              return (c.nome || c.nome_completo || '').toLowerCase().includes(q) ||
                                     (c.cpf || '').includes(q) ||
                                     (c.email || '').toLowerCase().includes(q);
                            })
                            .map(cli => (
                              <div
                                key={cli.id_usuario || cli.cpf}
                                className="p-3 rounded-xl bg-celestial-950/80 border border-ouro/20 hover:border-ouro/60 transition-all flex items-center justify-between gap-3 text-left shadow-sm"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-9 h-9 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-sm shrink-0">
                                    👤
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs font-bold text-luar-100 truncate">
                                        {cli.nome || cli.nome_completo}
                                      </span>
                                      <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 whitespace-nowrap">
                                        Pessoa Física
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-[11px] text-luar-300/70 mt-0.5 font-mono flex-wrap">
                                      <span>CPF: {formatarCpf(cli.cpf)}</span>
                                      {cli.telefone && <span>• {cli.telefone}</span>}
                                      {cli.email && <span className="truncate">• {cli.email}</span>}
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => selecionarClienteVenda(cli)}
                                  className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-ouro hover:brightness-110 text-celestial-950 text-xs font-bold transition-all cursor-pointer shadow flex items-center gap-1.5 shrink-0 whitespace-nowrap active:scale-95"
                                  title="Selecionar este cliente e ir para a Frente de Caixa"
                                >
                                  <span>🛒</span>
                                  <span>Vender</span>
                                </button>
                              </div>
                            ))
                        )}
                      </div>
                    </div>

                  </div>
                )}

                {/* SUB-ABA 2: CADASTRO DE PRODUTOS & ESTOQUE INICIAL */}
                {subAbaCadastro === 'produtos' && (
                  <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3 overflow-hidden">
                    
                    {/* FORMULÁRIO DE PRODUTO (5 colunas) */}
                    <div className="lg:col-span-5 bg-celestial-900/90 border border-ouro/40 rounded-2xl p-4 flex flex-col justify-between overflow-y-auto shadow-xl">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b border-ouro/20">
                          <div className="flex items-center gap-2">
                            <span className="text-base">🛍️</span>
                            <h3 className="font-serif text-sm font-bold text-amber-300 uppercase tracking-wide">
                              Novo Produto &amp; Estoque
                            </h3>
                          </div>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">
                            Catálogo Boutique
                          </span>
                        </div>

                        <div className="space-y-2.5">
                          {/* Nome do Produto */}
                          <div>
                            <label className="text-[11px] font-bold text-ouro/90 block mb-1">
                              Nome do Item / Produto *
                            </label>
                            <input
                              type="text"
                              value={novoProdNome}
                              onChange={e => setNovoProdNome(e.target.value)}
                              placeholder="Ex: Conjunto Seda Lunar &amp; Renda"
                              className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                            />
                          </div>

                          {/* Categoria com Regra Fiscal Automática */}
                          <div>
                            <label className="text-[11px] font-bold text-ouro/90 block mb-1">
                              Categoria &amp; Particularidade Fiscal *
                            </label>
                            <select
                              value={novoProdCat}
                              onChange={e => setNovoProdCat(e.target.value)}
                              className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 focus:outline-none focus:border-ouro"
                            >
                              <option value="Moda">👗 Moda Humana &amp; Íntima (Tributação Normal Simples - CSOSN 102)</option>
                              <option value="Cosmeticos">💄 Cosméticos &amp; Higiene (Substituição Tributária - CSOSN 500 / Monofásico)</option>
                              <option value="Pet">🐾 Universo Pet Shop (Acessórios e Rações - CSOSN 500 / 102)</option>
                              <option value="Cafeteria">☕ Cafeteria &amp; Bistrô (Anexo I Comércio 4% - Ficha Técnica)</option>
                            </select>
                          </div>

                          {/* Preço e Estoque Inicial */}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[11px] font-bold text-ouro/90 block mb-1">
                                Preço de Venda (R$) *
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={novoProdPreco}
                                onChange={e => setNovoProdPreco(e.target.value)}
                                placeholder="0.00"
                                className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs font-mono text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-bold text-ouro/90 block mb-1">
                                Estoque Físico Inicial *
                              </label>
                              <input
                                type="number"
                                min="0"
                                value={novoProdEstoque}
                                onChange={e => setNovoProdEstoque(e.target.value)}
                                placeholder="10"
                                className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs font-mono text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                              />
                            </div>
                          </div>

                          {/* Descrição */}
                          <div>
                            <label className="text-[11px] font-bold text-ouro/90 block mb-1">
                              Descrição / Detalhes
                            </label>
                            <input
                              type="text"
                              value={novoProdDesc}
                              onChange={e => setNovoProdDesc(e.target.value)}
                              placeholder="Ex: Peça exclusiva de corte nobre da coleção Vênus &amp; Luar."
                              className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                            />
                          </div>

                          {/* Foto URL com Presets Rápidos */}
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[11px] font-bold text-ouro/90 block">
                                Foto do Produto (URL)
                              </label>
                              <span className="text-[9px] text-ouro/70">Opcional</span>
                            </div>
                            <input
                              type="url"
                              value={novoProdImg}
                              onChange={e => setNovoProdImg(e.target.value)}
                              placeholder="https://images.unsplash.com/..."
                              className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                            />
                            {/* Fotos Rápidas da Boutique */}
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              <span className="text-[9.5px] text-luar-300/70 font-semibold">Fotos sugeridas:</span>
                              <button
                                type="button"
                                onClick={() => setNovoProdImg('https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=80')}
                                className="px-2 py-0.5 rounded text-[9px] bg-celestial-950 border border-ouro/30 text-ouro hover:bg-ouro/15 cursor-pointer"
                              >
                                👗 Moda
                              </button>
                              <button
                                type="button"
                                onClick={() => setNovoProdImg('https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=800&q=80')}
                                className="px-2 py-0.5 rounded text-[9px] bg-celestial-950 border border-ouro/30 text-ouro hover:bg-ouro/15 cursor-pointer"
                              >
                                💄 Perfume
                              </button>
                              <button
                                type="button"
                                onClick={() => setNovoProdImg('https://images.unsplash.com/photo-1601758228041-f3b2795255f1?auto=format&fit=crop&w=800&q=80')}
                                className="px-2 py-0.5 rounded text-[9px] bg-celestial-950 border border-ouro/30 text-ouro hover:bg-ouro/15 cursor-pointer"
                              >
                                🐾 Pet
                              </button>
                              <button
                                type="button"
                                onClick={() => setNovoProdImg('https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=800&q=80')}
                                className="px-2 py-0.5 rounded text-[9px] bg-celestial-950 border border-ouro/30 text-ouro hover:bg-ouro/15 cursor-pointer"
                              >
                                ☕ Bistrô
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Botão Salvar Produto */}
                      <div className="pt-3 border-t border-ouro/20 mt-3">
                        <button
                          type="button"
                          id="btn-salvar-produto-tab"
                          onClick={cadastrarNovoProduto}
                          disabled={salvandoProduto}
                          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-ouro hover:brightness-110 text-celestial-950 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          <span>✨</span>
                          <span>{salvandoProduto ? 'Cadastrando Produto...' : 'Salvar Produto no Catálogo'}</span>
                        </button>
                      </div>
                    </div>

                    {/* LISTA DE PRODUTOS & GESTÃO RÁPIDA DE ESTOQUE (7 colunas) */}
                    <div className="lg:col-span-7 bg-celestial-900/90 border border-ouro/30 rounded-2xl p-4 flex flex-col min-h-0 shadow-xl overflow-hidden">
                      <div className="flex items-center justify-between pb-2 mb-3 border-b border-ouro/20 shrink-0">
                        <div className="flex items-center gap-2">
                          <span className="text-base">📦</span>
                          <h3 className="font-serif text-sm font-bold text-amber-300 uppercase tracking-wide">
                            Estoque Físico da Boutique
                          </h3>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            {produtos.length} itens
                          </span>
                        </div>

                        {/* Campo de Busca de Produtos */}
                        <div className="w-60">
                          <input
                            type="text"
                            value={buscaCadastroProd}
                            onChange={e => setBuscaCadastroProd(e.target.value)}
                            placeholder="🔍 Buscar produto ou código..."
                            className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-2.5 py-1 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                          />
                        </div>
                      </div>

                      {/* Lista scrollável de itens */}
                      <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
                        {produtos
                          .filter(p => !buscaCadastroProd || p.nome_item.toLowerCase().includes(buscaCadastroProd.toLowerCase()))
                          .map(p => (
                            <div
                              key={p.id_produto}
                              className="p-3 rounded-xl bg-celestial-950/80 border border-ouro/20 hover:border-ouro/50 transition-all flex items-center justify-between gap-3 text-left shadow-sm"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <img
                                  src={p.imagem_url}
                                  alt={p.nome_item}
                                  className="w-11 h-11 rounded-lg object-cover bg-celestial-900 border border-ouro/30 shrink-0"
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-bold text-luar-100 truncate">
                                      {p.nome_item}
                                    </span>
                                    <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                      {p.categoria === 'Cafeteria' ? '☕ Bistrô' : (p.categoria === 'Moda' ? '👗 Moda' : (p.categoria === 'Pet' ? '🐾 Pet' : '💄 Cosméticos'))}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3 text-[11.5px] mt-0.5">
                                    <span className="font-serif font-bold text-ouro">{formatBRL(p.preco)}</span>
                                    <span className="text-luar-300/70 font-mono text-[10.5px]">
                                      Estoque: <strong className="text-emerald-400">{p.categoria === 'Cafeteria' ? 'Sob Demanda' : (p.estoque + ' un')}</strong>
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {p.categoria !== 'Cafeteria' && (
                                  <div className="flex items-center gap-1 bg-celestial-900 border border-ouro/30 rounded-lg p-0.5">
                                    <button
                                      type="button"
                                      onClick={() => salvarEstoque(p.id_produto, Math.max(0, Number(p.estoque || 0) - 1), p.preco)}
                                      className="w-6 h-6 rounded bg-stone-800 text-stone-200 hover:text-white flex items-center justify-center text-xs font-bold cursor-pointer"
                                    >
                                      -
                                    </button>
                                    <span className="w-8 text-center text-xs font-bold font-mono text-ouro">
                                      {p.estoque}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => salvarEstoque(p.id_produto, Number(p.estoque || 0) + 1, p.preco)}
                                      className="w-6 h-6 rounded bg-stone-800 text-stone-200 hover:text-white flex items-center justify-center text-xs font-bold cursor-pointer"
                                    >
                                      +
                                    </button>
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    adicionarItem(p);
                                    setAbaPrincipal('caixa');
                                    avisar('✨ ' + p.nome_item + ' adicionado ao caixa!');
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-ouro hover:brightness-110 text-celestial-950 text-xs font-bold transition-all cursor-pointer shadow flex items-center gap-1 active:scale-95"
                                >
                                  <span>+ Caixa</span>
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>

                  </div>
                )}

                {/* SUB-ABA 3: DADOS DO ESTABELECIMENTO & CONFIGURAÇÕES FISCAIS */}
                {subAbaCadastro === 'loja' && (
                  <div className="flex-1 min-h-0 bg-celestial-900/90 border border-ouro/30 rounded-2xl p-5 overflow-y-auto shadow-xl text-left space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-ouro/25">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">🏢</span>
                        <div>
                          <h3 className="font-serif text-base font-bold gold-gradient-text tracking-wide">
                            Vênus &amp; Luar Boutique Ltda • Cadastro do Estabelecimento
                          </h3>
                          <p className="text-xs text-luar-300/80">
                            Parâmetros tributários oficiais registrados para faturamento com a SEFAZ-ES e emissão de NFC-e
                          </p>
                        </div>
                      </div>
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                        🟢 Sistema Homologado (Sandbox Fiscal Ativo)
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      <div className="p-3.5 rounded-xl bg-celestial-950/80 border border-ouro/20 space-y-1">
                        <span className="text-[10px] uppercase font-bold text-ouro/80 tracking-wider">Razão Social</span>
                        <p className="text-xs font-bold text-luar-100">Vênus &amp; Luar Boutique Ltda</p>
                        <p className="text-[10px] text-luar-300/60">Nome Fantasia: Vênus &amp; Luar Boutique</p>
                      </div>

                      <div className="p-3.5 rounded-xl bg-celestial-950/80 border border-ouro/20 space-y-1">
                        <span className="text-[10px] uppercase font-bold text-ouro/80 tracking-wider">Município &amp; Código IBGE</span>
                        <p className="text-xs font-bold text-emerald-300">Vila Velha - ES</p>
                        <p className="text-[10px] font-mono text-luar-300/60">Código IBGE Oficial: 3205200 (ES: 32)</p>
                      </div>

                      <div className="p-3.5 rounded-xl bg-celestial-950/80 border border-ouro/20 space-y-1">
                        <span className="text-[10px] uppercase font-bold text-ouro/80 tracking-wider">Regime Tributário</span>
                        <p className="text-xs font-bold text-amber-300">Simples Nacional (CRT 1)</p>
                        <p className="text-[10px] text-luar-300/60">LC 123/2006 • Anexo I Comércio (4%)</p>
                      </div>

                      <div className="p-3.5 rounded-xl bg-celestial-950/80 border border-ouro/20 space-y-1">
                        <span className="text-[10px] uppercase font-bold text-ouro/80 tracking-wider">Documento Fiscal Emitido</span>
                        <p className="text-xs font-bold text-luar-100">NFC-e (Nota Fiscal de Consumidor)</p>
                        <p className="text-[10px] font-mono text-luar-300/60">Modelo 65 • Série 1 • Cupom 80mm</p>
                      </div>

                      <div className="p-3.5 rounded-xl bg-celestial-950/80 border border-ouro/20 space-y-1">
                        <span className="text-[10px] uppercase font-bold text-ouro/80 tracking-wider">Regra de Clientes no Caixa</span>
                        <p className="text-xs font-bold text-luar-100">Pessoa Física Obrigatório</p>
                        <p className="text-[10px] text-luar-300/60">CPF de 11 dígitos com validação SEFAZ</p>
                      </div>

                      <div className="p-3.5 rounded-xl bg-celestial-950/80 border border-ouro/20 space-y-1">
                        <span className="text-[10px] uppercase font-bold text-ouro/80 tracking-wider">Terminal &amp; Operadora</span>
                        <p className="text-xs font-bold text-ouro">#CAIXA-01 • Mileny Gabriely</p>
                        <p className="text-[10px] text-luar-300/60">Administradora &amp; Proprietária</p>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL 1: MÓDULO DE PRODUTOS & GESTÃO DE ESTOQUE */}
          {/* ==================================================================== */}
          {modalProdutosEstoqueAberto && (
            <div id="modal-produtos-estoque" className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fadeIn">
              <div className="relative w-full max-w-4xl bg-celestial-900 border border-ouro/50 rounded-3xl p-5 sm:p-6 space-y-4 shadow-2xl max-h-[92vh] flex flex-col text-left">
                <div className="flex items-center justify-between pb-3 border-b border-ouro/25 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">📦</span>
                    <div>
                      <h2 className="font-serif text-lg font-bold gold-gradient-text tracking-wide">
                        Módulo de Produtos &amp; Estoque da Boutique
                      </h2>
                      <p className="text-xs text-luar-300/80">
                        Cadastre novos produtos no sistema e gerencie o estoque físico sincronizado
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    id="btn-fechar-modal-produtos"
                    onClick={() => setModalProdutosEstoqueAberto(false)}
                    className="w-8 h-8 rounded-full bg-celestial-950 border border-ouro/30 text-ouro hover:text-white flex items-center justify-center text-lg font-bold cursor-pointer"
                  >
                    ×
                  </button>
                </div>

                {/* Abas Internas do Modal: Cadastrar vs Gestão de Estoque */}
                <div className="flex items-center gap-2 border-b border-ouro/20 pb-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setAbaModalProdutos('estoque')}
                    className={"px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 " + (abaModalProdutos === 'estoque' ? 'bg-ouro text-celestial-950 shadow-md' : 'bg-celestial-950 text-luar-200 hover:text-ouro border border-ouro/30')}
                  >
                    <span>📋 Gestão de Estoque &amp; Preços</span>
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-celestial-900 text-ouro font-extrabold">{produtos.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAbaModalProdutos('cadastrar')}
                    className={"px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 " + (abaModalProdutos === 'cadastrar' ? 'bg-ouro text-celestial-950 shadow-md' : 'bg-celestial-950 text-luar-200 hover:text-ouro border border-ouro/30')}
                  >
                    <span>➕ Cadastrar Novo Produto</span>
                  </button>
                </div>

                {/* Conteúdo da Aba 1: Gestão de Estoque & Preços */}
                {abaModalProdutos === 'estoque' && (
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {produtos.map(p => {
                        const ehAlimento = p.categoria === 'Cafeteria';
                        const estoqueAtual = p.estoque !== undefined ? Number(p.estoque) : 10;
                        const salvando = salvandoEstoqueId === p.id_produto;

                        return (
                          <div
                            key={p.id_produto}
                            className="p-3 rounded-2xl bg-celestial-950/80 border border-ouro/25 hover:border-ouro/50 transition-all flex items-start gap-3"
                          >
                            <img src={p.imagem_url} alt={p.nome_item} className="w-16 h-16 rounded-xl object-cover border border-ouro/30 shrink-0" />
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-xs font-bold text-luar-100 truncate">{p.nome_item}</span>
                                <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-ouro/20 text-ouro border border-ouro/30 shrink-0">
                                  {p.categoria}
                                </span>
                              </div>

                              <div className="flex items-center justify-between text-xs">
                                <span className="font-serif font-bold text-ouro">{formatBRL(p.preco)}</span>
                                {ehAlimento ? (
                                  <span className="text-[10px] text-amber-300 font-bold bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/30">
                                    ☕ Sob Demanda (Artesanal)
                                  </span>
                                ) : (
                                  <span className={"text-[10px] font-bold px-2 py-0.5 rounded border " + (estoqueAtual > 3 ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40' : estoqueAtual > 0 ? 'bg-amber-950/70 text-amber-300 border-amber-500/40' : 'bg-rose-950/70 text-rose-300 border-rose-500/40')}>
                                    {estoqueAtual > 0 ? ('📦 ' + estoqueAtual + ' un') : 'Esgotado'}
                                  </span>
                                )}
                              </div>

                              {/* Controles de Estoque para Moda e Pet */}
                              {!ehAlimento && (
                                <div className="pt-1.5 flex items-center justify-between gap-1 flex-wrap border-t border-ouro/15">
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={salvando}
                                      onClick={() => ajustarEstoque(p.id_produto, -1)}
                                      className="px-2 py-0.5 rounded bg-celestial-900 border border-ouro/30 text-ouro hover:bg-ouro/20 text-xs font-bold cursor-pointer"
                                    >
                                      -1
                                    </button>
                                    <button
                                      type="button"
                                      disabled={salvando}
                                      onClick={() => ajustarEstoque(p.id_produto, 1)}
                                      className="px-2 py-0.5 rounded bg-celestial-900 border border-ouro/30 text-ouro hover:bg-ouro/20 text-xs font-bold cursor-pointer"
                                    >
                                      +1
                                    </button>
                                    <button
                                      type="button"
                                      disabled={salvando}
                                      onClick={() => ajustarEstoque(p.id_produto, 5)}
                                      className="px-2 py-0.5 rounded bg-celestial-900 border border-ouro/30 text-ouro hover:bg-ouro/20 text-xs font-bold cursor-pointer"
                                    >
                                      +5
                                    </button>
                                    <button
                                      type="button"
                                      disabled={salvando}
                                      onClick={() => ajustarEstoque(p.id_produto, 0, 1)}
                                      className="px-2 py-0.5 rounded bg-amber-950 border border-amber-400 text-amber-300 hover:bg-amber-900 text-xs font-bold cursor-pointer"
                                      title="Definir exatamente 1 unidade (peça única)"
                                    >
                                      ⚡ 1 un
                                    </button>
                                    <button
                                      type="button"
                                      disabled={salvando}
                                      onClick={() => ajustarEstoque(p.id_produto, 0, 0)}
                                      className="px-2 py-0.5 rounded bg-rose-950 border border-rose-500 text-rose-300 hover:bg-rose-900 text-xs font-bold cursor-pointer"
                                      title="Zerar estoque (esgotar)"
                                    >
                                      ✕ Zerar
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Conteúdo da Aba 2: Formulário de Cadastro de Novo Produto */}
                {abaModalProdutos === 'cadastrar' && (
                  <form onSubmit={cadastrarNovoProduto} className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="sm:col-span-2 space-y-1">
                        <label className="text-[11px] font-bold uppercase text-ouro/80">Nome da Peça / Produto *</label>
                        <input
                          type="text"
                          required
                          value={novoProdNome}
                          onChange={e => setNovoProdNome(e.target.value)}
                          placeholder="Ex: Vestido Aurora Boreal em Linho Dourado"
                          className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase text-ouro/80">Categoria *</label>
                        <select
                          value={novoProdCat}
                          onChange={e => setNovoProdCat(e.target.value)}
                          className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-ouro focus:outline-none focus:border-ouro"
                        >
                          <option value="Moda">👗 Moda &amp; Alfaiataria</option>
                          <option value="Pet">🐾 Acessórios Pet de Luxo</option>
                          <option value="Cafeteria">☕ Bistrô &amp; Cafeteria (Sob Demanda)</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase text-ouro/80">Preço de Venda (R$) *</label>
                        <input
                          type="number"
                          step="0.01"
                          required
                          value={novoProdPreco}
                          onChange={e => setNovoProdPreco(e.target.value)}
                          placeholder="189.90"
                          className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-bold uppercase text-ouro/80">
                          {novoProdCat === 'Cafeteria' ? 'Estoque (Não aplicável para Cafeteria)' : 'Estoque Físico Inicial (unidades)'}
                        </label>
                        <input
                          type="number"
                          disabled={novoProdCat === 'Cafeteria'}
                          value={novoProdCat === 'Cafeteria' ? '0' : novoProdEstoque}
                          onChange={e => setNovoProdEstoque(e.target.value)}
                          placeholder="10"
                          className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro disabled:opacity-50"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-bold uppercase text-ouro/80">URL da Imagem do Produto</label>
                      <input
                        type="url"
                        value={novoProdImg}
                        onChange={e => setNovoProdImg(e.target.value)}
                        placeholder="https://images.unsplash.com/photo-..."
                        className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-bold uppercase text-ouro/80">Descrição Detalhada</label>
                      <textarea
                        rows={2}
                        value={novoProdDesc}
                        onChange={e => setNovoProdDesc(e.target.value)}
                        placeholder="Descreva tecidos, acabamentos, corte exclusivo Vênus & Luar..."
                        className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                      />
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        type="submit"
                        disabled={salvandoProduto}
                        id="btn-salvar-novo-produto"
                        className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-ouro text-celestial-950 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg disabled:opacity-50 flex items-center gap-2"
                      >
                        {salvandoProduto ? 'Salvando...' : '✨ Salvar e Publicar Produto'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL 2: MÓDULO DE VENDAS DA BOUTIQUE (AUDITORIA EM TEMPO REAL) */}
          {/* ==================================================================== */}
          {modalVendasBoutiqueAberto && (
            <div id="modal-vendas-boutique" className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fadeIn">
              <div className="relative w-full max-w-5xl bg-celestial-900 border border-ouro/50 rounded-3xl p-5 sm:p-6 space-y-4 shadow-2xl max-h-[92vh] flex flex-col text-left">
                <div className="flex items-center justify-between pb-3 border-b border-ouro/25 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">📊</span>
                    <div>
                      <h2 className="font-serif text-lg font-bold gold-gradient-text tracking-wide">
                        Monitor de Vendas da Boutique &amp; Faturamento
                      </h2>
                      <p className="text-xs text-luar-300/80">
                        Acompanhe o que o site da boutique e o bistrô estão vendendo em tempo real
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    id="btn-fechar-modal-vendas"
                    onClick={() => setModalVendasBoutiqueAberto(false)}
                    className="w-8 h-8 rounded-full bg-celestial-950 border border-ouro/30 text-ouro hover:text-white flex items-center justify-center text-lg font-bold cursor-pointer"
                  >
                    ×
                  </button>
                </div>

                {/* Cards com KPIs de Vendas Consolidadas */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 shrink-0">
                  <div className="p-3 rounded-2xl bg-celestial-950/90 border border-blue-500/30">
                    <span className="text-[10px] font-bold text-blue-300 uppercase block">🌐 Site (E-commerce)</span>
                    <span className="text-base font-serif font-bold text-blue-200">
                      {formatBRL(vendasBoutique.kpis?.total_site_valor || 0)}
                    </span>
                    <span className="text-[10px] text-luar-300/60 block">{vendasBoutique.kpis?.total_site_qtd || 0} pedidos faturados</span>
                  </div>

                  <div className="p-3 rounded-2xl bg-celestial-950/90 border border-amber-500/30">
                    <span className="text-[10px] font-bold text-amber-300 uppercase block">☕ Bistrô (Site/Mesas)</span>
                    <span className="text-base font-serif font-bold text-amber-200">
                      {formatBRL(vendasBoutique.kpis?.total_bistro_valor || 0)}
                    </span>
                    <span className="text-[10px] text-luar-300/60 block">{vendasBoutique.kpis?.total_bistro_qtd || 0} comandas</span>
                  </div>

                  <div className="p-3 rounded-2xl bg-celestial-950/90 border border-emerald-500/30">
                    <span className="text-[10px] font-bold text-emerald-300 uppercase block">🏪 PDV Caixa Físico</span>
                    <span className="text-base font-serif font-bold text-emerald-200">
                      {formatBRL(vendasBoutique.kpis?.total_pdv_valor || 0)}
                    </span>
                    <span className="text-[10px] text-luar-300/60 block">{vendasBoutique.kpis?.total_pdv_qtd || 0} vendas de balcão</span>
                  </div>

                  <div className="p-3 rounded-2xl bg-gradient-to-br from-celestial-950 to-amber-950/40 border border-ouro/60">
                    <span className="text-[10px] font-bold text-ouro uppercase block">💰 Faturamento Total</span>
                    <span className="text-base font-serif font-bold text-ouro-light">
                      {formatBRL(vendasBoutique.kpis?.total_geral_valor || 0)}
                    </span>
                    <span className="text-[10px] text-ouro/70 block">{vendasBoutique.kpis?.total_geral_qtd || 0} faturamentos</span>
                  </div>
                </div>

                {/* DRE Simplificado & Margens de Lucro Real */}
                {(() => {
                  const fat = vendasBoutique.kpis?.total_geral_valor || 0;
                  const impSimples = fat * 0.045;
                  const cpv = fat * 0.35;
                  const lucroLiq = fat - impSimples - cpv;
                  const margemLiq = fat > 0 ? ((lucroLiq / fat) * 100).toFixed(1) : '0.0';
                  const ticketMedio = (vendasBoutique.kpis?.total_geral_qtd || 0) > 0 ? (fat / vendasBoutique.kpis.total_geral_qtd) : 0;
                  return (
                    <div className="p-2.5 sm:p-3 rounded-2xl bg-celestial-950/80 border border-ouro/30 grid grid-cols-2 sm:grid-cols-4 gap-2 text-left shrink-0">
                      <div>
                        <span className="text-[9.5px] uppercase font-bold text-stone-400 block">📊 Receita Líquida</span>
                        <span className="text-sm font-bold text-luar-100">{formatBRL(fat - impSimples)}</span>
                        <span className="text-[9px] text-stone-400 block">-4.5% DAS Simples ({formatBRL(impSimples)})</span>
                      </div>
                      <div>
                        <span className="text-[9.5px] uppercase font-bold text-stone-400 block">📦 CPV Estimado</span>
                        <span className="text-sm font-bold text-rose-300">-{formatBRL(cpv)}</span>
                        <span className="text-[9px] text-rose-400/80 block">~35% Insumos &amp; Peças</span>
                      </div>
                      <div>
                        <span className="text-[9.5px] uppercase font-bold text-stone-400 block">💎 Lucro Líquido Real</span>
                        <span className="text-sm font-bold text-emerald-300">{formatBRL(lucroLiq)}</span>
                        <span className="text-[9px] text-emerald-400/80 block">Margem Líquida: {margemLiq}%</span>
                      </div>
                      <div>
                        <span className="text-[9.5px] uppercase font-bold text-stone-400 block">🏷️ Ticket Médio Omnichannel</span>
                        <span className="text-sm font-bold text-ouro">{formatBRL(ticketMedio)}</span>
                        <span className="text-[9px] text-ouro/70 block">Média por pedido</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Filtro por Origem */}
                <div className="flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-1.5 overflow-x-auto">
                    {['Todos', 'Site', 'Bistrô', 'PDV'].map(orig => (
                      <button
                        key={orig}
                        type="button"
                        onClick={() => setFiltroOrigemVendas(orig)}
                        className={"px-3 py-1 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer " + (filtroOrigemVendas === orig ? 'bg-ouro text-celestial-950 shadow' : 'bg-celestial-950 text-luar-200 hover:text-ouro border border-ouro/30')}
                      >
                        {orig === 'Site' ? '🌐 E-commerce' : (orig === 'Bistrô' ? '☕ Bistrô' : (orig === 'PDV' ? '🏪 PDV Físico' : '✨ Todos'))}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={carregarVendasBoutique}
                    disabled={carregandoVendas}
                    className="px-2.5 py-1 rounded-lg bg-celestial-950 border border-ouro/30 text-ouro hover:bg-ouro/20 text-xs font-bold cursor-pointer"
                  >
                    🔄 Atualizar
                  </button>
                </div>

                {/* Tabela de Pedidos com Faturamento */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-0 border border-ouro/20 rounded-2xl p-2 bg-celestial-950/60">
                  {vendasBoutique.pedidos?.length === 0 ? (
                    <div className="p-8 text-center text-xs text-luar-300/60">Nenhum pedido encontrado.</div>
                  ) : (
                    vendasBoutique.pedidos
                      ?.filter(p => {
                        if (filtroOrigemVendas === 'Todos') return true;
                        if (filtroOrigemVendas === 'Site') return (p.tipo_pedido === 'E-commerce' || (p.origem || '').includes('Site'));
                        if (filtroOrigemVendas === 'Bistrô') return p.tipo_pedido === 'Bistrô';
                        if (filtroOrigemVendas === 'PDV') return p.tipo_pedido === 'PDV';
                        return true;
                      })
                      .map(p => (
                        <div
                          key={p.id_pedido}
                          className="p-3 rounded-xl bg-celestial-900/80 border border-ouro/20 hover:border-ouro/50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-bold text-ouro">
                                #{p.numero_fatura || p.numero_cupom || p.numero_comanda || p.id_pedido}
                              </span>
                              <span className={"px-2 py-0.5 rounded-full text-[9px] font-bold border " + (p.tipo_pedido === 'E-commerce' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' : p.tipo_pedido === 'Bistrô' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30')}>
                                {p.origem || p.tipo_pedido}
                              </span>
                              <span className="text-[10px] text-luar-300/70">
                                {formatarDataHora(p.faturado_em || p.criado_em || p.data_hora)}
                              </span>
                            </div>

                            <p className="text-luar-100 font-semibold">
                              Cliente: <span className="text-ouro">{p.nome_cliente || 'Consumidor'}</span>
                              {p.cpf_cliente && <span className="text-luar-300/70 font-mono text-[10px] ml-1.5">(CPF: {formatarCpf(p.cpf_cliente)})</span>}
                            </p>

                            <p className="text-[11px] text-luar-300/80 line-clamp-1">
                              {p.itens?.map(it => it.quantidade + 'x ' + it.nome_item).join(', ')}
                            </p>
                          </div>

                          <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1 shrink-0">
                            <span className="font-serif font-bold text-sm text-ouro">
                              {formatBRL(p.total)}
                            </span>
                            <span className={"text-[9.5px] font-bold px-2 py-0.5 rounded border " + ((p.status || '').toLowerCase().includes('faturado') || (p.status || '').toLowerCase().includes('pago') ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border-amber-500/30')}>
                              {p.status_faturamento || p.status || 'Faturado'}
                            </span>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL 3: CADASTRO RÁPIDO DE CLIENTE PESSOA FÍSICA (OBRIGATÓRIO PF) */}
          {/* ==================================================================== */}
          {modalNovoClienteAberto && (
            <div id="modal-novo-cliente" className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fadeIn">
              <div className="relative w-full max-w-md bg-celestial-900 border border-ouro/50 rounded-3xl p-5 sm:p-6 space-y-4 shadow-2xl text-left">
                <div className="flex items-center justify-between pb-3 border-b border-ouro/25">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">👤</span>
                    <div>
                      <h2 className="font-serif text-base font-bold gold-gradient-text tracking-wide">
                        Cadastrar Cliente (Pessoa Física)
                      </h2>
                      <p className="text-[10px] text-luar-300/70">
                        Obrigatório para emissão fiscal e faturamento no PDV
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    id="btn-fechar-modal-cliente"
                    onClick={() => setModalNovoClienteAberto(false)}
                    className="w-8 h-8 rounded-full bg-celestial-950 border border-ouro/30 text-ouro hover:text-white flex items-center justify-center text-lg font-bold cursor-pointer"
                  >
                    ×
                  </button>
                </div>

                <form onSubmit={cadastrarClientePessoaFisica} className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10.5px] font-bold uppercase text-ouro/80">Nome Completo *</label>
                    <input
                      type="text"
                      required
                      id="input-novo-cliente-nome"
                      value={novoCliNome}
                      onChange={e => setNovoCliNome(e.target.value)}
                      placeholder="Ex: Beatriz Vasconcelos"
                      className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10.5px] font-bold uppercase text-ouro/80">CPF (11 dígitos) *</label>
                    <input
                      type="text"
                      required
                      maxLength={14}
                      id="input-novo-cliente-cpf"
                      value={novoCliCpf}
                      onChange={e => setNovoCliCpf(formatarCpf(e.target.value))}
                      placeholder="000.000.000-00"
                      className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro font-mono"
                    />
                    <p className="text-[9.5px] text-amber-300/70">
                      Somente Pessoa Física. O sistema valida 11 dígitos.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10.5px] font-bold uppercase text-ouro/80">WhatsApp / Telefone</label>
                      <input
                        type="tel"
                        value={novoCliTel}
                        onChange={e => setNovoCliTel(formatarTelefone(e.target.value))}
                        placeholder="(11) 98765-4321"
                        className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10.5px] font-bold uppercase text-ouro/80">E-mail</label>
                      <input
                        type="email"
                        value={novoCliEmail}
                        onChange={e => setNovoCliEmail(e.target.value)}
                        placeholder="cliente@email.com"
                        className="w-full bg-celestial-950 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                      />
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={salvandoCliente}
                      id="btn-confirmar-cadastro-cliente"
                      className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-ouro text-celestial-950 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {salvandoCliente ? 'Cadastrando...' : '✓ Salvar & Selecionar para Venda'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL 4: CUPOM TÉRMICO NÃO FISCAL & FATURA (PADRÃO 80MM) */}
          {/* ==================================================================== */}
          {cupomEmitido && (
            <div id="modal-cupom" className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fadeIn">
              <div className="relative w-full max-w-md bg-stone-50 text-stone-900 rounded-3xl p-6 sm:p-7 space-y-4 shadow-2xl border-2 border-ouro/60 max-h-[92vh] overflow-y-auto font-mono text-xs">
                <button type="button" id="btn-fechar-cupom-x" onClick={() => setCupomEmitido(null)} className="absolute top-4 right-4 text-stone-500 hover:text-stone-900 text-xl font-bold cursor-pointer print:hidden">×</button>

                <div id="area-cupom-impressao" className="space-y-2">
                  <div className="text-center space-y-1">
                    <div className="w-12 h-12 mx-auto rounded-full border border-stone-800 p-0.5 overflow-hidden">
                      <img src="/logo.jpg" alt="Logo" className="w-full h-full object-cover rounded-full" />
                    </div>
                    <h3 className="font-serif font-bold text-sm uppercase tracking-wider text-stone-900">
                      Vênus &amp; Luar Boutique
                    </h3>
                    <p className="text-[10px] text-stone-600 leading-tight font-bold">NFC-e • NOTA FISCAL DE CONSUMIDOR ELETRÔNICA (MOD. 65)</p>
                    <p className="text-[9px] text-stone-500 leading-tight">CNPJ: 00.000.000/0001-91 • IE: ISENTO • CRT 1 (Simples Nacional)</p>
                    <p className="text-[9px] text-stone-500 leading-tight">Rua Santa Rosa, 123 • Glória, Vila Velha - ES • CEP: 29122-000</p>
                    <div className="text-[10px] text-stone-400 select-none py-0.5">------------------------------------------------</div>
                  </div>

                  <div className="space-y-0.5 text-[10.5px]">
                    <div className="flex justify-between"><span className="font-bold">FATURA FISCAL:</span><span className="font-bold text-amber-900">{cupomEmitido.numero_fatura || cupomEmitido.numero_cupom}</span></div>
                    {cupomEmitido.numero_comanda && (
                      <div className="flex justify-between"><span className="font-bold">COMANDA ORIGEM:</span><span>{cupomEmitido.numero_comanda}</span></div>
                    )}
                    <div className="flex justify-between"><span className="font-bold">DATA / HORA:</span><span>{cupomEmitido.data_hora_formatada || formatarDataHora(cupomEmitido.data_hora)}</span></div>
                    <div className="flex justify-between"><span className="font-bold">OPERADOR:</span><span>{cupomEmitido.operador}</span></div>
                    <div className="flex justify-between"><span className="font-bold">CLIENTE:</span><span>{cupomEmitido.cliente}</span></div>
                    <div className="flex justify-between"><span className="font-bold">CPF (PF):</span><span className="font-bold">{cupomEmitido.cpf}</span></div>
                    <div className="flex justify-between"><span className="font-bold">DOCUMENTO:</span><span>Pessoa Física</span></div>
                    <div className="flex justify-between"><span className="font-bold">STATUS FISCAL:</span><span className="font-bold text-emerald-800">Autorizado SEFAZ-ES (Homologação)</span></div>
                    <div className="text-[10px] text-stone-400 select-none py-0.5 text-center">------------------------------------------------</div>
                  </div>

                  {cupomEmitido.chave_acesso_44 && (
                    <div className="bg-amber-50 border border-amber-600/30 p-2 rounded-xl text-left space-y-1">
                      <div className="text-[9px] font-bold text-amber-950">CHAVE DE ACESSO OFICIAL SEFAZ-ES (44 DÍGITOS):</div>
                      <div className="font-mono text-[8.5px] text-stone-900 tracking-wider break-all bg-white p-1 rounded border border-stone-300 select-all">
                        {(cupomEmitido.chave_acesso_44.match(/.{1,4}/g) || []).join(' ')}
                      </div>
                      {cupomEmitido.protocolo_autorizacao && (
                        <div className="text-[8.5px] text-stone-700 flex justify-between pt-0.5">
                          <span>Protocolo SEFAZ:</span>
                          <span className="font-bold text-stone-900">{cupomEmitido.protocolo_autorizacao}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-1 text-[10.5px]">
                    <div className="flex justify-between font-bold border-b border-stone-300 pb-0.5 text-[9.5px]">
                      <span>QTD ITEM</span><span>TOTAL (R$)</span>
                    </div>
                    {cupomEmitido.itens?.map((it, idx) => (
                      <div key={idx} className="flex justify-between items-start text-left">
                        <span className="flex-1 pr-2">{it.quantidade}x {it.nome_item}</span>
                        <span className="font-bold">{(Number(it.preco) * Number(it.quantidade)).toFixed(2)}</span>
                      </div>
                    ))}
                    <div className="text-[10px] text-stone-400 select-none py-0.5 text-center">------------------------------------------------</div>
                  </div>

                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span>Subtotal:</span><span>R$ {cupomEmitido.subtotal.toFixed(2)}</span></div>
                    {cupomEmitido.desconto > 0 && (
                      <div className="flex justify-between text-rose-700"><span>Desconto Concedido:</span><span>- R$ {cupomEmitido.desconto.toFixed(2)}</span></div>
                    )}
                    <div className="flex justify-between font-bold text-sm border-t border-b border-stone-800 py-1">
                      <span>TOTAL FATURADO:</span><span>R$ {cupomEmitido.total.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between pt-0.5">
                      <span>FORMA DE PGTO:</span><span className="font-bold uppercase">{cupomEmitido.forma_pagamento}</span>
                    </div>
                    {cupomEmitido.forma_pagamento.includes('Dinheiro') && (
                      <>
                        <div className="flex justify-between"><span>VALOR RECEBIDO:</span><span>R$ {cupomEmitido.valor_recebido.toFixed(2)}</span></div>
                        <div className="flex justify-between font-bold text-emerald-800"><span>TROCO DEVOLVIDO:</span><span>R$ {cupomEmitido.troco.toFixed(2)}</span></div>
                      </>
                    )}
                    <div className="text-[10px] text-stone-400 select-none py-0.5 text-center">------------------------------------------------</div>
                  </div>

                  {cupomEmitido.qr_code_url && (
                    <div className="text-center py-1">
                      <div className="inline-block p-1.5 bg-white border border-stone-400 rounded-lg max-w-full">
                        <div className="text-[8px] font-bold text-stone-600 pb-0.5">CONSULTA NFC-e VIA QR CODE SEFAZ-ES</div>
                        <a href={cupomEmitido.qr_code_url} target="_blank" rel="noreferrer" className="text-[8.5px] text-blue-700 underline font-mono break-all hover:text-blue-900 block">
                          🔗 Abrir Validação Oficial na SEFAZ
                        </a>
                      </div>
                    </div>
                  )}

                  <div className="text-center space-y-1 text-[9px] text-stone-500">
                    <p className="font-bold">AUTENTICAÇÃO DIGITAL SHA-256:</p>
                    <p className="font-mono break-all text-[8px] bg-stone-200 p-1 rounded border border-stone-300">
                      {cupomEmitido.chave_autenticacao}
                    </p>
                    <p className="mt-2 text-[9px] text-stone-600">Agradecemos a sua preferência na Vênus &amp; Luar Boutique!</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 print:hidden">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex-1 min-w-[120px] py-2.5 rounded-xl bg-stone-900 text-stone-50 hover:bg-stone-800 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md flex items-center justify-center gap-1.5"
                  >
                    <span>🖨️</span>
                    <span>Imprimir (80mm)</span>
                  </button>
                  <button
                    type="button"
                    id="btn-whatsapp-cupom"
                    onClick={() => {
                      const tel = prompt('Informe o WhatsApp do cliente com DDD (somente números):', '') || '';
                      const telLimpo = tel.replace(/[^0-9]/g, '');
                      if (!telLimpo) return;
                      const dddTel = telLimpo.length <= 11 ? (telLimpo.startsWith('55') ? telLimpo : '55' + telLimpo) : telLimpo;
                      const itensTxt = (cupomEmitido.itens || []).map(it => '• ' + it.quantidade + 'x ' + it.nome + ' - R$ ' + ((it.preco || 0) * it.quantidade).toFixed(2)).join('\n');
                      const msg = '✨ *VÊNUS & LUAR BOUTIQUE* ✨\n🧾 *Cupom Fiscal / PDV:* #' + (cupomEmitido.numero_fatura || cupomEmitido.numero_cupom) + '\n📅 *Data:* ' + cupomEmitido.data_hora_formatada + '\n👤 *Cliente:* ' + cupomEmitido.cliente + ' (CPF: ' + cupomEmitido.cpf + ')\n━━━━━━━━━━━━━━━━━━━━\n🛍️ *ITENS COMPRADOS:*\n' + itensTxt + '\n━━━━━━━━━━━━━━━━━━━━\n💳 *Pagamento:* ' + cupomEmitido.forma_pagamento + '\n💰 *Total:* R$ ' + Number(cupomEmitido.total || 0).toFixed(2) + '\n🔐 *Autenticação:* ' + (cupomEmitido.chave_autenticacao || '').substring(0, 24) + '...\n\n_Agradecemos sua preferência na Vênus & Luar Boutique!_';
                      window.open('https://wa.me/' + dddTel + '?text=' + encodeURIComponent(msg), '_blank');
                    }}
                    className="flex-1 min-w-[120px] py-2.5 rounded-xl bg-emerald-700 text-white hover:bg-emerald-600 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md flex items-center justify-center gap-1.5"
                  >
                    <span>📲</span>
                    <span>WhatsApp</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCupomEmitido(null)}
                    className="flex-1 min-w-[120px] py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-ouro text-celestial-950 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md flex items-center justify-center gap-1"
                  >
                    <span>✨ Nova Venda</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL 5: PERMISSIONAMENTO & GESTÃO DE EQUIPE */}
          {/* ==================================================================== */}
          {modalEquipeAberto && (
            <div id="modal-equipe" className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fadeIn">
              <div className="relative w-full max-w-lg bg-celestial-900 border border-ouro/50 rounded-3xl p-5 sm:p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto">
                <div className="flex items-center justify-between pb-3 border-b border-ouro/25">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-full border border-ouro bg-celestial-950 flex items-center justify-center text-lg">
                      👥
                    </div>
                    <div className="text-left">
                      <h2 className="font-serif text-base font-bold gold-gradient-text tracking-wide">
                        Operadores &amp; Permissões de Caixa
                      </h2>
                      <p className="text-[11px] text-luar-300/70">
                        Selecione quem está operando o caixa ou cadastre nova parceira
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    id="btn-fechar-modal-equipe"
                    onClick={() => setModalEquipeAberto(false)}
                    className="w-8 h-8 rounded-full bg-celestial-950 border border-ouro/30 text-ouro hover:text-white flex items-center justify-center text-lg font-bold cursor-pointer"
                  >
                    ×
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-ouro tracking-wider">
                      Equipe Autorizada ({colaboradores.length})
                    </span>
                    <button
                      type="button"
                      id="btn-toggle-novo-colab"
                      onClick={() => setFormNovoColab(!formNovoColab)}
                      className="text-xs text-ouro hover:text-ouro-light font-bold cursor-pointer underline flex items-center gap-1"
                    >
                      <span>{formNovoColab ? '✕ Cancelar' : '+ Adicionar Parceira'}</span>
                    </button>
                  </div>

                  {formNovoColab && (
                    <form onSubmit={cadastrarColaborador} className="p-3 rounded-2xl bg-celestial-950/90 border border-ouro/40 space-y-2.5 text-left animate-fadeIn">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] uppercase font-bold text-ouro/80">Nome Completo *</label>
                          <input
                            type="text"
                            required
                            value={novoNome}
                            onChange={e => setNovoNome(e.target.value)}
                            placeholder="Ex: Mileny Gabriely"
                            className="w-full bg-celestial-900 border border-ouro/30 rounded-lg px-2.5 py-1.5 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-ouro/80">Cargo / Função</label>
                          <select
                            value={novoCargo}
                            onChange={e => setNovoCargo(e.target.value)}
                            className="w-full bg-celestial-900 border border-ouro/30 rounded-lg px-2.5 py-1.5 text-xs text-ouro focus:outline-none focus:border-ouro"
                          >
                            <option value="Administrador">Administradora Geral</option>
                            <option value="Gerente">Gerente de Loja</option>
                            <option value="Vendedor">Vendedora / Caixa</option>
                            <option value="Barista">Barista Bistrô</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] uppercase font-bold text-ouro/80">E-mail *</label>
                          <input
                            type="email"
                            required
                            value={novoEmail}
                            onChange={e => setNovoEmail(e.target.value)}
                            placeholder="parceira@butique.com"
                            className="w-full bg-celestial-900 border border-ouro/30 rounded-lg px-2.5 py-1.5 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-ouro/80">Senha *</label>
                          <input
                            type="password"
                            required
                            value={novoSenha}
                            onChange={e => setNovoSenha(e.target.value)}
                            placeholder="••••••••"
                            className="w-full bg-celestial-900 border border-ouro/30 rounded-lg px-2.5 py-1.5 text-xs text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                          />
                        </div>
                      </div>

                      <div className="pt-1 flex justify-end">
                        <button
                          type="submit"
                          className="px-4 py-1.5 rounded-xl bg-ouro text-celestial-950 font-bold text-xs uppercase cursor-pointer"
                        >
                          Salvar Colaborador(a)
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="space-y-2 max-h-[46vh] overflow-y-auto pr-1">
                    {colaboradores.map(c => {
                      const ehAtivo = operador.id_usuario === c.id_usuario || operador.nome === c.nome_completo;
                      return (
                        <div key={c.id_usuario} className={"p-3 rounded-2xl border transition-all text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 " + (ehAtivo ? 'bg-amber-950/40 border-amber-400 ring-1 ring-amber-400/40' : 'bg-celestial-950/80 border-ouro/25 hover:border-ouro/60')}>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-celestial-900 to-ouro/30 border border-ouro/40 flex items-center justify-center font-serif text-sm font-bold text-ouro shrink-0">
                              {(c.nome_completo || c.email || 'C').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs font-bold text-ouro-light">{c.nome_completo}</span>
                                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-ouro/20 text-ouro border border-ouro/30">
                                  {c.cargo || (c.role === 'admin' ? 'Administradora' : 'Colaborador')}
                                </span>
                                {ehAtivo && (
                                  <span className="text-[9.5px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse">
                                    🟢 No Caixa Agora
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-luar-300/70 mt-0.5">{c.email}</p>
                            </div>
                          </div>

                          {!ehAtivo ? (
                            <button
                              type="button"
                              id={'btn-assumir-' + c.id_usuario}
                              onClick={() => selecionarOperador(c)}
                              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-ouro text-celestial-950 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-md flex items-center justify-center gap-1"
                            >
                              <span>⚡</span>
                              <span>Assumir Operação</span>
                            </button>
                          ) : (
                            <span className="text-[11px] text-emerald-400 font-bold">✓ Conectada</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL 6: GESTÃO & CONTROLE DE TURNO DE CAIXA */}
          {/* ==================================================================== */}
          {modalCaixaAberto && (
            <div id="modal-caixa-turno" className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fadeIn">
              <div className="relative w-full max-w-lg bg-celestial-900 border border-ouro/50 rounded-3xl p-5 sm:p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto text-left">
                <div className="flex items-center justify-between pb-3 border-b border-ouro/25">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">{turnoCaixa ? '💵' : '🔒'}</span>
                    <div>
                      <h2 className="font-serif text-base font-bold gold-gradient-text tracking-wide">
                        {turnoCaixa ? 'Turno de Caixa em Andamento' : 'Abertura de Turno de Caixa'}
                      </h2>
                      <p className="text-[10.5px] text-luar-300/70">
                        {turnoCaixa ? ('Aberto por ' + turnoCaixa.operador_nome + ' em ' + (turnoCaixa.aberto_em_formatado || '')) : 'Abra o turno informando o fundo de troco inicial'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setModalCaixaAberto(false);
                      setCaixaAbaModal('status');
                    }}
                    className="w-8 h-8 rounded-full bg-celestial-950 border border-ouro/30 text-ouro hover:text-white flex items-center justify-center text-lg font-bold cursor-pointer"
                  >
                    ×
                  </button>
                </div>

                {/* Se Caixa Aberto: Painel de Saldos e Ações */}
                {turnoCaixa ? (
                  <div className="space-y-4">
                    {/* Navegação entre Ações do Caixa */}
                    <div className="flex items-center gap-1.5 p-1 bg-celestial-950/80 rounded-xl border border-ouro/20">
                      <button
                        type="button"
                        onClick={() => setCaixaAbaModal('status')}
                        className={"flex-1 py-1.5 rounded-lg text-xs font-bold transition-all " + (caixaAbaModal === 'status' ? 'bg-ouro text-celestial-950 shadow' : 'text-luar-200 hover:text-ouro')}
                      >
                        📊 Saldos &amp; Gaveta
                      </button>
                      <button
                        type="button"
                        onClick={() => setCaixaAbaModal('suprimento')}
                        className={"flex-1 py-1.5 rounded-lg text-xs font-bold transition-all " + (caixaAbaModal === 'suprimento' ? 'bg-emerald-600 text-white shadow' : 'text-emerald-300 hover:bg-emerald-950/40')}
                      >
                        ➕ Suprimento
                      </button>
                      <button
                        type="button"
                        onClick={() => setCaixaAbaModal('sangria')}
                        className={"flex-1 py-1.5 rounded-lg text-xs font-bold transition-all " + (caixaAbaModal === 'sangria' ? 'bg-rose-700 text-white shadow' : 'text-rose-300 hover:bg-rose-950/40')}
                      >
                        ➖ Sangria
                      </button>
                      <button
                        type="button"
                        onClick={() => setCaixaAbaModal('fechar')}
                        className={"flex-1 py-1.5 rounded-lg text-xs font-bold transition-all " + (caixaAbaModal === 'fechar' ? 'bg-amber-600 text-white shadow' : 'text-amber-300 hover:bg-amber-950/40')}
                      >
                        🔒 Fechar Caixa
                      </button>
                    </div>

                    {/* Sub-Aba: STATUS / SALDOS */}
                    {caixaAbaModal === 'status' && (
                      <div className="space-y-3">
                        {/* Gaveta Dinheiro */}
                        <div className="p-3.5 rounded-2xl bg-emerald-950/40 border border-emerald-500/40">
                          <span className="text-[10px] uppercase font-bold text-emerald-300 block">💵 Saldo Esperado em Dinheiro na Gaveta</span>
                          <span className="text-2xl font-serif font-bold text-emerald-200">
                            R$ {Number((turnoCaixa.fundo_troco_inicial || 0) + (turnoCaixa.total_suprimentos || 0) - (turnoCaixa.total_sangrias || 0) + (turnoCaixa.vendas_dinheiro || 0)).toFixed(2)}
                          </span>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-[10.5px] text-emerald-300/80 pt-2 border-t border-emerald-500/20">
                            <div>Fundo Inicial: <strong>R$ {Number(turnoCaixa.fundo_troco_inicial || 0).toFixed(2)}</strong></div>
                            <div>Vendas Dinheiro: <strong>R$ {Number(turnoCaixa.vendas_dinheiro || 0).toFixed(2)}</strong></div>
                            <div>Suprimentos (+): <strong>R$ {Number(turnoCaixa.total_suprimentos || 0).toFixed(2)}</strong></div>
                            <div>Sangrias (-): <strong>R$ {Number(turnoCaixa.total_sangrias || 0).toFixed(2)}</strong></div>
                          </div>
                        </div>

                        {/* Outras Formas de Pagamento */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="p-3 rounded-xl bg-celestial-950/80 border border-ouro/20">
                            <span className="text-[10px] uppercase font-bold text-stone-400 block">💳 Vendas no Cartão</span>
                            <span className="text-base font-bold text-luar-100">R$ {Number(turnoCaixa.vendas_cartao || 0).toFixed(2)}</span>
                          </div>
                          <div className="p-3 rounded-xl bg-celestial-950/80 border border-ouro/20">
                            <span className="text-[10px] uppercase font-bold text-stone-400 block">⚡ Vendas no PIX</span>
                            <span className="text-base font-bold text-luar-100">R$ {Number(turnoCaixa.vendas_pix || 0).toFixed(2)}</span>
                          </div>
                        </div>

                        <div className="p-3 rounded-xl bg-celestial-950/60 border border-ouro/20 flex justify-between items-center text-xs">
                          <span className="text-stone-300 font-bold">Total Faturado no Turno:</span>
                          <span className="font-serif font-bold text-ouro text-sm">R$ {Number(turnoCaixa.total_vendas || 0).toFixed(2)}</span>
                        </div>
                      </div>
                    )}

                    {/* Sub-Aba: SUPRIMENTO / SANGRIA FORM */}
                    {(caixaAbaModal === 'suprimento' || caixaAbaModal === 'sangria') && (
                      <div className="p-4 rounded-2xl bg-celestial-950/80 border border-ouro/30 space-y-3">
                        <h3 className="font-bold text-xs uppercase tracking-wider text-ouro">
                          {caixaAbaModal === 'suprimento' ? '➕ Registrar Entrada / Suprimento de Troco' : '➖ Registrar Sangria / Retirada de Caixa'}
                        </h3>
                        <div>
                          <label className="text-[11px] text-stone-300 block mb-1">Valor (R$):</label>
                          <input
                            type="number"
                            step="0.01"
                            value={caixaMovValor}
                            onChange={e => setCaixaMovValor(e.target.value)}
                            placeholder="0,00"
                            className="w-full bg-celestial-900 border border-ouro/30 rounded-xl p-2.5 text-sm text-luar-100 font-mono font-bold focus:outline-none focus:border-ouro"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-stone-300 block mb-1">Motivo / Observação:</label>
                          <input
                            type="text"
                            value={caixaMovMotivo}
                            onChange={e => setCaixaMovMotivo(e.target.value)}
                            placeholder={caixaAbaModal === 'suprimento' ? 'Ex: Reforço de moedas pelo gerente' : 'Ex: Sangria para cofre de segurança'}
                            className="w-full bg-celestial-900 border border-ouro/30 rounded-xl p-2.5 text-xs text-luar-100 focus:outline-none focus:border-ouro"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={processandoCaixa}
                          onClick={() => registrarMovimentoCaixa(caixaAbaModal)}
                          className={"w-full py-2.5 rounded-xl text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md " + (caixaAbaModal === 'suprimento' ? 'bg-emerald-700 hover:bg-emerald-600' : 'bg-rose-700 hover:bg-rose-600')}
                        >
                          {processandoCaixa ? 'Processando...' : ('Confirmar ' + (caixaAbaModal === 'suprimento' ? 'Suprimento' : 'Sangria'))}
                        </button>
                      </div>
                    )}

                    {/* Sub-Aba: FECHAR CAIXA */}
                    {caixaAbaModal === 'fechar' && (
                      <form onSubmit={fecharTurnoCaixa} className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/40 space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">⚠️</span>
                          <div>
                            <h3 className="font-bold text-xs text-amber-300 uppercase tracking-wider">Conferência Cega de Fechamento</h3>
                            <p className="text-[10px] text-stone-300">Conte todas as cédulas e moedas presentes na gaveta antes de encerrar o turno.</p>
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] text-stone-300 block mb-1">Dinheiro Contado na Gaveta (R$):</label>
                          <input
                            type="number"
                            step="0.01"
                            required
                            value={caixaDinheiroContado}
                            onChange={e => setCaixaDinheiroContado(e.target.value)}
                            placeholder="Informe o valor contado"
                            className="w-full bg-celestial-900 border border-ouro/40 rounded-xl p-2.5 text-sm text-luar-100 font-mono font-bold focus:outline-none focus:border-ouro"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={processandoCaixa}
                          className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:brightness-110 text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg"
                        >
                          {processandoCaixa ? 'Fechando Turno...' : '🔒 Confirmar Fechamento e Emitir Relatório'}
                        </button>
                      </form>
                    )}
                  </div>
                ) : (
                  /* Form de Abertura quando Caixa está Fechado */
                  caixaAbaModal === 'relatorio' && caixaRelatorioFechamento ? (
                    <div className="p-4 rounded-2xl bg-stone-100 text-stone-900 font-mono text-xs space-y-2">
                      <div className="text-center font-bold text-sm border-b pb-1">RELATÓRIO DE FECHAMENTO DE CAIXA</div>
                      <div className="flex justify-between"><span>OPERADOR:</span><span>{caixaRelatorioFechamento.fechado_por}</span></div>
                      <div className="flex justify-between"><span>ABERTO EM:</span><span>{caixaRelatorioFechamento.aberto_em_formatado}</span></div>
                      <div className="flex justify-between"><span>FECHADO EM:</span><span>{caixaRelatorioFechamento.fechado_em_formatado}</span></div>
                      <div className="border-t pt-1 flex justify-between"><span>FUNDO INICIAL:</span><span>R$ {Number(caixaRelatorioFechamento.fundo_troco_inicial || 0).toFixed(2)}</span></div>
                      <div className="flex justify-between"><span>SUPRIMENTOS (+):</span><span>R$ {Number(caixaRelatorioFechamento.total_suprimentos || 0).toFixed(2)}</span></div>
                      <div className="flex justify-between"><span>SANGRIAS (-):</span><span>R$ {Number(caixaRelatorioFechamento.total_sangrias || 0).toFixed(2)}</span></div>
                      <div className="flex justify-between"><span>VENDAS DINHEIRO:</span><span>R$ {Number(caixaRelatorioFechamento.vendas_dinheiro || 0).toFixed(2)}</span></div>
                      <div className="border-t pt-1 flex justify-between font-bold"><span>ESPERADO DINHEIRO:</span><span>R$ {Number(caixaRelatorioFechamento.saldo_esperado_dinheiro || 0).toFixed(2)}</span></div>
                      <div className="flex justify-between font-bold"><span>DINHEIRO CONTADO:</span><span>R$ {Number(caixaRelatorioFechamento.dinheiro_contado || 0).toFixed(2)}</span></div>
                      <div className={"flex justify-between font-bold text-sm pt-1 border-t " + (caixaRelatorioFechamento.quebra_caixa < 0 ? 'text-red-700' : 'text-emerald-700')}>
                        <span>{caixaRelatorioFechamento.quebra_caixa < 0 ? 'QUEBRA DE CAIXA:' : 'SOBRA DE CAIXA:'}</span>
                        <span>R$ {Number(Math.abs(caixaRelatorioFechamento.quebra_caixa || 0)).toFixed(2)}</span>
                      </div>
                      <div className="pt-2">
                        <button type="button" onClick={() => window.print()} className="w-full py-2 bg-stone-900 text-white rounded-xl text-xs font-bold uppercase cursor-pointer">🖨️ Imprimir Resumo</button>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={abrirTurnoCaixa} className="p-4 rounded-2xl bg-celestial-950/80 border border-ouro/30 space-y-4">
                      <div>
                        <label className="text-xs text-stone-300 block mb-1">Operador Responsável:</label>
                        <input
                          type="text"
                          disabled
                          value={operador?.nome || 'Operador'}
                          className="w-full bg-celestial-900 border border-ouro/20 rounded-xl p-2.5 text-xs text-ouro-light font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-stone-300 block mb-1">Fundo de Troco Inicial (R$):</label>
                        <input
                          type="number"
                          step="0.01"
                          required
                          value={caixaFundoInicial}
                          onChange={e => setCaixaFundoInicial(e.target.value)}
                          placeholder="100,00"
                          className="w-full bg-celestial-900 border border-ouro/40 rounded-xl p-2.5 text-sm text-luar-100 font-mono font-bold focus:outline-none focus:border-ouro"
                        />
                        <span className="text-[10px] text-stone-400 block mt-1">Valor em moedas e cédulas colocado na gaveta no início do expediente.</span>
                      </div>
                      <button
                        type="submit"
                        disabled={processandoCaixa}
                        className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:brightness-110 text-white font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg flex items-center justify-center gap-2"
                      >
                        <span>🔓</span>
                        <span>{processandoCaixa ? 'Abrindo Caixa...' : 'Abrir Turno de Caixa'}</span>
                      </button>
                    </form>
                  )
                )}
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL 7: MONITOR DA COPA & BISTRÔ (KDS - KITCHEN DISPLAY SYSTEM) */}
          {/* ==================================================================== */}
          {modalKdsAberto && (
            <div id="modal-kds" className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fadeIn">
              <div className="relative w-full max-w-4xl bg-celestial-900 border border-ouro/50 rounded-3xl p-5 sm:p-6 space-y-4 shadow-2xl max-h-[92vh] flex flex-col text-left">
                <div className="flex items-center justify-between pb-3 border-b border-ouro/25 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <span className="text-2xl">☕</span>
                    <div>
                      <h2 className="font-serif text-lg font-bold gold-gradient-text tracking-wide">
                        Monitor da Copa &amp; Cafeteria Bistrô (KDS)
                      </h2>
                      <p className="text-xs text-luar-300/80">
                        Fila de pedidos da cafeteria em tempo real para o barista e copa
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={carregarKdsPedidos}
                      className="px-2.5 py-1.5 rounded-xl bg-celestial-950 border border-ouro/30 text-ouro text-xs font-bold hover:bg-celestial-800 transition-all cursor-pointer flex items-center gap-1"
                    >
                      <span>🔄</span>
                      <span>Atualizar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalKdsAberto(false)}
                      className="w-8 h-8 rounded-full bg-celestial-950 border border-ouro/30 text-ouro hover:text-white flex items-center justify-center text-lg font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                </div>

                {/* Lista de Pedidos KDS */}
                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {carregandoKds ? (
                    <div className="text-center py-12 text-ouro text-xs animate-pulse">Carregando pedidos da copa...</div>
                  ) : kdsPedidos.length === 0 ? (
                    <div className="text-center py-12 text-stone-400 text-xs">Nenhum pedido de cafeteria ou bistrô na fila no momento.</div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {kdsPedidos.map(p => {
                        const st = p.status_kds || 'em_preparo';
                        return (
                          <div key={p.id_pedido} className="p-3.5 rounded-2xl bg-celestial-950/80 border border-ouro/25 space-y-2.5 flex flex-col justify-between shadow-md">
                            <div>
                              <div className="flex items-center justify-between gap-1 pb-1.5 border-b border-ouro/15">
                                <span className="font-mono font-bold text-xs text-ouro">
                                  #{p.numero_comanda || p.numero_fatura || p.id_pedido}
                                </span>
                                <span className={"px-2 py-0.5 rounded-full text-[9px] font-bold uppercase " + (st === 'pronto' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : st === 'em_preparo' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30')}>
                                  {st === 'pronto' ? '✓ Pronto' : st === 'em_preparo' ? '🔥 Em Preparo' : '🕒 Na Fila'}
                                </span>
                              </div>
                              <p className="text-[11px] text-luar-100 font-semibold mt-1">
                                👤 {p.nome_cliente || 'Mesa / Balcão'}
                              </p>
                              <div className="mt-2 space-y-1 text-xs">
                                {(p.itens || []).map((it, idx) => (
                                  <div key={idx} className="flex justify-between items-center text-[11px] text-stone-200">
                                    <span><strong>{it.quantidade}x</strong> {it.nome}</span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Controles do Barista */}
                            <div className="pt-2 border-t border-ouro/15 flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => atualizarStatusKds(p.id_pedido, 'em_preparo')}
                                className={"flex-1 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer " + (st === 'em_preparo' ? 'bg-blue-600 text-white' : 'bg-celestial-900 text-stone-300 hover:text-white')}
                              >
                                🔥 Preparar
                              </button>
                              <button
                                type="button"
                                onClick={() => atualizarStatusKds(p.id_pedido, 'pronto')}
                                className={"flex-1 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer " + (st === 'pronto' ? 'bg-emerald-600 text-white' : 'bg-celestial-900 text-stone-300 hover:text-white')}
                              >
                                ✅ Pronto
                              </button>
                              <button
                                type="button"
                                onClick={() => atualizarStatusKds(p.id_pedido, 'entregue')}
                                className="px-2 py-1 rounded-lg text-[10px] font-bold bg-celestial-900 text-stone-400 hover:text-stone-200 transition-all cursor-pointer"
                                title="Marcar como entregue ao cliente"
                              >
                                🍽️
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Notificação Toast */}
          {notificacao && (
            <div className="fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-xl bg-ouro text-celestial-950 font-bold text-xs uppercase tracking-wider shadow-2xl animate-bounce">
              {notificacao}
            </div>
          )}

        </div>
      );
    }

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<PdvApp />);
  </script>
</body>
</html>`;
}

// Servidor do PDV Independente
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Servir SPA do PDV (com cabeçalhos rigorosos para evitar cache de versões antigas)
  if (pathname === '/' || pathname === '/index.html' || pathname === '/pdv') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(getPdvHtml());
    return;
  }

  // Logo Oficial da Boutique Vênus e Luar
  if (pathname === '/logo.jpg') {
    const logoPath = path.join(__dirname, '..', 'logo.jpg');
    if (fs.existsSync(logoPath)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
      res.end(fs.readFileSync(logoPath));
      return;
    } else {
      res.writeHead(404);
      res.end('Logo not found');
      return;
    }
  }

  // =========================================================================
  // API: AUTENTICAÇÃO E CADASTRO INICIAL DE OPERADORES/USUÁRIOS DO PDV
  // =========================================================================

  // GET /api/pdv/auth/operadores (Lista colaboradores/operadores disponíveis)
  if (pathname === '/api/pdv/auth/operadores' && req.method === 'GET') {
    const usuarios = carregarJson(USERS_FILE, []);
    const operadores = usuarios
      .filter(u => u.role === 'admin' || u.cargo || u.permissoes)
      .map(u => ({
        id_usuario: u.id_usuario,
        nome: u.nome_completo || u.nome,
        email: u.email,
        cargo: u.cargo || (u.role === 'admin' ? 'Administradora & Proprietária' : 'Operadora de Caixa'),
        role: u.role || 'colaborador'
      }));

    if (!operadores.some(o => (o.email && o.email.includes('mileny')) || (o.nome && o.nome.includes('Mileny')))) {
      operadores.unshift({
        id_usuario: 'usr_mileny_admin',
        nome: 'Mileny Gabriely',
        email: 'mileny@venus.com',
        cargo: 'Administradora & Proprietária',
        role: 'admin'
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(operadores));
    return;
  }

  // POST /api/pdv/auth/login
  if (pathname === '/api/pdv/auth/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { email, senha } = JSON.parse(body);
        const emailNorm = (email || '').trim().toLowerCase();
        const usuarios = carregarJson(USERS_FILE, []);
        let usuarioEncontrado = usuarios.find(u => u.email && u.email.toLowerCase() === emailNorm);

        if (!usuarioEncontrado && (emailNorm === 'mileny@venus.com' || emailNorm.includes('mileny'))) {
          usuarioEncontrado = {
            id_usuario: 'usr_mileny_admin',
            nome: 'Mileny Gabriely',
            email: 'mileny@venus.com',
            cargo: 'Administradora & Proprietária',
            role: 'admin'
          };
        }

        if (!usuarioEncontrado) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Usuário não encontrado. Verifique o e-mail ou faça o Cadastro Inicial na aba ao lado.' }));
          return;
        }

        const operadorLogado = {
          id_usuario: usuarioEncontrado.id_usuario,
          nome: usuarioEncontrado.nome_completo || usuarioEncontrado.nome,
          email: usuarioEncontrado.email,
          cargo: usuarioEncontrado.cargo || (usuarioEncontrado.role === 'admin' ? 'Administradora & Proprietária' : 'Operadora de Caixa'),
          role: usuarioEncontrado.role || 'colaborador'
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sucesso: true, operador: operadorLogado }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao processar login no PDV.' }));
      }
    });
    return;
  }

  // POST /api/pdv/auth/registrar (Cadastro Inicial de Usuário / Operador no PDV)
  if (pathname === '/api/pdv/auth/registrar' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { nome, email, senha, cargo } = JSON.parse(body);
        if (!nome || !nome.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Informe o nome completo do usuário.' }));
          return;
        }
        if (!email || !email.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Informe um e-mail válido.' }));
          return;
        }
        if (!senha || senha.length < 6) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'A senha deve conter no mínimo 6 caracteres.' }));
          return;
        }

        const emailNorm = email.trim().toLowerCase();
        const usuarios = carregarJson(USERS_FILE, []);
        if (usuarios.some(u => u.email && u.email.toLowerCase() === emailNorm)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Este e-mail já está cadastrado. Entre pela aba Login.' }));
          return;
        }

        const novoOp = {
          id_usuario: 'usr_pdv_' + Date.now(),
          nome_completo: nome.trim(),
          nome: nome.trim(),
          email: emailNorm,
          cargo: cargo || 'Operadora de Caixa',
          role: (cargo && cargo.includes('Admin')) ? 'admin' : 'colaborador',
          permissoes: { pdv: true, estoque: true, produtos: true, faturamento: true },
          senha_hash: 'simulada:' + Date.now(),
          criado_em: new Date().toISOString()
        };

        usuarios.push(novoOp);
        salvarJson(USERS_FILE, usuarios);

        try {
          const db = getDb();
          db.prepare(`
            INSERT OR IGNORE INTO users (id, name, email, password_hash, role)
            VALUES (?, ?, ?, ?, ?)
          `).run(novoOp.id_usuario, novoOp.nome_completo, novoOp.email, novoOp.senha_hash, novoOp.role);
        } catch(e) {}

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sucesso: true,
          mensagem: 'Usuário cadastrado com sucesso!',
          operador: {
            id_usuario: novoOp.id_usuario,
            nome: novoOp.nome_completo,
            email: novoOp.email,
            cargo: novoOp.cargo,
            role: novoOp.role
          }
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao cadastrar novo operador.' }));
      }
    });
    return;
  }

  // =========================================================================
  // API: CLIENTES PESSOA FÍSICA (OBRIGATÓRIO PARA O PASSO 1 DO CAIXA)
  // =========================================================================
  
  // GET /api/pdv/clientes
  if (pathname === '/api/pdv/clientes' && req.method === 'GET') {
    const usuarios = carregarJson(USERS_FILE, []);
    const clientesPf = usuarios
      .filter(u => u.role !== 'admin' && !u.cargo)
      .map(u => ({
        id_usuario: u.id_usuario,
        nome: u.nome_completo || u.nome || 'Cliente Vênus e Luar',
        nome_completo: u.nome_completo || u.nome || 'Cliente Vênus e Luar',
        cpf: u.cpf ? formatarCpf(u.cpf) : '',
        email: u.email,
        telefone: u.telefone || '',
        origem: 'Cadastro da Boutique',
        tipo_documento: 'Pessoa Física'
      }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(clientesPf));
    return;
  }

  // POST /api/pdv/clientes/cadastrar
  if (pathname === '/api/pdv/clientes/cadastrar' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { nome_completo, cpf, email, telefone } = JSON.parse(body);
        const cpfLimpo = (cpf || '').replace(/\D/g, '');

        if (!nome_completo || !nome_completo.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'O nome completo do cliente é obrigatório.' }));
          return;
        }

        if (cpfLimpo.length !== 11 || !validarCpf(cpfLimpo)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'O CPF é obrigatório e deve conter exatamente 11 dígitos de Pessoa Física.' }));
          return;
        }

        const usuarios = carregarJson(USERS_FILE, []);
        const cpfFormatado = formatarCpf(cpfLimpo);

        // Se já existir cliente com esse CPF, atualiza os dados
        let cliente = usuarios.find(u => u.cpf && u.cpf.replace(/\D/g, '') === cpfLimpo);
        if (cliente) {
          cliente.nome_completo = nome_completo.trim();
          cliente.telefone = telefone || cliente.telefone;
          if (email) cliente.email = email.trim().toLowerCase();
        } else {
          cliente = {
            id_usuario: 'usr_pf_' + Date.now(),
            nome_completo: nome_completo.trim(),
            cpf: cpfFormatado,
            email: (email || (nome_completo.trim().toLowerCase().replace(/\s+/g, '.') + '@cliente.venus.com')).trim().toLowerCase(),
            telefone: telefone || '',
            role: 'cliente',
            tipo_documento: 'Pessoa Física',
            termos_lgpd_aceito: true,
            termos_lgpd_aceito_em: new Date().toISOString(),
            criado_em: new Date().toISOString(),
            ultimo_acesso: new Date().toISOString()
          };
          usuarios.push(cliente);
        }

        salvarJson(USERS_FILE, usuarios);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sucesso: true,
          mensagem: 'Cliente cadastrado com sucesso para faturamento de Pessoa Física!',
          cliente: {
            id_usuario: cliente.id_usuario,
            nome: cliente.nome_completo,
            nome_completo: cliente.nome_completo,
            cpf: cpfFormatado,
            email: cliente.email,
            telefone: cliente.telefone,
            tipo_documento: 'Pessoa Física'
          }
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro interno ao cadastrar cliente.' }));
      }
    });
    return;
  }

  // =========================================================================
  // API: PRODUTOS & ESTOQUE NO PDV
  // =========================================================================

  // GET /api/pdv/produtos
  if (pathname === '/api/pdv/produtos' && req.method === 'GET') {
    const prods = carregarJson(PRODUCTS_FILE, []);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(prods));
    return;
  }

  // POST /api/pdv/produtos/cadastrar (Cadastrar novo produto e estoque no PDV)
  if (pathname === '/api/pdv/produtos/cadastrar' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { nome_item, categoria, preco, estoque, descricao, imagem_url } = JSON.parse(body);

        if (!nome_item || !nome_item.trim() || !preco || isNaN(preco)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Nome e preço do produto são obrigatórios.' }));
          return;
        }

        const produtos = carregarJson(PRODUCTS_FILE, []);
        const novoId = produtos.reduce((max, p) => Math.max(max, Number(p.id_produto) || 0), 0) + 1;
        const ehAlimento = categoria === 'Cafeteria';

        const novoProduto = {
          id_produto: novoId,
          nome_item: nome_item.trim(),
          categoria: categoria || 'Moda',
          preco: Number(Number(preco).toFixed(2)),
          estoque: ehAlimento ? 0 : Math.max(0, parseInt(estoque || '10', 10)),
          imagem_url: (imagem_url || '').trim() || (categoria === 'Moda'
            ? 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=800&q=80'
            : (categoria === 'Pet'
              ? 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?auto=format&fit=crop&w=800&q=80'
              : 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=800&q=80')),
          descricao: (descricao || '').trim() || 'Item autoral exclusivo Vênus & Luar Boutique.',
          ativo: true,
          cadastrado_via: 'PDV Frente de Caixa',
          criado_em: new Date().toISOString()
        };

        produtos.push(novoProduto);
        salvarJson(PRODUCTS_FILE, produtos);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sucesso: true,
          mensagem: 'Produto cadastrado com sucesso no sistema da Boutique!',
          produto: novoProduto
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro interno ao cadastrar produto.' }));
      }
    });
    return;
  }

  // PUT /api/pdv/produtos/estoque (Atualizar estoque e/ou preço do produto)
  if (pathname === '/api/pdv/produtos/estoque' && req.method === 'PUT') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { id_produto, estoque, preco } = JSON.parse(body);
        const produtos = carregarJson(PRODUCTS_FILE, []);
        const prod = produtos.find(p => p.id_produto === Number(id_produto));

        if (!prod) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Produto não encontrado.' }));
          return;
        }

        if (estoque !== undefined) {
          prod.estoque = Math.max(0, parseInt(estoque, 10));
        }
        if (preco !== undefined && !isNaN(preco)) {
          prod.preco = Number(Number(preco).toFixed(2));
        }

        salvarJson(PRODUCTS_FILE, produtos);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sucesso: true,
          mensagem: 'Estoque do produto atualizado com sucesso!',
          produto: prod
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao atualizar estoque.' }));
      }
    });
    return;
  }

  // =========================================================================
  // API: AUDITORIA & VENDAS DA BOUTIQUE (SITE, BISTRÔ E PDV EM TEMPO REAL)
  // =========================================================================

  // GET /api/pdv/vendas-boutique
  if (pathname === '/api/pdv/vendas-boutique' && req.method === 'GET') {
    const pedidos = carregarJson(ORDERS_FILE, []);

    let totalSiteValor = 0, totalSiteQtd = 0;
    let totalBistroValor = 0, totalBistroQtd = 0;
    let totalPdvValor = 0, totalPdvQtd = 0;
    let totalGeralValor = 0, totalGeralQtd = 0;

    pedidos.forEach(p => {
      const valor = Number(p.total) || 0;
      const tipo = p.tipo_pedido || '';
      const origem = p.origem || '';

      if (tipo === 'E-commerce' || origem.includes('Site')) {
        totalSiteValor += valor;
        totalSiteQtd++;
      } else if (tipo === 'Bistrô') {
        totalBistroValor += valor;
        totalBistroQtd++;
      } else {
        totalPdvValor += valor;
        totalPdvQtd++;
      }

      totalGeralValor += valor;
      totalGeralQtd++;
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      sucesso: true,
      kpis: {
        total_site_valor: Number(totalSiteValor.toFixed(2)),
        total_site_qtd: totalSiteQtd,
        total_bistro_valor: Number(totalBistroValor.toFixed(2)),
        total_bistro_qtd: totalBistroQtd,
        total_pdv_valor: Number(totalPdvValor.toFixed(2)),
        total_pdv_qtd: totalPdvQtd,
        total_geral_valor: Number(totalGeralValor.toFixed(2)),
        total_geral_qtd: totalGeralQtd
      },
      pedidos: pedidos
    }));
    return;
  }

  // GET /api/pdv/comandas (Comandas digitais do bistrô da Boutique)
  if (pathname === '/api/pdv/comandas' && req.method === 'GET') {
    const pedidos = carregarJson(ORDERS_FILE, []);
    const comandasAbertas = pedidos.filter(p => {
      const st = (p.status || '').toLowerCase();
      const ehBistro = p.tipo_pedido === 'Bistrô' || st.includes('bistrô') || st.includes('pendente no caixa');
      const jaPago = st.includes('pago no caixa') || st.includes('pago no pdv') || st.includes('cancelado') || st.includes('liquidado');
      return ehBistro && !jaPago;
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(comandasAbertas));
    return;
  }

  // GET /api/pdv/equipe (Equipe e colaboradores)
  if (pathname === '/api/pdv/equipe' && req.method === 'GET') {
    const users = carregarJson(USERS_FILE, []);
    const lista = users
      .filter(u => u.role === 'admin' || u.cargo || ['gerente', 'vendedor', 'caixa', 'barista', 'colaborador'].includes(u.role))
      .map(u => ({
        id_usuario: u.id_usuario,
        nome: u.nome_completo || u.nome || 'Colaborador',
        nome_completo: u.nome_completo || u.nome || 'Colaborador',
        email: u.email,
        role: u.role,
        cargo: u.cargo || (u.id_usuario === 'usr_mileny_admin' ? 'Administradora & Proprietária' : (u.role === 'admin' ? 'Administradora Geral' : 'Colaborador')),
        permissoes: u.permissoes || { pdv: true, estoque: u.role === 'admin', produtos: u.role === 'admin', faturamento: u.role === 'admin', adocao: u.role === 'admin' }
      }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ colaboradores: lista }));
    return;
  }

  // POST /api/pdv/equipe/cadastrar (Cadastrar colaborador)
  if (pathname === '/api/pdv/equipe/cadastrar' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { nome, email, senha, cargo, permissoes } = JSON.parse(body);
        const users = carregarJson(USERS_FILE, []);
        const emailNorm = email.trim().toLowerCase();
        if (users.some(u => u.email.toLowerCase() === emailNorm)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'E-mail já cadastrado.' }));
          return;
        }

        const novo = {
          id_usuario: 'usr_staff_' + Date.now(),
          nome_completo: nome.trim(),
          email: emailNorm,
          cargo: cargo || 'Vendedor',
          role: cargo === 'Administrador' ? 'admin' : 'colaborador',
          permissoes: permissoes || { pdv: true, estoque: false, produtos: false, faturamento: false, adocao: false },
          senha_hash: 'scrypt:simulado:' + Date.now(),
          criado_em: new Date().toISOString()
        };
        users.push(novo);
        salvarJson(USERS_FILE, users);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sucesso: true, colaborador: novo }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao cadastrar.' }));
      }
    });
    return;
  }

  // GET /api/pdv/backup (Download de Backup do Banco SQLite)
  if (pathname === '/api/pdv/backup' && req.method === 'GET') {
    const dbPath = path.join(__dirname, '..', 'storage', 'database.sqlite');
    if (fs.existsSync(dbPath)) {
      const dataHora = getBrasiliaIsoString().slice(0, 10);
      const filename = `venus_e_luar_backup_${dataHora}.sqlite`;
      res.writeHead(200, {
        'Content-Type': 'application/vnd.sqlite3',
        'Content-Disposition': `attachment; filename="${filename}"`
      });
      fs.createReadStream(dbPath).pipe(res);
      return;
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Arquivo de banco de dados não encontrado.' }));
      return;
    }
  }

  // =========================================================================
  // API: CONTROLE DE TURNO DE CAIXA (ABERTURA, SANGRIA, SUPRIMENTO, FECHAMENTO)
  // =========================================================================

  // GET /api/pdv/caixa/status
  if (pathname === '/api/pdv/caixa/status' && req.method === 'GET') {
    const dadosCaixa = carregarTurnoCaixa();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      sucesso: true,
      turno: dadosCaixa.turnoAtual,
      aberto: Boolean(dadosCaixa.turnoAtual && dadosCaixa.turnoAtual.status === 'aberto'),
      historico: (dadosCaixa.historicoTurnos || []).slice(-10)
    }));
    return;
  }

  // POST /api/pdv/caixa/abrir
  if (pathname === '/api/pdv/caixa/abrir' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { operador_nome, operador_id, fundo_troco_inicial } = JSON.parse(body || '{}');
        const dadosCaixa = carregarTurnoCaixa();
        if (dadosCaixa.turnoAtual && dadosCaixa.turnoAtual.status === 'aberto') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Já existe um turno de caixa aberto no momento.' }));
          return;
        }
        const fundo = Number(fundo_troco_inicial) || 0;
        const novoTurno = {
          id: 'TURNO-' + Date.now(),
          operador_nome: operador_nome || 'Operador',
          operador_id: operador_id || 1,
          aberto_em: getBrasiliaIsoString(),
          aberto_em_formatado: formatarDataHoraBrasilia(),
          fundo_troco_inicial: fundo,
          suprimentos: [],
          sangrias: [],
          total_suprimentos: 0,
          total_sangrias: 0,
          vendas_dinheiro: 0,
          vendas_cartao: 0,
          vendas_pix: 0,
          total_vendas: 0,
          pedidos_faturados: [],
          status: 'aberto'
        };
        dadosCaixa.turnoAtual = novoTurno;
        salvarTurnoCaixa(dadosCaixa);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sucesso: true, turno: novoTurno }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao abrir turno de caixa.' }));
      }
    });
    return;
  }

  // POST /api/pdv/caixa/movimento (Sangria ou Suprimento)
  if (pathname === '/api/pdv/caixa/movimento' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { tipo, valor, motivo, operador_nome } = JSON.parse(body || '{}');
        const dadosCaixa = carregarTurnoCaixa();
        if (!dadosCaixa.turnoAtual || dadosCaixa.turnoAtual.status !== 'aberto') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Nenhum turno de caixa aberto no momento.' }));
          return;
        }
        const valNum = Number(valor) || 0;
        if (valNum <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'O valor da movimentação deve ser maior que zero.' }));
          return;
        }
        const t = dadosCaixa.turnoAtual;
        const mov = {
          id: 'MOV-' + Date.now(),
          tipo, // 'suprimento' | 'sangria'
          valor: valNum,
          motivo: motivo || (tipo === 'sangria' ? 'Retirada de segurança' : 'Reforço de troco'),
          operador_nome: operador_nome || t.operador_nome,
          hora: formatarDataHoraBrasilia()
        };
        if (!t.sangrias) t.sangrias = [];
        if (!t.suprimentos) t.suprimentos = [];
        if (tipo === 'sangria') {
          t.sangrias.push(mov);
          t.total_sangrias = Number(((t.total_sangrias || 0) + valNum).toFixed(2));
        } else {
          t.suprimentos.push(mov);
          t.total_suprimentos = Number(((t.total_suprimentos || 0) + valNum).toFixed(2));
        }
        salvarTurnoCaixa(dadosCaixa);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sucesso: true, turno: t, movimento: mov }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao registrar movimentação.' }));
      }
    });
    return;
  }

  // POST /api/pdv/caixa/fechar (Fechamento com conferência cega)
  if (pathname === '/api/pdv/caixa/fechar' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { operador_nome, dinheiro_contado } = JSON.parse(body || '{}');
        const dadosCaixa = carregarTurnoCaixa();
        if (!dadosCaixa.turnoAtual || dadosCaixa.turnoAtual.status !== 'aberto') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Nenhum turno de caixa aberto para fechar.' }));
          return;
        }
        const t = dadosCaixa.turnoAtual;
        const contado = Number(dinheiro_contado) || 0;
        const esperadoDinheiro = Number(((t.fundo_troco_inicial || 0) + (t.total_suprimentos || 0) - (t.total_sangrias || 0) + (t.vendas_dinheiro || 0)).toFixed(2));
        const quebra = Number((contado - esperadoDinheiro).toFixed(2));

        const fechamento = {
          ...t,
          fechado_em: getBrasiliaIsoString(),
          fechado_em_formatado: formatarDataHoraBrasilia(),
          fechado_por: operador_nome || t.operador_nome,
          saldo_esperado_dinheiro: esperadoDinheiro,
          dinheiro_contado: contado,
          quebra_caixa: quebra,
          status: 'fechado'
        };

        if (!dadosCaixa.historicoTurnos) dadosCaixa.historicoTurnos = [];
        dadosCaixa.historicoTurnos.push(fechamento);
        dadosCaixa.turnoAtual = null;
        salvarTurnoCaixa(dadosCaixa);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sucesso: true, relatorio: fechamento }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao fechar caixa.' }));
      }
    });
    return;
  }

  // =========================================================================
  // API: MONITOR DA COPA & BISTRÔ (KDS - KITCHEN DISPLAY SYSTEM)
  // =========================================================================

  // GET /api/pdv/kds/pedidos
  if (pathname === '/api/pdv/kds/pedidos' && req.method === 'GET') {
    const pedidos = carregarJson(ORDERS_FILE, []);
    const kdsPedidos = pedidos.filter(p => {
      const tipo = (p.tipo_pedido || '').toLowerCase();
      const st = (p.status || '').toLowerCase();
      const temItensBistro = (p.itens || []).some(it => {
        const cat = (it.categoria || '').toLowerCase();
        const nome = (it.nome || '').toLowerCase();
        return cat.includes('cafeteria') || cat.includes('bistr') || nome.includes('café') || nome.includes('croissant') || nome.includes('chá');
      });
      return (tipo.includes('bistrô') || temItensBistro) && !st.includes('cancelado');
    }).map(p => ({
      ...p,
      status_kds: p.status_kds || (p.status && p.status.includes('Liquidado') ? 'pronto' : 'em_preparo')
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sucesso: true, pedidos: kdsPedidos.slice(0, 30) }));
    return;
  }

  // POST /api/pdv/kds/status
  if (pathname === '/api/pdv/kds/status' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { id_pedido, status_kds } = JSON.parse(body || '{}');
        const pedidos = carregarJson(ORDERS_FILE, []);
        const ped = pedidos.find(p => String(p.id_pedido) === String(id_pedido) || p.numero_fatura === id_pedido || p.numero_comanda === id_pedido);
        if (!ped) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Pedido não encontrado.' }));
          return;
        }
        ped.status_kds = status_kds; // 'na_fila' | 'em_preparo' | 'pronto' | 'entregue'
        salvarJson(ORDERS_FILE, pedidos);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sucesso: true, pedido: ped }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao atualizar status KDS.' }));
      }
    });
    return;
  }

  // =========================================================================
  // API: FATURAR PEDIDO NO PDV (PASSO 4 OBRIGATÓRIO - PESSOA FÍSICA)
  // =========================================================================
  const handlerFaturar = (req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      try {
        const dados = JSON.parse(body);
        const {
          id_pedido,
          itens,
          desconto = 0,
          forma_pagamento = 'Dinheiro Físico',
          valor_recebido = 0,
          troco = 0,
          cliente_id,
          nome_cliente,
          cpf_cliente,
          email_cliente,
          telefone_cliente,
          local_consumo,
          nome_operador
        } = dados;

        // 1. Validação Estrita do Cliente Pessoa Física (CPF 11 dígitos)
        const cpfLimpo = (cpf_cliente || dados.cpf || '').replace(/\D/g, '');
        if (cpfLimpo.length !== 11 || !validarCpf(cpfLimpo)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            erro: 'Faturamento Bloqueado: É obrigatório identificar o cliente com CPF válido de Pessoa Física (11 dígitos). Atualmente trabalhamos exclusivamente com faturamento para Pessoa Física.'
          }));
          return;
        }

        if (!nome_cliente || !nome_cliente.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'O nome do cliente é obrigatório para emissão da nota de faturamento.' }));
          return;
        }

        // 2. Validação dos Itens
        if (!itens || !Array.isArray(itens) || itens.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Nenhum item na venda a faturar.' }));
          return;
        }

        // 3. Validação e Baixa de Estoque Físico da Boutique (apenas Moda e Pet; Cafeteria é sob demanda)
        const produtos = carregarJson(PRODUCTS_FILE, []);
        for (const it of itens) {
          const prod = produtos.find(p => p.id_produto === Number(it.id_produto));
          if (prod && prod.categoria !== 'Cafeteria') {
            const estoqueAtual = prod.estoque !== undefined ? Number(prod.estoque) : 10;
            if (estoqueAtual < Number(it.quantidade)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                erro: `Estoque insuficiente para a peça "${prod.nome_item}". Disponível em estoque: ${estoqueAtual} unidade(s).`
              }));
              return;
            }
          }
        }

        // Executar a baixa no estoque
        for (const it of itens) {
          const prod = produtos.find(p => p.id_produto === Number(it.id_produto));
          if (prod && prod.categoria !== 'Cafeteria') {
            const estoqueAtual = prod.estoque !== undefined ? Number(prod.estoque) : 10;
            prod.estoque = Math.max(0, estoqueAtual - Number(it.quantidade));
          }
        }
        salvarJson(PRODUCTS_FILE, produtos);

        // 4. Cálculos Financeiros e Geração da Fatura Oficial
        const subtotal = itens.reduce((acc, it) => acc + (Number(it.preco) * Number(it.quantidade)), 0);
        const descValor = Number(desconto) || 0;
        const totalFinal = Math.max(0, subtotal - descValor);
        const operadorNome = nome_operador || 'Mileny Gabriely';
        const dataVenda = getBrasiliaIsoString();
        const dataVendaFormatada = formatarDataHoraBrasilia(dataVenda);
        const pedidos = carregarJson(ORDERS_FILE, []);

        const numeroFatura = 'FAT-PDV-2026-' + (1000 + pedidos.length + 1);
        const numeroCupom = 'CUPOM-PDV-2026-' + (1000 + pedidos.length + 1);
        const chaveAutenticacao = crypto.createHash('sha256')
          .update(`${numeroFatura}:${totalFinal}:${dataVenda}:${cpfLimpo}:${operadorNome}`)
          .digest('hex').toUpperCase();

        const cpfFormatado = formatarCpf(cpfLimpo);
        const idComandaRef = id_pedido || dados.numero_comanda;

        // 4.1 Integração Fiscal & Estoque Omnichannel (SQLite Relacional)
        let fiscalAuth = null;
        let taxationList = [];
        try {
          const company = queryOne('SELECT * FROM companies WHERE id = ?', ['comp_matriz_es']);
          const orderSqlId = 'ord_pdv_' + Date.now();

          for (const it of itens) {
            const pId = 'prod_' + it.id_produto;
            let prodRow = queryOne('SELECT * FROM products WHERE id = ?', [pId]);
            if (!prodRow) {
              prodRow = queryOne('SELECT * FROM products WHERE lower(name) = lower(?)', [it.nome_item]) || {
                id: pId,
                name: it.nome_item,
                ncm: '61044300',
                has_icms_st: 0,
                is_monophasic_pis_cofins: 0,
                product_type: 'standard'
              };
            }

            const itemTax = FiscalEngineService.determineItemTaxation(it, prodRow, { destination_uf: 'ES' }, company);
            taxationList.push(itemTax);

            // Baixa de estoque relacional especializada
            if (prodRow.product_type === 'composite') {
              // Cafeteria / Bistrô: Baixa automática de insumos (café em g, leite em ml)
              RecipeDeductionEngine.deductRecipeIngredients(prodRow.id, Number(it.quantidade), {
                orderId: orderSqlId,
                operatorName: operadorNome
              });
            } else if (prodRow.product_type === 'batch') {
              // Cosméticos ou Pet: Baixa FEFO por validade
              try {
                FefoAllocationEngine.allocateAndConsume(prodRow.id, Number(it.quantidade), {
                  orderId: orderSqlId,
                  operatorName: operadorNome,
                  notes: `Venda PDV #${numeroFatura}`
                });
              } catch (fefoErr) {
                InventoryService.recordMovement({
                  productId: prodRow.id,
                  movementType: 'OUT_SALE',
                  quantity: -Number(it.quantidade),
                  orderId: orderSqlId,
                  operatorName: operadorNome
                });
              }
            } else {
              // Moda ou Acessórios: Kardex padrão
              InventoryService.recordMovement({
                productId: prodRow.id,
                movementType: 'OUT_SALE',
                quantity: -Number(it.quantidade),
                orderId: orderSqlId,
                operatorName: operadorNome
              });
            }
          }

          // Criar registro na tabela `orders` do SQLite
          execute(`
            INSERT INTO orders (
              id, order_number, channel, customer_cpf_snapshot, customer_name_snapshot,
              status, subtotal, discount_amount, total_amount, payment_method, created_at
            ) VALUES (?, ?, 'POS_RETAIL', ?, ?, 'invoiced', ?, ?, ?, ?, ?)
          `, [
            orderSqlId,
            numeroFatura,
            cpfLimpo,
            nome_cliente.trim(),
            Number(subtotal.toFixed(2)),
            descValor,
            Number(totalFinal.toFixed(2)),
            forma_pagamento,
            dataVenda
          ]);

          // Criar itens na tabela `order_items` do SQLite com snapshot fiscal
          for (let i = 0; i < taxationList.length; i++) {
            const tax = taxationList[i];
            execute(`
              INSERT INTO order_items (
                id, order_id, product_id, product_name, quantity, unit_price, total_price,
                ncm, cest, cfop, csosn, pis_cst, cofins_cst,
                icms_base, icms_rate, icms_amount, icms_st_amount,
                cbs_rate, cbs_amount, ibs_rate, ibs_amount
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              `${orderSqlId}_it_${i}`,
              orderSqlId,
              tax.product_id,
              tax.product_name,
              tax.quantity,
              tax.unit_price,
              tax.total_price,
              tax.ncm,
              tax.cest,
              tax.cfop,
              tax.csosn,
              tax.pis_cst,
              tax.cofins_cst,
              tax.icms_base,
              tax.icms_rate,
              tax.icms_amount,
              tax.icms_st_amount,
              tax.cbs_rate,
              tax.cbs_amount,
              tax.ibs_rate,
              tax.ibs_amount
            ]);
          }

          // Emitir e Autorizar NFC-e (Modelo 65) via MockFiscalProvider
          fiscalAuth = await mockFiscalProvider.authorize({
            id: orderSqlId,
            order_number: numeroFatura,
            channel: 'POS_RETAIL',
            customer_cpf_snapshot: cpfLimpo,
            customer_name_snapshot: nome_cliente.trim(),
            subtotal,
            discount_amount: descValor,
            shipping_amount: 0,
            total_amount: totalFinal
          }, company, { model: '65', tpEmis: 1 });

          // Se for comanda do bistrô, fechar comanda
          if (idComandaRef) {
            try {
              const tabRow = queryOne('SELECT id FROM bistro_tabs WHERE tab_number = ? OR id = ?', [String(idComandaRef), String(idComandaRef)]);
              if (tabRow) BistroTabService.closeTab(tabRow.id);
            } catch (tabErr) {}
          }
        } catch (fiscErr) {
          console.error('Aviso na camada relacional fiscal:', fiscErr);
        }

        let pedidoAtualizado = null;

        if (idComandaRef) {
          // Liquidando e faturando comanda existente do bistrô
          pedidoAtualizado = pedidos.find(p => p.id_pedido === Number(idComandaRef) || p.numero_comanda === idComandaRef || p.numero_fatura === idComandaRef);
          if (pedidoAtualizado) {
            pedidoAtualizado.tipo_pedido = 'Bistrô';
            pedidoAtualizado.origem = 'Bistrô (Faturado no Caixa PDV)';
            pedidoAtualizado.tipo_documento = 'Pessoa Física';
            pedidoAtualizado.numero_fatura = numeroFatura;
            pedidoAtualizado.numero_cupom = numeroCupom;
            pedidoAtualizado.chave_autenticacao = chaveAutenticacao;
            pedidoAtualizado.nome_cliente = nome_cliente.trim();
            pedidoAtualizado.cpf_cliente = cpfFormatado;
            pedidoAtualizado.itens = itens;
            pedidoAtualizado.total = Number(totalFinal.toFixed(2));
            pedidoAtualizado.desconto = descValor;
            pedidoAtualizado.forma_pagamento = forma_pagamento;
            pedidoAtualizado.detalhes_pagamento = {
              ...(pedidoAtualizado.detalhes_pagamento || {}),
              tipo: 'PDV Balcão Profissional',
              valor_recebido: Number(valor_recebido) || totalFinal,
              troco: Number(troco) || 0,
              operador: operadorNome,
              faturado_em: dataVenda,
              pago_em: dataVenda
            };
            pedidoAtualizado.status = 'Faturado & Liquidado';
            pedidoAtualizado.status_faturamento = 'Faturado';
            pedidoAtualizado.faturado_em = dataVenda;
          }
        }

        if (!pedidoAtualizado) {
          // Nova venda direta física avulsa faturada no PDV
          pedidoAtualizado = {
            id_pedido: 1000 + pedidos.length + 1,
            tipo_pedido: 'PDV',
            origem: 'Frente de Caixa (PDV Físico)',
            tipo_documento: 'Pessoa Física',
            numero_fatura: numeroFatura,
            numero_cupom: numeroCupom,
            chave_autenticacao: chaveAutenticacao,
            nome_cliente: nome_cliente.trim(),
            cpf_cliente: cpfFormatado,
            total: Number(totalFinal.toFixed(2)),
            desconto: descValor,
            subtotal: Number(subtotal.toFixed(2)),
            itens,
            forma_pagamento: forma_pagamento,
            local_consumo: local_consumo || 'Venda Balcão / Loja Física',
            detalhes_pagamento: {
              tipo: 'PDV Balcão Profissional',
              valor_recebido: Number(valor_recebido) || totalFinal,
              troco: Number(troco) || 0,
              operador: operadorNome,
              faturado_em: dataVenda,
              pago_em: dataVenda
            },
            status: 'Faturado & Liquidado',
            status_faturamento: 'Faturado',
            faturado_em: dataVenda,
            criado_em: dataVenda
          };
          pedidos.unshift(pedidoAtualizado);
        }

        salvarJson(ORDERS_FILE, pedidos);

        // Atualizar Turno do Caixa Ativo caso aberto
        try {
          const dadosCaixa = carregarTurnoCaixa();
          if (dadosCaixa.turnoAtual && dadosCaixa.turnoAtual.status === 'aberto') {
            const t = dadosCaixa.turnoAtual;
            const fp = String(forma_pagamento || '').toLowerCase();
            const valorFinalNum = Number(totalFinal.toFixed(2));
            if (fp.includes('dinheiro')) {
              t.vendas_dinheiro = Number(((t.vendas_dinheiro || 0) + valorFinalNum).toFixed(2));
            } else if (fp.includes('pix')) {
              t.vendas_pix = Number(((t.vendas_pix || 0) + valorFinalNum).toFixed(2));
            } else {
              t.vendas_cartao = Number(((t.vendas_cartao || 0) + valorFinalNum).toFixed(2));
            }
            t.total_vendas = Number(((t.total_vendas || 0) + valorFinalNum).toFixed(2));
            if (!t.pedidos_faturados) t.pedidos_faturados = [];
            t.pedidos_faturados.push(numeroFatura);
            salvarTurnoCaixa(dadosCaixa);
          }
        } catch (eCaixa) {
          console.error('Erro ao atualizar turno caixa:', eCaixa);
        }

        // Atualizar também o cliente em usuarios.json caso necessário
        const usuarios = carregarJson(USERS_FILE, []);
        let usuarioExistente = usuarios.find(u => u.cpf && u.cpf.replace(/\D/g, '') === cpfLimpo);
        if (usuarioExistente) {
          usuarioExistente.ultimo_acesso = dataVenda;
          salvarJson(USERS_FILE, usuarios);
        }

        const cupomPdv = {
          numero_fatura: numeroFatura,
          numero_cupom: numeroCupom,
          numero_comanda: pedidoAtualizado.numero_comanda,
          data_hora: dataVenda,
          data_hora_formatada: dataVendaFormatada,
          operador: operadorNome,
          cliente: pedidoAtualizado.nome_cliente,
          cpf: pedidoAtualizado.cpf_cliente,
          tipo_documento: 'Pessoa Física',
          local: pedidoAtualizado.local_consumo,
          itens: pedidoAtualizado.itens,
          subtotal: Number(subtotal.toFixed(2)),
          desconto: descValor,
          total: Number(totalFinal.toFixed(2)),
          forma_pagamento: pedidoAtualizado.forma_pagamento,
          valor_recebido: Number(valor_recebido) || totalFinal,
          troco: Number(troco) || 0,
          chave_autenticacao: chaveAutenticacao,
          // Dados Oficiais de Emissão NFC-e SEFAZ-ES
          chave_acesso_44: fiscalAuth?.access_key || null,
          protocolo_autorizacao: fiscalAuth?.protocol_number || null,
          qr_code_url: fiscalAuth?.qr_code_url || null,
          modelo_fiscal: 'NFC-e (Modelo 65)',
          ambiente_fiscal: 'Homologação / SEFAZ-ES (Mock A1)',
          tributacao_itens: taxationList
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sucesso: true,
          mensagem: 'Pedido faturado com sucesso para Pessoa Física!',
          pedido: pedidoAtualizado,
          cupom: cupomPdv
        }));
      } catch (e) {
        console.error('Erro ao faturar:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro interno ao processar faturamento no PDV.' }));
      }
    });
  };

  // POST /api/pdv/faturar (Endpoint principal)
  if (pathname === '/api/pdv/faturar' && req.method === 'POST') {
    handlerFaturar(req, res);
    return;
  }

  // POST /api/pdv/finalizar (Alias de compatibilidade)
  if (pathname === '/api/pdv/finalizar' && req.method === 'POST') {
    handlerFaturar(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ erro: 'Endpoint não encontrado no PDV.' }));
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log('🖥️  VÊNUS & LUAR BOUTIQUE • PDV INDEPENDENTE PROFISSIONAL');
  console.log('👉 Acesso ao PDV Frente de Caixa: http://localhost:' + PORT);
  console.log('📡 Sincronizado com a Boutique em: ' + BOUTIQUE_URL);
  console.log('====================================================');
});
