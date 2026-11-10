import React, { useState } from 'react';
import { Lock, X, Sparkles, LogIn, ArrowRight, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { Produto, Usuario } from '../types';
import { api } from '../services/api';
import { useAuthStore } from '../store/useAuthStore';

interface PermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  produtoPendente?: {
    produto: Produto;
    atributos?: Record<string, any>;
  } | null;
  onSucesso: (usuario: Usuario) => void;
}

export const PermissionModal: React.FC<PermissionModalProps> = ({
  isOpen,
  onClose,
  produtoPendente,
  onSucesso,
}) => {
  const setAuth = useAuthStore((state) => state.setAuth);
  const abrirAuthModal = useAuthStore((state) => state.abrirAuthModal);

  const [email, setEmail] = useState('admin@butique.com');
  const [senha, setSenha] = useState('admin123');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  if (!isOpen) return null;

  const formatarPreco = (valor: number) => {
    return Number(valor).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCarregando(true);
    setErro('');

    try {
      const res = await api.login(email, senha);
      setAuth(res.usuario, res.token);
      onSucesso(res.usuario);
      onClose();
    } catch (err: any) {
      setErro(err.message || 'Falha ao autenticar.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div 
        className="relative w-full max-w-lg bg-celestial-900 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl border-2 border-ouro/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fechar */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-ouro/80 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Ícone e Título */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-full mx-auto bg-celestial-950 border-2 border-ouro/70 flex items-center justify-center text-ouro shadow-inner">
            <Lock className="w-8 h-8" />
          </div>

          <h3 className="font-serif text-2xl sm:text-3xl font-bold gold-gradient-text">
            Acesso Exclusivo Vênus & Luar
          </h3>

          <p className="text-xs text-luar-300 max-w-sm mx-auto leading-relaxed">
            Para selecionar e reservar peças de <strong className="text-ouro font-semibold">Alta Costura</strong> e produtos na sua sacola, é necessário estar conectado à sua conta.
          </p>
        </div>

        {/* Prévia da Peça Bloqueada */}
        {produtoPendente?.produto && (
          <div className="p-3.5 rounded-2xl bg-celestial-950 border border-ouro/30 flex items-center gap-3.5">
            <img
              src={produtoPendente.produto.imagem_url}
              alt={produtoPendente.produto.nome_item}
              className="w-14 h-14 rounded-xl object-cover border border-ouro/30"
            />
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ouro block">
                Peça Selecionada • {produtoPendente.produto.categoria}
              </span>
              <h4 className="text-xs font-bold text-ouro-light truncate">
                {produtoPendente.produto.nome_item}
              </h4>
              <span className="text-xs font-serif font-bold text-ouro">
                {formatarPreco(produtoPendente.produto.preco)}
              </span>
            </div>
          </div>
        )}

        {erro && (
          <div className="p-3 bg-rose-950/60 border border-rose-500/50 text-rose-300 text-xs rounded-xl">
            {erro}
          </div>
        )}

        {/* Formulário de Identificação */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
              E-mail
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-luar-100 placeholder:text-stone-500 outline-none focus:border-ouro"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
              Senha
            </label>
            <div className="relative">
              <input
                type={mostrarSenha ? "text" : "password"}
                required
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="••••••••"
                className="w-full p-3 pr-10 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-luar-100 placeholder:text-stone-500 outline-none focus:border-ouro"
              />
              <button
                type="button"
                onClick={() => setMostrarSenha(!mostrarSenha)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-ouro/70 hover:text-ouro focus:outline-none transition-colors"
                title={mostrarSenha ? "Ocultar senha" : "Ver senha"}
              >
                {mostrarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={carregando}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 font-bold text-xs uppercase tracking-widest shadow-lg hover:brightness-110 active:scale-98 transition-all flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            <span>{carregando ? 'Autenticando...' : 'Autorizar e Adicionar à Sacola'}</span>
          </button>
        </form>

        {/* Link para criar conta */}
        <div className="pt-2 text-center border-t border-ouro/15 space-y-2">
          <span className="text-[11px] text-luar-300 block">
            Ainda não tem conta de cliente VIP?
          </span>
          <button
            type="button"
            onClick={() => {
              onClose();
              abrirAuthModal();
            }}
            className="text-xs text-ouro hover:underline font-bold inline-flex items-center gap-1"
          >
            <span>Cadastre-se na Boutique Vênus e Luar</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

      </div>
    </div>
  );
};
