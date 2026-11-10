import React from 'react';
import { ShoppingBag, Eye, Shirt, PawPrint, Coffee } from 'lucide-react';
import { Produto } from '../types';
import { useCarrinhoStore } from '../store/useCarrinhoStore';

interface ProductCardProps {
  produto: Produto;
  onVerDetalhes: (produto: Produto) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({ produto, onVerDetalhes }) => {
  const adicionarAoCarrinho = useCarrinhoStore((state) => state.adicionarAoCarrinho);

  const formatarPreco = (valor: number) => {
    return Number(valor).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  const getCategoriaBadge = (cat: string) => {
    switch (cat) {
      case 'Moda':
        return {
          bg: 'bg-amber-50 text-amber-800 border-amber-200',
          icon: Shirt,
        };
      case 'Pet':
        return {
          bg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          icon: PawPrint,
        };
      case 'Cafeteria':
        return {
          bg: 'bg-stone-100 text-stone-800 border-stone-300',
          icon: Coffee,
        };
      default:
        return {
          bg: 'bg-boutique-100 text-boutique-800 border-boutique-200',
          icon: Shirt,
        };
    }
  };

  const badge = getCategoriaBadge(produto.categoria);
  const BadgeIcon = badge.icon;

  // Atributos JSONB destacados para exibição rápida
  const renderAtributosPreview = () => {
    const at = produto.atributos || {};
    const tags: string[] = [];

    if (at.tecido) tags.push(`Tecido: ${at.tecido}`);
    if (at.tamanho) tags.push(`Tamanho: ${at.tamanho}`);
    if (at.cor) tags.push(at.cor);
    if (at.tamanho_pet) tags.push(`Porte: ${at.tamanho_pet}`);
    if (at.indicacao) tags.push(at.indicacao);
    if (at.tipo_leite) tags.push(`Leite: ${at.tipo_leite}`);
    if (at.volume_ml) tags.push(`${at.volume_ml}ml`);
    if (at.grao) tags.push(at.grao);
    if (at.fermentacao) tags.push(`Ferm. ${at.fermentacao}`);

    return tags.slice(0, 3).map((tag, idx) => (
      <span
        key={idx}
        className="text-[10px] font-medium bg-boutique-100/80 text-boutique-700 px-2 py-0.5 rounded-md border border-boutique-200/60"
      >
        {tag}
      </span>
    ));
  };

  return (
    <div className="group relative bg-white rounded-2xl border border-boutique-200/70 overflow-hidden shadow-xs hover:shadow-xl hover:border-boutique-300 transition-all duration-300 flex flex-col justify-between">
      
      <div>
        {/* Imagem do Produto com overlay e botões */}
        <div className="relative aspect-[4/3] sm:aspect-square overflow-hidden bg-boutique-100">
          <img
            src={produto.imagem_url || 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=800&q=80'}
            alt={produto.nome_item}
            className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
          />

          {/* Badge de Categoria */}
          <div className="absolute top-3 left-3">
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border shadow-xs ${badge.bg}`}>
              <BadgeIcon className="w-3 h-3" />
              <span>{produto.categoria}</span>
            </span>
          </div>

          {/* Botão de Espiar / Ver Detalhes */}
          <button
            onClick={() => onVerDetalhes(produto)}
            className="absolute bottom-3 right-3 p-2 rounded-full bg-white/90 backdrop-blur-sm text-boutique-800 shadow-md hover:bg-white hover:text-terracotta hover:scale-110 transition-all opacity-0 group-hover:opacity-100"
            title="Ver Atributos e Detalhes"
          >
            <Eye className="w-4 h-4" />
          </button>
        </div>

        {/* Informações do Produto */}
        <div className="p-4 sm:p-5 space-y-2">
          <h3 
            onClick={() => onVerDetalhes(produto)}
            className="font-serif text-base sm:text-lg font-bold text-boutique-900 line-clamp-1 group-hover:text-terracotta transition-colors cursor-pointer"
          >
            {produto.nome_item}
          </h3>

          <p className="text-xs text-boutique-600 line-clamp-2 leading-relaxed">
            {produto.descricao}
          </p>

          {/* Tags dinâmicas do JSONB */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {renderAtributosPreview()}
          </div>
        </div>
      </div>

      {/* Rodapé com Preço e Botão Adicionar */}
      <div className="p-4 sm:p-5 pt-0 border-t border-boutique-100/80 flex items-center justify-between gap-2 mt-2">
        <div>
          <span className="block text-[10px] text-boutique-500 uppercase tracking-wider font-semibold">Valor</span>
          <span className="text-lg font-bold text-boutique-900 font-serif">
            {formatarPreco(produto.preco)}
          </span>
        </div>

        <button
          onClick={() => adicionarAoCarrinho(produto)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-boutique-900 text-white text-xs font-semibold hover:bg-terracotta active:scale-95 transition-all shadow-sm"
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          <span>Comprar</span>
        </button>
      </div>

    </div>
  );
};
