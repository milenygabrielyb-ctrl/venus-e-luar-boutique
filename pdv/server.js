/**
 * VÊNUS & LUAR BOUTIQUE - SISTEMA INDEPENDENTE DE PDV (FRENTE DE CAIXA PROFISSIONAL)
 * 
 * - Porta Dedicada: 3001 (http://localhost:3001)
 * - Função: Sistema profissional e independente para frente de caixa, recepção de comandas do bistrô,
 *           vendas físicas de balcão, cálculo de troco, controle de estoque físico e emissão de cupom 80mm.
 * - Integração Bidirecional com a Boutique (http://localhost:3000):
 *   1. Receptor de solicitações de clientes feitas no site da Boutique (pedidos de bistrô de mesas/balcão)
 *   2. Emissor de atualizações para a Boutique (liquidação de comandas, baixa de estoque físico em Moda e Pet)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3001;
const BOUTIQUE_URL = process.env.BOUTIQUE_URL || 'http://localhost:3000';

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

function formatarCpf(cpf) {
  const d = (cpf || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return d.slice(0, 3) + '.' + d.slice(3);
  if (d.length <= 9) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
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
        width: 360px !important;
        min-width: 330px !important;
        max-width: 390px !important;
        flex-shrink: 0 !important;
        height: 100% !important;
        min-height: 0 !important;
      }
    }

    /* Telas < 850px (Tablets e Celulares): Visualização por Abas Elegantes */
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

    function PdvApp() {
      // Operador Atual (Padrão: Mileny ou parceira cadastrada)
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

      // Estados de Dados do PDV
      const [produtos, setProdutos] = useState([]);
      const [comandas, setComandas] = useState([]);
      const [colaboradores, setColaboradores] = useState([]);
      const [carregando, setCarregando] = useState(true);
      const [statusConexao, setStatusConexao] = useState('online');

      // Venda Ativa no Caixa
      const [comandaSelecionada, setComandaSelecionada] = useState(null);
      const [itensCaixa, setItensCaixa] = useState([]);
      const [clienteNome, setClienteNome] = useState('');
      const [clienteCpf, setClienteCpf] = useState('');
      const [localConsumo, setLocalConsumo] = useState('');
      const [desconto, setDesconto] = useState(0);
      const [formaPagamento, setFormaPagamento] = useState('Dinheiro');
      const [valorRecebido, setValorRecebido] = useState('');
      const [finalizando, setFinalizando] = useState(false);
      const [cupomEmitido, setCupomEmitido] = useState(null);

      // Filtros do Catálogo e Visualização Responsiva
      const [busca, setBusca] = useState('');
      const [abaCat, setAbaCat] = useState('Todos');
      const [abaAtivaMobile, setAbaAtivaMobile] = useState('catalogo');

      // Modal de Permissionamento & Equipe
      const [modalEquipeAberto, setModalEquipeAberto] = useState(false);
      const [formNovoColab, setFormNovoColab] = useState(false);
      const [novoNome, setNovoNome] = useState('');
      const [novoCargo, setNovoCargo] = useState('Vendedor');
      const [novoEmail, setNovoEmail] = useState('');
      const [novoSenha, setNovoSenha] = useState('');
      const [novoPerms, setNovoPerms] = useState({ pdv: true, estoque: false, produtos: false, faturamento: false, adocao: false });

      // Notificação
      const [notificacao, setNotificacao] = useState(null);
      const avisar = (msg) => {
        setNotificacao(msg);
        setTimeout(() => setNotificacao(null), 3500);
      };

      // Carregar dados iniciais
      const carregarDados = async () => {
        try {
          const [resP, resC, resE] = await Promise.all([
            fetch('/api/pdv/produtos'),
            fetch('/api/pdv/comandas'),
            fetch('/api/pdv/equipe')
          ]);
          if (resP.ok) setProdutos(await resP.json());
          if (resC.ok) setComandas(await resC.json());
          if (resE.ok) {
            const data = await resE.json();
            setColaboradores(data.colaboradores || []);
          }
          setStatusConexao('online');
        } catch (e) {
          setStatusConexao('offline');
        } finally {
          setCarregando(false);
        }
      };

      useEffect(() => {
        carregarDados();
        const interval = setInterval(async () => {
          try {
            const res = await fetch('/api/pdv/comandas');
            if (res.ok) {
              const data = await res.json();
              setComandas(data);
              setStatusConexao('online');
            }
          } catch(e) {
            setStatusConexao('offline');
          }
        }, 3000); // Polling a cada 3s para receber pedidos do bistrô em tempo real
        return () => clearInterval(interval);
      }, []);

      // Atalho de Teclado F2 para Finalizar Venda e Esc para Modais
      useEffect(() => {
        const handleKeys = (e) => {
          if (e.key === 'F2') {
            e.preventDefault();
            const btn = document.getElementById('btn-finalizar-venda');
            if (btn && !btn.disabled) btn.click();
          } else if (e.key === 'Escape') {
            setCupomEmitido(null);
            setModalEquipeAberto(false);
          }
        };
        window.addEventListener('keydown', handleKeys);
        return () => window.removeEventListener('keydown', handleKeys);
      }, []);

      // Seleção rápida de operadora em 1 clique
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

      // Adicionar produto do catálogo ao caixa
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
        avisar('+1 ' + prod.nome_item + ' adicionado ao caixa!');
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
        setClienteNome(cmd.nome_cliente || '');
        setClienteCpf(cmd.cpf_cliente !== 'Pagamento no Caixa' ? cmd.cpf_cliente : '');
        setLocalConsumo(cmd.local_consumo || '');
        setDesconto(0);
        setValorRecebido('');
        setAbaAtivaMobile('caixa');
        avisar('Comanda #' + (cmd.numero_comanda || cmd.id_pedido) + ' carregada no caixa!');
      };

      // Limpar Venda Atual
      const limparVenda = () => {
        setComandaSelecionada(null);
        setItensCaixa([]);
        setClienteNome('');
        setClienteCpf('');
        setLocalConsumo('');
        setDesconto(0);
        setValorRecebido('');
      };

      // Totais e Troco
      const subtotal = itensCaixa.reduce((acc, it) => acc + (Number(it.preco) * Number(it.quantidade)), 0);
      const totalFinal = Math.max(0, subtotal - (Number(desconto) || 0));
      const troco = formaPagamento === 'Dinheiro' && Number(valorRecebido) > totalFinal ? Number(valorRecebido) - totalFinal : 0;

      // Finalizar Venda e Emitir Cupom
      const finalizarVenda = async () => {
        if (itensCaixa.length === 0) {
          alert('Adicione itens ou selecione uma comanda para liquidar a venda.');
          return;
        }

        if (formaPagamento === 'Dinheiro') {
          const vr = Number(valorRecebido) || 0;
          if (vr < totalFinal) {
            alert('O valor em dinheiro informado (R$ ' + vr.toFixed(2) + ') é menor que o total a pagar (R$ ' + totalFinal.toFixed(2) + ').');
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
            nome_cliente: clienteNome.trim() || 'Consumidor Final',
            cpf_cliente: clienteCpf.trim(),
            local_consumo: localConsumo || (comandaSelecionada ? comandaSelecionada.local_consumo : 'Venda Balcão / Loja Física'),
            nome_operador: operador.nome
          };

          const res = await fetch('/api/pdv/finalizar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const data = await res.json();
          if (res.ok && data.sucesso) {
            setCupomEmitido(data.cupom);
            limparVenda();
            carregarDados();
            avisar('Venda finalizada com sucesso! Cupom emitido.');
          } else {
            alert(data.erro || 'Falha ao processar venda.');
          }
        } catch (e) {
          alert('Erro de conexão ao finalizar venda no PDV.');
        } finally {
          setFinalizando(false);
        }
      };

      // Salvar Novo Colaborador
      const cadastrarColaborador = async (e) => {
        e.preventDefault();
        if (!novoNome || !novoEmail || !novoSenha) {
          alert('Preencha os campos obrigatórios.');
          return;
        }
        try {
          const res = await fetch('/api/pdv/equipe/cadastrar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nome: novoNome,
              cargo: novoCargo,
              email: novoEmail,
              senha: novoSenha,
              permissoes: novoPerms
            })
          });
          const data = await res.json();
          if (res.ok && data.sucesso) {
            avisar('Colaborador(a) ' + novoNome + ' cadastrado(a)!');
            setNovoNome('');
            setNovoEmail('');
            setNovoSenha('');
            setFormNovoColab(false);
            carregarDados();
          } else {
            alert(data.erro || 'Falha ao cadastrar.');
          }
        } catch(e) {
          alert('Erro de conexão.');
        }
      };

      const formatBRL = (val) => Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

      return (
        <div className="h-screen w-screen flex flex-col bg-[#03060E] text-[#EAE6DF] overflow-hidden">
          
          {/* TOPO: BARRA DE OPERAÇÃO PROFISSIONAL RESPONSIVA */}
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
                    {statusConexao === 'online' ? '🟢 Online' : '🔴 Offline'}
                  </span>
                </div>
                <p className="text-[10px] sm:text-[11px] text-ouro/80 truncate">
                  Operadora: <strong className="text-ouro">{operador.nome}</strong> • #CAIXA-01
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                type="button"
                id="btn-abrir-equipe"
                onClick={() => setModalEquipeAberto(true)}
                className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-celestial-950 border border-purple-400/50 hover:bg-purple-950 text-purple-200 text-[11px] sm:text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-sm whitespace-nowrap"
              >
                <span>👥</span>
                <span className="hidden sm:inline">Operadores &amp;</span> Permissões
              </button>

              <button
                type="button"
                onClick={limparVenda}
                className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-stone-800/80 border border-stone-600 hover:border-rose-500 text-stone-300 hover:text-rose-400 text-[11px] sm:text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap"
              >
                <span>🧹</span>
                <span>Limpar</span>
              </button>

              <a
                href={BOUTIQUE_URL}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-celestial-950 border border-ouro/40 text-ouro hover:bg-ouro/15 text-[11px] sm:text-xs font-bold transition-all cursor-pointer flex items-center gap-1 whitespace-nowrap"
                title="Abrir a Loja Virtual da Boutique para o Cliente"
              >
                <span>🌐</span>
                <span className="hidden sm:inline">Ver Site</span>
              </a>
            </div>
          </header>

          {/* BARRA DE NAVEGAÇÃO DE ABAS PARA TELAS MENORES QUE 850px */}
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
              
              {/* COLUNA 1: COMANDAS DIGITAIS DO BISTRÔ */}
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

              {/* COLUNA 2: CATÁLOGO PROFISSIONAL DE PRODUTOS FÍSICOS */}
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
                                  ☕ Fresco
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

              {/* COLUNA 3: CUPOM ATIVO & FINALIZAÇÃO NO CAIXA */}
              <div className={"pdv-col-caixa bg-celestial-900/95 border-2 border-ouro/50 rounded-2xl p-2.5 sm:p-3 flex flex-col justify-between overflow-hidden shadow-2xl " + (abaAtivaMobile !== 'caixa' ? 'hidden' : 'flex')}>
                {/* Header do Cupom */}
                <div className="space-y-1.5 pb-2 border-b border-ouro/30 shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">🧾</span>
                      <h2 className="font-serif text-sm font-bold gold-gradient-text tracking-wide">
                        Venda Ativa
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

                  <div className="grid grid-cols-2 gap-2 text-left">
                    <div>
                      <label className="text-[9px] uppercase font-bold text-ouro/70 block">Cliente</label>
                      <input
                        type="text"
                        id="input-cliente-nome"
                        value={clienteNome}
                        onChange={e => setClienteNome(e.target.value)}
                        placeholder="Consumidor Final"
                        className="w-full bg-celestial-950 border border-ouro/25 rounded-lg px-2 py-1 text-[11px] text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase font-bold text-ouro/70 block">CPF na Nota</label>
                      <input
                        type="text"
                        id="input-cliente-cpf"
                        value={clienteCpf}
                        onChange={e => setClienteCpf(formatarCpf(e.target.value))}
                        placeholder="000.000.000-00"
                        maxLength={14}
                        className="w-full bg-celestial-950 border border-ouro/25 rounded-lg px-2 py-1 text-[11px] text-luar-100 placeholder-luar-300/40 focus:outline-none focus:border-ouro font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Lista de Itens do Cupom */}
                <div className="flex-1 overflow-y-auto space-y-1 my-1.5 pr-1 min-h-[90px]">
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

                {/* Totais & Formas de Pagamento (Pinned no Rodapé) */}
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
                      <span className="text-xs uppercase text-ouro/90">Total a Pagar:</span>
                      <span className="text-base text-ouro font-serif" id="mostrador-total-final">
                        {formatBRL(totalFinal)}
                      </span>
                    </div>
                  </div>

                  {/* Seletor de Pagamento */}
                  <div className="grid grid-cols-4 gap-1 pt-0.5">
                    {[
                      { id: 'Dinheiro', label: 'Dinheiro', icone: '💵' },
                      { id: 'Cartão de Crédito', label: 'Crédito', icone: '💳' },
                      { id: 'Cartão de Débito', label: 'Débito', icone: '💳' },
                      { id: 'PIX Instantâneo', label: 'PIX', icone: '📱' }
                    ].map(fp => (
                      <button
                        key={fp.id}
                        type="button"
                        id={'btn-fp-' + fp.id.replace(/\s+/g, '')}
                        onClick={() => setFormaPagamento(fp.id)}
                        className={"py-1 px-1 rounded-lg text-[9.5px] font-bold flex flex-col items-center justify-center transition-all cursor-pointer " + (formaPagamento === fp.id ? 'bg-ouro text-celestial-950 ring-2 ring-ouro-light shadow-md' : 'bg-celestial-900 border border-ouro/30 text-luar-200 hover:text-ouro')}
                      >
                        <span className="text-xs">{fp.icone}</span>
                        <span>{fp.label}</span>
                      </button>
                    ))}
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

                  {/* Botão de Finalização da Venda */}
                  <button
                    type="button"
                    id="btn-finalizar-venda"
                    onClick={finalizarVenda}
                    disabled={finalizando || itensCaixa.length === 0}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-ouro to-amber-500 hover:brightness-110 text-celestial-950 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-98"
                  >
                    {finalizando ? (
                      <span>⏳ Liquidando Venda no Caixa...</span>
                    ) : (
                      <>
                        <span>✨ Finalizar Venda &amp; Emitir Cupom</span>
                        <span>(F2)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

            </div>
          </div>

          {/* ==================================================================== */}
          {/* MODAL DO CUPOM TÉRMICO NÃO FISCAL (PADRÃO 80MM) */}
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
                    <p className="text-[10px] text-stone-600 leading-tight">DOCUMENTO AUXILIAR DE VENDA • CUPOM NÃO FISCAL</p>
                    <p className="text-[9px] text-stone-500 leading-tight">CNPJ: 45.123.890/0001-99 • IE: 112.345.678.910</p>
                    <p className="text-[9px] text-stone-500 leading-tight">Alameda dos Jardins, 1020 • Jardins, São Paulo - SP</p>
                    <div className="text-[10px] text-stone-400 select-none py-0.5">------------------------------------------------</div>
                  </div>

                  <div className="space-y-0.5 text-[10.5px]">
                    <div className="flex justify-between"><span className="font-bold">CUPOM Nº:</span><span>{cupomEmitido.numero_cupom}</span></div>
                    {cupomEmitido.numero_comanda && (
                      <div className="flex justify-between"><span className="font-bold">COMANDA ORIGEM:</span><span>{cupomEmitido.numero_comanda}</span></div>
                    )}
                    <div className="flex justify-between"><span className="font-bold">DATA / HORA:</span><span>{new Date(cupomEmitido.data_hora).toLocaleString('pt-BR')}</span></div>
                    <div className="flex justify-between"><span className="font-bold">OPERADOR:</span><span>{cupomEmitido.operador}</span></div>
                    <div className="flex justify-between"><span className="font-bold">CLIENTE:</span><span>{cupomEmitido.cliente}</span></div>
                    <div className="flex justify-between"><span className="font-bold">CPF:</span><span>{cupomEmitido.cpf || 'Não informado'}</span></div>
                    <div className="flex justify-between"><span className="font-bold">LOCAL:</span><span>{cupomEmitido.local}</span></div>
                    <div className="text-[10px] text-stone-400 select-none py-0.5 text-center">------------------------------------------------</div>
                  </div>

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
                      <span>TOTAL LIQUIDADO:</span><span>R$ {cupomEmitido.total.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between pt-0.5">
                      <span>FORMA DE PGTO:</span><span className="font-bold uppercase">{cupomEmitido.forma_pagamento}</span>
                    </div>
                    {cupomEmitido.forma_pagamento.includes('Dinheiro') && (
                      <>
                        <div className="flex justify-between"><span>VALOR RECEBIDO:</span><span>R$ {cupomEmitido.valor_recebido.toFixed(2)}</span></div>
                        <div className="flex justify-between font-bold text-emerald-800"><span>TROCO ENTREGUE:</span><span>R$ {cupomEmitido.troco.toFixed(2)}</span></div>
                      </>
                    )}
                    <div className="text-[10px] text-stone-400 select-none py-0.5 text-center">------------------------------------------------</div>
                  </div>

                  <div className="text-center space-y-1 text-[9px] text-stone-500">
                    <p className="font-bold text-stone-700">CHAVE DE AUTENTICAÇÃO DIGITAL:</p>
                    <p className="font-mono break-all text-[8px] bg-stone-200/70 p-1 rounded">
                      {cupomEmitido.chave_autenticacao}
                    </p>
                    <p className="pt-1">Agradecemos a sua preferência!</p>
                    <p>Volte sempre à Vênus e Luar Boutique.</p>
                  </div>
                </div>

                <div className="flex gap-2 pt-2 border-t border-stone-300 print:hidden font-sans">
                  <button type="button" id="btn-imprimir-cupom" onClick={() => window.print()} className="flex-1 py-2.5 rounded-xl bg-stone-900 hover:bg-black text-white text-xs font-bold uppercase transition-all cursor-pointer shadow-md flex items-center justify-center gap-1.5">
                    <span>🖨️</span>
                    <span>Imprimir 80mm</span>
                  </button>
                  <button type="button" id="btn-fechar-cupom" onClick={() => setCupomEmitido(null)} className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-ouro text-celestial-950 text-xs font-bold uppercase tracking-wider hover:brightness-110 transition-all cursor-pointer shadow-md">
                    ✨ Nova Venda
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL DE PERMISSIONAMENTO & GESTÃO DE EQUIPE NO PDV */}
          {/* ==================================================================== */}
          {modalEquipeAberto && (
            <div id="modal-equipe" className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/90 backdrop-blur-md animate-fadeIn">
              <div className="relative w-full max-w-2xl bg-celestial-900 border-2 border-ouro/60 rounded-3xl p-5 sm:p-7 shadow-2xl max-h-[92vh] overflow-y-auto space-y-4">
                <button type="button" onClick={() => setModalEquipeAberto(false)} className="absolute top-4 right-4 text-ouro hover:text-white text-2xl font-bold cursor-pointer">×</button>

                <div className="text-center space-y-1.5 pb-3 border-b border-ouro/25">
                  <div className="w-12 h-12 mx-auto rounded-full bg-celestial-950 border border-ouro/60 p-1 flex items-center justify-center shadow-md">
                    <span className="text-2xl">🔐</span>
                  </div>
                  <h3 className="font-serif text-xl sm:text-2xl font-bold gold-gradient-text tracking-wide">
                    Modal de Permissionamento &amp; Equipe
                  </h3>
                  <p className="text-xs text-luar-300">
                    Controle de Acessos para Administradoras, Vendedores, Caixas e Baristas da Boutique
                  </p>
                  
                  <div className="p-3 rounded-2xl bg-purple-950/40 border border-purple-500/40 text-purple-200 text-xs text-left leading-relaxed mt-2 flex items-start gap-2">
                    <span className="text-base shrink-0">💡</span>
                    <div>
                      <strong className="text-purple-300 font-bold block">Operação Atual da Boutique:</strong>
                      Atualmente operado por você e sua parceira. Selecione a operadora ativa abaixo com <strong>1 clique</strong> para assumir o caixa, ou cadastre novos colaboradores conforme a equipe expandir.
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-ouro uppercase tracking-wider flex items-center gap-1.5">
                      <span>👥</span>
                      <span>Colaboradores Cadastrados ({colaboradores.length})</span>
                    </h4>
                    <button
                      type="button"
                      id="btn-toggle-form-colab"
                      onClick={() => setFormNovoColab(!formNovoColab)}
                      className="px-3 py-1 rounded-xl bg-gradient-to-r from-ouro to-amber-500 text-celestial-950 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-sm"
                    >
                      {formNovoColab ? '✕ Fechar Formulário' : '✦ Cadastrar Novo Colaborador'}
                    </button>
                  </div>

                  {formNovoColab && (
                    <form onSubmit={cadastrarColaborador} className="p-4 rounded-2xl bg-celestial-950 border-2 border-ouro/50 space-y-3 animate-fadeIn">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                        <div>
                          <label className="text-[10px] uppercase font-bold text-ouro/80 block mb-1">Nome Completo</label>
                          <input type="text" required value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Ex: Beatriz Lima" className="w-full bg-celestial-900 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 focus:outline-none focus:border-ouro" />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-ouro/80 block mb-1">Cargo / Função</label>
                          <select value={novoCargo} onChange={e => setNovoCargo(e.target.value)} className="w-full bg-celestial-900 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 focus:outline-none focus:border-ouro cursor-pointer">
                            <option value="Administrador">👑 Administrador (Acesso Pleno)</option>
                            <option value="Gerente">💼 Gerente (PDV e Estoque)</option>
                            <option value="Vendedor">🛍️ Vendedor (PDV e Catálogo)</option>
                            <option value="Operador de Caixa">🖥️ Operador de Caixa (PDV e Cupons)</option>
                            <option value="Barista">☕ Barista (Comandas Bistrô)</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-ouro/80 block mb-1">E-mail Profissional</label>
                          <input type="email" required value={novoEmail} onChange={e => setNovoEmail(e.target.value)} placeholder="colaborador@butique.com" className="w-full bg-celestial-900 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 focus:outline-none focus:border-ouro" />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase font-bold text-ouro/80 block mb-1">Senha (Mín. 6 caracteres)</label>
                          <input type="password" required value={novoSenha} onChange={e => setNovoSenha(e.target.value)} placeholder="••••••••••••" className="w-full bg-celestial-900 border border-ouro/30 rounded-xl px-3 py-2 text-xs text-luar-100 focus:outline-none focus:border-ouro" />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={() => setFormNovoColab(false)} className="px-3 py-2 rounded-xl bg-stone-800 text-stone-300 text-xs font-bold uppercase">Cancelar</button>
                        <button type="submit" id="btn-submit-novo-colab" className="px-4 py-2 rounded-xl bg-gradient-to-r from-ouro to-amber-500 text-celestial-950 font-bold text-xs uppercase tracking-wider">✦ Cadastrar Colaborador</button>
                      </div>
                    </form>
                  )}

                  <div className="space-y-2.5 max-h-[46vh] overflow-y-auto pr-1">
                    {colaboradores.map(c => {
                      const ehAtivo = operador.id_usuario === c.id_usuario || operador.nome === c.nome_completo;
                      return (
                        <div key={c.id_usuario} className={"p-3.5 rounded-2xl border transition-all text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 " + (ehAtivo ? 'bg-amber-950/40 border-amber-400 ring-1 ring-amber-400/40' : 'bg-celestial-950/80 border-ouro/25 hover:border-ouro/60')}>
                          <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-celestial-900 to-ouro/30 border border-ouro/40 flex items-center justify-center font-serif text-sm font-bold text-ouro shrink-0">
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
                              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-ouro hover:from-ouro hover:to-amber-500 text-celestial-950 text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-md flex items-center justify-center gap-1.5"
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
      const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="100%" height="100%">
        <defs>
          <radialGradient id="skyGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#141c2e"/>
            <stop offset="100%" stop-color="#070b14"/>
          </radialGradient>
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fdf4dc"/>
            <stop offset="50%" stop-color="#d4af37"/>
            <stop offset="100%" stop-color="#aa820a"/>
          </linearGradient>
        </defs>
        <rect width="600" height="600" fill="url(#skyGrad)"/>
        <circle cx="300" cy="300" r="255" fill="none" stroke="url(#goldGrad)" stroke-width="2" stroke-opacity="0.4"/>
        <circle cx="300" cy="300" r="240" fill="none" stroke="url(#goldGrad)" stroke-width="1.5" stroke-dasharray="4 6"/>
        <path d="M300 130 C 410 130, 480 210, 480 300 C 480 390, 410 470, 300 470 C 375 410, 375 190, 300 130 Z" fill="url(#goldGrad)" opacity="0.95"/>
        <polygon points="300,195 315,255 375,270 315,285 300,345 285,285 225,270 285,255" fill="#fef3c7"/>
        <circle cx="210" cy="180" r="3" fill="#fef3c7"/>
        <circle cx="410" cy="190" r="3" fill="#fef3c7"/>
        <circle cx="390" cy="420" r="3.5" fill="#fef3c7"/>
        <circle cx="210" cy="410" r="2.5" fill="#fef3c7"/>
        <text x="300" y="445" font-family="'Playfair Display', Georgia, serif" font-size="30" fill="url(#goldGrad)" font-weight="bold" text-anchor="middle" letter-spacing="4">VÊNUS E LUAR</text>
        <text x="300" y="475" font-family="'Cinzel', 'Trajan Pro', sans-serif" font-size="14" fill="#fef3c7" font-weight="600" letter-spacing="10" text-anchor="middle">BOUTIQUE</text>
      </svg>`;
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
      res.end(fallbackSvg);
      return;
    }
  }

  // GET /api/pdv/produtos (Catálogo da Boutique sincronizado)
  if (pathname === '/api/pdv/produtos' && req.method === 'GET') {
    const prods = carregarJson(PRODUCTS_FILE, []);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(prods));
    return;
  }

  // GET /api/pdv/comandas (Comandas digitais do bistrô da Boutique)
  if (pathname === '/api/pdv/comandas' && req.method === 'GET') {
    const pedidos = carregarJson(ORDERS_FILE, []);
    const comandasAbertas = pedidos.filter(p => {
      const st = (p.status || '').toLowerCase();
      const ehBistro = p.tipo_pedido === 'Bistrô' || st.includes('bistrô') || st.includes('pendente no caixa');
      const jaPago = st.includes('pago no caixa') || st.includes('pago no pdv') || st.includes('cancelado');
      return ehBistro && !jaPago;
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(comandasAbertas));
    return;
  }

  // GET /api/pdv/equipe (Equipe e colaboradores cadastrados)
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

  // POST /api/pdv/equipe/cadastrar (Cadastrar novo colaborador no sistema)
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

  // POST /api/pdv/finalizar (Liquidar comanda ou registrar venda física de balcão)
  if (pathname === '/api/pdv/finalizar' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const dados = JSON.parse(body);
        const {
          id_pedido,
          itens,
          desconto = 0,
          forma_pagamento = 'Dinheiro Físico',
          valor_recebido = 0,
          troco = 0,
          nome_cliente,
          cpf_cliente,
          local_consumo,
          nome_operador
        } = dados;

        if (!itens || !Array.isArray(itens) || itens.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Nenhum item na venda.' }));
          return;
        }

        // 1. Dar baixa no estoque físico da Boutique (apenas Moda e Pet, Cafeteria é artesanal sem estoque)
        const produtos = carregarJson(PRODUCTS_FILE, []);
        for (const it of itens) {
          const prod = produtos.find(p => p.id_produto === Number(it.id_produto));
          if (prod && prod.categoria !== 'Cafeteria') {
            const estoqueAtual = prod.estoque !== undefined ? Number(prod.estoque) : 10;
            prod.estoque = Math.max(0, estoqueAtual - Number(it.quantidade));
          }
        }
        salvarJson(PRODUCTS_FILE, produtos);

        const subtotal = itens.reduce((acc, it) => acc + (Number(it.preco) * Number(it.quantidade)), 0);
        const descValor = Number(desconto) || 0;
        const totalFinal = Math.max(0, subtotal - descValor);
        const operadorNome = nome_operador || (dados.operador && (dados.operador.nome_completo || dados.operador.nome)) || 'Mileny Gabriely';
        const dataVenda = new Date().toISOString();
        const pedidos = carregarJson(ORDERS_FILE, []);
        const numeroCupom = 'CUPOM-PDV-' + (1000 + pedidos.length + 1);
        const chaveAutenticacao = crypto.createHash('sha256')
          .update(numeroCupom + ':' + totalFinal + ':' + dataVenda + ':' + operadorNome)
          .digest('hex').toUpperCase();

        let pedidoAtualizado = null;
        const idComandaRef = id_pedido || dados.numero_comanda;

        if (idComandaRef) {
          // Liquidando comanda existente do bistrô enviada pelos clientes na Boutique
          pedidoAtualizado = pedidos.find(p => p.id_pedido === Number(idComandaRef) || p.numero_comanda === idComandaRef || p.numero_fatura === idComandaRef);
          if (pedidoAtualizado) {
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
              pago_em: dataVenda
            };
            pedidoAtualizado.status = 'Pago no Caixa & Entregue';
            pedidoAtualizado.numero_cupom = numeroCupom;
            pedidoAtualizado.chave_autenticacao = chaveAutenticacao;
          }
        }

        if (!pedidoAtualizado) {
          // Nova venda direta física avulsa no PDV
          pedidoAtualizado = {
            id_pedido: 1000 + pedidos.length + 1,
            tipo_pedido: 'PDV',
            numero_comanda: numeroCupom,
            numero_fatura: numeroCupom,
            numero_cupom: numeroCupom,
            chave_autenticacao: chaveAutenticacao,
            nome_cliente: (nome_cliente || 'Consumidor Final').trim(),
            cpf_cliente: cpf_cliente ? formatarCpf(cpf_cliente.replace(/\D/g, '')) : 'Não informado',
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
              pago_em: dataVenda
            },
            status: 'Pago no PDV',
            criado_em: dataVenda
          };
          pedidos.unshift(pedidoAtualizado);
        }

        salvarJson(ORDERS_FILE, pedidos);

        const cupomPdv = {
          numero_cupom: numeroCupom,
          numero_comanda: pedidoAtualizado.numero_comanda,
          data_hora: dataVenda,
          operador: operadorNome,
          cliente: pedidoAtualizado.nome_cliente,
          cpf: pedidoAtualizado.cpf_cliente,
          local: pedidoAtualizado.local_consumo,
          itens: pedidoAtualizado.itens,
          subtotal: Number(subtotal.toFixed(2)),
          desconto: descValor,
          total: Number(totalFinal.toFixed(2)),
          forma_pagamento: pedidoAtualizado.forma_pagamento,
          valor_recebido: Number(valor_recebido) || totalFinal,
          troco: Number(troco) || 0,
          chave_autenticacao: chaveAutenticacao
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sucesso: true,
          mensagem: 'Venda finalizada com sucesso no PDV Independente!',
          pedido: pedidoAtualizado,
          cupom: cupomPdv
        }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao processar venda no PDV.' }));
      }
    });
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
