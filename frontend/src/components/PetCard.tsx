import React from 'react';
import { Heart, CheckCircle2, AlertCircle, Info, Sparkles } from 'lucide-react';
import { PetAdocao } from '../types';

interface PetCardProps {
  pet: PetAdocao;
  onAdotar: (pet: PetAdocao) => void;
}

export const PetCard: React.FC<PetCardProps> = ({ pet, onAdotar }) => {
  const perfil = pet.perfil || {};

  const formatarIdade = (meses?: number) => {
    if (!meses) return 'Idade não informada';
    if (meses < 12) return `${meses} meses`;
    const anos = Math.floor(meses / 12);
    const resto = meses % 12;
    return resto > 0 ? `${anos} ano(s) e ${resto}m` : `${anos} ano(s)`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Disponível':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'Triagem':
        return 'bg-amber-100 text-amber-800 border-amber-300';
      case 'Adotado':
        return 'bg-stone-200 text-stone-700 border-stone-400';
      default:
        return 'bg-boutique-100 text-boutique-800 border-boutique-300';
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-boutique-200/80 overflow-hidden shadow-xs hover:shadow-xl transition-all duration-300 flex flex-col justify-between group">
      
      <div>
        {/* Imagem do Pet com Status */}
        <div className="relative aspect-[4/3] overflow-hidden bg-boutique-100">
          <img
            src={pet.imagem_url || 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=800&q=80'}
            alt={pet.nome_pet}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />

          <div className="absolute top-3 left-3 flex items-center gap-2">
            <span className={`text-[11px] font-bold px-3 py-1 rounded-full border shadow-xs ${getStatusBadge(pet.status)}`}>
              {pet.status}
            </span>
            <span className="text-[11px] font-medium bg-black/50 text-white backdrop-blur-sm px-2.5 py-1 rounded-full">
              {pet.especie}
            </span>
          </div>

          <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur-md px-3 py-1 rounded-xl shadow-xs text-xs font-semibold text-boutique-800">
            {formatarIdade(perfil.idade_meses)}
          </div>
        </div>

        {/* Informações e História */}
        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-serif text-2xl font-bold text-boutique-900 group-hover:text-terracotta transition-colors">
              {pet.nome_pet}
            </h3>
            {perfil.porte && (
              <span className="text-xs font-medium text-boutique-600 bg-boutique-100 px-2.5 py-0.5 rounded-md">
                Porte {perfil.porte}
              </span>
            )}
          </div>

          <p className="text-xs text-boutique-600 leading-relaxed italic line-clamp-3">
            "{pet.historia || 'Esperando por uma família com muito amor para compartilhar.'}"
          </p>

          {/* Perfil Comportamental e Clínico JSONB */}
          <div className="pt-2 border-t border-boutique-100 space-y-2">
            <span className="text-[10px] font-bold text-boutique-500 uppercase tracking-wider block flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-terracotta" />
              Perfil Clínico & Social (JSONB)
            </span>

            <div className="flex flex-wrap gap-1.5">
              {perfil.castrado && (
                <span className="inline-flex items-center gap-1 text-[11px] bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full border border-emerald-200">
                  <CheckCircle2 className="w-3 h-3" /> Castrado
                </span>
              )}

              {perfil.vacinado && (
                <span className="inline-flex items-center gap-1 text-[11px] bg-sky-50 text-sky-700 px-2.5 py-0.5 rounded-full border border-sky-200">
                  <CheckCircle2 className="w-3 h-3" /> Vacinado
                </span>
              )}

              {perfil.convive_com_gatos !== undefined && (
                <span className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full border ${
                  perfil.convive_com_gatos 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                    : 'bg-stone-100 text-stone-600 border-stone-200'
                }`}>
                  {perfil.convive_com_gatos ? '✓ Amigo de Gatos' : '✕ Prefere sem Gatos'}
                </span>
              )}

              {perfil.temperamento && (
                <span className="text-[11px] bg-boutique-100 text-boutique-800 px-2.5 py-0.5 rounded-full border border-boutique-200 font-medium">
                  {perfil.temperamento}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Botão de Candidatura */}
      <div className="p-5 pt-0 mt-2">
        <button
          onClick={() => onAdotar(pet)}
          disabled={pet.status !== 'Disponível'}
          className={`w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-xs tracking-wide transition-all shadow-sm ${
            pet.status === 'Disponível'
              ? 'bg-rose-600 hover:bg-rose-700 text-white active:scale-98 shadow-rose-200'
              : 'bg-stone-200 text-stone-500 cursor-not-allowed'
          }`}
        >
          <Heart className="w-4 h-4 fill-current" />
          <span>{pet.status === 'Disponível' ? 'Candidatar-se para Adoção' : 'Adoção em Andamento'}</span>
        </button>
      </div>

    </div>
  );
};
