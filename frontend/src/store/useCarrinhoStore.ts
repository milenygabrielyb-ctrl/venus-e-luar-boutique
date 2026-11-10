import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ItemCarrinho, Produto } from '../types';

interface CarrinhoState {
  itens: ItemCarrinho[];
  isOpen: boolean;
  abrirCarrinho: () => void;
  fecharCarrinho: () => void;
  alternarCarrinho: () => void;
  adicionarAoCarrinho: (produto: Produto, atributosSelecionados?: Record<string, any>) => void;
  removerDoCarrinho: (id_produto: number) => void;
  decrementarQuantidade: (id_produto: number) => void;
  calcularTotal: () => number;
  contarItensTotal: () => number;
  limparCarrinho: () => void;
}

export const useCarrinhoStore = create<CarrinhoState>()(
  persist(
    (set, get) => ({
      itens: [], // Lista unificada: roupas, pet e café
      isOpen: false,

      abrirCarrinho: () => set({ isOpen: true }),
      fecharCarrinho: () => set({ isOpen: false }),
      alternarCarrinho: () => set((state) => ({ isOpen: !state.isOpen })),

      // Função para adicionar qualquer tipo de produto (Moda, Pet ou Café)
      adicionarAoCarrinho: (produto, atributosSelecionados) => {
        const itensAtuais = get().itens;
        const itemExistente = itensAtuais.find((i) => i.id_produto === produto.id_produto);

        if (itemExistente) {
          // Se já existe, apenas incrementa a quantidade
          set({
            itens: itensAtuais.map((i) =>
              i.id_produto === produto.id_produto
                ? {
                    ...i,
                    quantidade: i.quantidade + 1,
                    atributosSelecionados: atributosSelecionados || i.atributosSelecionados,
                  }
                : i
            ),
            isOpen: true, // Abre sutilmente a gaveta para feedback visual
          });
        } else {
          // Se é novo, adiciona com quantidade 1
          set({
            itens: [
              ...itensAtuais,
              {
                ...produto,
                quantidade: 1,
                atributosSelecionados: atributosSelecionados || produto.atributos,
              },
            ],
            isOpen: true,
          });
        }
      },

      // Decrementar ou remover se for 1
      decrementarQuantidade: (id_produto: number) => {
        const itensAtuais = get().itens;
        const item = itensAtuais.find((i) => i.id_produto === id_produto);
        if (!item) return;

        if (item.quantidade <= 1) {
          set({ itens: itensAtuais.filter((i) => i.id_produto !== id_produto) });
        } else {
          set({
            itens: itensAtuais.map((i) =>
              i.id_produto === id_produto ? { ...i, quantidade: i.quantidade - 1 } : i
            ),
          });
        }
      },

      // Função para remover item
      removerDoCarrinho: (id_produto: number) => {
        set({ itens: get().itens.filter((i) => i.id_produto !== id_produto) });
      },

      // Total financeiro dinâmico
      calcularTotal: () => {
        return get().itens.reduce((total, item) => total + Number(item.preco) * item.quantidade, 0);
      },

      // Quantidade total de unidades no carrinho
      contarItensTotal: () => {
        return get().itens.reduce((acc, item) => acc + item.quantidade, 0);
      },

      // Esvaziar carrinho após finalizar compra
      limparCarrinho: () => set({ itens: [] }),
    }),
    {
      name: 'carrinho-storage', // Salva no LocalStorage automaticamente
    }
  )
);

export default useCarrinhoStore;
