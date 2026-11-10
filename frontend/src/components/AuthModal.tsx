import React, { useState } from 'react';
import { X, Lock, Mail, User, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { api } from '../services/api';

export const AuthModal: React.FC = () => {
  const isAuthModalOpen = useAuthStore((state) => state.isAuthModalOpen);
  const fecharAuthModal = useAuthStore((state) => state.fecharAuthModal);
  const setAuth = useAuthStore((state) => state.setAuth);

  const [modo, setModo] = useState<'login' | 'registro'>('login');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  if (!isAuthModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCarregando(true);
    setErro('');

    try {
      if (modo === 'login') {
        const res = await api.login(email, senha);
        setAuth(res.usuario, res.token);
      } else {
        const res = await api.registrar(nome, email, senha);
        setAuth(res.usuario, res.token);
      }
      fecharAuthModal();
    } catch (err: any) {
      setErro(err.message || 'Erro ao processar autenticação.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-boutique-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={fecharAuthModal}
          className="absolute top-4 right-4 z-10 p-2 rounded-full bg-boutique-100 text-boutique-700 hover:text-boutique-950 transition-all"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 sm:p-8 space-y-6">
          <div className="text-center space-y-1">
            <h3 className="font-serif text-2xl font-bold text-boutique-900">
              {modo === 'login' ? 'Bem-vindo de Volta' : 'Criar Conta na Boutique'}
            </h3>
            <p className="text-xs text-boutique-500">
              Autenticação segura in-house com bcrypt e JWT
            </p>
          </div>

          {/* Abas Alternar */}
          <div className="grid grid-cols-2 p-1 bg-boutique-100 rounded-xl">
            <button
              type="button"
              onClick={() => { setModo('login'); setErro(''); }}
              className={`py-2 text-xs font-bold rounded-lg transition-all ${
                modo === 'login' ? 'bg-white text-boutique-900 shadow-xs' : 'text-boutique-600'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => { setModo('registro'); setErro(''); }}
              className={`py-2 text-xs font-bold rounded-lg transition-all ${
                modo === 'registro' ? 'bg-white text-boutique-900 shadow-xs' : 'text-boutique-600'
              }`}
            >
              Cadastrar
            </button>
          </div>

          {erro && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
              {erro}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {modo === 'registro' && (
              <div>
                <label className="block text-xs font-semibold text-boutique-800 mb-1">
                  Nome Completo
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-boutique-400" />
                  <input
                    type="text"
                    required
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Seu nome"
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-boutique-200 text-xs focus:ring-2 focus:ring-boutique-500/30 focus:border-boutique-500 outline-none"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-boutique-800 mb-1">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-boutique-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-boutique-200 text-xs focus:ring-2 focus:ring-boutique-500/30 focus:border-boutique-500 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-boutique-800 mb-1">
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-boutique-400" />
                <input
                  type={mostrarSenha ? "text" : "password"}
                  required
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-boutique-200 text-xs focus:ring-2 focus:ring-boutique-500/30 focus:border-boutique-500 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha(!mostrarSenha)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-boutique-400 hover:text-boutique-700 focus:outline-none"
                  title={mostrarSenha ? "Ocultar senha" : "Ver senha"}
                >
                  {mostrarSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={carregando}
              className="w-full py-3 rounded-2xl bg-boutique-900 text-white font-bold text-xs hover:bg-terracotta active:scale-98 transition-all shadow-md"
            >
              {carregando ? 'Processando...' : modo === 'login' ? 'Entrar na Conta' : 'Concluir Cadastro'}
            </button>
          </form>

          <div className="text-center pt-2">
            <span className="text-[11px] text-boutique-500 flex items-center justify-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Senha com Bcrypt (salt 12) e Token JWT seguro</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
