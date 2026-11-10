import { Pool } from 'pg';
import crypto from 'crypto';

interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

// Configuração do PostgreSQL
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/butique_db';

let pool: Pool | null = null;
let usePostgres = false;

// Tenta inicializar o Pool se PostgreSQL estiver disponível
try {
  pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 2000,
  });
} catch (e) {
  console.log('PostgreSQL não configurado localmente. Usando camada de dados resiliente em memória.');
}

// ==========================================
// STORE RESILIENTE INTEGRADA (Fallback Rápido)
// ==========================================
interface UsuarioStore {
  id_usuario: string;
  nome_completo: string;
  email: string;
  senha_hash: string;
  role: string;
  criado_em: Date;
}

interface ProdutoStore {
  id_produto: number;
  nome_item: string;
  categoria: string;
  preco: number;
  estoque: number;
  atributos: Record<string, any>;
  imagem_url: string;
  descricao: string;
  ativo: boolean;
}

interface PetStore {
  id_pet: number;
  nome_pet: string;
  especie: string;
  perfil: Record<string, any>;
  imagem_url: string;
  historia: string;
  status: string;
  criado_em: Date;
}

interface PedidoStore {
  id_pedido: number;
  id_usuario: string | null;
  total: number;
  status: string;
  itens: any[];
  dados_entrega: Record<string, any>;
  criado_em: Date;
}

// Dados iniciais
const usuariosMem: UsuarioStore[] = [];
let produtoIdCounter = 1;
const produtosMem: ProdutoStore[] = [
  {
    id_produto: produtoIdCounter++,
    nome_item: 'Vestido Floral Midi Linho',
    categoria: 'Moda',
    preco: 289.90,
    estoque: 15,
    atributos: { tamanho: 'M', estacao: 'primavera/verao', tecido: 'linho com viscose', cor: 'Off-white Floral', corte: 'Evasê', grades_disponiveis: ['P', 'M', 'G'] },
    imagem_url: 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=800&q=80',
    descricao: 'Vestido midi sofisticado com caimento fluído em tecido natural e estampa botânica exclusiva da boutique.',
    ativo: true,
  },
  {
    id_produto: produtoIdCounter++,
    nome_item: 'Blazer Alfaiataria Minimalista',
    categoria: 'Moda',
    preco: 429.00,
    estoque: 8,
    atributos: { tamanho: 'G', estacao: 'todas', tecido: 'alfaiataria premium', cor: 'Bege Areia', forrado: true, grades_disponiveis: ['PP', 'P', 'M', 'G'] },
    imagem_url: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=800&q=80',
    descricao: 'Blazer estruturado com botões rajados em madrepérola e corte de alta costura.',
    ativo: true,
  },
  {
    id_produto: produtoIdCounter++,
    nome_item: 'Camisa Oversized Seda & Algodão',
    categoria: 'Moda',
    preco: 219.50,
    estoque: 20,
    atributos: { tamanho: 'U', estacao: 'todas', tecido: 'misto seda e algodao egípcio', cor: 'Verde Oliva', grades_disponiveis: ['Unico'] },
    imagem_url: 'https://images.unsplash.com/photo-1598554747436-c9293d6a588f?auto=format&fit=crop&w=800&q=80',
    descricao: 'Peça atemporal e versátil com toque sedoso e elegância despojada para qualquer ocasião.',
    ativo: true,
  },
  {
    id_produto: produtoIdCounter++,
    nome_item: 'Bolsa Baguete Couro Artesanal',
    categoria: 'Moda',
    preco: 349.00,
    estoque: 6,
    atributos: { material: 'couro legítimo ecológico', cor: 'Caramelo', fecho: 'ímã dourado', compartimentos: 3 },
    imagem_url: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=800&q=80',
    descricao: 'Acessório confeccionado à mão por artesãos locais com acabamento impecável.',
    ativo: true,
  },
  {
    id_produto: produtoIdCounter++,
    nome_item: 'Cama Nuvem Ortopédica Plush',
    categoria: 'Pet',
    preco: 189.90,
    estoque: 12,
    atributos: { tamanho_pet: 'M', indicacao: 'cães e gatos', lavavel: true, enchimento: 'espuma viscoelástica antialérgica', cor: 'Cinza Mescla' },
    imagem_url: 'https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?auto=format&fit=crop&w=800&q=80',
    descricao: 'Cama com efeito calmante e alívio de articulações para o sono perfeito do seu pet.',
    ativo: true,
  },
  {
    id_produto: produtoIdCounter++,
    nome_item: 'Coleira e Guia Couro Botânico',
    categoria: 'Pet',
    preco: 119.00,
    estoque: 25,
    atributos: { tamanho_pet: 'P/M', indicacao: 'todos os portes', material: 'couro vegetal curtido a óleo', ferragens: 'latão escovado', inclui_placa_gravacao: true },
    imagem_url: 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?auto=format&fit=crop&w=800&q=80',
    descricao: 'Conjunto resistente e estiloso, desenhado para harmonizar com o estilo dos tutores modernos.',
    ativo: true,
  },
  {
    id_produto: produtoIdCounter++,
    nome_item: 'Snack Gourmet Salmão & Alecrim 150g',
    categoria: 'Pet',
    preco: 34.90,
    estoque: 40,
    atributos: { tipo: 'petisco funcional', ingredientes_nobres: true, livre_corantes: true, indicacao: 'cães adultos e idosos' },
    imagem_url: 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?auto=format&fit=crop&w=800&q=80',
    descricao: 'Petisco 100% natural, rico em Ômega-3 para pelos sedosos e articulações saudáveis.',
    ativo: true,
  },
  {
    id_produto: produtoIdCounter++,
    nome_item: 'Brinquedo Corda Orgânica Trançada',
    categoria: 'Pet',
    preco: 45.00,
    estoque: 18,
    atributos: { tamanho_pet: 'M/G', indicacao: 'cães mordedores', material: 'algodão cru 100% biodegradável', ajuda_tartaro: true },
    imagem_url: 'https://images.unsplash.com/photo-1535294435445-d7249524ef2e?auto=format&fit=crop&w=800&q=80',
    descricao: 'Divertido e seguro, limpa os dentes enquanto o pet brinca de puxar.',
    ativo: true,
  },
  {
    id_produto: produtoIdCounter++,
    nome_item: 'Cappuccino Italiano Artesanal',
    categoria: 'Cafeteria',
    preco: 18.50,
    estoque: 100,
    atributos: { volume_ml: 240, tipo_leite: 'vegetal ou integral', grao: 'Catuaí Vermelho 86 pts', opcoes_leite: ['Aveia Barista', 'Amêndoas', 'Integral Fresco', 'Sem Lactose'], temperatura: 'quente' },
    imagem_url: 'https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=800&q=80',
    descricao: 'Espresso duplo cremoso com leite vaporizado sedoso e polvilhado de cacau 70% da Bahia.',
    ativo: true,
  },
  {
    id_produto: produtoIdCounter++,
    nome_item: 'Croissant Amêndoas & Manteiga Francesa',
    categoria: 'Cafeteria',
    preco: 22.00,
    estoque: 25,
    atributos: { fermentacao: 'natural 36h', recheio: 'creme frangipane', cobertura: 'amêndoas laminadas', vegano: false },
    imagem_url: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=800&q=80',
    descricao: 'Croissant folhado tradicional com massa crocante por fora e interior aerado amanteigado.',
    ativo: true,
  },
  {
    id_produto: produtoIdCounter++,
    nome_item: 'Cold Brew Infusão Cítrica Tangerina',
    categoria: 'Cafeteria',
    preco: 19.00,
    estoque: 50,
    atributos: { volume_ml: 350, extracao: 'a frio por 18 horas', grao: 'Mogiana Paulista', acidez: 'brilhante e frutada', vegano: true },
    imagem_url: 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=800&q=80',
    descricao: 'Café extraído a frio extremamente refrescante servido com gelo artesanal e toque de tangerina.',
    ativo: true,
  },
  {
    id_produto: produtoIdCounter++,
    nome_item: 'Toast Rústico Brie & Mel de Cacau',
    categoria: 'Cafeteria',
    preco: 28.00,
    estoque: 20,
    atributos: { pao: 'sourdough multigrãos', ingredientes: ['Queijo Brie da Serra', 'Mel de Cacau Orgânico', 'Nozes Pecan tostadas'], vegetariano: true },
    imagem_url: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=800&q=80',
    descricao: 'Fatia generosa tostada na brasa, harmonização perfeita com cafés filtrados.',
    ativo: true,
  },
];

let petIdCounter = 1;
const petsMem: PetStore[] = [
  {
    id_pet: petIdCounter++,
    nome_pet: 'Pipoca',
    especie: 'Cachorro',
    perfil: { idade_meses: 14, porte: 'Médio', castrado: true, vacinado: true, convive_com_gatos: true, convive_com_criancas: true, energia: 'Moderada', temperamento: 'Carinhosa e calma' },
    imagem_url: 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=800&q=80',
    historia: 'Resgatada nas redondezas da boutique, Pipoca ama receber cafuné e fica super à vontade ao lado dos clientes que tomam café.',
    status: 'Disponível',
    criado_em: new Date(),
  },
  {
    id_pet: petIdCounter++,
    nome_pet: 'Theo',
    especie: 'Cachorro',
    perfil: { idade_meses: 8, porte: 'Grande', castrado: true, vacinado: true, convive_com_gatos: false, convive_com_criancas: true, energia: 'Alta', temperamento: 'Brincalhão e curioso' },
    imagem_url: 'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=800&q=80',
    historia: 'Theo é um filhotão cheio de alegria que adora correr na grama e aprender novos comandos com facilidade.',
    status: 'Disponível',
    criado_em: new Date(),
  },
  {
    id_pet: petIdCounter++,
    nome_pet: 'Mel',
    especie: 'Gato',
    perfil: { idade_meses: 6, porte: 'Pequeno', castrado: true, vacinado: true, convive_com_gatos: true, convive_com_criancas: true, energia: 'Baixa', temperamento: 'Dorminhoca e ronronadora' },
    imagem_url: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=800&q=80',
    historia: 'Mel é uma gatinha doce de olhos expressivos que adora se aninhar no colo enquanto você lê um bom livro.',
    status: 'Disponível',
    criado_em: new Date(),
  },
];

let pedidoIdCounter = 1;
const pedidosMem: PedidoStore[] = [];

// Função Query com suporte unificado a PostgreSQL e Engine Resiliente
export const db = {
  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    // Se tiver pool ativo e funcionando
    if (pool) {
      try {
        const res = await pool.query(sql, params);
        return {
          rows: res.rows,
          rowCount: res.rowCount || res.rows.length,
        };
      } catch (err: any) {
        // Se a conexão falhar ou banco não estiver rodando, use a engine resiliente
        if (!usePostgres) {
          // Fallback silencioso para engine resiliente
        } else {
          throw err;
        }
      }
    }

    // Engine Resiliente (compatível com os comandos das tabelas usuarios, produtos, pets_adocao, pedidos)
    const sqlTrim = sql.trim().toUpperCase();

    // 1. SELECT * FROM usuarios WHERE email = $1
    if (sqlTrim.startsWith('SELECT * FROM USUARIOS WHERE EMAIL')) {
      const email = params[0];
      const user = usuariosMem.find(u => u.email.toLowerCase() === (email || '').toLowerCase());
      return { rows: (user ? [user] : []) as any, rowCount: user ? 1 : 0 };
    }

    // 2. INSERT INTO usuarios (nome_completo, email, senha_hash) VALUES ($1, $2, $3) RETURNING id_usuario, nome_completo, email
    if (sqlTrim.startsWith('INSERT INTO USUARIOS')) {
      const [nome, email, senhaHash] = params;
      const id = crypto.randomUUID();
      const novoUsuario: UsuarioStore = {
        id_usuario: id,
        nome_completo: nome,
        email: email,
        senha_hash: senhaHash,
        role: email.includes('admin') ? 'admin' : 'cliente',
        criado_em: new Date(),
      };
      usuariosMem.push(novoUsuario);
      return {
        rows: [{ id_usuario: id, nome_completo: nome, email: email, role: novoUsuario.role }] as any,
        rowCount: 1,
      };
    }

    // 3. SELECT * FROM produtos WHERE ...
    if (sqlTrim.startsWith('SELECT') && sqlTrim.includes('FROM PRODUTOS')) {
      let filtered = produtosMem.filter(p => p.ativo);
      if (params.length > 0 && params[0]) {
        filtered = filtered.filter(p => p.categoria.toLowerCase() === params[0].toLowerCase());
      }
      return { rows: filtered as any, rowCount: filtered.length };
    }

    // 4. INSERT INTO produtos
    if (sqlTrim.startsWith('INSERT INTO PRODUTOS')) {
      const [nome, categoria, preco, estoque, atributos, imagem, descricao] = params;
      const novoProduto: ProdutoStore = {
        id_produto: produtoIdCounter++,
        nome_item: nome,
        categoria: categoria,
        preco: Number(preco),
        estoque: Number(estoque),
        atributos: typeof atributos === 'string' ? JSON.parse(atributos) : atributos,
        imagem_url: imagem || 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=800&q=80',
        descricao: descricao || '',
        ativo: true,
      };
      produtosMem.push(novoProduto);
      return { rows: [novoProduto] as any, rowCount: 1 };
    }

    // 5. SELECT * FROM pets_adocao
    if (sqlTrim.startsWith('SELECT') && sqlTrim.includes('FROM PETS_ADOCAO')) {
      return { rows: petsMem as any, rowCount: petsMem.length };
    }

    // 6. UPDATE pets_adocao SET status = $1 WHERE id_pet = $2
    if (sqlTrim.startsWith('UPDATE PETS_ADOCAO')) {
      const [status, id] = params;
      const pet = petsMem.find(p => p.id_pet === Number(id));
      if (pet) {
        pet.status = status;
      }
      return { rows: (pet ? [pet] : []) as any, rowCount: pet ? 1 : 0 };
    }

    // 7. INSERT INTO pets_adocao
    if (sqlTrim.startsWith('INSERT INTO PETS_ADOCAO')) {
      const [nome, especie, perfil, imagem, historia] = params;
      const novoPet: PetStore = {
        id_pet: petIdCounter++,
        nome_pet: nome,
        especie: especie,
        perfil: typeof perfil === 'string' ? JSON.parse(perfil) : perfil,
        imagem_url: imagem || 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=800&q=80',
        historia: historia || '',
        status: 'Disponível',
        criado_em: new Date(),
      };
      petsMem.push(novoPet);
      return { rows: [novoPet] as any, rowCount: 1 };
    }

    // 8. INSERT INTO pedidos
    if (sqlTrim.startsWith('INSERT INTO PEDIDOS')) {
      const [idUsuario, total, itens, dadosEntrega] = params;
      const novoPedido: PedidoStore = {
        id_pedido: pedidoIdCounter++,
        id_usuario: idUsuario || null,
        total: Number(total),
        status: 'Recebido com Sucesso',
        itens: typeof itens === 'string' ? JSON.parse(itens) : itens,
        dados_entrega: typeof dadosEntrega === 'string' ? JSON.parse(dadosEntrega) : dadosEntrega,
        criado_em: new Date(),
      };
      pedidosMem.push(novoPedido);
      return { rows: [novoPedido] as any, rowCount: 1 };
    }

    // Default
    return { rows: [], rowCount: 0 };
  },

  // Helper para verificar status
  async checkConnection(): Promise<{ type: string; status: string }> {
    if (pool) {
      try {
        const client = await pool.connect();
        client.release();
        usePostgres = true;
        return { type: 'PostgreSQL', status: 'Conectado' };
      } catch (err) {
        return { type: 'Resiliente (In-Memory JSONB)', status: 'Ativo' };
      }
    }
    return { type: 'Resiliente (In-Memory JSONB)', status: 'Ativo' };
  }
};
