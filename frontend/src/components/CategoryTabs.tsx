import React from 'react';
import { Search, Sparkles, Shirt, PawPrint, Coffee, Heart } from 'lucide-react';

interface CategoryTabsProps {
  abaAtiva: string;
  setAbaAtiva: (aba: string) => void;
  busca: string;
  setBusca: (busca: string) => void;
  totalProdutos: number;
}

export const CategoryTabs: React.FC<CategoryTabsProps> = ({
  abaAtiva,
  setAbaAtiva,
  busca,
  setBusca,
  totalProdutos,
}) => {
  const abas = [
    { id: 'Todos', label: 'Todos os Itens', icon: Sparkles, cor: 'hover:border-boutique-600' },
    { id: 'Moda', label: 'Moda & Acessórios', icon: Shirt, cor: 'hover:border-terracotta' },
    { id: 'Pet', label: 'Pet Shop', icon: PawPrint, cor: 'hover:border-sage-600' },
    { id: 'Cafeteria', label: 'Cafeteria & Bistrô', icon: Coffee, cor: 'hover:border-boutique-700' },
    { id: 'Adocao', label: 'Pets para Adoção', icon: Heart, cor: 'hover:border-rose-500' },
  ];

  return (
    <div className="space-y-4 mb-8">
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        
        {/* Abas com ícones */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
          {abas.map((aba) => {
            const Icon = aba.icon;
            const ativa = abaAtiva === aba.id;
            return (
              <button
                key={aba.id}
                onClick={() => setAbaAtiva(aba.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-xs whitespace-nowrap transition-all border ${
                  ativa
                    ? 'bg-boutique-900 text-white border-boutique-900 shadow-sm'
                    : `bg-white text-boutique-700 border-boutique-200 ${aba.cor} hover:bg-boutique-50`
                }`}
              >
                <Icon className={`w-4 h-4 ${ativa ? 'text-terracotta' : 'text-boutique-500'}`} />
                <span>{aba.label}</span>
              </button>
            );
          })}
        </div>

        {/* Campo de Busca Inteligente */}
        <div className="relative min-w-[260px] md:min-w-[320px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-boutique-400" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, tecido, leite vegetal, tamanho..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-boutique-200 bg-white text-xs text-boutique-900 placeholder:text-boutique-400 focus:outline-none focus:ring-2 focus:ring-boutique-500/30 focus:border-boutique-500 transition-all shadow-xs"
          />
          {busca && (
            <button
              onClick={() => setBusca('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-boutique-400 hover:text-boutique-700 text-xs"
            >
              ×
            </button>
          )}
        </div>

      </div>

      <div className="flex items-center justify-between text-xs text-boutique-500 font-medium px-1">
        <span>Exibindo catálogo filtrado</span>
        <span>{totalProdutos} {totalProdutos === 1 ? 'item encontrado' : 'itens encontrados'}</span>
      </div>
    </div>
  );
};
