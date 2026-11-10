import { Produto, PetAdocao, Usuario, Pedido } from '../types';

const API_BASE = 'http://localhost:3001/api';

export const api = {
  // Autenticação
  async registrar(nome: string, email: string, senha: string): Promise<{ token: string; usuario: Usuario }> {
    const res = await fetch(`${API_BASE}/auth/registrar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, email, senha }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.erro || 'Erro ao registrar usuário');
    }
    return res.json();
  },

  async login(email: string, senha: string): Promise<{ token: string; usuario: Usuario }> {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.erro || 'Credenciais inválidas');
    }
    return res.json();
  },

  // Produtos
  async listarProdutos(categoria?: string, busca?: string): Promise<Produto[]> {
    const params = new URLSearchParams();
    if (categoria && categoria !== 'Todos') params.append('categoria', categoria);
    if (busca) params.append('busca', busca);

    const res = await fetch(`${API_BASE}/produtos?${params.toString()}`);
    if (!res.ok) throw new Error('Erro ao buscar produtos');
    return res.json();
  },

  async criarProduto(produto: Partial<Produto>): Promise<Produto> {
    const res = await fetch(`${API_BASE}/produtos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(produto),
    });
    if (!res.ok) throw new Error('Erro ao criar produto');
    return res.json();
  },

  // Pets
  async listarPets(especie?: string): Promise<PetAdocao[]> {
    const params = new URLSearchParams();
    if (especie && especie !== 'Todos') params.append('especie', especie);

    const res = await fetch(`${API_BASE}/pets?${params.toString()}`);
    if (!res.ok) throw new Error('Erro ao buscar pets');
    return res.json();
  },

  async solicitarAdocao(dados: {
    id_pet: number;
    nome_candidato: string;
    email: string;
    telefone: string;
    experiencia: string;
    motivo: string;
  }): Promise<{ mensagem: string }> {
    const res = await fetch(`${API_BASE}/pets/adotar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados),
    });
    if (!res.ok) throw new Error('Erro ao enviar solicitação de adoção');
    return res.json();
  },

  async criarPet(pet: Partial<PetAdocao>): Promise<PetAdocao> {
    const res = await fetch(`${API_BASE}/pets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pet),
    });
    if (!res.ok) throw new Error('Erro ao cadastrar pet');
    return res.json();
  },

  // Pedidos
  async checkout(dados: {
    id_usuario?: string;
    itens: any[];
    dados_entrega: any;
    forma_pagamento: string;
  }): Promise<{ mensagem: string; pedido: Pedido }> {
    const res = await fetch(`${API_BASE}/pedidos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados),
    });
    if (!res.ok) throw new Error('Erro ao processar pedido');
    return res.json();
  },
};
