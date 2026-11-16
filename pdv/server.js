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

    function formatarCpf(cpf) {
      const d = (cpf || '').replace(/\\D/g, '').slice(0, 11);
      if (d.length <= 3) return d;
      if (d.length <= 6) return d.slice(0, 3) + '.' + d.slice(3);
      if (d.length <= 9) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
      return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    }

    function formatarTelefone(tel) {
      const d = (tel || '').replace(/\\D/g, '').slice(0, 11);
      if (d.length <= 2) return d;
      if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
      if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
      return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    }

    function PdvApp() {
      // Operador Atual (Mileny ou colaboradora)
      const [operador, setOperador] = useState(() => {
        const salvo = localStorage.getItem('venus_pdv_operador');
        if (salvo) {
          try { return JSON.parse(salvo); } catch(e) {}
        }
        return {
          id_usuario: 'usr_mileny_admin',
          nome: 'Mileny Gabriely',
          cargo: 'Administradora & Proprietária'
        };
      });

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

      // Modais do Sistema
      const [modalEquipeAberto, setModalEquipeAberto] = useState(false);
      const [modalProdutosEstoqueAberto, setModalProdutosEstoqueAberto] = useState(false);
      const [modalVendasBoutiqueAberto, setModalVendasBoutiqueAberto] = useState(false);
      const [modalNovoClienteAberto, setModalNovoClienteAberto] = useState(false);

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

      // Atalhos de Teclado (F2 Faturar, Esc Fechar Modais)
      useEffect(() => {
        const handleKeys = (e) => {
          if (e.key === 'F2') {
            e.preventDefault();
            const btn = document.getElementById('btn-faturar-pedido-pdv');
            if (btn && !btn.disabled) btn.click();
          } else if (e.key === 'Escape') {
            setCupomEmitido(null);
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

      // Adicionar produto do catálogo ao carrinho
      const adicionarItem = (prod) => {
        const existe = itensCaixa.find(it => it.id_produto === prod.id_produto);
        if (existe) {
          setItensCaixa(itensCaixa.map(it => it.id_produto === prod.id_produto ? { ...it, quantidade: it.quantidade + 1 } : it));
        } else {
          setItensCaixa([...itensCaixa, {
            id_produto: prod.id_produto,
            nome_item: prod.nome_item,
            preco: Number(prod.preco),
            quantidade: 1,
            categoria: prod.categoria,
            imagem_url: prod.imagem_url
          }]);
        }
        avisar('+1 ' + prod.nome_item + ' adicionado ao pedido!');
      };

      // Alterar quantidade
      const alterarQtd = (idProd, delta) => {
        setItensCaixa(itensCaixa.map(it => {
          if (it.id_produto === idProd) {
            const nova = it.quantidade + delta;
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
        if (cmd.cpf_cliente && cmd.cpf_cliente !== 'Pagamento no Caixa' && cmd.cpf_cliente.replace(/\\D/g, '').length === 11) {
          const cliExistente = clientes.find(c => c.cpf && c.cpf.replace(/\\D/g, '') === cmd.cpf_cliente.replace(/\\D/g, ''));
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
        // Validação Estrita do Passo 1: Cliente Pessoa Física Obrigatório
        if (!clienteSelecionado || !clienteSelecionado.cpf || clienteSelecionado.cpf.replace(/\\D/g, '').length !== 11) {
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
      const cadastrarClientePessoaFisica = async (e) => {
        e.preventDefault();
        const cpfLimpo = novoCliCpf.replace(/\\D/g, '');
        if (cpfLimpo.length !== 11) {
          alert('O CPF é obrigatório e deve conter exatamente 11 dígitos de Pessoa Física.');
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
              email: novoCliEmail.trim() || (novoCliNome.trim().toLowerCase().replace(/\\s+/g, '.') + '@cliente.venus.com'),
              telefone: novoCliTel.trim()
            })
          });

          const data = await res.json();
          if (res.ok && data.sucesso) {
            avisar('Cliente ' + data.cliente.nome + ' cadastrado(a) com sucesso!');
            setClienteSelecionado(data.cliente);
            setNovoCliNome('');
            setNovoCliCpf('');
            setNovoCliEmail('');
            setNovoCliTel('');
            setModalNovoClienteAberto(false);
            carregarDados();
          } else {
            alert(data.erro || 'Erro ao cadastrar cliente.');
          }
        } catch(e) {
          alert('Erro ao conectar com o servidor.');
        } finally {
          setSalvandoCliente(false);
        }
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
            const bCpf = buscaCliente.toLowerCase().replace(/\\D/g, '');
            const bTexto = buscaCliente.toLowerCase().trim();
            const matchNome = (c.nome || c.nome_completo || '').toLowerCase().includes(bTexto);
            const matchEmail = (c.email || '').toLowerCase().includes(bTexto);
            const matchCpf = bCpf.length > 0 && (c.cpf || '').replace(/\\D/g, '').includes(bCpf);
            return matchNome || matchEmail || matchCpf;
          })
        : [];

      return (
        <div className="h-screen w-screen flex flex-col bg-[#03060E] text-[#EAE6DF] overflow-hidden">
          
          {/* TOPO: BARRA DE OPERAÇÃO PROFISSIONAL */}
          <header className="bg-celestial-900 border-b border-ouro/30 px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2 shadow-lg shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-full border border-ouro/60 bg-celestial-950 p-0.5 flex items-center justify-center shadow-md shrink-0">
                <img src="/logo.jpg" alt="Logo" className="w-full h-full object-cover rounded-full" />
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
                <p className="text-[10px] sm:text-[11px] text-ouro/80 truncate">
                  Operadora: <strong className="text-ouro">{operador.nome}</strong> • #CAIXA-01
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
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

          {/* CORPO DO PDV: 3 COLUNAS PROFISSIONAIS (LADO A LADO >= 850px) */}
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
                      placeholder="🔍 Buscar produto por nome ou código..."
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
                              ) : estoqueNum === 1 ? (
                                <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-950/90 text-amber-300 border border-amber-400 animate-pulse">
                                  ⚡ 1 un
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
                        const cpfLimpo = (clienteSelecionado.cpf || '').replace(/\\D/g, '');
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
                                    setNovoCliNome(buscaCliente);
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
                          id={'btn-fp-' + fp.id.replace(/\\s+/g, '')}
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
                                {new Date(p.criado_em || p.data_hora).toLocaleString('pt-BR')}
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
                    <div className="flex justify-between"><span className="font-bold">DATA / HORA:</span><span>{new Date(cupomEmitido.data_hora).toLocaleString('pt-BR')}</span></div>
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
                        {cupomEmitido.chave_acesso_44.replace(/(\d{4})/g, '$1 ').trim()}
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

                <div className="flex items-center gap-2 pt-2 print:hidden">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex-1 py-2.5 rounded-xl bg-stone-900 text-stone-50 hover:bg-stone-800 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md flex items-center justify-center gap-2"
                  >
                    <span>🖨️</span>
                    <span>Imprimir Cupom (80mm)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCupomEmitido(null)}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-ouro text-celestial-950 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md flex items-center justify-center gap-1"
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

  // Servir SPA do PDV
  if (pathname === '/' || pathname === '/index.html' || pathname === '/pdv') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
        const dataVenda = new Date().toISOString();
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
