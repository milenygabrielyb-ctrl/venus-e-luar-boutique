import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Usuario } from '../types';

interface AuthState {
  usuario: Usuario | null;
  token: string | null;
  isAuthModalOpen: boolean;
  isAdminModalOpen: boolean;
  setAuth: (usuario: Usuario, token: string) => void;
  logout: () => void;
  abrirAuthModal: () => void;
  fecharAuthModal: () => void;
  abrirAdminModal: () => void;
  fecharAdminModal: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      usuario: null,
      token: null,
      isAuthModalOpen: false,
      isAdminModalOpen: false,

      setAuth: (usuario, token) => set({ usuario, token, isAuthModalOpen: false }),
      logout: () => set({ usuario: null, token: null }),
      abrirAuthModal: () => set({ isAuthModalOpen: true }),
      fecharAuthModal: () => set({ isAuthModalOpen: false }),
      abrirAdminModal: () => set({ isAdminModalOpen: true }),
      fecharAdminModal: () => set({ isAdminModalOpen: false }),
    }),
    {
      name: 'butique-auth-storage',
    }
  )
);
