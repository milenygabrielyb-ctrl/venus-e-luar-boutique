import React from 'react';
import { ShoppingBag, Heart, User, Sparkles, ShieldPlus, Coffee, Shirt, PawPrint } from 'lucide-react';
import { useCarrinhoStore } from '../store/useCarrinhoStore';
import { useAuthStore } from '../store/useAuthStore';

interface NavbarProps {
  abaAtiva: string;
  setAbaAtiva: (aba: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ abaAtiva, setAbaAtiva }) => {
  const contarItensTotal = useCarrinhoStore((state) => state.contarItensTotal);
  const alternarCarrinho = useCarrinhoStore((state) => state.alternarCarrinho);
  const totalItens = contarItensTotal();

  const usuario = useAuthStore((state) => state.usuario);
  const abrirAuthModal = useAuthStore((state) => state.abrirAuthModal);
  const abrirAdminModal = useAuthStore((state) => state.abrirAdminModal);
  const logout = useAuthStore((state) => state.logout);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-boutique-200/60 shadow-sm transition-all">
      {/* Barra de Aviso Superior */}
      <div className="bg-boutique-900 text-boutique-100 text-xs py-1.5 px-4 text-center font-medium tracking-wide flex items-center justify-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-terracotta" />
        <span>Boutique Conceito: Moda Autoral, Cafeteria Especial e Espaço Pet Friendly com Adoção Responsável</span>
        <Sparkles className="w-3.5 h-3.5 text-terracotta" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          
          {/* Logo & Marca */}
          <div 
            onClick={() => setAbaAtiva('Todos')}
            className="cursor-pointer flex items-center gap-3 group"
          >
            <div className="w-11 h-11 rounded-full bg-boutique-100 border border-boutique-300 flex items-center justify-center text-boutique-700 font-serif text-xl font-bold shadow-inner group-hover:scale-105 transition-transform">
              M
            </div>
            <div>
              <span className="font-serif text-2xl font-bold tracking-tight text-boutique-900 group-hover:text-terracotta transition-colors">
                Maison & Pet
              </span>
              <span className="block text-[10px] tracking-[0.25em] uppercase text-boutique-500 font-semibold">
                Boutique • Café • Adoção
              </span>
            </div>
          </div>

          {/* Navegação Rápida de Nichos */}
          <nav className="hidden md:flex items-center gap-1 bg-boutique-100/70 p-1.5 rounded-full border border-boutique-200/80">
            <button
              onClick={() => setAbaAtiva('Todos')}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all ${
                abaAtiva === 'Todos'
                  ? 'bg-boutique-900 text-white shadow-sm'
                  : 'text-boutique-700 hover:text-boutique-900 hover:bg-white/50'
              }`}
            >
              Coleção Completa
            </button>
            <button
              onClick={() => setAbaAtiva('Moda')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all ${
                abaAtiva === 'Moda'
                  ? 'bg-terracotta text-white shadow-sm'
                  : 'text-boutique-700 hover:text-boutique-900 hover:bg-white/50'
              }`}
            >
              <Shirt className="w-3.5 h-3.5" />
              Moda
            </button>
            <button
              onClick={() => setAbaAtiva('Pet')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all ${
                abaAtiva === 'Pet'
                  ? 'bg-sage-600 text-white shadow-sm'
                  : 'text-boutique-700 hover:text-boutique-900 hover:bg-white/50'
              }`}
            >
              <PawPrint className="w-3.5 h-3.5" />
              Pet Shop
            </button>
            <button
              onClick={() => setAbaAtiva('Cafeteria')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all ${
                abaAtiva === 'Cafeteria'
                  ? 'bg-boutique-700 text-white shadow-sm'
                  : 'text-boutique-700 hover:text-boutique-900 hover:bg-white/50'
              }`}
            >
              <Coffee className="w-3.5 h-3.5" />
              Cafeteria
            </button>
            <button
              onClick={() => setAbaAtiva('Adocao')}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all ${
                abaAtiva === 'Adocao'
                  ? 'bg-rose-600 text-white shadow-sm animate-pulse'
                  : 'text-rose-700 hover:text-rose-900 hover:bg-rose-50'
              }`}
            >
              <Heart className="w-3.5 h-3.5 fill-current" />
              Adoção de Pets
            </button>
          </nav>

          {/* Ações: Painel Admin, Usuário e Carrinho */}
          <div className="flex items-center gap-3">
            {/* Botão Admin */}
            <button
              onClick={abrirAdminModal}
              title="Gerenciar Produtos e Pets (Admin)"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-boutique-300 bg-boutique-50 text-boutique-700 hover:bg-boutique-100 hover:text-boutique-900 text-xs font-medium transition-colors"
            >
              <ShieldPlus className="w-3.5 h-3.5 text-boutique-600" />
              <span>Gestão</span>
            </button>

            {/* Usuário / Login */}
            {usuario ? (
              <div className="flex items-center gap-2">
                <span className="hidden lg:inline text-xs font-medium text-boutique-700">
                  Olá, <strong className="text-boutique-900">{usuario.nome.split(' ')[0]}</strong>
                </span>
                <button
                  onClick={logout}
                  className="px-3 py-1.5 text-xs text-stone-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-200"
                >
                  Sair
                </button>
              </div>
            ) : (
              <button
                onClick={abrirAuthModal}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border border-boutique-300 text-boutique-800 hover:border-boutique-500 hover:bg-boutique-50 text-xs font-semibold transition-all"
              >
                <User className="w-3.5 h-3.5 text-terracotta" />
                <span>Entrar</span>
              </button>
            )}

            {/* Botão de Carrinho com Badge */}
            <button
              onClick={alternarCarrinho}
              aria-label="Abrir carrinho"
              className="relative p-2.5 rounded-full bg-boutique-900 text-white hover:bg-terracotta transition-colors shadow-md flex items-center justify-center group"
            >
              <ShoppingBag className="w-5 h-5 group-hover:scale-110 transition-transform" />
              {totalItens > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow animate-bounce">
                  {totalItens}
                </span>
              )}
            </button>

          </div>
        </div>
      </div>
    </header>
  );
};
