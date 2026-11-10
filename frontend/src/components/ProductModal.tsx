import React, { useState } from 'react';
import { X, ShoppingBag, Code2, Check, Sparkles } from 'lucide-react';
import { Produto } from '../types';
import { useCarrinhoStore } from '../store/useCarrinhoStore';

interface ProductModalProps {
  produto: Produto | null;
  onClose: () => void;
}

export const ProductModal: React.FC<ProductModalProps> = ({ produto, onClose }) => {
  const adicionarAoCarrinho = useCarrinhoStore((state) => state.adicionarAoCarrinho);
  const [verJsonBruto, setVerJsonBruto] = useState(false);
  const [opcaoSelecionada, setOpcaoSelecionada] = useState<string>('');

  if (!produto) return null;

  const atributos = produto.atributos || {};

  const formatarPreco = (valor: number) => {
    return Number(valor).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  const handleAdicionar = () => {
    const customAtributos = { ...atributos };
    if (opcaoSelecionada) {
      if (atributos.grades_disponiveis) customAtributos.tamanho_escolhido = opcaoSelecionada;
      if (atributos.opcoes_leite) customAtributos.leite_escolhido = opcaoSelecionada;
    }
    adicionarAoCarrinho(produto, customAtributos);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-boutique-200 overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Botão Fechar */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 rounded-full bg-white/90 text-boutique-700 hover:text-boutique-950 hover:bg-white shadow transition-all"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="overflow-y-auto p-6 sm:p-8 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
            
            {/* Imagem */}
            <div className="aspect-square rounded-2xl overflow-hidden bg-boutique-100 shadow-inner">
              <img
                src={produto.imagem_url || 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=800&q=80'}
                alt={produto.nome_item}
                className="w-full h-full object-cover"
              />
            </div>

            {/* Cabeçalho e Preço */}
            <div className="space-y-3">
              <span className="inline-block text-xs uppercase font-bold tracking-widest text-terracotta bg-boutique-100 px-3 py-1 rounded-full">
                {produto.categoria}
              </span>
              
              <h2 className="font-serif text-2xl font-bold text-boutique-900 leading-snug">
                {produto.nome_item}
              </h2>

              <p className="text-sm text-boutique-600 leading-relaxed">
                {produto.descricao}
              </p>

              <div className="pt-2">
                <span className="text-2xl font-bold font-serif text-boutique-900">
                  {formatarPreco(produto.preco)}
                </span>
                <span className="text-xs text-boutique-500 block mt-0.5">
                  Estoque disponível: {produto.estoque} unidades
                </span>
              </div>
            </div>

          </div>

          {/* Seletor dinâmico baseado no JSONB */}
          {atributos.grades_disponiveis && (
            <div className="space-y-2 border-t border-boutique-100 pt-4">
              <label className="text-xs font-bold text-boutique-800 uppercase tracking-wider block">
                Escolha o Tamanho:
              </label>
              <div className="flex gap-2">
                {atributos.grades_disponiveis.map((tam: string) => (
                  <button
                    key={tam}
                    type="button"
                    onClick={() => setOpcaoSelecionada(tam)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${
                      opcaoSelecionada === tam
                        ? 'bg-boutique-900 text-white border-boutique-900 shadow'
                        : 'bg-boutique-50 text-boutique-700 border-boutique-200 hover:border-boutique-400'
                    }`}
                  >
                    {tam}
                  </button>
                ))}
              </div>
            </div>
          )}

          {atributos.opcoes_leite && (
            <div className="space-y-2 border-t border-boutique-100 pt-4">
              <label className="text-xs font-bold text-boutique-800 uppercase tracking-wider block">
                Escolha o Leite Especial:
              </label>
              <div className="flex flex-wrap gap-2">
                {atributos.opcoes_leite.map((leite: string) => (
                  <button
                    key={leite}
                    type="button"
                    onClick={() => setOpcaoSelecionada(leite)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                      opcaoSelecionada === leite
                        ? 'bg-boutique-900 text-white border-boutique-900 shadow'
                        : 'bg-boutique-50 text-boutique-700 border-boutique-200 hover:border-boutique-400'
                    }`}
                  >
                    {leite}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Atributos Flexíveis JSONB em Grade */}
          <div className="border-t border-boutique-100 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-boutique-800 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-terracotta" />
                <span>Atributos Dinâmicos (Modelagem JSONB)</span>
              </h4>

              <button
                type="button"
                onClick={() => setVerJsonBruto(!verJsonBruto)}
                className="text-xs font-semibold text-boutique-600 hover:text-boutique-900 flex items-center gap-1 underline underline-offset-2"
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>{verJsonBruto ? 'Ocultar JSON' : 'Ver JSONB Bruto'}</span>
              </button>
            </div>

            {verJsonBruto ? (
              <pre className="p-3 bg-stone-900 text-emerald-400 text-xs rounded-xl overflow-x-auto font-mono">
                {JSON.stringify(produto.atributos, null, 2)}
              </pre>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {Object.entries(atributos)
                  .filter(([k]) => k !== 'grades_disponiveis' && k !== 'opcoes_leite')
                  .map(([chave, valor]) => (
                    <div key={chave} className="p-2.5 rounded-xl bg-boutique-50 border border-boutique-200/60">
                      <span className="block text-[10px] text-boutique-500 uppercase tracking-wide font-bold">
                        {chave.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs font-semibold text-boutique-900">
                        {typeof valor === 'boolean' ? (valor ? 'Sim' : 'Não') : String(valor)}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Rodapé Ação */}
        <div className="p-6 bg-boutique-50 border-t border-boutique-200 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-boutique-300 text-boutique-700 font-semibold text-xs hover:bg-white transition-colors"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={handleAdicionar}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-boutique-900 text-white font-semibold text-xs hover:bg-terracotta transition-all shadow-md active:scale-95"
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Adicionar ao Carrinho</span>
          </button>
        </div>

      </div>
    </div>
  );
};
