import React, { useState } from 'react';
import { X, Heart, Sparkles, Send, CheckCircle2 } from 'lucide-react';
import { PetAdocao } from '../types';
import { api } from '../services/api';

interface PetAdoptionModalProps {
  pet: PetAdocao | null;
  onClose: () => void;
  onSucesso: (id_pet: number) => void;
}

export const PetAdoptionModal: React.FC<PetAdoptionModalProps> = ({ pet, onClose, onSucesso }) => {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');
  const [experiencia, setExperiencia] = useState('Já tive outros pets');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [erro, setErro] = useState('');

  if (!pet) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErro('');

    try {
      await api.solicitarAdocao({
        id_pet: pet.id_pet,
        nome_candidato: nome,
        email,
        telefone,
        experiencia,
        motivo,
      });

      setSucesso(true);
      onSucesso(pet.id_pet);
      setTimeout(() => {
        onClose();
      }, 2500);
    } catch (err: any) {
      setErro(err.message || 'Erro ao processar candidatura.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-boutique-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 rounded-full bg-boutique-100 text-boutique-700 hover:text-boutique-950 transition-all"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 sm:p-8 space-y-5">
          {sucesso ? (
            <div className="py-8 text-center space-y-3">
              <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <Heart className="w-8 h-8 fill-current" />
              </div>
              <h3 className="font-serif text-2xl font-bold text-boutique-900">
                Candidatura Enviada!
              </h3>
              <p className="text-xs text-boutique-600 max-w-xs mx-auto leading-relaxed">
                Nossa equipe de bem-estar pet analisará seu perfil com carinho e entrará em contato para agendar uma visita na boutique com o {pet.nome_pet}.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl overflow-hidden bg-boutique-100 flex-shrink-0">
                  <img src={pet.imagem_url} alt={pet.nome_pet} className="w-full h-full object-cover" />
                </div>
                <div>
                  <h3 className="font-serif text-xl font-bold text-boutique-900 flex items-center gap-1.5">
                    <span>Adotar {pet.nome_pet}</span>
                    <Heart className="w-4 h-4 text-rose-500 fill-current" />
                  </h3>
                  <span className="text-xs text-boutique-500">
                    Adoção Responsável Isolada do Fluxo Comercial
                  </span>
                </div>
              </div>

              {erro && (
                <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl border border-rose-200">
                  {erro}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-boutique-800 mb-1">
                    Seu Nome Completo *
                  </label>
                  <input
                    type="text"
                    required
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Ex: Mileny Santos"
                    className="w-full px-3.5 py-2 rounded-xl border border-boutique-300 text-xs focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500 outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-boutique-800 mb-1">
                      E-mail *
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="seu@email.com"
                      className="w-full px-3.5 py-2 rounded-xl border border-boutique-300 text-xs focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-boutique-800 mb-1">
                      WhatsApp / Telefone *
                    </label>
                    <input
                      type="tel"
                      required
                      value={telefone}
                      onChange={(e) => setTelefone(e.target.value)}
                      placeholder="(11) 98765-4321"
                      className="w-full px-3.5 py-2 rounded-xl border border-boutique-300 text-xs focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-boutique-800 mb-1">
                    Experiência Prévia com Animais
                  </label>
                  <select
                    value={experiencia}
                    onChange={(e) => setExperiencia(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl border border-boutique-300 text-xs focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500 outline-none bg-white"
                  >
                    <option value="Já tive outros pets">Já tive outros cães/gatos</option>
                    <option value="Primeira vez como tutor">Será meu primeiro animal de estimação</option>
                    <option value="Tenho outros animais atualmente">Tenho outros animais no momento</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-boutique-800 mb-1">
                    Conte um pouco sobre sua rotina e o novo lar do pet
                  </label>
                  <textarea
                    rows={3}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Casa ou apartamento? Telas de proteção? Tempo disponível para passeios..."
                    className="w-full px-3.5 py-2 rounded-xl border border-boutique-300 text-xs focus:ring-2 focus:ring-rose-500/30 focus:border-rose-500 outline-none resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={enviando}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-rose-600 text-white font-bold text-xs hover:bg-rose-700 active:scale-98 transition-all shadow-md shadow-rose-200"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{enviando ? 'Enviando Candidatura...' : 'Enviar Candidatura de Adoção'}</span>
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
