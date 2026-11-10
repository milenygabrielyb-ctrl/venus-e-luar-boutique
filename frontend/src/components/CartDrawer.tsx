import React, { useState } from 'react';
import { X, Trash2, Plus, Minus, ShoppingBag, ArrowRight, CheckCircle2, Sparkles, MapPin } from 'lucide-react';
import { useCarrinhoStore } from '../store/useCarrinhoStore';
import { useAuthStore } from '../store/useAuthStore';
import { api } from '../services/api';

export const CartDrawer: React.FC = () => {
  const {
    itens,
    isOpen,
    fecharCarrinho,
    adicionarAoCarrinho,
    decrementarQuantidade,
    removerDoCarrinho,
    calcularTotal,
    limparCarrinho,
  } = useCarrinhoStore();

  const usuario = useAuthStore((state) => state.usuario);
  const abrirAuthModal = useAuthStore((state) => state.abrirAuthModal);

  const [finalizando, setFinalizando] = useState(false);
  const [pedidoConcluido, setPedidoConcluido] = useState<any | null>(null);
  const [tipoEntrega, setTipoEntrega] = useState<'retirada' | 'entrega'>('retirada');
  const [endereco, setEndereco] = useState('');

  if (!isOpen) return null;

  const total = calcularTotal();

  const formatarPreco = (valor: number) => {
    return Number(valor).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  const handleCheckout = async () => {
    if (itens.length === 0) return;

    setFinalizando(true);
    try {
      const res = await api.checkout({
        id_usuario: usuario?.id_usuario,
        itens,
        dados_entrega: {
          tipo: tipoEntrega,
          endereco: tipoEntrega === 'entrega' ? endereco || 'Endereço cadastrado' : 'Retirada na Boutique & Bistrô',
        },
        forma_pagamento: 'Pix / Cartão Integrado',
      });

      setPedidoConcluido(res.pedido);
      limparCarrinho();
    } catch (err: any) {
      alert(err.message || 'Erro ao finalizar o pedido');
    } finally {
      setFinalizando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        onClick={fecharCarrinho}
        className="absolute inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col justify-between border-l border-boutique-200">
          
          {/* Topo do Carrinho */}
          <div className="p-6 border-b border-boutique-200 flex items-center justify-between bg-boutique-50/70">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-boutique-900 text-white rounded-xl">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-serif text-lg font-bold text-boutique-900">
                  Sua Sacola
                </h2>
                <span className="text-[11px] text-boutique-600 block">
                  {itens.length} {itens.length === 1 ? 'linha de item' : 'linhas de itens'} unificados
                </span>
              </div>
            </div>

            <button
              onClick={fecharCarrinho}
              className="p-2 rounded-full hover:bg-boutique-200 text-boutique-700 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Conteúdo: Lista ou Sucesso */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {pedidoConcluido ? (
              <div className="py-12 text-center space-y-4">
                <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <CheckCircle2 className="w-9 h-9" />
                </div>
                <h3 className="font-serif text-2xl font-bold text-boutique-900">
                  Pedido Confirmado!
                </h3>
                <p className="text-xs text-boutique-600 max-w-xs mx-auto leading-relaxed">
                  Seu pedido <strong className="text-boutique-900">#{pedidoConcluido.id_pedido}</strong> no valor de <strong className="text-terracotta">{formatarPreco(pedidoConcluido.total)}</strong> foi processado com sucesso unificando moda, pet e cafeteria!
                </p>
                <button
                  onClick={() => {
                    setPedidoConcluido(null);
                    fecharCarrinho();
                  }}
                  className="px-6 py-2.5 rounded-xl bg-boutique-900 text-white text-xs font-semibold hover:bg-terracotta transition-colors shadow"
                >
                  Continuar Comprando
                </button>
              </div>
            ) : itens.length === 0 ? (
              <div className="py-16 text-center space-y-3">
                <div className="w-16 h-16 bg-boutique-100 text-boutique-400 rounded-full flex items-center justify-center mx-auto">
                  <ShoppingBag className="w-8 h-8" />
                </div>
                <h3 className="font-serif text-lg font-bold text-boutique-800">
                  Sua sacola está vazia
                </h3>
                <p className="text-xs text-boutique-500 max-w-xs mx-auto">
                  Navegue pela boutique e adicione vestidos, camas pet ou cappuccinos artesanais.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {itens.map((item) => {
                  const attrs = item.atributosSelecionados || item.atributos || {};
                  return (
                    <div
                      key={item.id_produto}
                      className="p-3.5 rounded-2xl border border-boutique-200/80 bg-white hover:border-boutique-300 transition-all flex gap-3 items-center shadow-xs"
                    >
                      {/* Foto */}
                      <img
                        src={item.imagem_url}
                        alt={item.nome_item}
                        className="w-16 h-16 rounded-xl object-cover bg-boutique-100 flex-shrink-0"
                      />

                      {/* Dados */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-terracotta">
                            {item.categoria}
                          </span>
                          <button
                            onClick={() => removerDoCarrinho(item.id_produto)}
                            className="text-stone-400 hover:text-rose-600 transition-colors p-1"
                            title="Remover"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <h4 className="text-xs font-bold text-boutique-900 truncate">
                          {item.nome_item}
                        </h4>

                        {/* Atributo selecionado */}
                        <div className="text-[10px] text-boutique-500 truncate mt-0.5">
                          {attrs.tamanho_escolhido && `Tam: ${attrs.tamanho_escolhido} • `}
                          {attrs.leite_escolhido && `Leite: ${attrs.leite_escolhido} • `}
                          {attrs.tecido && `${attrs.tecido}`}
                        </div>

                        {/* Preço e Quantidade */}
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs font-bold text-boutique-900 font-serif">
                            {formatarPreco(item.preco * item.quantidade)}
                          </span>

                          <div className="flex items-center gap-1.5 bg-boutique-100 rounded-lg p-0.5 border border-boutique-200">
                            <button
                              onClick={() => decrementarQuantidade(item.id_produto)}
                              className="w-5 h-5 flex items-center justify-center rounded bg-white text-boutique-800 hover:bg-boutique-200 text-xs shadow-xs"
                            >
                              <Minus className="w-2.5 h-2.5" />
                            </button>
                            <span className="text-xs font-bold px-1 text-boutique-900">
                              {item.quantidade}
                            </span>
                            <button
                              onClick={() => adicionarAoCarrinho(item)}
                              className="w-5 h-5 flex items-center justify-center rounded bg-white text-boutique-800 hover:bg-boutique-200 text-xs shadow-xs"
                            >
                              <Plus className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Opções de Entrega */}
                <div className="p-3.5 rounded-2xl bg-boutique-50 border border-boutique-200 space-y-2 mt-4">
                  <span className="text-[11px] font-bold text-boutique-800 uppercase tracking-wide block">
                    Modo de Entrega / Retirada
                  </span>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTipoEntrega('retirada')}
                      className={`p-2 rounded-xl text-xs font-semibold text-center border transition-all ${
                        tipoEntrega === 'retirada'
                          ? 'bg-boutique-900 text-white border-boutique-900 shadow-xs'
                          : 'bg-white text-boutique-700 border-boutique-200 hover:bg-boutique-100'
                      }`}
                    >
                      Retirar na Loja (Grátis)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTipoEntrega('entrega')}
                      className={`p-2 rounded-xl text-xs font-semibold text-center border transition-all ${
                        tipoEntrega === 'entrega'
                          ? 'bg-boutique-900 text-white border-boutique-900 shadow-xs'
                          : 'bg-white text-boutique-700 border-boutique-200 hover:bg-boutique-100'
                      }`}
                    >
                      Entrega Expressa
                    </button>
                  </div>

                  {tipoEntrega === 'entrega' && (
                    <input
                      type="text"
                      placeholder="Seu endereço de entrega..."
                      value={endereco}
                      onChange={(e) => setEndereco(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-boutique-300 text-xs bg-white outline-none focus:ring-1 focus:ring-boutique-500"
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Rodapé e Checkout */}
          {!pedidoConcluido && itens.length > 0 && (
            <div className="p-6 bg-boutique-50 border-t border-boutique-200 space-y-3">
              <div className="space-y-1.5 text-xs text-boutique-700">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{formatarPreco(total)}</span>
                </div>
                <div className="flex justify-between text-emerald-700 font-medium">
                  <span>Entrega / Retirada</span>
                  <span>{tipoEntrega === 'retirada' ? 'Grátis' : 'R$ 15,00'}</span>
                </div>
                <div className="flex justify-between text-base font-bold text-boutique-900 font-serif pt-2 border-t border-boutique-200">
                  <span>Total Final</span>
                  <span>{formatarPreco(total + (tipoEntrega === 'entrega' ? 15 : 0))}</span>
                </div>
              </div>

              <button
                onClick={handleCheckout}
                disabled={finalizando}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-boutique-900 text-white font-bold text-xs tracking-wider uppercase hover:bg-terracotta active:scale-98 transition-all shadow-md"
              >
                <span>{finalizando ? 'Processando Pedido...' : 'Finalizar Pedido Unificado'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
