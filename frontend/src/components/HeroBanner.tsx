import React from 'react';
import { Sparkles, ArrowRight, HeartHandshake } from 'lucide-react';

interface HeroBannerProps {
  setAbaAtiva: (aba: string) => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({ setAbaAtiva }) => {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-boutique-100 via-boutique-50 to-sage-50 border-b border-boutique-200/50 py-12 md:py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          <div className="lg:col-span-7 space-y-6 text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/80 border border-boutique-300 shadow-xs text-xs font-semibold text-boutique-800 uppercase tracking-widest">
              <Sparkles className="w-3.5 h-3.5 text-terracotta" />
              <span>Experiência Híbrida & Sustentável</span>
            </div>

            <h1 className="font-serif text-3xl sm:text-5xl lg:text-6xl font-bold text-boutique-900 leading-[1.15]">
              Onde a alta costura encontra o afeto pet e o aroma do café especial.
            </h1>

            <p className="text-base sm:text-lg text-boutique-700 font-light max-w-2xl leading-relaxed">
              Explore vestidos florais em linho puro, produtos de bem-estar para seu companheiro de quatro patas e espressos artesanais. Um único espaço, um único carrinho unificado.
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                onClick={() => setAbaAtiva('Moda')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-boutique-900 text-white font-medium text-sm hover:bg-terracotta transition-all shadow-md group"
              >
                <span>Explorar Moda & Acessórios</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>

              <button
                onClick={() => setAbaAtiva('Adocao')}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white border border-boutique-300 text-boutique-800 font-medium text-sm hover:bg-rose-50 hover:border-rose-300 hover:text-rose-800 transition-all shadow-xs"
              >
                <HeartHandshake className="w-4 h-4 text-rose-500" />
                <span>Conhecer Pets para Adoção</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 grid grid-cols-2 gap-3.5">
            <div className="space-y-3.5">
              <div className="relative rounded-2xl overflow-hidden shadow-lg group">
                <img
                  src="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=600&q=80"
                  alt="Moda Boutique"
                  className="w-full h-48 sm:h-56 object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-3.5">
                  <span className="text-white text-xs font-bold tracking-wide">Moda Autoral & Linho</span>
                </div>
              </div>

              <div className="relative rounded-2xl overflow-hidden shadow-lg group">
                <img
                  src="https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=600&q=80"
                  alt="Cafeteria Gourmet"
                  className="w-full h-36 sm:h-44 object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-3.5">
                  <span className="text-white text-xs font-bold tracking-wide">Cafeteria Especial</span>
                </div>
              </div>
            </div>

            <div className="space-y-3.5 pt-6">
              <div className="relative rounded-2xl overflow-hidden shadow-lg group">
                <img
                  src="https://images.unsplash.com/photo-1537151608828-ea2b11777ee8?auto=format&fit=crop&w=600&q=80"
                  alt="Espaço Pet Friendly"
                  className="w-full h-40 sm:h-48 object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-3.5">
                  <span className="text-white text-xs font-bold tracking-wide">Pet Shop & Adoção</span>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white border border-boutique-200/80 shadow-md text-center flex flex-col justify-center">
                <span className="text-2xl font-serif font-bold text-terracotta">100%</span>
                <span className="text-[11px] font-medium text-boutique-600">Modelagem PostgreSQL com JSONB Unificado</span>
              </div>
            </div>

          </div>

        </div>
      </div>
    </section>
  );
};
