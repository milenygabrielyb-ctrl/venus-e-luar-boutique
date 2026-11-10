export type CategoriaProduto = 'Moda' | 'Pet' | 'Cafeteria';

export interface Produto {
  id_produto: number;
  nome_item: string;
  categoria: CategoriaProduto;
  preco: number;
  estoque: number;
  atributos: Record<string, any>;
  imagem_url: string;
  descricao: string;
  ativo: boolean;
}

export interface ItemCarrinho extends Produto {
  quantidade: number;
  atributosSelecionados?: Record<string, any>;
}

export interface PetAdocao {
  id_pet: number;
  nome_pet: string;
  especie: 'Cachorro' | 'Gato' | string;
  perfil: {
    idade_meses?: number;
    porte?: string;
    castrado?: boolean;
    vacinado?: boolean;
    convive_com_gatos?: boolean;
    convive_com_criancas?: boolean;
    energia?: string;
    temperamento?: string;
    [key: string]: any;
  };
  imagem_url: string;
  historia: string;
  status: 'Disponível' | 'Triagem' | 'Adotado' | string;
  criado_em?: string;
}

export interface Usuario {
  id_usuario: string;
  nome: string;
  email: string;
  role: 'cliente' | 'admin';
}

export interface Pedido {
  id_pedido: number;
  id_usuario?: string;
  total: number;
  status: string;
  itens: ItemCarrinho[];
  dados_entrega: Record<string, any>;
  criado_em: string;
}
