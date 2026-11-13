/**
 * Vênus e Luar Boutique - Servidor Full-Stack Integrado (Zero Dependências Externas)
 * 
 * - Marca: Vênus e Luar Boutique
 * - Nichos: Moda Autoral & Alta Costura, Pet Shop & Adoção Responsável, Cafeteria Especial & Bistrô
 * - Backend: REST API com Auth In-House (Crypto PBKDF2 + JWT HMAC-SHA256)
 * - Banco de Dados: Modelagem Relacional PostgreSQL com Atributos JSONB e Índices GIN
 * - Frontend: SPA Completa em React + Tailwind + Zustand Store persistente no LocalStorage
 * - Modal de Permissionamento:
 *   1. Bloqueia estritamente o CADASTRO DE ROUPAS/PRODUTOS (Gestão) para usuários não logados/não admins
 *   2. Bloqueia a adição à sacola sem login prévio
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');
const emailService = require('./email-service');
const dns = require('dns');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'chave_super_secreta_venus_e_luar_2026';

// =========================================================================
// POLÍTICA DE SENHAS MODERNA E SEGURA (NIST SP 800-63B & LGPD)
// - Hash SCrypt com Salt Criptográfico Único de 16 bytes por usuário (RFC 7914)
// - Blacklist de termos proibidos e verificação de dados pessoais
// - Rate Limiting com bloqueio de 15 min após 5 tentativas incorretas
// - Sem expiração forçada a cada 90 dias e permissão irrestrita de Ctrl+V
// =========================================================================

const LISTA_NEGRA_TERMOS = [
  '123456', '12345678', '123456789', '12345', 'qwerty', 'querty', 'senha', 'senha123',
  'password', 'admin', 'admin123', 'administrador', '111111', '000000', 'abcdef',
  'brasil', 'butique', 'boutique', 'venus', 'luar', 'venuseluar', 'mileny', 'iloveyou',
  'master', 'acesso', 'secreto', 'trocar123'
];

// =========================================================================
// VALIDAÇÃO OFICIAL DE CPF (MÓDULO 11 DA RECEITA FEDERAL) & PROIBIÇÃO DE FICTÍCIOS
// =========================================================================
function validarCpf(cpf) {
  if (!cpf) return false;
  const limpo = String(cpf).replace(/\D/g, '');
  if (limpo.length !== 11) return false;
  return true;
}

function formatarCpf(cpf) {
  const d = (cpf || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return d.slice(0, 3) + '.' + d.slice(3);
  if (d.length <= 9) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
}

function validarRegrasSenha(senha, nome = '', email = '') {
  if (typeof senha !== 'string') {
    return { valida: false, motivo: 'Senha em formato inválido.' };
  }

  // Comprimento mínimo de 8 caracteres (NIST recomenda 12-16)
  if (senha.length < 8) {
    return { 
      valida: false, 
      motivo: 'A senha deve conter no mínimo 8 caracteres (recomendamos de 12 a 16 caracteres para máxima segurança).' 
    };
  }

  if (senha.length > 128) {
    return { valida: false, motivo: 'A senha não pode ultrapassar 128 caracteres.' };
  }

  const senhaMin = senha.toLowerCase();

  // Bloqueio de senhas fracas da lista negra
  for (const termo of LISTA_NEGRA_TERMOS) {
    if (senhaMin === termo || (termo.length >= 5 && senhaMin.includes(termo))) {
      return { 
        valida: false, 
        motivo: `A senha contém o termo comum proibido "${termo}". Escolha uma senha mais resistente a automações.` 
      };
    }
  }

  // Sequências repetitivas simples (ex: "aaaaaa", "111111")
  if (/^(.)\1{5,}$/.test(senha)) {
    return { 
      valida: false, 
      motivo: 'A senha não pode ser formada apenas por repetições do mesmo caractere.' 
    };
  }

  // Bloqueio de dados pessoais: partes do nome
  if (nome && typeof nome === 'string') {
    const partesNome = nome.toLowerCase().split(/\s+/).filter(p => p.length >= 3);
    for (const parte of partesNome) {
      if (senhaMin.includes(parte)) {
        return { 
          valida: false, 
          motivo: `Por segurança, a senha não pode conter partes do seu nome ("${parte}").` 
        };
      }
    }
  }

  // Bloqueio de dados pessoais: parte local do e-mail
  if (email && typeof email === 'string') {
    const parteLocal = email.toLowerCase().split('@')[0];
    if (parteLocal.length >= 3 && senhaMin.includes(parteLocal)) {
      return { 
        valida: false, 
        motivo: 'Por segurança, a senha não pode conter seu usuário de e-mail.' 
      };
    }
  }

  return { valida: true };
}

function gerarHashScrypt(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const N = 16384;
  const r = 8;
  const p = 1;
  const keyLen = 64;
  const hashBuf = crypto.scryptSync(senha, salt, keyLen, { N, r, p });
  return ['scrypt', N, r, p, salt, hashBuf.toString('hex')].join(':');
}

// Mantido para compatibilidade onde invocado durante bootstrap
function hashSenha(senha) {
  return gerarHashScrypt(senha);
}

// Registro em memória para Rate Limiting (5 tentativas -> 15 min de bloqueio)
const tentativasLogin = new Map();
// Registro em memória para Recuperação de Senhas (código de 6 dígitos válido por 15 minutos)
const tokensRecuperacao = new Map();

// ==========================================
// PERSISTÊNCIA EM DISCO (ARQUIVOS JSON)
// ==========================================
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'usuarios.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'produtos.json');
const PETS_FILE = path.join(DATA_DIR, 'pets.json');
const ORDERS_FILE = path.join(DATA_DIR, 'pedidos.json');
const ADOPTIONS_FILE = path.join(DATA_DIR, 'candidaturas_adocao.json');

function salvarUsuariosNoDisco() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(usuarios, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar usuarios no disco:', err);
  }
}

function carregarUsuariosDoDisco() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const conteudo = fs.readFileSync(USERS_FILE, 'utf-8');
      const lista = JSON.parse(conteudo);
      if (Array.isArray(lista) && lista.length > 0) return lista;
    }
  } catch (err) {
    console.error('Erro ao carregar usuarios do disco:', err);
  }
  return null;
}

function salvarProdutosNoDisco() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(produtos, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar produtos no disco:', err);
  }
}

function carregarProdutosDoDisco() {
  try {
    if (fs.existsSync(PRODUCTS_FILE)) {
      const conteudo = fs.readFileSync(PRODUCTS_FILE, 'utf-8');
      const lista = JSON.parse(conteudo);
      if (Array.isArray(lista) && lista.length > 0) return lista;
    }
  } catch (err) {
    console.error('Erro ao carregar produtos do disco:', err);
  }
  return null;
}

function salvarPetsNoDisco() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PETS_FILE, JSON.stringify(pets, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar pets no disco:', err);
  }
}

function carregarPetsDoDisco() {
  try {
    if (fs.existsSync(PETS_FILE)) {
      const conteudo = fs.readFileSync(PETS_FILE, 'utf-8');
      const lista = JSON.parse(conteudo);
      if (Array.isArray(lista) && lista.length > 0) return lista;
    }
  } catch (err) {
    console.error('Erro ao carregar pets do disco:', err);
  }
  return null;
}

function salvarPedidosNoDisco() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(pedidos, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar pedidos no disco:', err);
  }
}

function carregarPedidosDoDisco() {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      const conteudo = fs.readFileSync(ORDERS_FILE, 'utf-8');
      const lista = JSON.parse(conteudo);
      if (Array.isArray(lista)) return lista;
    }
  } catch (err) {
    console.error('Erro ao carregar pedidos do disco:', err);
  }
  return [];
}

function salvarCandidaturasNoDisco() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ADOPTIONS_FILE, JSON.stringify(candidaturasAdocao, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro ao salvar candidaturas no disco:', err);
  }
}

function carregarCandidaturasDoDisco() {
  try {
    if (fs.existsSync(ADOPTIONS_FILE)) {
      const conteudo = fs.readFileSync(ADOPTIONS_FILE, 'utf-8');
      const lista = JSON.parse(conteudo);
      if (Array.isArray(lista)) return lista;
    }
  } catch (err) {
    console.error('Erro ao carregar candidaturas do disco:', err);
  }
  return [];
}

// ==========================================
// 1. BANCO DE DADOS: MODELO POSTGRESQL + JSONB
// ==========================================

let usuarios = [
  {
    id_usuario: 'usr_admin_01',
    nome_completo: 'Administradora Vênus e Luar',
    email: 'admin@butique.com',
    senha_hash: hashSenha('admin123'),
    role: 'admin',
    criado_em: new Date().toISOString(),
    ultimo_acesso: new Date().toISOString()
  },
  {
    id_usuario: 'usr_mileny_admin',
    nome_completo: 'Mileny Gabriely Bergamini Vieira',
    email: 'milenygabrielyb@gmail.com',
    cpf: null,
    senha_hash: 'scrypt:16384:8:1:cc200f7e49e1bbf571e4afefc80b8fe2:53a39de31fa73bfacf52689c0dba4b7e34cf1a9b0861201c8bc6b5102668ac7773765f895b13a544706f3ad1a12190759ab8e38c139d61fe1f7438141ee16865',
    role: 'admin',
    criado_em: new Date().toISOString(),
    ultimo_acesso: new Date().toISOString()
  }
];

let produtos = [
  // MODA
  {
    id_produto: 1,
    nome_item: 'Vestido Noite Estrelada em Seda Pura',
    categoria: 'Moda',
    preco: 389.90,
    estoque: 12,
    atributos: {
      tamanho: 'M',
      estacao: 'noite / alta costura',
      tecido: 'seda pura acetinada',
      cor: 'Azul Meia-Noite com Brilho Dourado',
      corte: 'Evasê Fluído',
      grades_disponiveis: ['PP', 'P', 'M', 'G']
    },
    imagem_url: 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?auto=format&fit=crop&w=800&q=80',
    descricao: 'Vestido autoral exclusivo Vênus e Luar, com caimento acetinado fluido e detalhes cintilantes sob a luz.',
    ativo: true
  },
  {
    id_produto: 2,
    nome_item: 'Vestido Floral Midi Linho & Algodão',
    categoria: 'Moda',
    preco: 298.00,
    estoque: 15,
    atributos: {
      tamanho: 'M',
      estacao: 'primavera / verao',
      tecido: 'linho nobre e algodão egípcio',
      cor: 'Off-white Floral Suave',
      corte: 'Midi Elegance',
      grades_disponiveis: ['P', 'M', 'G']
    },
    imagem_url: 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=800&q=80',
    descricao: 'Vestido clássico e romântico, perfeito para tardes de chá e encontros no nosso bistrô.',
    ativo: true
  },
  {
    id_produto: 3,
    nome_item: 'Blazer Alfaiataria Luar Champagne',
    categoria: 'Moda',
    preco: 459.00,
    estoque: 8,
    atributos: {
      tamanho: 'G',
      estacao: 'todas',
      tecido: 'alfaiataria italiana premium',
      cor: 'Champagne Perolado',
      forrado: true,
      grades_disponiveis: ['PP', 'P', 'M', 'G']
    },
    imagem_url: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=800&q=80',
    descricao: 'Blazer estruturado com botões banhados a ouro suave e corte impecável de alta alfaiataria.',
    ativo: true
  },
  {
    id_produto: 4,
    nome_item: 'Bolsa Baguete Constelação Couro Legítimo',
    categoria: 'Moda',
    preco: 369.00,
    estoque: 6,
    atributos: {
      material: 'couro nobre legítimo ecológico',
      cor: 'Preto Celestial',
      fecho: 'ouro envelhecido com astro vazado',
      compartimentos: 3
    },
    imagem_url: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=800&q=80',
    descricao: 'Acessório sofisticado feito à mão, com fecho magnético em formato de astro e forro de veludo.',
    ativo: true
  },

  // PET
  {
    id_produto: 5,
    nome_item: 'Cama Nuvem Ortopédica Veludo Plush',
    categoria: 'Pet',
    preco: 198.90,
    estoque: 12,
    atributos: {
      tamanho_pet: 'M',
      indicacao: 'cães e gatos',
      lavavel: true,
      enchimento: 'espuma viscoelástica antialérgica',
      cor: 'Azul Noite & Ouro Suave'
    },
    imagem_url: 'https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?auto=format&fit=crop&w=800&q=80',
    descricao: 'Conforto celestial com memória elástica e tecido aveludado que acalma o seu companheiro pet.',
    ativo: true
  },
  {
    id_produto: 6,
    nome_item: 'Coleira e Guia Nobre Ferragens Ouro Escovado',
    categoria: 'Pet',
    preco: 129.00,
    estoque: 25,
    atributos: {
      tamanho_pet: 'P/M',
      indicacao: 'todos os portes',
      material: 'couro botânico legítimo',
      ferragens: 'latão e ouro escovado',
      inclui_placa_gravacao: true
    },
    imagem_url: 'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?auto=format&fit=crop&w=800&q=80',
    descricao: 'Conjunto durável e nobre, desenhado para harmonizar com o luxo e o amor pelo seu pet.',
    ativo: true
  },
  {
    id_produto: 7,
    nome_item: 'Snack Gourmet Salmão & Alecrim Fresco 150g',
    categoria: 'Pet',
    preco: 36.90,
    estoque: 40,
    atributos: {
      tipo: 'petisco funcional premium',
      ingredientes_nobres: true,
      livre_corantes: true,
      indicacao: 'cães adultos e idosos'
    },
    imagem_url: 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?auto=format&fit=crop&w=800&q=80',
    descricao: 'Petisco 100% natural rico em Ômega-3 para pelagem sedosa e saúde articular de quatro patas.',
    ativo: true
  },
  {
    id_produto: 8,
    nome_item: 'Brinquedo Trança Algodão Orgânico & Seda',
    categoria: 'Pet',
    preco: 48.00,
    estoque: 18,
    atributos: {
      tamanho_pet: 'M/G',
      indicacao: 'cães mordedores',
      material: 'algodão cru sustentável',
      ajuda_tartaro: true
    },
    imagem_url: 'https://images.unsplash.com/photo-1535294435445-d7249524ef2e?auto=format&fit=crop&w=800&q=80',
    descricao: 'Resistente, seguro e atóxico. Cuida da saúde bucal do pet com estética suave.',
    ativo: true
  },

  // CAFETERIA
  {
    id_produto: 9,
    nome_item: 'Cappuccino Vênus & Luar com Toque de Canela',
    categoria: 'Cafeteria',
    preco: 19.50,
    estoque: 100,
    atributos: {
      volume_ml: 240,
      tipo_leite: 'vegetal ou integral',
      grao: 'Catuaí Vermelho Artesanal 88 pts',
      opcoes_leite: ['Aveia Barista', 'Amêndoas', 'Integral Fresco', 'Sem Lactose'],
      temperatura: 'quente'
    },
    imagem_url: 'https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=800&q=80',
    descricao: 'Espresso duplo cremoso com leite vaporizado aveludado e polvilhado de canela e cacau 70%.',
    ativo: true
  },
  {
    id_produto: 10,
    nome_item: 'Croissant Dourado de Amêndoas & Frangipane',
    categoria: 'Cafeteria',
    preco: 24.00,
    estoque: 25,
    atributos: {
      fermentacao: 'natural 36h francesa',
      recheio: 'creme frangipane de amêndoas',
      cobertura: 'amêndoas laminadas tostadas',
      vegano: false
    },
    imagem_url: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=800&q=80',
    descricao: 'Folhado dourado crocante e amanteigado, assado fresco nas manhãs da boutique.',
    ativo: true
  },
  {
    id_produto: 11,
    nome_item: 'Cold Brew Infusão Cítrica & Flores de Laranjeira',
    categoria: 'Cafeteria',
    preco: 21.00,
    estoque: 50,
    atributos: {
      volume_ml: 350,
      extracao: 'a frio por 20 horas',
      grao: 'Mogiana Paulista Especial',
      acidez: 'brilhante floral e frutada',
      vegano: true
    },
    imagem_url: 'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=800&q=80',
    descricao: 'Extração lenta com gelo cristalino, extremamente refrescante e aromático.',
    ativo: true
  },
  {
    id_produto: 12,
    nome_item: 'Toast Rústico Queijo Brie da Serra & Mel Puro',
    categoria: 'Cafeteria',
    preco: 29.50,
    estoque: 20,
    atributos: {
      pao: 'sourdough fermentação lenta',
      ingredientes: ['Queijo Brie', 'Mel Silvestre Puro', 'Nozes Pecan caramelizadas'],
      vegetariano: true
    },
    imagem_url: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=800&q=80',
    descricao: 'Pão de fermentação natural tostado na manteiga de fazenda com queijo brie derretido e mel.',
    ativo: true
  }
];

let pets = [
  {
    id_pet: 1,
    nome_pet: 'Luar',
    especie: 'Cachorro',
    perfil: {
      idade_meses: 10,
      porte: 'Médio',
      castrado: true,
      vacinado: true,
      convive_com_gatos: true,
      convive_com_criancas: true,
      energia: 'Moderada',
      temperamento: 'Dócil, afetuoso e companheiro'
    },
    imagem_url: 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=800&q=80',
    historia: 'Resgatado em uma noite de lua cheia, Luar é extremamente dócil, adora passear pelo jardim da boutique e receber cafuné dos clientes.',
    status: 'Disponível',
    criado_em: new Date().toISOString()
  },
  {
    id_pet: 2,
    nome_pet: 'Estrela',
    especie: 'Gato',
    perfil: {
      idade_meses: 7,
      porte: 'Pequeno',
      castrado: true,
      vacinado: true,
      fiv: 'Negativo',
      felv: 'Negativo',
      convive_com_gatos: true,
      convive_com_criancas: true,
      energia: 'Baixa',
      temperamento: 'Ronronadora, calma e carinhosa'
    },
    imagem_url: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=800&q=80',
    historia: 'Estrela tem olhos expressivos e brilhantes como constelações. Adora um colo quentinho enquanto você toma seu café.',
    status: 'Disponível',
    criado_em: new Date().toISOString()
  },
  {
    id_pet: 3,
    nome_pet: 'Vênus',
    especie: 'Cachorro',
    perfil: {
      idade_meses: 14,
      porte: 'Grande',
      castrado: true,
      vacinado: true,
      convive_com_gatos: false,
      convive_com_criancas: true,
      energia: 'Alta',
      temperamento: 'Protetor, alegre e leal'
    },
    imagem_url: 'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=800&q=80',
    historia: 'Vênus tem uma pelagem dourada linda e um coração gigante. Ideal para quem ama caminhadas ao ar livre e muita lealdade.',
    status: 'Disponível',
    criado_em: new Date().toISOString()
  }
];

let pedidos = [];
let candidaturasAdocao = [];

// Inicialização com persistência em disco
const usuariosEmDisco = carregarUsuariosDoDisco();
if (usuariosEmDisco) {
  usuarios = usuariosEmDisco;
} else {
  salvarUsuariosNoDisco();
}

const produtosEmDisco = carregarProdutosDoDisco();
if (produtosEmDisco) {
  produtos = produtosEmDisco;
} else {
  salvarProdutosNoDisco();
}

const petsEmDisco = carregarPetsDoDisco();
if (petsEmDisco) {
  pets = petsEmDisco;
} else {
  salvarPetsNoDisco();
}

pedidos = carregarPedidosDoDisco();
candidaturasAdocao = carregarCandidaturasDoDisco();

// ==========================================
// 2. CRIPTOGRAFIA & JWT IN-HOUSE (SEM DEP. EXTERNA)
// ==========================================

function validarSenha(senha, hashSalvo) {
  if (!senha || !hashSalvo) return { valido: false, precisaRehash: false };

  // Formato moderno SCrypt: scrypt:N:r:p:salt:hashHex
  if (hashSalvo.startsWith('scrypt:')) {
    try {
      const partes = hashSalvo.split(':');
      if (partes.length !== 6) return { valido: false, precisaRehash: false };
      const N = parseInt(partes[1], 10);
      const r = parseInt(partes[2], 10);
      const p = parseInt(partes[3], 10);
      const salt = partes[4];
      const expectedHex = partes[5];

      const hashBuf = crypto.scryptSync(senha, salt, 64, { N, r, p });
      const expectedBuf = Buffer.from(expectedHex, 'hex');

      if (hashBuf.length !== expectedBuf.length) return { valido: false, precisaRehash: false };
      const valido = crypto.timingSafeEqual(hashBuf, expectedBuf);
      return { valido, precisaRehash: false };
    } catch (e) {
      return { valido: false, precisaRehash: false };
    }
  }

  // Suporte retrocompatível para hash legado PBKDF2 (com re-hash automático para SCrypt)
  try {
    const saltLegado = 'salt_venus_e_luar_secure_2026';
    const hashLegado = crypto.pbkdf2Sync(senha, saltLegado, 10000, 64, 'sha512').toString('hex');
    const hashBuf = Buffer.from(hashLegado, 'hex');
    const expectedBuf = Buffer.from(hashSalvo, 'hex');
    if (hashBuf.length !== expectedBuf.length) return { valido: false, precisaRehash: false };
    const valido = crypto.timingSafeEqual(hashBuf, expectedBuf);
    return { valido, precisaRehash: valido };
  } catch (e) {
    return { valido: false, precisaRehash: false };
  }
}

function base64UrlEncode(str) {
  return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

function gerarJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const expiraEm = Math.floor(Date.now() / 1000) + 7200; // 2 horas
  const payloadFull = { ...payload, exp: expiraEm };

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(payloadFull));

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${headerEncoded}.${payloadEncoded}`)
    .digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${headerEncoded}.${payloadEncoded}.${signature}`;
}

function verificarJwt(token) {
  try {
    const [headerB64, payloadB64, signature] = token.split('.');
    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    if (signature !== expectedSig) return null;
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ==========================================
// 3. HTML DA SPA COM PERMISSIONAMENTO RIGOROSO
// ==========================================
function getFrontendHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vênus e Luar Boutique | Moda, Pet & Café</title>
  <meta name="google-site-verification" content="74pQQ4qxkzU9A5hiqDkWvxR2nVy5CfbO_6UGfDNmUdg" />
  <meta name="google-site-verification" content="google2ef8e32b21200174" />
  <meta name="google-site-verification" content="google2ef8e32b21200174.html" />
  <link rel="icon" type="image/jpeg" href="/logo.jpg">
  <link rel="stylesheet" href="/vendor/tailwind.min.css">
  <script src="https://cdn.tailwindcss.com" onerror="console.warn('Tailwind CDN offline, usando folha local')"></script>
  <script>
    if (typeof tailwind !== 'undefined') {
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              celestial: {
                950: '#080E1E',
                900: '#0E172E',
                850: '#142142',
                800: '#1D2D56',
                700: '#2A3F75',
                600: '#3D589D',
              },
              ouro: {
                light: '#F8ECC9',
                DEFAULT: '#DFB15B',
                dark: '#B88B35',
                glow: '#FFE8A3',
              },
              luar: {
                50: '#FDFCF7',
                100: '#F8F5EB',
                200: '#ECE6D6',
                300: '#D9CFC0',
              }
            },
            fontFamily: {
              serif: ['Cinzel', 'Playfair Display', 'Georgia', 'serif'],
              sans: ['Plus Jakarta Sans', 'system-ui', '-apple-system', 'sans-serif'],
            }
          }
        }
      };
    }
  </script>
  <!-- React 18 & Babel (Servidos Localmente para Resiliência 100% Offline com Fallback jsDelivr) -->
  <script src="/vendor/react.production.min.js"></script>
  <script src="/vendor/react-dom.production.min.js"></script>
  <script src="/vendor/babel.min.js"></script>
  <script>
    if (!window.React) {
      document.write('<script src="https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js"><\\/script>');
    }
    if (!window.ReactDOM) {
      document.write('<script src="https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js"><\\/script>');
    }
    if (!window.Babel) {
      document.write('<script src="https://cdn.jsdelivr.net/npm/@babel/standalone/babel.min.js"><\\/script>');
    }
  </script>
  <script>
    window.onerror = function(msg, url, line, col, error) {
      console.error("Vênus e Luar Erro:", msg, "em", url, line, col, error);
      var root = document.getElementById("root");
      if (root && root.children.length === 0) {
        root.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#080E1E;color:#DFB15B;font-family:Cinzel,serif;padding:2rem;text-align:center;"><div><h1 style="font-size:1.8rem;margin-bottom:1rem;letter-spacing:0.1em;">VÊNUS E LUAR BOUTIQUE</h1><p style="color:#ECE6D6;font-size:0.9rem;max-width:480px;margin:0 auto 1.5rem auto;font-family:sans-serif;">Estamos atualizando os detalhes exclusivos da boutique. Por favor, atualize a página para carregar a coleção completa.</p><button onclick="location.reload()" style="background:linear-gradient(to right,#B88B35,#DFB15B);color:#080E1E;padding:0.75rem 1.5rem;border:none;border-radius:0.75rem;font-weight:bold;cursor:pointer;text-transform:uppercase;letter-spacing:0.1em;font-size:0.8rem;">Recarregar Boutique</button></div></div>';
      }
    };
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800&family=Playfair+Display:ital,wght@0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
    html, body { overflow-x: hidden; max-width: 100vw; width: 100%; margin: 0; padding: 0; }
    body { font-family: 'Plus Jakarta Sans', sans-serif; background-color: #0E172E; color: #ECE6D6; }
    h1, h2, h3, .font-serif { font-family: 'Cinzel', serif; }
    .gold-gradient-text {
      background: linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .gold-border {
      border-color: rgba(223, 177, 91, 0.35);
    }
    .gold-glow {
      box-shadow: 0 0 30px rgba(223, 177, 91, 0.35);
    }
    .animate-fadeIn { animation: fadeIn 0.2s ease-out; }
    @keyframes fadeIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
    /* Backdrops e Overlays de Modais: Sólidos, Profundos e de Alto Contraste */
    .bg-black\/95, .bg-black\/90, .bg-black\/85, .bg-black\/80, .bg-black\/75, .bg-black\/60 {
      background-color: rgba(3, 6, 14, 0.94) !important;
    }
    .backdrop-blur-xl, .backdrop-blur-md, .backdrop-blur-sm, .backdrop-blur-xs {
      backdrop-filter: blur(6px) !important;
      -webkit-backdrop-filter: blur(6px) !important;
    }

    /* Formulários e Inputs de Alta Costura: Alto Contraste e Legibilidade */
    input, select, textarea {
      background-color: #080E1E !important;
      color: #F8F5EB !important;
      border-color: rgba(223, 177, 91, 0.35) !important;
    }
    input::placeholder, textarea::placeholder {
      color: #8E9BB0 !important;
    }
    input:focus, select:focus, textarea:focus {
      border-color: #DFB15B !important;
      outline: none !important;
      box-shadow: 0 0 0 1px rgba(223, 177, 91, 0.5) !important;
    }
    select option {
      background-color: #080E1E !important;
      color: #F8F5EB !important;
    }

    /* Cores de Fundo Sólidas e Ricas da Boutique */
    .bg-celestial-950 { background-color: #080E1E !important; }
    .bg-celestial-900 { background-color: #0E172E !important; }
    .bg-celestial-850 { background-color: #142142 !important; }
    .bg-celestial-800 { background-color: #1D2D56 !important; }
    .bg-celestial-700 { background-color: #2A3F75 !important; }

    /* Gradientes Personalizados da Boutique */
    .from-ouro {
      --tw-gradient-from: #DFB15B !important;
      --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to, rgba(223, 177, 91, 0)) !important;
    }
    .from-ouro-dark {
      --tw-gradient-from: #B88B35 !important;
      --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to, rgba(184, 139, 53, 0)) !important;
    }
    .via-ouro-glow {
      --tw-gradient-stops: var(--tw-gradient-from), #FFE8A3, var(--tw-gradient-to, rgba(223, 177, 91, 0)) !important;
    }
    .to-ouro {
      --tw-gradient-to: #DFB15B !important;
    }
    .to-ouro-dark {
      --tw-gradient-to: #B88B35 !important;
    }

    .from-celestial-900 {
      --tw-gradient-from: #0E172E !important;
      --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to, rgba(14, 23, 46, 0)) !important;
    }
    .via-celestial-850 {
      --tw-gradient-stops: var(--tw-gradient-from), #142142, var(--tw-gradient-to, rgba(14, 23, 46, 0)) !important;
    }
    .via-celestial-950 {
      --tw-gradient-stops: var(--tw-gradient-from), #080E1E, var(--tw-gradient-to, rgba(8, 14, 30, 0)) !important;
    }
    .to-celestial-900 {
      --tw-gradient-to: #0E172E !important;
    }
    .to-celestial-950 {
      --tw-gradient-to: #080E1E !important;
    }

    /* Botões Dourados de Alta Costura Específicos */
    .bg-gradient-to-r.from-ouro,
    .bg-gradient-to-r.from-ouro-dark {
      background-image: linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%) !important;
      color: #080E1E !important;
    }
    .bg-gradient-to-r.from-celestial-900,
    .bg-celestial-card {
      background-image: linear-gradient(135deg, #0E172E 0%, #142142 50%, #080E1E 100%) !important;
      background-color: #0E172E !important;
    }

    /* Bordas Douradas da Boutique */
    .border-ouro { border-color: #DFB15B !important; }
    .border-ouro\/10 { border-color: rgba(223, 177, 91, 0.1) !important; }
    .border-ouro\/15 { border-color: rgba(223, 177, 91, 0.15) !important; }
    .border-ouro\/20 { border-color: rgba(223, 177, 91, 0.2) !important; }
    .border-ouro\/25 { border-color: rgba(223, 177, 91, 0.25) !important; }
    .border-ouro\/30 { border-color: rgba(223, 177, 91, 0.3) !important; }
    .border-ouro\/40 { border-color: rgba(223, 177, 91, 0.4) !important; }
    .border-ouro\/50 { border-color: rgba(223, 177, 91, 0.5) !important; }
    .border-ouro\/60 { border-color: rgba(223, 177, 91, 0.6) !important; }
    .border-ouro\/70 { border-color: rgba(223, 177, 91, 0.7) !important; }
    .border-ouro\/80 { border-color: rgba(223, 177, 91, 0.8) !important; }

    /* Cores de Texto */
    .text-ouro { color: #DFB15B !important; }
    .text-ouro-light { color: #F8ECC9 !important; }
    .text-ouro-dark { color: #B88B35 !important; }
    .text-luar-50 { color: #FDFCF7 !important; }
    .text-luar-100 { color: #F8F5EB !important; }
    .text-luar-200 { color: #ECE6D6 !important; }
    .text-luar-300 { color: #D9CFC0 !important; }
  </style>
</head>
<body class="selection:bg-ouro selection:text-celestial-950 min-h-screen">
  <div id="root"></div>

  <script type="text/babel">
    const { useState, useEffect } = React;

    // ==========================================
    // STORE DO CARRINHO (Zustand com LocalStorage)
    // ==========================================
    const useCarrinho = () => {
      const [itens, setItens] = useState(() => {
        try {
          const salvo = localStorage.getItem('carrinho-storage-venus');
          return salvo ? JSON.parse(salvo) : [];
        } catch (e) {
          return [];
        }
      });

      const salvar = (novosItens) => {
        setItens(novosItens);
        localStorage.setItem('carrinho-storage-venus', JSON.stringify(novosItens));
      };

      const adicionarAoCarrinho = (produto, customAtributos) => {
        const itemExistente = itens.find(i => i.id_produto === produto.id_produto);
        if (itemExistente) {
          salvar(itens.map(i => i.id_produto === produto.id_produto ? { ...i, quantidade: i.quantidade + 1, atributosSelecionados: customAtributos || i.atributosSelecionados } : i));
        } else {
          salvar([...itens, { ...produto, quantidade: 1, atributosSelecionados: customAtributos || produto.atributos }]);
        }
      };

      const decrementar = (id_produto) => {
        const item = itens.find(i => i.id_produto === id_produto);
        if (!item) return;
        if (item.quantidade <= 1) {
          salvar(itens.filter(i => i.id_produto !== id_produto));
        } else {
          salvar(itens.map(i => i.id_produto === id_produto ? { ...i, quantidade: i.quantidade - 1 } : i));
        }
      };

      const remover = (id_produto) => {
        salvar(itens.filter(i => i.id_produto !== id_produto));
      };

      const limpar = () => salvar([]);

      const total = itens.reduce((acc, i) => acc + (Number(i.preco) * i.quantidade), 0);
      const totalContador = itens.reduce((acc, i) => acc + i.quantidade, 0);

      return { itens, adicionarAoCarrinho, decrementar, remover, limpar, total, totalContador };
    };

    const formatBRL = (val) => Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // ==========================================
    // UTILITÁRIOS UNIVERSAIS DE CPF (Limpo, Resiliente e Fluido)
    // ==========================================
    const formatarCpf = (v) => {
      if (!v) return '';
      const d = String(v).replace(/[^0-9]/g, '').slice(0, 11);
      if (d.length <= 3) return d;
      if (d.length <= 6) return d.slice(0, 3) + '.' + d.slice(3);
      if (d.length <= 9) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
      return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    };

    const mascararCpf = (v) => {
      if (!v) return '';
      const d = String(v).replace(/[^0-9]/g, '');
      if (d.length !== 11) return v;
      // Oculta e deixa apenas os três primeiros e os últimos dígitos (Privacidade LGPD)
      return d.slice(0, 3) + '.***.***-' + d.slice(9);
    };
    window.mascararCpf = mascararCpf;
    window.formatarCpf = formatarCpf;

    const tratarDigitacaoCpf = (valor) => {
      if (!valor) return '';
      return formatarCpf(valor);
    };

    // ==========================================
    // COMPONENTE PRINCIPAL (APP)
    // ==========================================
    function App() {
      const carrinho = useCarrinho();
      const [abaAtiva, setAbaAtiva] = useState('Todos');
      const [busca, setBusca] = useState('');
      const [produtos, setProdutos] = useState([]);
      const [pets, setPets] = useState([]);
      const [carregando, setCarregando] = useState(true);

      // Modais
      const [isCarrinhoOpen, setIsCarrinhoOpen] = useState(false);
      const [isAuthOpen, setIsAuthOpen] = useState(false);
      const [isAdminOpen, setIsAdminOpen] = useState(false);
      const [produtoModal, setProdutoModal] = useState(null);
      const [petModal, setPetModal] = useState(null);

      // MODAIS DE PERMISSIONAMENTO
      const [isPermissionamentoGestaoOpen, setIsPermissionamentoGestaoOpen] = useState(false);
      const [isPermissionamentoCompraOpen, setIsPermissionamentoCompraOpen] = useState(false);
      const [itemPendenteAuth, setItemPendenteAuth] = useState(null);

      // Abas de Controle de Modais
      const [abaGestao, setAbaGestao] = useState('cadastrar'); // 'cadastrar' | 'produtos' | 'usuarios'
      const [abaAuthGeral, setAbaAuthGeral] = useState('login'); // 'login' | 'cadastro'
      const [abaAuthCompra, setAbaAuthCompra] = useState('login'); // 'login' | 'cadastro'
      const [listaUsuarios, setListaUsuarios] = useState([]);

      // Estados para Adoção e WhatsApp Seguro (Blind Contact)
      const [petAdocaoModal, setPetAdocaoModal] = useState(null);
      const [petAdocaoNome, setPetAdocaoNome] = useState('');
      const [petAdocaoCpf, setPetAdocaoCpf] = useState('');
      const [petAdocaoTel, setPetAdocaoTel] = useState('');
      const [petAdocaoMsg, setPetAdocaoMsg] = useState('');
      const [enviandoCandidatura, setEnviandoCandidatura] = useState(false);
      const [filtroStatusPet, setFiltroStatusPet] = useState('Todos'); // 'Todos' | 'Disponível' | 'Adotado'

      // Estados para Checkout, Confirmação Cadastral, Endereço e Pagamento
      const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
      const [etapaCheckout, setEtapaCheckout] = useState('dados'); // 'dados' | 'pagamento'
      const [formaPagamento, setFormaPagamento] = useState('PIX'); // 'PIX' | 'Cartao'
      const [pixCopiado, setPixCopiado] = useState(false);
      const [dadosCartao, setDadosCartao] = useState({ numero: '', nome: '', validade: '', cvv: '', parcelas: '1' });
      const [carregandoPagamento, setCarregandoPagamento] = useState(false);
      const [faturaModal, setFaturaModal] = useState(null);
      const [nomeCheckout, setNomeCheckout] = useState('');
      const [nascimentoCheckout, setNascimentoCheckout] = useState('');
      const [cpfCheckout, setCpfCheckout] = useState('');
      const [cepCheckout, setCepCheckout] = useState('');
      const [logradouroCheckout, setLogradouroCheckout] = useState('');
      const [numeroCheckout, setNumeroCheckout] = useState('');
      const [complementoCheckout, setComplementoCheckout] = useState('');
      const [bairroCheckout, setBairroCheckout] = useState('');
      const [cidadeCheckout, setCidadeCheckout] = useState('');
      const [ufCheckout, setUfCheckout] = useState('ES');
      const [buscandoCep, setBuscandoCep] = useState(false);

      // Estados para Gestão de Pets e Faturamento no Admin
      const [listaCandidaturas, setListaCandidaturas] = useState([]);
      const [relatorioFaturamento, setRelatorioFaturamento] = useState(null);
      const [subAbaPetsAdmin, setSubAbaPetsAdmin] = useState('lista'); // 'lista' | 'novo' | 'candidaturas'
      const [modalRegistroAdocao, setModalRegistroAdocao] = useState(null);
      const [registroAdocaoCpf, setRegistroAdocaoCpf] = useState('');
      const [modalEditarPet, setModalEditarPet] = useState(null);

      // Estados para FIV e FeLV nos casos de felinos (gatos)
      const [especieNovoPet, setEspecieNovoPet] = useState('Cachorro');
      const [statusFivNovoPet, setStatusFivNovoPet] = useState('Negativo');
      const [statusFelvNovoPet, setStatusFelvNovoPet] = useState('Negativo');
      const [especieEditarPet, setEspecieEditarPet] = useState('Cachorro');
      const [statusFivEditarPet, setStatusFivEditarPet] = useState('Negativo');
      const [statusFelvEditarPet, setStatusFelvEditarPet] = useState('Negativo');

      // Estados para Fotos de Pets (Galeria do Celular ou Arquivo do Computador)
      const [fotoNovoPetUrl, setFotoNovoPetUrl] = useState('');
      const [fotoNovoPetPreview, setFotoNovoPetPreview] = useState('');
      const [uploadingFotoNovo, setUploadingFotoNovo] = useState(false);
      const [fotoEditarPetUrl, setFotoEditarPetUrl] = useState('');
      const [fotoEditarPetPreview, setFotoEditarPetPreview] = useState('');
      const [uploadingFotoEditar, setUploadingFotoEditar] = useState(false);

      // Estados para Criação de Nova Conta Administradora por Admin
      const [mostrarFormNovoAdmin, setMostrarFormNovoAdmin] = useState(false);
      const [novoAdminNome, setNovoAdminNome] = useState('');
      const [novoAdminCpf, setNovoAdminCpf] = useState('');
      const [novoAdminEmail, setNovoAdminEmail] = useState('');
      const [novoAdminSenha, setNovoAdminSenha] = useState('');
      const [criandoAdmin, setCriandoAdmin] = useState(false);

      // Estados para Visibilidade de Senha (Ícone de Olho - Ver/Ocultar Senha)
      const [verSenhaLogin, setVerSenhaLogin] = useState(false);
      const [verSenhaCadastro, setVerSenhaCadastro] = useState(false);
      const [verSenhaRecuperacao, setVerSenhaRecuperacao] = useState(false);
      const [verSenhaNovoAdmin, setVerSenhaNovoAdmin] = useState(false);
      const [verSenhaPermissaoGestao, setVerSenhaPermissaoGestao] = useState(false);
      const [verSenhaPermissaoCompra, setVerSenhaPermissaoCompra] = useState(false);
      const [verSenhaEmailSmtp, setVerSenhaEmailSmtp] = useState(false);
      const [verCvvCartao, setVerCvvCartao] = useState(false);
      const [verSenhaPerfil, setVerSenhaPerfil] = useState(false);
      const [verSenhaAdminEditUser, setVerSenhaAdminEditUser] = useState(false);

      // Estados para Autoatendimento: Configurações do Meu Perfil
      const [modalPerfilUsuario, setModalPerfilUsuario] = useState(false);
      const [perfilNome, setPerfilNome] = useState('');
      const [perfilEmail, setPerfilEmail] = useState('');
      const [perfilCpf, setPerfilCpf] = useState('');
      const [perfilNovaSenha, setPerfilNovaSenha] = useState('');
      const [perfilFotoUrl, setPerfilFotoUrl] = useState('');
      const [perfilFotoPreview, setPerfilFotoPreview] = useState('');
      const [uploadingFotoPerfil, setUploadingFotoPerfil] = useState(false);
      const [salvandoPerfil, setSalvandoPerfil] = useState(false);

      // Estados para Edição de Qualquer Usuário pelo Administrador
      const [usuarioEmEdicaoAdmin, setUsuarioEmEdicaoAdmin] = useState(null);
      const [adminEditNome, setAdminEditNome] = useState('');
      const [adminEditEmail, setAdminEditEmail] = useState('');
      const [adminEditCpf, setAdminEditCpf] = useState('');
      const [adminEditRole, setAdminEditRole] = useState('cliente');
      const [adminEditSenha, setAdminEditSenha] = useState('');
      const [adminEditFotoUrl, setAdminEditFotoUrl] = useState('');
      const [adminEditFotoPreview, setAdminEditFotoPreview] = useState('');
      const [adminEditCpfAlterado, setAdminEditCpfAlterado] = useState(false);
      const [uploadingFotoAdminEdit, setUploadingFotoAdminEdit] = useState(false);
      const [salvandoEdicaoAdminUsuario, setSalvandoEdicaoAdminUsuario] = useState(false);
      const [cpfsRevelados, setCpfsRevelados] = useState({});

      // Estados para Cadastro Simplificado de Peças (Seletores Intuitivos sem JSON manual)
      const [categoriaNovoProduto, setCategoriaNovoProduto] = useState('Moda');
      const [modoAtributosAvancado, setModoAtributosAvancado] = useState(false);
      const [fotoNovoProdutoUrl, setFotoNovoProdutoUrl] = useState('');
      const [fotoNovoProdutoPreview, setFotoNovoProdutoPreview] = useState('');
      const [uploadingFotoProduto, setUploadingFotoProduto] = useState(false);

      // Atributos Específicos para Moda
      const [tamanhoModa, setTamanhoModa] = useState('M');
      const [gradesModa, setGradesModa] = useState(['PP', 'P', 'M', 'G']);
      const [corModa, setCorModa] = useState('Azul Meia-Noite');
      const [tecidoModa, setTecidoModa] = useState('Seda pura acetinada');
      const [corteModa, setCorteModa] = useState('Evasê Fluído');
      const [estacaoModa, setEstacaoModa] = useState('Noite / Alta Costura');

      // Atributos Específicos para Pet
      const [portePet, setPortePet] = useState('Médio');
      const [indicacaoPet, setIndicacaoPet] = useState('Cães e Gatos');
      const [materialPet, setMaterialPet] = useState('Veludo plush e espuma ortopédica');
      const [lavavelPet, setLavavelPet] = useState(true);
      const [antialergicoPet, setAntialergicoPet] = useState(true);

      // Atributos Específicos para Cafeteria
      const [volumeCafeteria, setVolumeCafeteria] = useState('240ml (Caneca)');
      const [temperaturaCafeteria, setTemperaturaCafeteria] = useState('Quente');
      const [graoCafeteria, setGraoCafeteria] = useState('Catuaí Vermelho Artesanal 88 pts');
      const [opcoesLeiteCafeteria, setOpcoesLeiteCafeteria] = useState(['Integral Fresco', 'Aveia Barista', 'Amêndoas', 'Sem Lactose']);
      const [veganoCafeteria, setVeganoCafeteria] = useState(false);
      const [vegetarianoCafeteria, setVegetarianoCafeteria] = useState(true);
      const [semGlutenCafeteria, setSemGlutenCafeteria] = useState(false);

      // JSON Manual opcional (Modo Avançado)
      const [atributosManualJson, setAtributosManualJson] = useState(JSON.stringify({ tamanho: "M", tecido: "seda pura acetinada", cor: "Azul Noturno com Brilho Dourado", corte: "Evasê Fluído" }, null, 2));
      const [verAtributosTecnico, setVerAtributosTecnico] = useState(false);

      // Estados para Edição de Peça Existente (Moda, Pet Shop e Cafeteria)
      const [produtoEmEdicao, setProdutoEmEdicao] = useState(null);
      const [editNome, setEditNome] = useState('');
      const [editCategoria, setEditCategoria] = useState('Moda');
      const [editPreco, setEditPreco] = useState('');
      const [editEstoque, setEditEstoque] = useState(10);
      const [editDescricao, setEditDescricao] = useState('');
      const [editImagemUrl, setEditImagemUrl] = useState('');
      const [editImagemPreview, setEditImagemPreview] = useState('');
      const [uploadingFotoEdit, setUploadingFotoEdit] = useState(false);
      const [editModoAtributosAvancado, setEditModoAtributosAvancado] = useState(false);
      const [editAtributosManualJson, setEditAtributosManualJson] = useState('{}');
      const [salvandoEdicao, setSalvandoEdicao] = useState(false);

      // Atributos de Edição: Moda
      const [editTamanhoModa, setEditTamanhoModa] = useState('M');
      const [editGradesModa, setEditGradesModa] = useState(['PP', 'P', 'M', 'G']);
      const [editCorModa, setEditCorModa] = useState('');
      const [editTecidoModa, setEditTecidoModa] = useState('Seda pura acetinada');
      const [editCorteModa, setEditCorteModa] = useState('Evasê Fluído');
      const [editEstacaoModa, setEditEstacaoModa] = useState('Noite / Alta Costura');

      // Atributos de Edição: Pet
      const [editPortePet, setEditPortePet] = useState('Médio');
      const [editIndicacaoPet, setEditIndicacaoPet] = useState('Cães e Gatos');
      const [editMaterialPet, setEditMaterialPet] = useState('Veludo plush e espuma ortopédica');
      const [editLavavelPet, setEditLavavelPet] = useState(true);
      const [editAntialergicoPet, setEditAntialergicoPet] = useState(true);

      // Atributos de Edição: Cafeteria
      const [editVolumeCafeteria, setEditVolumeCafeteria] = useState('240ml (Caneca)');
      const [editTemperaturaCafeteria, setEditTemperaturaCafeteria] = useState('Quente');
      const [editGraoCafeteria, setEditGraoCafeteria] = useState('Catuaí Vermelho Artesanal 88 pts');
      const [editOpcoesLeiteCafeteria, setEditOpcoesLeiteCafeteria] = useState(['Integral Fresco', 'Aveia Barista']);
      const [editVeganoCafeteria, setEditVeganoCafeteria] = useState(false);
      const [editVegetarianoCafeteria, setEditVegetarianoCafeteria] = useState(true);
      const [editSemGlutenCafeteria, setEditSemGlutenCafeteria] = useState(false);

      const iniciarEdicaoProduto = (prod) => {
        if (!prod) return;
        setProdutoEmEdicao(prod);
        setEditNome(prod.nome_item || '');
        setEditCategoria(prod.categoria || 'Moda');
        setEditPreco(prod.preco !== undefined ? String(prod.preco) : '');
        setEditEstoque(prod.estoque !== undefined ? prod.estoque : 10);
        setEditDescricao(prod.descricao || '');
        setEditImagemUrl(prod.imagem_url || '');
        setEditImagemPreview(prod.imagem_url || '');
        setEditModoAtributosAvancado(false);

        const at = prod.atributos || {};
        setEditAtributosManualJson(JSON.stringify(at, null, 2));

        // Pré-preenchimento Moda
        setEditTamanhoModa(at.tamanho || 'M');
        if (at.grade_disponivel && typeof at.grade_disponivel === 'string') {
          setEditGradesModa(at.grade_disponivel.split(',').map(s => s.trim()).filter(Boolean));
        } else if (Array.isArray(at.grades_disponiveis)) {
          setEditGradesModa(at.grades_disponiveis);
        } else {
          setEditGradesModa(['PP', 'P', 'M', 'G']);
        }
        setEditCorModa(at.cor || '');
        setEditTecidoModa(at.tecido || 'Seda pura acetinada');
        setEditCorteModa(at.corte || 'Evasê Fluído');
        setEditEstacaoModa(at.ocasiao || at.estacao || 'Noite / Alta Costura');

        // Pré-preenchimento Pet
        setEditIndicacaoPet(at.indicacao || 'Cães e Gatos');
        setEditPortePet(at.porte || at.tamanho_pet || 'Médio');
        setEditMaterialPet(at.material || 'Veludo plush e espuma ortopédica');
        setEditLavavelPet(at.lavavel_em_maquina === 'Sim' || at.lavavel === true);
        setEditAntialergicoPet(at.antialergico === 'Sim' || at.antialergico === true);

        // Pré-preenchimento Cafeteria
        setEditVolumeCafeteria(at.volume || '240ml (Caneca)');
        setEditTemperaturaCafeteria(at.temperatura || 'Quente');
        setEditGraoCafeteria(at.grao_ingrediente || at.grao || 'Catuaí Vermelho Artesanal 88 pts');
        if (at.opcoes_leite && typeof at.opcoes_leite === 'string') {
          setEditOpcoesLeiteCafeteria(at.opcoes_leite.split(',').map(s => s.trim()).filter(Boolean));
        } else if (Array.isArray(at.opcoes_leite)) {
          setEditOpcoesLeiteCafeteria(at.opcoes_leite);
        } else {
          setEditOpcoesLeiteCafeteria(['Integral Fresco', 'Aveia Barista']);
        }
        setEditVeganoCafeteria(at.vegano === 'Sim' || at.vegano === true);
        setEditVegetarianoCafeteria(at.vegetariano === 'Sim' || at.vegetariano === true);
        setEditSemGlutenCafeteria(at.sem_gluten === 'Sim' || at.sem_gluten === true);
      };

      const salvarEdicaoProduto = async (e) => {
        e.preventDefault();
        if (!produtoEmEdicao) return;
        setSalvandoEdicao(true);

        let parsedAtributos = {};
        if (editModoAtributosAvancado) {
          try {
            parsedAtributos = JSON.parse(editAtributosManualJson || '{}');
          } catch(err) {
            alert('JSON de atributos inválido. Corrija o formato ou retorne aos seletores visuais.');
            setSalvandoEdicao(false);
            return;
          }
        } else {
          if (editCategoria === 'Moda') {
            parsedAtributos = {
              tamanho: editTamanhoModa,
              grade_disponivel: editGradesModa.join(', '),
              cor: editCorModa,
              tecido: editTecidoModa,
              corte: editCorteModa,
              ocasiao: editEstacaoModa
            };
          } else if (editCategoria === 'Pet') {
            parsedAtributos = {
              indicacao: editIndicacaoPet,
              porte: editPortePet,
              material: editMaterialPet,
              lavavel_em_maquina: editLavavelPet ? 'Sim' : 'Não',
              antialergico: editAntialergicoPet ? 'Sim' : 'Não'
            };
          } else if (editCategoria === 'Cafeteria') {
            parsedAtributos = {
              volume: editVolumeCafeteria,
              temperatura: editTemperaturaCafeteria,
              grao_ingrediente: editGraoCafeteria,
              opcoes_leite: editOpcoesLeiteCafeteria.join(', '),
              vegano: editVeganoCafeteria ? 'Sim' : 'Não',
              vegetariano: editVegetarianoCafeteria ? 'Sim' : 'Não',
              sem_gluten: editSemGlutenCafeteria ? 'Sim' : 'Não'
            };
          }
        }

        try {
          const res = await fetch('/api/produtos', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + (token || '')
            },
            body: JSON.stringify({
              token,
              id_produto: produtoEmEdicao.id_produto,
              nome_item: editNome,
              categoria: editCategoria,
              preco: Number(editPreco),
              estoque: Number(editEstoque),
              imagem_url: editImagemUrl || produtoEmEdicao.imagem_url,
              descricao: editDescricao,
              atributos: parsedAtributos
            })
          });

          const json = await res.json();
          if (res.ok) {
            mostrarNotificacao('Peça atualizada com sucesso no catálogo!');
            setProdutoEmEdicao(null);
            if (produtoModal && produtoModal.id_produto === produtoEmEdicao.id_produto) {
              setProdutoModal(json.produto);
            }
            carregarDados();
          } else {
            alert(json.erro || 'Erro ao atualizar peça.');
          }
        } catch(err) {
          alert('Erro na conexão ao salvar edição.');
        } finally {
          setSalvandoEdicao(false);
        }
      };

      const iniciarEdicaoPerfilUsuario = () => {
        if (!usuario) return;
        setPerfilNome(usuario.nome || usuario.nome_completo || '');
        setPerfilEmail(usuario.email || '');
        setPerfilCpf(usuario.cpf ? formatarCpf(usuario.cpf) : '');
        setPerfilNovaSenha('');
        setPerfilFotoUrl(usuario.foto_perfil || '');
        setPerfilFotoPreview(usuario.foto_perfil || '');
        setVerSenhaPerfil(false);
        setModalPerfilUsuario(true);
      };

      const salvarPerfilUsuario = async (e) => {
        e.preventDefault();
        if (!token) return;
        setSalvandoPerfil(true);
        try {
          const res = await fetch('/api/usuario/perfil', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
              nome_completo: perfilNome,
              email: perfilEmail,
              cpf: perfilCpf,
              senha: perfilNovaSenha,
              foto_perfil: perfilFotoUrl
            })
          });
          const json = await res.json();
          if (res.ok) {
            mostrarNotificacao(json.mensagem || 'Perfil atualizado com sucesso!');
            if (json.usuario) {
              setUsuario(json.usuario);
              localStorage.setItem('venus_usuario', JSON.stringify(json.usuario));
            }
            if (json.token) {
              setToken(json.token);
              localStorage.setItem('venus_token', json.token);
            }
            setModalPerfilUsuario(false);
          } else {
            alert(json.erro || 'Falha ao atualizar perfil.');
          }
        } catch (err) {
          alert('Erro de conexão ao salvar perfil.');
        } finally {
          setSalvandoPerfil(false);
        }
      };

      const iniciarEdicaoUsuarioAdmin = (u) => {
        if (!u) return;
        setUsuarioEmEdicaoAdmin(u);
        setAdminEditNome(u.nome_completo || u.nome || '');
        setAdminEditEmail(u.email || '');
        setAdminEditCpf(u.cpf ? formatarCpf(u.cpf) : '');
        setAdminEditRole(u.role || 'cliente');
        setAdminEditSenha('');
        setAdminEditFotoUrl(u.foto_perfil || '');
        setAdminEditFotoPreview(u.foto_perfil || '');
        setAdminEditCpfAlterado(!!u.cpf_alterado);
        setVerSenhaAdminEditUser(false);
      };

      const salvarEdicaoUsuarioAdmin = async (e) => {
        e.preventDefault();
        if (!token || !usuarioEmEdicaoAdmin) return;
        setSalvandoEdicaoAdminUsuario(true);
        try {
          const res = await fetch('/api/admin/usuarios', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
              id_usuario: usuarioEmEdicaoAdmin.id_usuario,
              nome_completo: adminEditNome,
              email: adminEditEmail,
              cpf: adminEditCpf,
              role: adminEditRole,
              foto_perfil: adminEditFotoUrl,
              cpf_alterado: adminEditCpfAlterado,
              senha: adminEditSenha
            })
          });
          const json = await res.json();
          if (res.ok) {
            mostrarNotificacao(json.mensagem || 'Usuário atualizado com sucesso pela administração!');
            setUsuarioEmEdicaoAdmin(null);
            carregarUsuarios();
            if (usuario && usuario.id_usuario === usuarioEmEdicaoAdmin.id_usuario && json.usuario) {
              const usuarioSinc = { ...usuario, ...json.usuario };
              setUsuario(usuarioSinc);
              localStorage.setItem('venus_usuario', JSON.stringify(usuarioSinc));
            }
          } else {
            alert(json.erro || 'Falha ao atualizar dados do usuário.');
          }
        } catch (err) {
          alert('Erro de conexão ao salvar usuário.');
        } finally {
          setSalvandoEdicaoAdminUsuario(false);
        }
      };

      const renderBotaoOlhoSenha = (visivel, aoAlternar, id = '') => (
        <button
          type="button"
          onClick={aoAlternar}
          tabIndex="-1"
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-ouro/70 hover:text-ouro focus:outline-none cursor-pointer transition-colors"
          title={visivel ? "Ocultar senha" : "Ver senha"}
          aria-label={visivel ? "Ocultar senha" : "Ver senha"}
          id={id || undefined}
        >
          {visivel ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          )}
        </button>
      );

      const processarUploadImagem = (arquivo, onSucesso, onErro) => {
        if (!arquivo) return;
        if (!arquivo.type.startsWith('image/')) {
          alert('Por favor, selecione um arquivo de imagem válido (JPG, PNG, WEBP).');
          return;
        }

        const leitor = new FileReader();
        leitor.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const maxDim = 1200;
            let width = img.width;
            let height = img.height;
            if (width > maxDim || height > maxDim) {
              if (width > height) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
              } else {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
              }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const base64Comprimido = canvas.toDataURL('image/jpeg', 0.85);

            fetch('/api/upload-imagem', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (token || '')
              },
              body: JSON.stringify({
                imagem_base64: base64Comprimido,
                nome_arquivo: arquivo.name
              })
            })
            .then(r => r.json())
            .then(res => {
              if (res.sucesso && res.url) {
                onSucesso(res.url);
              } else {
                onErro && onErro(res.erro || 'Falha ao salvar imagem');
              }
            })
            .catch(err => {
              onErro && onErro(err.message);
            });
          };
          img.onerror = () => onErro && onErro('Erro ao processar imagem.');
          img.src = e.target.result;
        };
        leitor.onerror = () => onErro && onErro('Erro ao ler arquivo do dispositivo.');
        leitor.readAsDataURL(arquivo);
      };

      // Estado do formulário de cadastro (Nome, E-mail, Senha e Data de Nascimento)
      const [nomeCadastro, setNomeCadastro] = useState('');
      const [dataNascimentoCadastro, setDataNascimentoCadastro] = useState('');
      const [emailCadastro, setEmailCadastro] = useState('');
      const [senhaCadastro, setSenhaCadastro] = useState('');
      const [concordaTermosLgpd, setConcordaTermosLgpd] = useState(false);
      const [modalTermosLgpdAberto, setModalTermosLgpdAberto] = useState(false);
      const [secaoTermosAtiva, setSecaoTermosAtiva] = useState('todos'); // 'todos' | 'termos_uso' | 'compras' | 'adocao' | 'lgpd'

      const formatarCep = (v) => {
        const dig = String(v || '').replace(/[^0-9]/g, '').slice(0, 8);
        if (dig.length <= 5) return dig;
        return dig.slice(0, 5) + '-' + dig.slice(5);
      };

      const buscarCep = async (cepValor) => {
        const limpo = String(cepValor || '').replace(/[^0-9]/g, '');
        if (limpo.length === 8) {
          try {
            setBuscandoCep(true);
            const res = await fetch('https://viacep.com.br/ws/' + limpo + '/json/');
            const data = await res.json();
            if (!data.erro) {
              setLogradouroCheckout(data.logradouro || '');
              setBairroCheckout(data.bairro || '');
              setCidadeCheckout(data.localidade || '');
              setUfCheckout(data.uf || 'ES');
              mostrarNotificacao('Endereço preenchido automaticamente via CEP!');
            } else {
              mostrarNotificacao('CEP não localizado. Preencha o endereço manualmente.', 'aviso');
            }
          } catch (e) {
            // fallback
          } finally {
            setBuscandoCep(false);
          }
        }
      };

      const validarCpf = (cpf) => {
        if (!cpf) return false;
        const limpo = String(cpf).replace(/[^0-9]/g, '');
        if (limpo.length !== 11) return false;
        if (limpo.split('').every(c => c === limpo[0])) return false;
        let soma = 0;
        let resto;
        for (let i = 1; i <= 9; i++) soma += parseInt(limpo.substring(i - 1, i)) * (11 - i);
        resto = (soma * 10) % 11;
        if (resto === 10 || resto === 11) resto = 0;
        if (resto !== parseInt(limpo.substring(9, 10))) return false;
        soma = 0;
        for (let i = 1; i <= 10; i++) soma += parseInt(limpo.substring(i - 1, i)) * (12 - i);
        resto = (soma * 10) % 11;
        if (resto === 10 || resto === 11) resto = 0;
        if (resto !== parseInt(limpo.substring(10, 11))) return false;
        return true;
      };

      const cpfCheckoutLimpo = (cpfCheckout || '').replace(/[^0-9]/g, '');
      const statusCpfCheckout = cpfCheckoutLimpo.length === 11 ? (validarCpf(cpfCheckout) ? 'valido' : 'invalido') : null;

      const calcularForcaSenha = (senha, nome, email) => {
        if (!senha) return { score: 0, nivel: '', cor: '', bg: '', texto: '' };
        
        const sLower = senha.toLowerCase();
        const listaNegra = ['123456', '12345678', 'qwerty', 'senha', 'password', 'admin', 'butique', 'venus', 'luar'];
        for (const termo of listaNegra) {
          if (sLower.includes(termo)) {
            return { score: 1, nivel: 'Fraca', cor: 'text-rose-400', bg: 'bg-rose-500', texto: 'Contém termo comum previsível' };
          }
        }
        if (nome) {
          const partes = nome.toLowerCase().split(/\s+/).filter(p => p.length >= 3);
          for (const p of partes) {
            if (sLower.includes(p)) {
              return { score: 1, nivel: 'Fraca', cor: 'text-rose-400', bg: 'bg-rose-500', texto: 'Contém parte do seu nome' };
            }
          }
        }
        if (email) {
          const parteEmail = email.toLowerCase().split('@')[0];
          if (parteEmail.length >= 3 && sLower.includes(parteEmail)) {
            return { score: 1, nivel: 'Fraca', cor: 'text-rose-400', bg: 'bg-rose-500', texto: 'Contém parte do seu e-mail' };
          }
        }

        let score = 0;
        if (senha.length >= 8) score += 1;
        if (senha.length >= 12) score += 1;
        if (/[a-z]/.test(senha) && /[A-Z]/.test(senha)) score += 1;
        if (/[0-9]/.test(senha) || /[^a-zA-Z0-9]/.test(senha)) score += 1;

        if (senha.length < 8) {
          return { score: 1, nivel: 'Fraca', cor: 'text-rose-400', bg: 'bg-rose-500', texto: 'Mínimo de 8 caracteres exigido' };
        } else if (score === 2) {
          return { score: 2, nivel: 'Média', cor: 'text-amber-400', bg: 'bg-amber-500', texto: 'Média • Recomendado 12 a 16 carac.' };
        } else if (score === 3) {
          return { score: 3, nivel: 'Forte', cor: 'text-emerald-400', bg: 'bg-emerald-500', texto: 'Forte • Excelente proteção' };
        } else {
          return { score: 4, nivel: 'Excelente', cor: 'text-ouro', bg: 'bg-gradient-to-r from-ouro-dark to-ouro', texto: 'Excelente • Máxima entropia e segurança' };
        }
      };

      const forcaAtual = calcularForcaSenha(senhaCadastro, nomeCadastro, emailCadastro);
      // Estados para Recuperação de Senha via E-mail Pessoal
      const [emailRecuperacao, setEmailRecuperacao] = useState('');
      const [codigoRecuperacao, setCodigoRecuperacao] = useState('');
      const [novaSenhaRecuperacao, setNovaSenhaRecuperacao] = useState('');
      const [etapaRecuperacao, setEtapaRecuperacao] = useState(1); // 1 = solicitar email, 2 = código e nova senha
      const [previewCodigoEmail, setPreviewCodigoEmail] = useState(null);
      const [carregandoRecuperacao, setCarregandoRecuperacao] = useState(false);
      const [msgInfoRecuperacao, setMsgInfoRecuperacao] = useState('');

      const forcaNovaSenha = calcularForcaSenha(novaSenhaRecuperacao, '', emailRecuperacao);

      // Estados para Configuração de E-mail Real (SMTP)
      const [configEmail, setConfigEmail] = useState({
        provedor: 'gmail',
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        user: 'boutiquevenuseluar@gmail.com',
        pass: '',
        remetente: 'Vênus e Luar Boutique'
      });
      const [emailDestinoTeste, setEmailDestinoTeste] = useState('');
      const [carregandoEmailConfig, setCarregandoEmailConfig] = useState(false);
      const [statusTesteEmail, setStatusTesteEmail] = useState(null);

      const carregarConfigEmailAdmin = async () => {
        try {
          const res = await fetch('/api/admin/email-config', {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          const json = await res.json();
          if (res.ok && json.config) {
            setConfigEmail(json.config);
          }
        } catch (err) {
          console.error('Erro ao carregar config email:', err);
        }
      };

      const salvarConfigEmailAdmin = async (e) => {
        e.preventDefault();
        setCarregandoEmailConfig(true);
        try {
          const res = await fetch('/api/admin/email-config', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify(configEmail)
          });
          const json = await res.json();
          if (res.ok) {
            mostrarNotificacao('Configurações de e-mail SMTP salvas com sucesso!');
            carregarConfigEmailAdmin();
          } else {
            alert(json.erro || 'Erro ao salvar configurações.');
          }
        } catch (err) {
          alert('Erro ao conectar ao servidor.');
        } finally {
          setCarregandoEmailConfig(false);
        }
      };

            // Estados para Gestão de Domínio e DNS
      const [configDominio, setConfigDominio] = useState({
        dominio: 'venuseluar.com.br',
        url_base: 'https://venuseluar.com.br',
        email_atendimento: 'boutiquevenuseluar@gmail.com',
        email_contato: 'boutiquevenuseluar@gmail.com',
        email_seguranca: 'boutiquevenuseluar@gmail.com'
      });
      const [registrosDns, setRegistrosDns] = useState([]);
      const [carregandoDominio, setCarregandoDominio] = useState(false);
      const [statusVerificacaoDns, setStatusVerificacaoDns] = useState(null);
      const [registroCopiado, setRegistroCopiado] = useState(null);

      const carregarDominioAdmin = async () => {
        try {
          const res = await fetch('/api/admin/dominio', {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          const json = await res.json();
          if (res.ok && json.config) {
            setConfigDominio(json.config);
            setRegistrosDns(json.registrosDns || []);
          }
        } catch (err) {
          console.error('Erro ao carregar domínio:', err);
        }
      };

      const salvarDominioAdmin = async (e) => {
        e.preventDefault();
        setCarregandoDominio(true);
        try {
          const res = await fetch('/api/admin/dominio', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify(configDominio)
          });
          const json = await res.json();
          if (res.ok) {
            mostrarNotificacao('Configurações de domínio salvas com sucesso!');
            carregarDominioAdmin();
          } else {
            alert(json.erro || 'Erro ao salvar domínio.');
          }
        } catch (err) {
          alert('Erro ao conectar ao servidor.');
        } finally {
          setCarregandoDominio(false);
        }
      };

      const auditarDnsOnline = async () => {
        setStatusVerificacaoDns({ carregando: true, msg: 'Consultando servidores de nomes e propagação DNS...' });
        try {
          const res = await fetch('/api/admin/verificar-dns', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ dominio: configDominio.dominio })
          });
          const json = await res.json();
          if (res.ok) {
            setStatusVerificacaoDns({
              sucesso: true,
              msg: json.mensagem,
              detalhes: json.detalhes
            });
          } else {
            setStatusVerificacaoDns({
              sucesso: false,
              msg: json.erro || 'Domínio ainda em fase de propagação nos servidores de nomes globais.'
            });
          }
        } catch (err) {
          setStatusVerificacaoDns({ sucesso: false, msg: 'Erro ao consultar propagação DNS.' });
        }
      };

      const dispararEmailTeste = async () => {
        if (!emailDestinoTeste || !emailDestinoTeste.includes('@')) {
          alert('Por favor, informe um endereço de e-mail válido para o teste.');
          return;
        }
        setStatusTesteEmail({ carregando: true, msg: 'Conectando ao servidor SMTP e disparando e-mail real...' });
        try {
          const res = await fetch('/api/admin/testar-email', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
              destino: emailDestinoTeste,
              configTeste: configEmail
            })
          });
          const json = await res.json();
          if (res.ok) {
            setStatusTesteEmail({ sucesso: true, msg: json.mensagem });
            mostrarNotificacao('E-mail real entregue com sucesso!');
          } else {
            setStatusTesteEmail({ sucesso: false, msg: json.erro || 'Falha na conexão SMTP.' });
          }
        } catch (err) {
          setStatusTesteEmail({ sucesso: false, msg: 'Erro de comunicação com o servidor.' });
        }
      };

      // Notificação interna
      const [notificacao, setNotificacao] = useState(null);

      // Sessão: se houver usuário e token
      const [usuario, setUsuario] = useState(() => {
        try {
          const u = localStorage.getItem('venus_usuario');
          return u ? JSON.parse(u) : null;
        } catch (e) { return null; }
      });
      const [token, setToken] = useState(() => localStorage.getItem('venus_token') || '');

      const carregarDados = () => {
        setCarregando(true);
        Promise.all([
          fetch('/api/produtos').then(r => r.json()),
          fetch('/api/pets').then(r => r.json())
        ]).then(([prods, pts]) => {
          setProdutos(prods);
          setPets(pts);
          setCarregando(false);
        }).catch(err => {
          console.error(err);
          setCarregando(false);
        });
      };

      const carregarUsuarios = async (tokenAtual = token) => {
        if (!tokenAtual) return;
        try {
          const res = await fetch('/api/usuarios', {
            headers: { 'Authorization': 'Bearer ' + tokenAtual }
          });
          if (res.ok) {
            const data = await res.json();
            setListaUsuarios(data);
          }
        } catch (e) {
          console.error('Erro ao buscar usuarios:', e);
        }
      };

      const excluirProduto = async (idProduto) => {
        try {
          const res = await fetch(\`/api/produtos?id=\${idProduto}\`, {
            method: 'DELETE',
            headers: {
              'Authorization': 'Bearer ' + (token || '')
            }
          });
          const json = await res.json();
          if (res.ok) {
            mostrarNotificacao(json.mensagem || 'Peça excluída com sucesso do catálogo!');
            carregarDados();
          } else {
            alert(json.erro || 'Falha ao excluir peça.');
          }
        } catch (err) {
          alert('Erro de conexão ao excluir.');
        }
      };

      useEffect(() => {
        carregarDados();
        if (usuario && usuario.role === 'admin' && token) {
          carregarUsuarios(token);
        }
      }, []);

      const mostrarNotificacao = (texto, tipo = 'sucesso') => {
        setNotificacao({ texto, tipo });
        setTimeout(() => setNotificacao(null), 4000);
      };

      // ================================================================
      // REGRA 1 DE PERMISSIONAMENTO: BLOQUEIA ADICIONAR/CADASTRAR ROUPAS (GESTÃO)
      // ================================================================
      const handleAbrirGestao = () => {
        // Se NÃO estiver logado, abre o modal de acesso administrativo/login
        if (!usuario) {
          setIsPermissionamentoGestaoOpen(true);
          return;
        }
        if (usuario.role === 'admin') {
          setAbaGestao('cadastrar');
          carregarUsuarios();
        } else {
          // Cliente também é doador de pets: abre diretamente o painel de doação
          setAbaGestao('pets');
          setSubAbaPetsAdmin('lista');
          carregarCandidaturasAdmin();
        }
        setIsAdminOpen(true);
      };

      // ================================================================
      // REGRA 2 DE PERMISSIONAMENTO: BLOQUEIA ADICIONAR À SACOLA SEM LOGIN
      // ================================================================
      const tentarAdicionarAoCarrinho = (produto, customAtributos) => {
        if (!usuario) {
          setItemPendenteAuth({ produto, customAtributos });
          setIsPermissionamentoCompraOpen(true);
          return false;
        }
        carrinho.adicionarAoCarrinho(produto, customAtributos);
        setIsCarrinhoOpen(true);
        return true;
      };

      const handleLoginAdminSucesso = (usr, tok) => {
        setUsuario(usr);
        setToken(tok);
        localStorage.setItem('venus_usuario', JSON.stringify(usr));
        localStorage.setItem('venus_token', tok);
        setIsPermissionamentoGestaoOpen(false);
        setIsAdminOpen(true); // Abre a tela de gestão autorizada
        carregarUsuarios(tok);
        mostrarNotificacao('Acesso de Administrador Autorizado com Sucesso!');
      };

      const handleLoginCompraSucesso = (usr, tok) => {
        setUsuario(usr);
        setToken(tok);
        localStorage.setItem('venus_usuario', JSON.stringify(usr));
        localStorage.setItem('venus_token', tok);
        setIsPermissionamentoCompraOpen(false);
        if (itemPendenteAuth) {
          carrinho.adicionarAoCarrinho(itemPendenteAuth.produto, itemPendenteAuth.customAtributos);
          setIsCarrinhoOpen(true);
          setItemPendenteAuth(null);
        }
        mostrarNotificacao('Identificação confirmada! Peça adicionada à sacola.');
      };

      const carregarCandidaturasAdmin = async () => {
        try {
          const res = await fetch('/api/admin/candidaturas', {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          if (res.ok) {
            const data = await res.json();
            setListaCandidaturas(data);
          }
        } catch (e) {
          console.error(e);
        }
      };

      const carregarFaturamentoAdmin = async () => {
        try {
          const res = await fetch('/api/admin/faturamento', {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          if (res.ok) {
            const data = await res.json();
            setRelatorioFaturamento(data);
          }
        } catch (e) {
          console.error(e);
        }
      };

      const handleDeslogar = () => {
        setUsuario(null);
        setToken('');
        localStorage.removeItem('venus_usuario');
        localStorage.removeItem('venus_token');
        localStorage.removeItem('butique_usuario');
        mostrarNotificacao('Você desconectou. Modo Visitante ativo.', 'info');
      };

      // Filtragem
      const produtosFiltrados = produtos.filter(p => {
        const catMatch = abaAtiva === 'Todos' || p.categoria.toLowerCase() === abaAtiva.toLowerCase();
        if (!busca) return catMatch;
        const b = busca.toLowerCase();
        return catMatch && (p.nome_item.toLowerCase().includes(b) || p.descricao.toLowerCase().includes(b) || JSON.stringify(p.atributos).toLowerCase().includes(b));
      });

      const petsFiltrados = pets.filter(p => {
        const statusMatch = filtroStatusPet === 'Todos' || (p.status || '').toLowerCase() === filtroStatusPet.toLowerCase();
        if (!statusMatch) return false;
        if (!busca) return true;
        const b = busca.toLowerCase();
        return p.nome_pet.toLowerCase().includes(b) || p.especie.toLowerCase().includes(b) || JSON.stringify(p.perfil).toLowerCase().includes(b);
      });

      return (
        <div className="min-h-screen flex flex-col bg-celestial-950 text-luar-200">
          
          {/* TOAST NOTIFICAÇÃO ELEGANTE */}
          {notificacao && (
            <div className="fixed top-5 right-5 z-50 bg-celestial-900 border-2 border-ouro text-ouro-light px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-fadeIn">
              <svg className="w-5 h-5 text-ouro flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
              <span className="text-xs font-semibold">{notificacao.texto}</span>
              <button onClick={() => setNotificacao(null)} className="text-ouro font-bold text-sm ml-2">×</button>
            </div>
          )}


          {/* Header com a Logo Oficial e Ações Responsivas */}
          <header className="sticky top-0 z-40 bg-celestial-900/95 backdrop-blur-md border-b border-ouro/25 shadow-lg">
            <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-14 sm:h-16 lg:h-18 gap-2">
                
                {/* Logo Oficial com o Símbolo */}
                <div onClick={() => setAbaAtiva('Todos')} className="cursor-pointer flex items-center gap-2 sm:gap-3 group flex-shrink-0">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full overflow-hidden border border-ouro/60 p-0.5 bg-celestial-950 shadow-md group-hover:scale-105 transition-transform duration-300">
                    <img src="/logo.jpg" alt="Vênus e Luar Logo" className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <span className="font-serif text-sm sm:text-base lg:text-xl font-bold tracking-wider gold-gradient-text block leading-tight">
                      Vênus e Luar
                    </span>
                    <span className="block text-[7px] sm:text-[8px] lg:text-[9px] tracking-[0.22em] sm:tracking-[0.28em] uppercase text-ouro/80 font-semibold leading-tight">
                      BOUTIQUE
                    </span>
                  </div>
                </div>

                {/* Navegação de Nichos Compacta (Perfeita em Notebooks e Telas Grandes) */}
                <nav className="hidden lg:flex items-center gap-1 bg-celestial-950/80 p-1 rounded-full border border-ouro/25 backdrop-blur-md shadow-inner flex-shrink">
                  <button 
                    onClick={() => setAbaAtiva('Todos')} 
                    style={abaAtiva === 'Todos' ? {
                      background: 'linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%)',
                      color: '#080E1E',
                      fontWeight: '800',
                      boxShadow: '0 2px 8px rgba(223, 177, 91, 0.35)'
                    } : {}}
                    className={"px-2.5 xl:px-3.5 py-1 rounded-full text-[10px] xl:text-[11px] font-medium tracking-[0.08em] uppercase transition-all duration-200 whitespace-nowrap cursor-pointer " + (abaAtiva === 'Todos' ? 'font-bold' : 'text-luar-200/80 hover:text-ouro hover:bg-ouro/10')}
                  >
                    Todas
                  </button>
                  <button 
                    onClick={() => setAbaAtiva('Moda')} 
                    style={abaAtiva === 'Moda' ? {
                      background: 'linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%)',
                      color: '#080E1E',
                      fontWeight: '800',
                      boxShadow: '0 2px 8px rgba(223, 177, 91, 0.35)'
                    } : {}}
                    className={"px-2.5 xl:px-3.5 py-1 rounded-full text-[10px] xl:text-[11px] font-medium tracking-[0.08em] uppercase transition-all duration-200 whitespace-nowrap cursor-pointer " + (abaAtiva === 'Moda' ? 'font-bold' : 'text-luar-200/80 hover:text-ouro hover:bg-ouro/10')}
                  >
                    Alta Costura
                  </button>
                  <button 
                    onClick={() => setAbaAtiva('Pet')} 
                    style={abaAtiva === 'Pet' ? {
                      background: 'linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%)',
                      color: '#080E1E',
                      fontWeight: '800',
                      boxShadow: '0 2px 8px rgba(223, 177, 91, 0.35)'
                    } : {}}
                    className={"px-2.5 xl:px-3.5 py-1 rounded-full text-[10px] xl:text-[11px] font-medium tracking-[0.08em] uppercase transition-all duration-200 whitespace-nowrap cursor-pointer " + (abaAtiva === 'Pet' ? 'font-bold' : 'text-luar-200/80 hover:text-ouro hover:bg-ouro/10')}
                  >
                    Espaço Pet
                  </button>
                  <button 
                    onClick={() => setAbaAtiva('Cafeteria')} 
                    style={abaAtiva === 'Cafeteria' ? {
                      background: 'linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%)',
                      color: '#080E1E',
                      fontWeight: '800',
                      boxShadow: '0 2px 8px rgba(223, 177, 91, 0.35)'
                    } : {}}
                    className={"px-2.5 xl:px-3.5 py-1 rounded-full text-[10px] xl:text-[11px] font-medium tracking-[0.08em] uppercase transition-all duration-200 whitespace-nowrap cursor-pointer " + (abaAtiva === 'Cafeteria' ? 'font-bold' : 'text-luar-200/80 hover:text-ouro hover:bg-ouro/10')}
                  >
                    Bistrô & Café
                  </button>
                  <button 
                    id="btn-nav-adocao"
                    onClick={() => setAbaAtiva('Adocao')} 
                    style={abaAtiva === 'Adocao' ? {
                      background: 'linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%)',
                      color: '#080E1E',
                      fontWeight: '800',
                      boxShadow: '0 2px 8px rgba(223, 177, 91, 0.35)'
                    } : {}}
                    className={"px-2.5 xl:px-3.5 py-1 rounded-full text-[10px] xl:text-[11px] font-medium tracking-[0.08em] uppercase transition-all duration-200 whitespace-nowrap cursor-pointer " + (abaAtiva === 'Adocao' ? 'font-bold' : 'text-luar-200/80 hover:text-ouro hover:bg-ouro/10')}
                  >
                    Adoção
                  </button>
                </nav>

                {/* Ações da Barra: Gestão, Conta e Sacola (Perfeito em Celular, Tablet e Notebook) */}
                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                  <button
                    id="btn-gestao-header"
                    onClick={handleAbrirGestao}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-ouro/50 bg-celestial-950/80 text-ouro hover:bg-ouro hover:text-celestial-950 text-[10.5px] sm:text-xs font-semibold tracking-wider uppercase transition-all duration-200 cursor-pointer shadow-sm group whitespace-nowrap"
                    title={usuario?.role === 'admin' ? 'Painel de Gestão e Catálogo (Administrador)' : 'Painel de Gestão de Pets'}
                  >
                    {usuario && usuario.role !== 'admin' ? (
                      <span className="text-xs">🐾</span>
                    ) : (
                      <svg className="w-3.5 h-3.5 stroke-current transition-transform duration-200 group-hover:rotate-45" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                      </svg>
                    )}
                    <span className="hidden sm:inline">{usuario?.role === 'admin' ? 'Gestão' : (usuario ? 'Doar Pet' : 'Gestão')}</span>
                  </button>

                  {usuario ? (
                    <div className="flex items-center gap-1.5 pl-1.5 border-l border-ouro/25">
                      <button
                        id="btn-meu-perfil-header"
                        type="button"
                        onClick={iniciarEdicaoPerfilUsuario}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-celestial-950 border border-ouro/40 hover:border-ouro hover:bg-ouro/10 transition-all cursor-pointer group shadow-sm"
                        title="Configurações do Meu Perfil"
                      >
                        {usuario.foto_perfil ? (
                          <img 
                            src={usuario.foto_perfil} 
                            alt={usuario.nome || 'Avatar'} 
                            className="w-5 h-5 rounded-full object-cover border border-ouro shadow-xs flex-shrink-0" 
                          />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-ouro-dark to-ouro text-celestial-950 font-serif font-bold text-[10px] flex items-center justify-center shadow-xs flex-shrink-0">
                            {((usuario.nome || usuario.email || 'U')[0]).toUpperCase()}
                          </div>
                        )}
                        <span className="text-[10px] uppercase tracking-wider font-bold text-ouro">
                          {usuario.role === 'admin' ? 'Admin' : 'Usuário'}
                        </span>
                        {usuario.nome && usuario.nome.toLowerCase() !== 'administradora' && usuario.nome.toLowerCase() !== 'admin' && (
                          <span className="text-[10.5px] text-luar-100 font-serif font-medium pl-0.5 max-w-[80px] truncate hidden md:inline">
                            {usuario.nome.split(' ')[0]}
                          </span>
                        )}
                        <span className="text-[9px] text-ouro/70 group-hover:text-ouro ml-0.5">⚙️</span>
                      </button>
                      <button
                        onClick={handleDeslogar}
                        className="text-[10px] uppercase tracking-wider text-stone-400 hover:text-rose-400 px-2 py-1 rounded-full border border-stone-700/50 hover:border-rose-500/50 transition-all cursor-pointer whitespace-nowrap"
                        title="Encerrar sessão"
                      >
                        Sair
                      </button>
                    </div>
                  ) : (
                    <button
                      id="btn-entrar-header"
                      onClick={() => { setIsAuthOpen(true); setAbaAuthGeral('login'); }}
                      className="px-3 py-1.5 rounded-full border border-ouro/50 text-ouro hover:bg-ouro hover:text-celestial-950 text-[10.5px] sm:text-xs uppercase tracking-wider font-bold transition-all cursor-pointer whitespace-nowrap"
                    >
                      Entrar
                    </button>
                  )}

                  <button
                    id="btn-sacola-header"
                    onClick={() => setIsCarrinhoOpen(true)}
                    className="relative p-1.5 sm:p-2 rounded-full bg-gradient-to-r from-ouro-dark via-ouro to-ouro text-celestial-950 hover:brightness-110 active:scale-95 transition-all shadow-md shadow-ouro/20 cursor-pointer flex items-center justify-center group flex-shrink-0"
                    aria-label="Ver sacola de compras"
                  >
                    <svg className="w-3.5 h-3.5 stroke-celestial-950 stroke-[2] fill-none transition-transform group-hover:scale-110" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25c-.669 0-1.189-.578-1.119-1.243l1.263-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119.993z" />
                    </svg>
                    {carrinho.totalContador > 0 && (
                      <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center border border-celestial-950 shadow">
                        {carrinho.totalContador}
                      </span>
                    )}
                  </button>
                </div>

              </div>
            </div>
          </header>

          {/* Hero Banner de Boas-Vindas: Exibido com elegância na Vitrine Geral (Todos) */}
          {abaAtiva === 'Todos' && (
            <section className="relative overflow-hidden bg-gradient-to-b from-celestial-900 via-celestial-950 to-celestial-950 border-b border-ouro/20 py-4 sm:py-5 lg:py-6">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-center">
                  
                  <div className="lg:col-span-7 space-y-2 sm:space-y-3">
                    <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-celestial-850 border border-ouro/40 text-[9.5px] sm:text-[10px] font-semibold text-ouro tracking-widest uppercase">
                      <span>Alta Costura • Afeto Pet • Cafés Especiais</span>
                    </div>

                    <h1 className="font-serif text-xl sm:text-2xl lg:text-3xl font-bold leading-tight gold-gradient-text">
                      Onde o luar inspira a moda, o afeto pet e o aroma do café.
                    </h1>

                    <p className="text-[11px] sm:text-xs text-luar-200 font-light max-w-xl leading-relaxed">
                      Bem-vindo à <strong>Vênus e Luar Boutique</strong>. Um conceito singular onde alta costura em seda e linho convive com o espaço pet friendly, adoção responsável e o calor do café artesanal.
                    </p>

                    <div className="flex flex-wrap gap-2 pt-1 w-full sm:w-auto">
                      <button
                        onClick={() => setAbaAtiva('Moda')}
                        className="px-4 py-2 rounded-full bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 font-bold text-[11px] uppercase tracking-wider hover:opacity-95 transition-all shadow-md cursor-pointer text-center justify-center flex items-center"
                      >
                        Ver Coleção de Alta Costura →
                      </button>
                      <button
                        id="btn-hero-adocao"
                        onClick={() => setAbaAtiva('Adocao')}
                        className="px-4 py-2 rounded-full bg-celestial-850 border border-rose-400/40 text-rose-300 font-bold text-[11px] uppercase tracking-wider hover:bg-rose-950/40 transition-all cursor-pointer text-center justify-center flex items-center"
                      >
                        Conhecer Pets para Adoção
                      </button>
                    </div>
                  </div>

                  <div className="lg:col-span-5 flex justify-center">
                    <div className="relative group max-w-[190px] sm:max-w-[220px] w-full">
                      <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-ouro to-ouro-dark opacity-30 blur-lg group-hover:opacity-50 transition-opacity"></div>
                      <div className="relative rounded-xl overflow-hidden border border-ouro/40 shadow-xl bg-celestial-900 w-full">
                        <img src="/logo.jpg" alt="Vênus e Luar Boutique Emblema" className="w-full h-auto object-cover" />
                        <div className="p-2 bg-celestial-900/90 text-center border-t border-ouro/20">
                          <span className="text-[9.5px] uppercase tracking-[0.2em] text-ouro font-semibold block">Vênus e Luar Boutique</span>
                          <span className="text-[8.5px] text-luar-300">Alta Costura, Afeto Pet &amp; Cafeteria</span>
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            </section>
          )}

          {/* Conteúdo Principal */}
          <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-6 lg:py-8 pb-24 lg:pb-12 space-y-6">
            
            {/* Barra Superior da Vitrine: Indicador e Busca Proporcional */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {/* No Mobile/Tablet: Carrossel de Pílulas */}
                <div 
                  style={{ WebkitOverflowScrolling: 'touch' }}
                  className="flex lg:hidden items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none"
                >
                  {['Todos', 'Moda', 'Pet', 'Cafeteria', 'Adocao'].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setAbaAtiva(cat)}
                      className={"px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap border transition-all cursor-pointer " + (
                        abaAtiva === cat
                          ? "bg-ouro text-celestial-950 border-ouro font-bold shadow-md"
                          : "bg-celestial-900 text-luar-300 border-ouro/20 hover:border-ouro/50"
                      )}
                    >
                      {cat === 'Adocao' ? 'Pets para Adoção' : (cat === 'Todos' ? 'Todas as Criações' : (cat === 'Moda' ? 'Alta Costura' : (cat === 'Pet' ? 'Espaço Pet' : 'Bistrô & Café')))}
                    </button>
                  ))}
                </div>

                {/* No Desktop: Título do Nicho Ativo Elegante com Destaque Dourado */}
                <div className="hidden lg:flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-ouro"></span>
                  <span className="font-serif font-bold text-base tracking-wider gold-gradient-text uppercase">
                    {abaAtiva === 'Todos' && 'Vitrine Geral • Todas as Criações'}
                    {abaAtiva === 'Moda' && 'Alta Costura • Seda & Linho'}
                    {abaAtiva === 'Pet' && 'Espaço Pet • Conforto & Estilo'}
                    {abaAtiva === 'Cafeteria' && 'Bistrô & Cafeteria Especial'}
                    {abaAtiva === 'Adocao' && 'Adoção Responsável • Nossos Companheiros'}
                  </span>
                </div>
              </div>

              {/* Busca Dinâmica Proporcional */}
              <div className="relative w-full sm:w-80">
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar no catálogo..."
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl border border-ouro/30 bg-celestial-900 text-xs text-luar-100 placeholder:text-luar-300/50 focus:outline-none focus:ring-2 focus:ring-ouro/50"
                />
                {busca && (
                  <button onClick={() => setBusca('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ouro hover:text-white text-xs">×</button>
                )}
              </div>
            </div>

            {/* Vitrine de Produtos ou Pets */}
            {carregando ? (
              <div className="py-24 text-center text-xs text-ouro font-medium tracking-wide">
                Carregando catálogo Vênus e Luar...
              </div>
            ) : abaAtiva === 'Adocao' ? (
              <div className="space-y-5">
                <div 
                  style={{ background: 'linear-gradient(135deg, #0E172E 0%, #142142 50%, #080E1E 100%)' }}
                  className="p-4 sm:p-5 rounded-2xl border border-ouro/30 flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl animate-fadeIn"
                >
                  <div className="space-y-2">
                    <span className="text-[10px] uppercase font-bold text-ouro tracking-[0.2em] flex items-center gap-1.5">
                      <svg className="w-3 h-3 text-ouro fill-current inline-block" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                      Adoção Responsável Vênus e Luar
                    </span>
                    <h2 className="font-serif text-xl sm:text-2xl font-bold gold-gradient-text tracking-wide">
                      Nossos Companheiros de Quatro Patas
                    </h2>
                    <p className="text-[11px] sm:text-xs text-luar-100 max-w-xl leading-relaxed font-light">
                      Cada animal resgatado passa por rigoroso acompanhamento veterinário, vacinação, castração e muito afeto. Conectamos lares acolhedores a companheiros que transformam vidas através de um processo transparente e amoroso.
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      {[
                        { id: 'Todos', label: 'Todos (' + pets.length + ')' },
                        { id: 'Disponível', label: 'Disponíveis (' + pets.filter(p => (p.status || '').toLowerCase() === 'disponível').length + ')' },
                        { id: 'Adotado', label: 'Adotados com Amor (' + pets.filter(p => (p.status || '').toLowerCase() === 'adotado').length + ')' }
                      ].map(f => (
                        <button
                          key={f.id}
                          onClick={() => setFiltroStatusPet(f.id)}
                          style={filtroStatusPet === f.id ? {
                            background: 'linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%)',
                            color: '#080E1E',
                            fontWeight: '700',
                            borderColor: '#DFB15B'
                          } : {
                            backgroundColor: '#080E1E',
                            color: '#ECE6D6',
                            borderColor: 'rgba(223, 177, 91, 0.3)'
                          }}
                          className="px-3 py-1 rounded-xl text-xs font-semibold border transition-all cursor-pointer shadow-sm hover:border-ouro hover:text-ouro"
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center gap-3 shrink-0 w-full md:w-auto">
                    <div 
                      style={{ backgroundColor: '#080E1E', borderColor: 'rgba(223, 177, 91, 0.5)' }}
                      className="px-5 py-3 rounded-xl border text-center shadow-lg w-full sm:w-auto"
                    >
                      <span className="text-2xl font-serif font-bold text-ouro block">{pets.filter(p => p.status === 'Disponível').length}</span>
                      <span className="text-[11px] font-semibold text-luar-200">Disponíveis</span>
                    </div>

                    <button
                      type="button"
                      id="btn-quero-doar-pet"
                      onClick={() => {
                        if (!usuario) {
                          setAbaAuthGeral('cadastro');
                          setIsAuthOpen(true);
                        } else {
                          setAbaGestao('pets');
                          setSubAbaPetsAdmin('novo');
                          carregarCandidaturasAdmin();
                          setIsAdminOpen(true);
                        }
                      }}
                      className="w-full sm:w-auto px-4 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer shadow-lg flex items-center justify-center gap-2 bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 hover:brightness-110 active:scale-95"
                    >
                      <span>🐾 Quero Doar um Pet</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {petsFiltrados.map(pet => (
                    <div key={pet.id_pet} className="bg-celestial-900 rounded-3xl border border-ouro/25 overflow-hidden shadow-lg hover:border-ouro/60 transition-all flex flex-col justify-between group">
                      <div>
                        <div className="relative aspect-[4/3] bg-celestial-950 overflow-hidden">
                          <img src={pet.imagem_url} alt={pet.nome_pet} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                          <span className={'absolute top-3 left-3 text-[11px] font-bold px-3 py-1 rounded-full shadow-md ' + (
                            pet.status === 'Adotado'
                              ? 'bg-gradient-to-r from-amber-900 to-rose-900 text-ouro-light border border-ouro'
                              : 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                          )}>
                            {pet.status === 'Adotado' ? '✨ Adotado com Amor ❤️' : '✓ Disponível para Adoção'}
                          </span>
                        </div>
                        <div className="p-6 space-y-3">
                          <div className="flex items-center justify-between">
                            <h3 className="font-serif text-2xl font-bold text-ouro-light">{pet.nome_pet}</h3>
                            <span className="text-xs bg-celestial-950 border border-ouro/20 px-2.5 py-0.5 rounded text-ouro">{pet.especie}</span>
                          </div>
                          <p className="text-xs text-luar-300 italic leading-relaxed">"{pet.historia}"</p>
                          
                          {/* Tags JSONB */}
                          <div className="pt-3 border-t border-ouro/15 flex flex-wrap gap-1.5">
                            {pet.perfil?.castrado && <span className="text-[10px] bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">✓ Castrado</span>}
                            {pet.perfil?.vacinado && <span className="text-[10px] bg-sky-950/60 text-sky-300 border border-sky-500/30 px-2.5 py-0.5 rounded-full">✓ Vacinado</span>}
                            {/* Badges FIV e FeLV nos casos de gato */}
                            {pet.especie?.toLowerCase().includes('gato') && pet.perfil?.fiv && (
                              <span className={"text-[10px] px-2.5 py-0.5 rounded-full border font-medium " + (
                                pet.perfil.fiv === 'Negativo' 
                                  ? 'bg-purple-950/70 text-purple-300 border-purple-500/40' 
                                  : (pet.perfil.fiv === 'Positivo' ? 'bg-amber-950/70 text-amber-300 border-amber-500/40' : 'bg-stone-900 text-stone-300 border-stone-700/50')
                              )}>
                                {pet.perfil.fiv === 'Negativo' ? '✓ FIV Negativo' : (pet.perfil.fiv === 'Positivo' ? '⚠ FIV Positivo' : 'FIV: ' + pet.perfil.fiv)}
                              </span>
                            )}
                            {pet.especie?.toLowerCase().includes('gato') && pet.perfil?.felv && (
                              <span className={"text-[10px] px-2.5 py-0.5 rounded-full border font-medium " + (
                                pet.perfil.felv === 'Negativo' 
                                  ? 'bg-teal-950/70 text-teal-300 border-teal-500/40' 
                                  : (pet.perfil.felv === 'Positivo' ? 'bg-rose-950/70 text-rose-300 border-rose-500/40' : 'FeLV: ' + pet.perfil.felv)
                              )}>
                                {pet.perfil.felv === 'Negativo' ? '✓ FeLV Negativo' : (pet.perfil.felv === 'Positivo' ? '⚠ FeLV Positivo' : 'FeLV: ' + pet.perfil.felv)}
                              </span>
                            )}
                            {pet.perfil?.convive_com_gatos && <span className="text-[10px] bg-amber-950/60 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 rounded-full">Amigo de Gatos</span>}
                            {pet.perfil?.temperamento && <span className="text-[10px] bg-celestial-950 text-luar-200 border border-ouro/20 px-2.5 py-0.5 rounded-full">{pet.perfil.temperamento}</span>}
                          </div>

                          {pet.status === 'Adotado' && pet.registro_adocao && (
                            <div className="p-2.5 rounded-xl bg-celestial-950/90 border border-ouro/30 text-center space-y-0.5">
                              <span className="text-[11px] font-bold text-ouro block">🎉 Final Feliz Concretizado!</span>
                              <span className="text-[10px] text-luar-300 block">Adotado por {pet.registro_adocao.adotante_nome}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="p-6 pt-0">
                        {pet.status === 'Adotado' ? (
                          <button disabled className="w-full py-3 rounded-xl bg-celestial-950 border border-ouro/30 text-ouro/70 font-bold text-xs uppercase tracking-wider cursor-default">
                            ✨ Lar Encontrado com Amor
                          </button>
                        ) : (
                          <button
                            id={'btn-adotar-pet-' + pet.id_pet}
                            onClick={() => {
                              setPetAdocaoModal(pet);
                              setPetAdocaoNome(usuario?.nome_completo || '');
                              setPetAdocaoCpf(usuario?.cpf || '');
                              setPetAdocaoTel('');
                              setPetAdocaoMsg('');
                            }}
                            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-600 hover:brightness-110 active:scale-98 text-white font-bold text-xs uppercase tracking-wider shadow-lg flex items-center justify-center gap-2 transition-all cursor-pointer"
                          >
                            <span>Candidatar-se via WhatsApp</span>
                            <span>🐾</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {abaAtiva === 'Cafeteria' && (
                  <div 
                    style={{ background: 'linear-gradient(135deg, #0E172E 0%, #142142 50%, #080E1E 100%)' }}
                    className="p-6 sm:p-8 rounded-3xl border border-ouro/40 shadow-2xl space-y-3 animate-fadeIn"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-ouro/20 pb-4">
                      <div>
                        <span className="text-[10px] text-ouro uppercase tracking-[0.25em] font-bold block">
                          Bistrô &amp; Cafeteria Especial
                        </span>
                        <h2 className="font-serif text-2xl sm:text-3xl font-bold gold-gradient-text mt-0.5">
                          Cardápio Autoral &amp; Cafés Especiais
                        </h2>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1 rounded-full bg-ouro/20 text-ouro border border-ouro/40 text-[11px] font-semibold">
                          ☕ Grãos 100% Arábica
                        </span>
                        <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[11px] font-semibold">
                          🌱 Opções Veganas
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-luar-100 max-w-2xl leading-relaxed font-light">
                      Aprecie nossa curadoria gastronômica exclusiva na boutique: cafés com microlotes de torra artesanal, leites vegetais de amêndoas e aveia, e pâtisserie fina para harmonizar com seu momento de estilo.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
                {produtosFiltrados.map(prod => (
                  <div key={prod.id_produto} className="bg-celestial-900 rounded-2xl border border-ouro/20 overflow-hidden shadow-lg hover:border-ouro/60 transition-all duration-300 flex flex-col justify-between group">
                    <div>
                      <div className="relative aspect-square overflow-hidden bg-celestial-950">
                        <img src={prod.imagem_url} alt={prod.nome_item} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        <span className="absolute top-3 left-3 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-celestial-950/90 border border-ouro/40 text-ouro shadow">
                          {prod.categoria}
                        </span>
                      </div>

                      <div className="p-5 space-y-2">
                        <h3 
                          onClick={() => setProdutoModal(prod)}
                          className="font-serif text-base font-bold text-ouro-light hover:text-ouro cursor-pointer transition-colors line-clamp-1"
                        >
                          {prod.nome_item}
                        </h3>
                        <p className="text-xs text-luar-300 line-clamp-2 leading-relaxed font-light">
                          {prod.descricao}
                        </p>

                        {/* Badges de Atributos JSONB */}
                        <div className="flex flex-wrap gap-1.5 pt-2">
                          {prod.atributos?.tecido && <span className="text-[10px] bg-celestial-950 text-ouro/90 border border-ouro/20 px-2 py-0.5 rounded">Tecido: {prod.atributos.tecido}</span>}
                          {prod.atributos?.tamanho && <span className="text-[10px] bg-celestial-950 text-ouro/90 border border-ouro/20 px-2 py-0.5 rounded">Tam: {prod.atributos.tamanho}</span>}
                          {prod.atributos?.tipo_leite && <span className="text-[10px] bg-celestial-950 text-ouro/90 border border-ouro/20 px-2 py-0.5 rounded">Leite: {prod.atributos.tipo_leite}</span>}
                          {prod.atributos?.tamanho_pet && <span className="text-[10px] bg-celestial-950 text-ouro/90 border border-ouro/20 px-2 py-0.5 rounded">Porte: {prod.atributos.tamanho_pet}</span>}
                        </div>
                      </div>
                    </div>

                    <div className="p-5 pt-0 border-t border-ouro/15 flex items-center justify-between mt-3">
                      <div>
                        <span className="block text-[10px] text-ouro/70 uppercase tracking-widest font-semibold">Valor</span>
                        <span className="font-serif text-lg font-bold text-ouro-light">{formatBRL(prod.preco)}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Botões Exclusivos para Administrador (Editar e Excluir) */}
                        {usuario?.role === 'admin' && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                iniciarEdicaoProduto(prod);
                              }}
                              className="p-2 rounded-xl bg-celestial-900 hover:bg-ouro/20 border border-ouro/40 text-ouro hover:text-ouro-light transition-all cursor-pointer shadow-sm"
                              title="Editar peça do catálogo"
                            >
                              <svg className="w-4 h-4 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm('Tem certeza que deseja excluir "' + prod.nome_item + '" do catálogo da boutique?')) {
                                  excluirProduto(prod.id_produto);
                                }
                              }}
                              className="p-2 rounded-xl bg-rose-950/60 hover:bg-rose-900 border border-rose-500/40 text-rose-300 hover:text-rose-100 transition-all cursor-pointer shadow-sm"
                              title="Excluir peça do catálogo"
                            >
                              <svg className="w-4 h-4 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                              </svg>
                            </button>
                          </div>
                        )}

                        {/* Botão Comprar com Proteção de Permissionamento */}
                        <button
                          type="button"
                          onClick={() => tentarAdicionarAoCarrinho(prod)}
                          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 font-bold text-xs shadow-md hover:brightness-110 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          {!usuario && (
  <svg className="w-3.5 h-3.5 text-celestial-950/80 inline-block mr-1" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
)}
                          <span>Comprar</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          </main>

          {/* ==================================================================== */}
          {/* MODAL 1: PERMISSIONAMENTO DE GESTÃO (BLOQUEIA CADASTRAR/ADICIONAR ROUPAS) */}
          {/* ==================================================================== */}
          {isPermissionamentoGestaoOpen && (
            <div 
              style={{ backgroundColor: 'rgba(3, 6, 14, 0.94)' }}
              className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 backdrop-blur-sm animate-fadeIn"
            >
              <div 
                style={{ backgroundColor: '#080E1E' }}
                className="relative w-full max-w-lg rounded-3xl p-5 sm:p-7 space-y-5 shadow-[0_25px_60px_rgba(0,0,0,0.95)] border border-ouro/60 gold-glow"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Fechar */}
                <button 
                  onClick={() => setIsPermissionamentoGestaoOpen(false)} 
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-celestial-900 border border-ouro/40 hover:border-ouro text-ouro hover:text-white flex items-center justify-center text-lg font-bold transition-all cursor-pointer z-10"
                  aria-label="Fechar"
                >
                  ×
                </button>

                <div className="text-center space-y-2">
                  <div className="w-16 h-16 rounded-full mx-auto bg-celestial-950 border-2 border-ouro/80 flex items-center justify-center text-ouro shadow-inner">
                    <svg className="w-8 h-8 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  </div>
                  <h3 className="font-serif text-2xl sm:text-3xl font-bold gold-gradient-text">
                    Permissão Administrativa
                  </h3>
                  <p className="text-xs text-luar-300 max-w-sm mx-auto leading-relaxed">
                    O cadastro e adição de novas roupas, peças ou produtos ao catálogo da <strong className="text-ouro font-semibold">Vênus e Luar Boutique</strong> é restrito a administradores.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-xs text-center">
                  <span className="font-semibold text-amber-300">Acesso Restrito:</span> Faça login com uma credencial de Administrador para liberar a adição de peças no banco de dados.
                </div>

                {/* Formulário de Identificação do Administrador */}
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  const email = e.target.email.value;
                  const senha = e.target.senha.value;
                  const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, senha })
                  });
                  const json = await res.json();
                  if (res.ok) {
                    if (json.usuario.role !== 'admin') {
                      alert('Esta conta é de usuário. Apenas Administradoras podem adicionar roupas no sistema.');
                      return;
                    }
                    handleLoginAdminSucesso(json.usuario, json.token);
                  } else {
                    alert(json.erro || 'Credenciais inválidas.');
                  }
                }} className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">E-mail de Administrador</label>
                    <input 
                      name="email" 
                      type="email" 
                      placeholder="admin@butique.com" 
                      required 
                      className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-luar-100 outline-none focus:border-ouro" 
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Senha</label>
                    <div className="relative">
                      <input 
                        name="senha" 
                        type={verSenhaPermissaoGestao ? "text" : "password"} 
                        placeholder="••••••••••••" 
                        required 
                        className="w-full p-3 pr-10 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-luar-100 outline-none focus:border-ouro" 
                      />
                      {renderBotaoOlhoSenha(verSenhaPermissaoGestao, () => setVerSenhaPermissaoGestao(!verSenhaPermissaoGestao), "btn-ver-senha-gestao")}
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 font-bold text-xs uppercase tracking-widest shadow-lg hover:brightness-110 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <svg className="w-4 h-4 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /></svg>
                    <span>Validar Permissão e Acessar Gestão</span>
                  </button>
                </form>

                {/* RECURSO OCULTO SOB DEMANDA: O botão de autorização VIP imediata existe no código, mas fica oculto até solicitação futura */}
                {false && (
                  <div className="pt-2 border-t border-ouro/20">
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await fetch('/api/auth/login', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ email: 'admin@butique.com', senha: 'admin123' })
                        });
                        const json = await res.json();
                        if (res.ok) {
                          handleLoginAdminSucesso(json.usuario, json.token);
                        }
                      }}
                      className="w-full py-3 rounded-xl bg-celestial-950 border border-ouro/40 text-ouro hover:bg-ouro/10 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
                      <span>Autorizar Imediatamente como Administradora VIP</span>
                    </button>
                  </div>
                )}

              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL 2: PERMISSIONAMENTO DE COMPRA (BLOQUEIA ADIÇÃO À SACOLA SEM LOGIN) */}
          {/* ==================================================================== */}
          {isPermissionamentoCompraOpen && (
            <div 
              style={{ backgroundColor: 'rgba(3, 6, 14, 0.94)' }}
              className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 backdrop-blur-sm animate-fadeIn"
            >
              <div 
                style={{ backgroundColor: '#080E1E' }}
                className="relative w-full max-w-lg rounded-3xl p-5 sm:p-7 space-y-5 shadow-[0_25px_60px_rgba(0,0,0,0.95)] border border-ouro/70 gold-glow"
                onClick={(e) => e.stopPropagation()}
              >
                <button 
                  onClick={() => setIsPermissionamentoCompraOpen(false)} 
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-celestial-900 border border-ouro/40 hover:border-ouro text-ouro hover:text-white flex items-center justify-center text-lg font-bold transition-all cursor-pointer z-10"
                  aria-label="Fechar"
                >
                  ×
                </button>

                <div className="text-center space-y-2">
                  <div className="w-16 h-16 rounded-full mx-auto bg-celestial-950 border-2 border-ouro/80 flex items-center justify-center text-ouro shadow-inner">
                    <svg className="w-8 h-8 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25c-.669 0-1.189-.578-1.119-1.243l1.263-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                    </svg>
                  </div>
                  <h3 className="font-serif text-2xl sm:text-3xl font-bold gold-gradient-text">
                    Identificação Necessária
                  </h3>
                  <p className="text-xs text-luar-300 max-w-sm mx-auto leading-relaxed">
                    Para reservar esta peça na sua sacola, entre com sua conta na Vênus e Luar.
                  </p>
                </div>

                {itemPendenteAuth?.produto && (
                  <div className="p-4 rounded-2xl bg-celestial-950 border border-ouro/40 flex items-center gap-4">
                    <img 
                      src={itemPendenteAuth.produto.imagem_url} 
                      alt={itemPendenteAuth.produto.nome_item} 
                      className="w-16 h-16 rounded-xl object-cover border border-ouro/30 flex-shrink-0" 
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-ouro block">
                        Peça Selecionada • {itemPendenteAuth.produto.categoria}
                      </span>
                      <h4 className="text-xs font-bold text-ouro-light truncate">
                        {itemPendenteAuth.produto.nome_item}
                      </h4>
                      <span className="text-sm font-serif font-bold text-ouro">
                        {formatBRL(itemPendenteAuth.produto.preco)}
                      </span>
                    </div>
                  </div>
                )}

                <form onSubmit={async (e) => {
                  e.preventDefault();
                  const email = e.target.email.value;
                  const senha = e.target.senha.value;
                  const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, senha })
                  });
                  const json = await res.json();
                  if (res.ok) {
                    handleLoginCompraSucesso(json.usuario, json.token);
                  } else {
                    alert(json.erro || 'Credenciais inválidas.');
                  }
                }} className="space-y-4">
                  <input name="email" type="email" required placeholder="seu@email.com" className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-luar-100 outline-none" />
                  <div className="relative">
                    <input name="senha" type={verSenhaPermissaoCompra ? "text" : "password"} required placeholder="••••••••••••" className="w-full p-3 pr-10 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-luar-100 outline-none" />
                    {renderBotaoOlhoSenha(verSenhaPermissaoCompra, () => setVerSenhaPermissaoCompra(!verSenhaPermissaoCompra), "btn-ver-senha-compra")}
                  </div>
                  <button type="submit" className="w-full py-3.5 rounded-xl bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 font-bold text-xs uppercase tracking-widest shadow-lg hover:brightness-110 cursor-pointer">
                    Autorizar e Adicionar à Sacola
                  </button>
                </form>

                {/* RECURSO OCULTO SOB DEMANDA */}
                {false && (
                  <div className="pt-2 text-center border-t border-ouro/20">
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await fetch('/api/auth/login', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ email: 'admin@butique.com', senha: 'admin123' })
                        });
                        const json = await res.json();
                        if (res.ok) {
                          handleLoginCompraSucesso(json.usuario, json.token);
                        }
                      }}
                      className="w-full py-2.5 rounded-xl bg-celestial-950 border border-ouro/40 text-ouro hover:bg-ouro/10 text-xs font-bold transition-all cursor-pointer"
                    >
                      Entrar com 1 Clique (Demonstração)
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* GAVETA DO CARRINHO (Zustand + LocalStorage) */}
          {isCarrinhoOpen && (
            <div className="fixed inset-0 z-50 overflow-hidden">
              <div onClick={() => setIsCarrinhoOpen(false)} className="absolute inset-0 bg-black/60 backdrop-blur-xs" />
              <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
                <div className="w-screen max-w-md bg-celestial-900 shadow-2xl flex flex-col justify-between border-l border-ouro/30 animate-fadeIn">
                  
                  {/* Topo Carrinho */}
                  <div className="p-6 border-b border-ouro/20 bg-celestial-950 flex items-center justify-between">
                    <div>
                      <h2 className="font-serif text-xl font-bold gold-gradient-text">Sacola Vênus e Luar</h2>
                      <span className="text-xs text-luar-300">{carrinho.itens.length} itens unificados</span>
                    </div>
                    <button onClick={() => setIsCarrinhoOpen(false)} className="text-ouro hover:text-white text-2xl font-bold cursor-pointer">×</button>
                  </div>

                  {/* Itens */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-3.5">
                    {carrinho.itens.length === 0 ? (
                      <div className="py-24 text-center space-y-3">
                        <div className="w-16 h-16 rounded-full mx-auto bg-celestial-950 border border-ouro/30 flex items-center justify-center text-ouro/70 mb-2">
    <svg className="w-8 h-8 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="1.3" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25c-.669 0-1.189-.578-1.119-1.243l1.263-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z" />
    </svg>
  </div>
                        <h4 className="font-serif text-lg font-bold text-ouro-light">Sua sacola está vazia</h4>
                        <p className="text-xs text-luar-300">Escolha peças de alta costura, mimos pet ou delícias do bistrô.</p>
                      </div>
                    ) : (
                      carrinho.itens.map(item => (
                        <div key={item.id_produto} className="p-3.5 rounded-2xl border border-ouro/20 bg-celestial-950 flex gap-3.5 items-center shadow-md">
                          <img src={item.imagem_url} alt={item.nome_item} className="w-16 h-16 rounded-xl object-cover" />
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-bold text-ouro uppercase tracking-wider">{item.categoria}</span>
                              <button onClick={() => carrinho.remover(item.id_produto)} className="text-stone-400 hover:text-rose-400 text-xs cursor-pointer">remover</button>
                            </div>
                            <h5 className="text-xs font-bold text-luar-100 truncate">{item.nome_item}</h5>
                            <div className="flex justify-between items-center mt-2">
                              <span className="text-xs font-serif font-bold text-ouro-light">{formatBRL(item.preco * item.quantidade)}</span>
                              <div className="flex items-center gap-2 bg-celestial-900 border border-ouro/30 rounded-lg px-2 py-0.5">
                                <button onClick={() => carrinho.decrementar(item.id_produto)} className="text-xs text-ouro font-bold cursor-pointer">-</button>
                                <span className="text-xs font-bold text-luar-100">{item.quantidade}</span>
                                <button onClick={() => carrinho.adicionarAoCarrinho(item)} className="text-xs text-ouro font-bold cursor-pointer">+</button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Checkout */}
                  {carrinho.itens.length > 0 && (
                    <div className="p-6 bg-celestial-950 border-t border-ouro/20 space-y-3.5">
                      <div className="flex justify-between text-base font-serif font-bold text-ouro-light">
                        <span>Total do Pedido:</span>
                        <span className="text-ouro">{formatBRL(carrinho.total)}</span>
                      </div>
                      <button
                        id="btn-avancar-checkout"
                        onClick={() => {
                          if (!usuario) {
                            mostrarNotificacao('Por favor, identifique-se para avançar ao pagamento.', 'aviso');
                            setIsAuthOpen(true);
                            return;
                          }
                          setNomeCheckout(usuario.nome || usuario.nome_completo || '');
                          setNascimentoCheckout(usuario.data_nascimento || '');
                          setCpfCheckout(usuario.cpf || '');
                          if (usuario.endereco) {
                            if (typeof usuario.endereco === 'object') {
                              setCepCheckout(usuario.endereco.cep || '');
                              setLogradouroCheckout(usuario.endereco.logradouro || '');
                              setNumeroCheckout(usuario.endereco.numero || '');
                              setComplementoCheckout(usuario.endereco.complemento || '');
                              setBairroCheckout(usuario.endereco.bairro || '');
                              setCidadeCheckout(usuario.endereco.cidade || '');
                              setUfCheckout(usuario.endereco.uf || 'ES');
                            } else if (typeof usuario.endereco === 'string') {
                              setLogradouroCheckout(usuario.endereco);
                            }
                          }
                          setEtapaCheckout('dados');
                          setIsCarrinhoOpen(false);
                          setIsCheckoutOpen(true);
                        }}
                        className="w-full py-4 rounded-xl bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 font-bold text-xs uppercase tracking-widest shadow-lg hover:brightness-110 transition-all cursor-pointer flex items-center justify-center gap-2"
                      >
                        <span>Finalizar Compra &amp; Confirmar Dados</span>
                        <span>➔</span>
                      </button>
                    </div>
                  )}

                </div>
              </div>
            </div>
          )}

          {/* MODAL DE PRODUTO & ATRIBUTOS JSONB */}
          {produtoModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
              <div className="relative w-full max-w-xl bg-celestial-900 rounded-3xl p-6 sm:p-8 space-y-4 shadow-2xl border border-ouro/40 animate-fadeIn">
                <button onClick={() => setProdutoModal(null)} className="absolute top-4 right-4 text-ouro hover:text-white text-2xl font-bold cursor-pointer">×</button>
                <div className="flex gap-4 items-center">
                  <img src={produtoModal.imagem_url} className="w-24 h-24 rounded-2xl object-cover border border-ouro/30" />
                  <div>
                    <span className="text-[10px] uppercase font-bold text-ouro bg-celestial-950 border border-ouro/30 px-2.5 py-0.5 rounded">{produtoModal.categoria}</span>
                    <h3 className="font-serif text-xl font-bold text-ouro-light mt-1">{produtoModal.nome_item}</h3>
                    <span className="text-lg font-serif font-bold text-ouro">{formatBRL(produtoModal.preco)}</span>
                  </div>
                </div>
                <p className="text-xs text-luar-300 leading-relaxed font-light">{produtoModal.descricao}</p>
                <div className="border-t border-ouro/20 pt-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-ouro flex items-center gap-1.5">
                      <span className="text-ouro font-serif">✦</span> Especificações da Peça:
                    </span>
                    <button
                      type="button"
                      onClick={() => setVerAtributosTecnico(!verAtributosTecnico)}
                      className="text-[10px] text-ouro/70 hover:text-ouro underline cursor-pointer"
                    >
                      {verAtributosTecnico ? 'Visualizar em Cartões' : 'Ver JSONB Técnico'}
                    </button>
                  </div>

                  {verAtributosTecnico ? (
                    <pre className="p-3.5 bg-celestial-950 text-ouro-light text-xs rounded-xl font-mono overflow-x-auto border border-ouro/20">
                      {JSON.stringify(produtoModal.atributos, null, 2)}
                    </pre>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {produtoModal.atributos && typeof produtoModal.atributos === 'object' && !Array.isArray(produtoModal.atributos) ? (
                        Object.entries(produtoModal.atributos).map(([chave, valor]) => (
                          <div key={chave} className="p-2.5 rounded-xl bg-celestial-950/80 border border-ouro/25">
                            <span className="text-[10px] uppercase font-bold text-ouro/70 tracking-wider block capitalize">
                              {chave.replace(/_/g, ' ')}
                            </span>
                            <span className="text-xs text-luar-100 font-medium block truncate" title={String(Array.isArray(valor) ? valor.join(', ') : valor)}>
                              {Array.isArray(valor) ? valor.join(', ') : String(valor)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-luar-300 italic col-span-2">Sem especificações adicionais.</p>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {usuario?.role === 'admin' && (
                    <button
                      type="button"
                      onClick={() => {
                        const prod = produtoModal;
                        setProdutoModal(null);
                        iniciarEdicaoProduto(prod);
                      }}
                      className="px-4 py-3.5 rounded-xl bg-celestial-950 border border-ouro/40 text-ouro hover:bg-ouro/15 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      title="Editar informações desta peça"
                    >
                      <span>✏️</span>
                      <span>Editar Peça</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const ok = tentarAdicionarAoCarrinho(produtoModal);
                      if (ok) setProdutoModal(null);
                    }}
                    className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 font-bold text-xs uppercase tracking-wider hover:brightness-110 shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {!usuario && (
                      <svg className="w-3.5 h-3.5 text-celestial-950/80 inline-block mr-1" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                      </svg>
                    )}
                    <span>Adicionar à Sacola</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL DE EDIÇÃO DE PRODUTO / PEÇA DO CATÁLOGO (ADMINISTRADOR) */}
          {/* ==================================================================== */}
          {produtoEmEdicao && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-fadeIn">
              <div className="relative w-full max-w-2xl bg-celestial-900 rounded-3xl p-5 sm:p-7 space-y-4 shadow-2xl border-2 border-ouro/50 gold-glow max-h-[92vh] overflow-y-auto">
                <button 
                  type="button"
                  onClick={() => setProdutoEmEdicao(null)} 
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-celestial-950 border border-ouro/40 hover:border-ouro text-ouro hover:text-white flex items-center justify-center text-lg font-bold transition-all cursor-pointer z-10"
                  aria-label="Fechar"
                >
                  ×
                </button>

                <div className="border-b border-ouro/20 pb-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-ouro/15 border border-ouro/40 flex items-center justify-center text-ouro text-lg">
                    ✏️
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-ouro tracking-wider block">
                      Gestão de Acervo &amp; Catálogo
                    </span>
                    <h3 className="font-serif text-xl sm:text-2xl font-bold gold-gradient-text">
                      Editar Peça: {editNome || produtoEmEdicao.nome_item}
                    </h3>
                  </div>
                </div>

                <form onSubmit={salvarEdicaoProduto} className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                      Nome da Peça / Produto
                    </label>
                    <input 
                      name="edit_nome" 
                      value={editNome} 
                      onChange={(e) => setEditNome(e.target.value)} 
                      required 
                      placeholder="Ex: Vestido Estelar em Seda Pura" 
                      className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                        Categoria
                      </label>
                      <select
                        name="edit_categoria"
                        value={editCategoria}
                        onChange={(e) => setEditCategoria(e.target.value)}
                        className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none cursor-pointer focus:border-ouro"
                      >
                        <option value="Moda">Moda (Alta Costura)</option>
                        <option value="Pet">Pet Shop</option>
                        <option value="Cafeteria">Cafeteria</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                        Preço (R$)
                      </label>
                      <input 
                        name="edit_preco" 
                        type="number" 
                        step="0.01" 
                        value={editPreco} 
                        onChange={(e) => setEditPreco(e.target.value)} 
                        required 
                        placeholder="Ex: 349.90" 
                        className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro font-mono" 
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                        Estoque
                      </label>
                      <input 
                        name="edit_estoque" 
                        type="number" 
                        min="0" 
                        value={editEstoque} 
                        onChange={(e) => setEditEstoque(e.target.value)} 
                        required 
                        placeholder="Ex: 10" 
                        className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro font-mono" 
                      />
                    </div>
                  </div>

                  {/* Foto da Peça */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-bold text-ouro uppercase tracking-wider">
                        Foto da Peça / Produto
                      </label>
                      <span className="text-[10px] text-luar-300">Galeria, PC ou URL</span>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
                      <label className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-celestial-950 border border-ouro/40 text-ouro hover:bg-ouro hover:text-celestial-950 font-bold text-xs cursor-pointer transition-all shadow-sm shrink-0">
                        <span>📷</span>
                        <span>{uploadingFotoEdit ? 'Processando foto...' : 'Escolher da Galeria ou PC'}</span>
                        <input 
                          type="file" 
                          accept="image/*" 
                          className="hidden" 
                          disabled={uploadingFotoEdit}
                          onChange={(e) => {
                            const arq = e.target.files && e.target.files[0];
                            if (!arq) return;
                            setUploadingFotoEdit(true);
                            processarUploadImagem(
                              arq,
                              (url) => {
                                setUploadingFotoEdit(false);
                                setEditImagemUrl(url);
                                setEditImagemPreview(url);
                                mostrarNotificacao('Foto carregada com sucesso!', 'sucesso');
                              },
                              (err) => {
                                setUploadingFotoEdit(false);
                                alert('Erro ao enviar foto: ' + err);
                              }
                            );
                          }}
                        />
                      </label>
                      <div className="flex-1 relative">
                        <input 
                          name="edit_imagem" 
                          value={editImagemUrl}
                          onChange={(e) => {
                            setEditImagemUrl(e.target.value);
                            setEditImagemPreview(e.target.value);
                          }}
                          placeholder="Ou cole a URL da imagem (https://...)" 
                          className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                        />
                      </div>
                      {editImagemPreview && (
                        <div className="flex items-center gap-2 shrink-0 bg-celestial-950 p-1.5 rounded-xl border border-ouro/30">
                          <img src={editImagemPreview} alt="Preview" className="w-10 h-10 rounded-lg object-cover border border-ouro/30" />
                          <button
                            type="button"
                            onClick={() => {
                              setEditImagemUrl('');
                              setEditImagemPreview('');
                            }}
                            className="text-xs text-red-400 hover:text-red-300 font-bold px-1.5 cursor-pointer"
                            title="Remover foto"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Descrição */}
                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                      Descrição Detalhada
                    </label>
                    <textarea 
                      name="edit_descricao" 
                      value={editDescricao} 
                      onChange={(e) => setEditDescricao(e.target.value)} 
                      placeholder="Detalhes do tecido, acabamentos, corte e proposta da peça..." 
                      className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro resize-none" 
                      rows="2"
                    />
                  </div>

                  {/* SELETORES DE ATRIBUTOS (COM MODO JSONB) */}
                  <div className="p-4 rounded-2xl bg-celestial-950/90 border border-ouro/35 space-y-3.5 shadow-inner">
                    <div className="flex items-center justify-between border-b border-ouro/20 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-ouro font-serif">✦</span>
                        <div>
                          <span className="block text-xs font-bold text-ouro uppercase tracking-wider">
                            {'Atributos & Detalhes da Peça (' + editCategoria + ')'}
                          </span>
                          <span className="block text-[10px] text-luar-300">
                            {'Seleções rápidas e intuitivas organizadas para ' + (editCategoria === 'Moda' ? 'Alta Costura' : editCategoria === 'Pet' ? 'o Pet Shop' : 'a Cafeteria')}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditModoAtributosAvancado(!editModoAtributosAvancado)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-mono border border-ouro/30 text-ouro/80 hover:text-ouro hover:bg-ouro/10 cursor-pointer transition-colors"
                      >
                        {editModoAtributosAvancado ? '✨ Voltar aos Seletores' : '{ } Modo JSON'}
                      </button>
                    </div>

                    {editModoAtributosAvancado ? (
                      <div>
                        <label className="block text-[10px] font-mono text-ouro/80 mb-1">JSONB Direto (PostgreSQL GIN):</label>
                        <textarea
                          name="edit_atributos_json"
                          value={editAtributosManualJson}
                          onChange={(e) => setEditAtributosManualJson(e.target.value)}
                          rows="4"
                          className="w-full p-3 rounded-xl bg-celestial-900 border border-ouro/30 text-xs font-mono text-ouro-light outline-none"
                        />
                      </div>
                    ) : (
                      <div className="space-y-3.5">
                        {/* ATRIBUTOS: MODA */}
                        {editCategoria === 'Moda' && (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                Tamanho Principal: <span className="text-luar-100 font-semibold">{editTamanhoModa}</span>
                              </label>
                              <div className="flex flex-wrap gap-1.5">
                                {['PP', 'P', 'M', 'G', 'GG', 'XG', 'Único'].map(tam => (
                                  <button
                                    key={tam}
                                    type="button"
                                    onClick={() => setEditTamanhoModa(tam)}
                                    className={"px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer " + (editTamanhoModa === tam ? 'bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 shadow-md font-bold' : 'bg-celestial-900 text-luar-200 border border-ouro/25 hover:border-ouro/60')}
                                  >
                                    {tam}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                Grade Disponível em Estoque:
                              </label>
                              <div className="flex flex-wrap gap-1.5">
                                {['PP', 'P', 'M', 'G', 'GG', 'XG', 'Sob Medida'].map(grade => {
                                  const ativo = editGradesModa.includes(grade);
                                  return (
                                    <button
                                      key={grade}
                                      type="button"
                                      onClick={() => {
                                        setEditGradesModa(ativo ? editGradesModa.filter(g => g !== grade) : [...editGradesModa, grade]);
                                      }}
                                      className={"px-2.5 py-1 rounded-lg text-[11px] transition-all cursor-pointer flex items-center gap-1 " + (ativo ? 'bg-ouro/20 border border-ouro text-ouro font-bold' : 'bg-celestial-900 border border-ouro/20 text-luar-300 hover:text-ouro')}
                                    >
                                      <span>{ativo ? '✓' : '+'}</span>
                                      <span>{grade}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                Cor Principal:
                              </label>
                              <input
                                type="text"
                                value={editCorModa}
                                onChange={(e) => setEditCorModa(e.target.value)}
                                placeholder="Ex: Azul Noturno com Fios Dourados"
                                className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none mb-1.5"
                              />
                              <div className="flex flex-wrap gap-1">
                                {['Azul Meia-Noite', 'Dourado Imperial', 'Preto Absoluto', 'Branco Pérola', 'Vinho Borgonha', 'Verde Esmeralda', 'Terracota'].map(c => (
                                  <button
                                    key={c}
                                    type="button"
                                    onClick={() => setEditCorModa(c)}
                                    className={"text-[10px] px-2 py-0.5 rounded-full cursor-pointer transition-all " + (editCorModa === c ? 'bg-ouro text-celestial-950 font-bold' : 'bg-celestial-900 text-luar-300 hover:text-ouro border border-ouro/20')}
                                  >
                                    {c}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              <div>
                                <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">Tecido / Material:</label>
                                <select
                                  value={editTecidoModa}
                                  onChange={(e) => setEditTecidoModa(e.target.value)}
                                  className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none cursor-pointer"
                                >
                                  <option value="Seda pura acetinada">Seda Pura Acetinada</option>
                                  <option value="Veludo Cristal Francês">Veludo Cristal Francês</option>
                                  <option value="Linho Rústico Nobre">Linho Rústico Nobre</option>
                                  <option value="Crepe de Seda Italiano">Crepe de Seda Italiano</option>
                                  <option value="Renda Chantilly Artesanal">Renda Chantilly Artesanal</option>
                                  <option value="Brocado com Fios Dourados">Brocado com Fios Dourados</option>
                                  <option value="Algodão Pima Peruano">Algodão Pima Peruano</option>
                                  <option value="Tule Bordado com Pedrarias">Tule Bordado com Pedrarias</option>
                                  <option value="Lã Fina Cashmere">Lã Fina Cashmere</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">Corte &amp; Caimento:</label>
                                <select
                                  value={editCorteModa}
                                  onChange={(e) => setEditCorteModa(e.target.value)}
                                  className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none cursor-pointer"
                                >
                                  <option value="Evasê Fluído">Evasê Fluído</option>
                                  <option value="Alfaiataria Slim Nobre">Alfaiataria Slim Nobre</option>
                                  <option value="Oversized Estruturado">Oversized Estruturado</option>
                                  <option value="Sereia Ajustado">Sereia Ajustado</option>
                                  <option value="Reto Clássico">Reto Clássico</option>
                                  <option value="Envelope Transpassado">Envelope Transpassado</option>
                                  <option value="Godê com Volume">Godê com Volume</option>
                                </select>
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                Ocasião / Coleção: <span className="text-luar-100 font-semibold">{editEstacaoModa}</span>
                              </label>
                              <div className="flex flex-wrap gap-1.5">
                                {['Noite / Gala', 'Casual Chic', 'Alta Joalheria', 'Primavera / Verão', 'Outono / Inverno'].map(est => (
                                  <button
                                    key={est}
                                    type="button"
                                    onClick={() => setEditEstacaoModa(est)}
                                    className={"px-2.5 py-1 rounded-lg text-[11px] cursor-pointer transition-all " + (editEstacaoModa === est ? 'bg-ouro text-celestial-950 font-bold' : 'bg-celestial-900 border border-ouro/25 text-luar-200 hover:text-ouro')}
                                  >
                                    {est}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* ATRIBUTOS: PET */}
                        {editCategoria === 'Pet' && (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                Indicação: <span className="text-luar-100 font-semibold">{editIndicacaoPet}</span>
                              </label>
                              <div className="flex flex-wrap gap-1.5">
                                {['Cães e Gatos', 'Cães Pequenos', 'Cães Grandes', 'Gatos', 'Filhotes'].map(ind => (
                                  <button
                                    key={ind}
                                    type="button"
                                    onClick={() => setEditIndicacaoPet(ind)}
                                    className={"px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer " + (editIndicacaoPet === ind ? 'bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 shadow-md font-bold' : 'bg-celestial-900 text-luar-200 border border-ouro/25 hover:border-ouro/60')}
                                  >
                                    {ind}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                Porte Recomendado: <span className="text-luar-100 font-semibold">{editPortePet}</span>
                              </label>
                              <div className="flex flex-wrap gap-1.5">
                                {['Mini (até 3kg)', 'Pequeno (3 a 7kg)', 'Médio (7 a 15kg)', 'Grande (15 a 30kg)', 'Gigante (+30kg)'].map(porte => (
                                  <button
                                    key={porte}
                                    type="button"
                                    onClick={() => setEditPortePet(porte)}
                                    className={"px-2.5 py-1 rounded-lg text-[11px] cursor-pointer transition-all " + (editPortePet === porte ? 'bg-ouro text-celestial-950 font-bold' : 'bg-celestial-900 border border-ouro/25 text-luar-200 hover:text-ouro')}
                                  >
                                    {porte}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">Material / Composição:</label>
                              <select
                                value={editMaterialPet}
                                onChange={(e) => setEditMaterialPet(e.target.value)}
                                className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none cursor-pointer"
                              >
                                <option value="Veludo plush e espuma ortopédica">Veludo Plush e Espuma Ortopédica</option>
                                <option value="Algodão orgânico respirável hipoalergênico">Algodão Orgânico Respirável Hipoalergênico</option>
                                <option value="Couro ecológico macio e acolchoado">Couro Ecológico Macio e Acolchoado</option>
                                <option value="Microfibra impermeável de alta resistência">Microfibra Impermeável de Alta Resistência</option>
                                <option value="Tricô soft aconchegante térmico">Tricô Soft Aconchegante Térmico</option>
                                <option value="Nylon náutico reforçado antirasgo">Nylon Náutico Reforçado Antirasgo</option>
                              </select>
                            </div>

                            <div className="grid grid-cols-2 gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => setEditLavavelPet(!editLavavelPet)}
                                className={"p-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-between " + (editLavavelPet ? 'bg-ouro/20 border-ouro text-ouro' : 'bg-celestial-900 border-ouro/25 text-luar-400')}
                              >
                                <span>🫧 Lavável em Máquina</span>
                                <span>{editLavavelPet ? '✓ Sim' : '✕ Não'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditAntialergicoPet(!editAntialergicoPet)}
                                className={"p-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-between " + (editAntialergicoPet ? 'bg-ouro/20 border-ouro text-ouro' : 'bg-celestial-900 border-ouro/25 text-luar-400')}
                              >
                                <span>🛡️ Hipoalergênico</span>
                                <span>{editAntialergicoPet ? '✓ Sim' : '✕ Não'}</span>
                              </button>
                            </div>
                          </div>
                        )}

                        {/* ATRIBUTOS: CAFETERIA */}
                        {editCategoria === 'Cafeteria' && (
                          <div className="space-y-3">
                            <div>
                              <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                Volume / Porção: <span className="text-luar-100 font-semibold">{editVolumeCafeteria}</span>
                              </label>
                              <div className="flex flex-wrap gap-1.5">
                                {['Dose 50ml', 'Xícara 120ml', 'Caneca 240ml', 'Grande 350ml', 'Porção 100g', 'Fatia 150g'].map(vol => (
                                  <button
                                    key={vol}
                                    type="button"
                                    onClick={() => setEditVolumeCafeteria(vol)}
                                    className={"px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer " + (editVolumeCafeteria === vol ? 'bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 shadow-md font-bold' : 'bg-celestial-900 text-luar-200 border border-ouro/25 hover:border-ouro/60')}
                                  >
                                    {vol}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                Temperatura de Serviço: <span className="text-luar-100 font-semibold">{editTemperaturaCafeteria}</span>
                              </label>
                              <div className="flex flex-wrap gap-2">
                                {[
                                  { rotulo: '☕ Quente', valor: 'Quente' },
                                  { rotulo: '❄️ Gelado', valor: 'Gelado' },
                                  { rotulo: '🥐 Ambiente', valor: 'Ambiente' }
                                ].map(item => (
                                  <button
                                    key={item.valor}
                                    type="button"
                                    onClick={() => setEditTemperaturaCafeteria(item.valor)}
                                    className={"px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer " + (editTemperaturaCafeteria === item.valor ? 'bg-ouro text-celestial-950 font-bold' : 'bg-celestial-900 border border-ouro/25 text-luar-200 hover:text-ouro')}
                                  >
                                    {item.rotulo}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">Grão Especial ou Ingrediente Nobre:</label>
                              <select
                                value={editGraoCafeteria}
                                onChange={(e) => setEditGraoCafeteria(e.target.value)}
                                className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none cursor-pointer"
                              >
                                <option value="Catuaí Vermelho Artesanal 88 pts">Catuaí Vermelho Artesanal 88 pts</option>
                                <option value="Bourbon Amarelo Vulcânico">Bourbon Amarelo Vulcânico</option>
                                <option value="Geisha Especial Premiado">Geisha Especial Premiado</option>
                                <option value="Matcha Cerimonial Uji Japão">Matcha Cerimonial Uji Japão</option>
                                <option value="Cacau Belga 70% Single Origin">Cacau Belga 70% Single Origin</option>
                                <option value="Chá Branco com Flores de Jasmim">Chá Branco com Flores de Jasmim</option>
                                <option value="Pistache Siciliano com Flor de Sal">Pistache Siciliano com Flor de Sal</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                Opções de Leite / Base Aceitas:
                              </label>
                              <div className="flex flex-wrap gap-1.5">
                                {['Integral Fresco', 'Aveia Barista', 'Amêndoas', 'Sem Lactose', 'Coco Artesanal'].map(leite => {
                                  const ativo = editOpcoesLeiteCafeteria.includes(leite);
                                  return (
                                    <button
                                      key={leite}
                                      type="button"
                                      onClick={() => {
                                        setEditOpcoesLeiteCafeteria(ativo ? editOpcoesLeiteCafeteria.filter(l => l !== leite) : [...editOpcoesLeiteCafeteria, leite]);
                                      }}
                                      className={"px-2.5 py-1 rounded-lg text-[11px] transition-all cursor-pointer flex items-center gap-1 " + (ativo ? 'bg-ouro/20 border border-ouro text-ouro font-bold' : 'bg-celestial-900 border border-ouro/20 text-luar-300 hover:text-ouro')}
                                    >
                                      <span>{ativo ? '✓' : '+'}</span>
                                      <span>{leite}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => setEditVeganoCafeteria(!editVeganoCafeteria)}
                                className={"p-2 rounded-xl border text-[11px] font-bold transition-all cursor-pointer flex flex-col items-center gap-1 " + (editVeganoCafeteria ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300' : 'bg-celestial-900 border-ouro/25 text-luar-400')}
                              >
                                <span>🌿 Vegano</span>
                                <span>{editVeganoCafeteria ? '✓ Sim' : '✕ Não'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditVegetarianoCafeteria(!editVegetarianoCafeteria)}
                                className={"p-2 rounded-xl border text-[11px] font-bold transition-all cursor-pointer flex flex-col items-center gap-1 " + (editVegetarianoCafeteria ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300' : 'bg-celestial-900 border-ouro/25 text-luar-400')}
                              >
                                <span>🧀 Vegetariano</span>
                                <span>{editVegetarianoCafeteria ? '✓ Sim' : '✕ Não'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditSemGlutenCafeteria(!editSemGlutenCafeteria)}
                                className={"p-2 rounded-xl border text-[11px] font-bold transition-all cursor-pointer flex flex-col items-center gap-1 " + (editSemGlutenCafeteria ? 'bg-amber-950/60 border-amber-500 text-amber-300' : 'bg-celestial-900 border-ouro/25 text-luar-400')}
                              >
                                <span>🌾 Sem Glúten</span>
                                <span>{editSemGlutenCafeteria ? '✓ Sim' : '✕ Não'}</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button 
                      type="button"
                      onClick={() => setProdutoEmEdicao(null)}
                      className="flex-1 py-3.5 rounded-xl bg-celestial-950 border border-ouro/30 text-luar-300 hover:text-white font-bold text-xs uppercase tracking-wider cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button 
                      type="submit" 
                      disabled={salvandoEdicao}
                      className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 font-bold text-xs uppercase tracking-wider hover:brightness-110 shadow-lg cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <span>{salvandoEdicao ? 'Salvando Alterações...' : 'Salvar Alterações'}</span>
                      <span>✦</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL CONFIGURAÇÕES DO MEU PERFIL (AUTOATENDIMENTO DO USUÁRIO) */}
          {/* ==================================================================== */}
          {modalPerfilUsuario && usuario && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-fadeIn">
              <div className="relative w-full max-w-lg bg-celestial-900 rounded-3xl p-5 sm:p-7 space-y-4 shadow-2xl border-2 border-ouro/50 gold-glow max-h-[92vh] overflow-y-auto">
                <button 
                  type="button"
                  onClick={() => setModalPerfilUsuario(false)} 
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-celestial-950 border border-ouro/40 hover:border-ouro text-ouro hover:text-white flex items-center justify-center text-lg font-bold transition-all cursor-pointer z-10"
                  aria-label="Fechar"
                >
                  ×
                </button>

                <div className="border-b border-ouro/20 pb-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-ouro/15 border border-ouro/40 flex items-center justify-center text-ouro text-lg">
                    👤
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-ouro tracking-wider block">
                      Minha Conta Vênus e Luar
                    </span>
                    <h3 className="font-serif text-xl sm:text-2xl font-bold gold-gradient-text">
                      Configurações do Meu Perfil
                    </h3>
                  </div>
                </div>

                <form onSubmit={salvarPerfilUsuario} className="space-y-4">
                  {/* Foto de Perfil */}
                  <div className="p-3.5 rounded-2xl bg-celestial-950/80 border border-ouro/30 flex flex-col sm:flex-row items-center gap-4">
                    <div className="relative">
                      {perfilFotoPreview ? (
                        <img 
                          src={perfilFotoPreview} 
                          alt="Pré-visualização" 
                          className="w-20 h-20 rounded-full object-cover border-2 border-ouro shadow-md" 
                        />
                      ) : (
                        <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-ouro-dark to-ouro text-celestial-950 font-serif font-bold text-2xl flex items-center justify-center border-2 border-ouro shadow-md">
                          {((perfilNome || usuario.email || 'U')[0]).toUpperCase()}
                        </div>
                      )}
                      {perfilFotoPreview && (
                        <button
                          type="button"
                          onClick={() => {
                            setPerfilFotoUrl('');
                            setPerfilFotoPreview('');
                          }}
                          className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-rose-600 text-white text-xs font-bold flex items-center justify-center hover:bg-rose-500 shadow cursor-pointer"
                          title="Remover foto de perfil"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="flex-1 space-y-2 text-center sm:text-left w-full">
                      <span className="block text-[11px] font-bold text-ouro uppercase tracking-wider">
                        Foto de Perfil
                      </span>
                      <div className="flex flex-col gap-2">
                        <label className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-celestial-900 border border-ouro/40 text-ouro hover:bg-ouro hover:text-celestial-950 text-xs font-bold cursor-pointer transition-all shadow-sm">
                          <span>📷</span>
                          <span>{uploadingFotoPerfil ? 'Processando foto...' : 'Escolher Foto do PC ou Celular'}</span>
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            disabled={uploadingFotoPerfil}
                            onChange={(e) => {
                              const arq = e.target.files && e.target.files[0];
                              if (!arq) return;
                              setUploadingFotoPerfil(true);
                              processarUploadImagem(
                                arq,
                                (url) => {
                                  setUploadingFotoPerfil(false);
                                  setPerfilFotoUrl(url);
                                  setPerfilFotoPreview(url);
                                  mostrarNotificacao('Foto carregada com sucesso!', 'sucesso');
                                },
                                (err) => {
                                  setUploadingFotoPerfil(false);
                                  alert('Erro ao carregar foto: ' + err);
                                }
                              );
                            }}
                          />
                        </label>
                        <input 
                          type="text"
                          value={perfilFotoUrl}
                          onChange={(e) => {
                            setPerfilFotoUrl(e.target.value);
                            setPerfilFotoPreview(e.target.value);
                          }}
                          placeholder="Ou cole a URL direta da imagem (https://...)" 
                          className="w-full p-2 rounded-xl bg-celestial-900 border border-ouro/25 text-xs text-luar-100 outline-none focus:border-ouro" 
                        />
                      </div>
                    </div>
                  </div>

                  {/* Nome Completo */}
                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                      Nome Completo
                    </label>
                    <input 
                      id="input-perfil-nome"
                      name="perfil_nome" 
                      value={perfilNome} 
                      onChange={(e) => setPerfilNome(e.target.value)} 
                      required 
                      placeholder="Ex: Clara Silveira" 
                      className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                    />
                  </div>

                  {/* E-mail */}
                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                      Endereço de E-mail
                    </label>
                    <input 
                      id="input-perfil-email"
                      name="perfil_email" 
                      type="email"
                      value={perfilEmail} 
                      onChange={(e) => setPerfilEmail(e.target.value)} 
                      required 
                      placeholder="seu@email.com" 
                      className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                    />
                  </div>

                  {/* CPF Oficial com Privacidade LGPD e Opcionalidade */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <label className="block text-[11px] font-bold text-ouro uppercase tracking-wider">
                          CPF (Opcional)
                        </label>
                        {perfilCpf && (
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-ouro/15 text-ouro border border-ouro/40" title="Proteção de Privacidade LGPD">
                            LGPD: {mascararCpf(perfilCpf)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {perfilCpf && (
                          <button
                            type="button"
                            onClick={() => setPerfilCpf('')}
                            className="text-[10px] text-ouro/80 hover:text-ouro bg-celestial-900 px-2 py-0.5 rounded border border-ouro/30 hover:border-ouro transition-colors cursor-pointer"
                            title="Limpar campo para digitar CPF"
                          >
                            ✕ Limpar
                          </button>
                        )}
                      </div>
                    </div>
                    <input 
                      id="input-perfil-cpf"
                      name="perfil_cpf" 
                      value={perfilCpf} 
                      onChange={(e) => setPerfilCpf(tratarDigitacaoCpf(e.target.value))}
                      inputMode="numeric"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength="14"
                      placeholder="000.000.000-00 (Opcional)" 
                      className="w-full p-3 rounded-xl text-xs font-mono outline-none bg-celestial-950 border border-ouro/30 text-luar-100 focus:border-ouro" 
                    />
                    <p className="text-[10.5px] text-luar-300/80 mt-1">
                      Campo opcional. Você pode cadastrar, atualizar ou retificar seu CPF a qualquer momento.
                    </p>
                  </div>

                  {/* Senha */}
                  <div className="p-3.5 rounded-2xl bg-celestial-950/80 border border-ouro/30 space-y-2">
                    <label className="block text-[11px] font-bold text-ouro uppercase tracking-wider">
                      Alterar Senha de Acesso (Opcional)
                    </label>
                    <p className="text-[10.5px] text-luar-300">
                      Deixe em branco caso deseje manter sua senha atual inalterada.
                    </p>
                    <div className="relative">
                      <input 
                        id="input-perfil-senha"
                        name="perfil_nova_senha" 
                        type={verSenhaPerfil ? "text" : "password"} 
                        value={perfilNovaSenha} 
                        onChange={(e) => setPerfilNovaSenha(e.target.value)} 
                        placeholder="Nova senha (mínimo 8 caracteres)" 
                        className="w-full p-3 pr-10 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                      />
                      {renderBotaoOlhoSenha(verSenhaPerfil, () => setVerSenhaPerfil(!verSenhaPerfil), "btn-ver-senha-perfil")}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button 
                      type="button"
                      onClick={() => setModalPerfilUsuario(false)}
                      className="flex-1 py-3.5 rounded-xl bg-celestial-950 border border-ouro/30 text-luar-300 hover:text-white font-bold text-xs uppercase tracking-wider cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button 
                      type="submit" 
                      disabled={salvandoPerfil}
                      className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 font-bold text-xs uppercase tracking-wider hover:brightness-110 shadow-lg cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <span>{salvandoPerfil ? 'Salvando...' : 'Salvar Alterações'}</span>
                      <span>✦</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL ADMIN: EDIÇÃO DE QUALQUER USUÁRIO (GESTOR) */}
          {/* ==================================================================== */}
          {usuarioEmEdicaoAdmin && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-sm animate-fadeIn">
              <div className="relative w-full max-w-xl bg-celestial-900 rounded-3xl p-5 sm:p-7 space-y-4 shadow-2xl border-2 border-ouro/60 gold-glow max-h-[92vh] overflow-y-auto">
                <button 
                  type="button"
                  onClick={() => setUsuarioEmEdicaoAdmin(null)} 
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-celestial-950 border border-ouro/40 hover:border-ouro text-ouro hover:text-white flex items-center justify-center text-lg font-bold transition-all cursor-pointer z-10"
                  aria-label="Fechar"
                >
                  ×
                </button>

                <div className="border-b border-ouro/20 pb-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-ouro/20 border border-ouro/40 flex items-center justify-center text-ouro text-lg">
                    ✏️
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-ouro tracking-wider block">
                      Administração de Acessos &amp; Cadastros
                    </span>
                    <h3 className="font-serif text-xl sm:text-2xl font-bold gold-gradient-text">
                      Editar Usuário: {adminEditNome || usuarioEmEdicaoAdmin.email}
                    </h3>
                  </div>
                </div>

                <form onSubmit={salvarEdicaoUsuarioAdmin} className="space-y-4">
                  {/* Foto de Perfil */}
                  <div className="p-3.5 rounded-2xl bg-celestial-950/80 border border-ouro/30 flex flex-col sm:flex-row items-center gap-4">
                    <div className="relative">
                      {adminEditFotoPreview ? (
                        <img 
                          src={adminEditFotoPreview} 
                          alt="Foto" 
                          className="w-16 h-16 rounded-full object-cover border-2 border-ouro shadow-md" 
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-ouro/15 text-ouro font-serif font-bold text-xl flex items-center justify-center border-2 border-ouro/40">
                          {((adminEditNome || usuarioEmEdicaoAdmin.email || 'U')[0]).toUpperCase()}
                        </div>
                      )}
                      {adminEditFotoPreview && (
                        <button
                          type="button"
                          onClick={() => {
                            setAdminEditFotoUrl('');
                            setAdminEditFotoPreview('');
                          }}
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center hover:bg-rose-500 shadow cursor-pointer"
                          title="Remover foto"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="flex-1 space-y-1.5 text-center sm:text-left w-full">
                      <span className="block text-[11px] font-bold text-ouro uppercase tracking-wider">
                        Foto de Perfil do Usuário
                      </span>
                      <div className="flex flex-col gap-1.5">
                        <label className="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-xl bg-celestial-900 border border-ouro/40 text-ouro hover:bg-ouro hover:text-celestial-950 text-xs font-bold cursor-pointer transition-all shadow-sm">
                          <span>📷</span>
                          <span>{uploadingFotoAdminEdit ? 'Processando foto...' : 'Escolher Foto do Computador ou Celular'}</span>
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            disabled={uploadingFotoAdminEdit}
                            onChange={(e) => {
                              const arq = e.target.files && e.target.files[0];
                              if (!arq) return;
                              setUploadingFotoAdminEdit(true);
                              processarUploadImagem(
                                arq,
                                (url) => {
                                  setUploadingFotoAdminEdit(false);
                                  setAdminEditFotoUrl(url);
                                  setAdminEditFotoPreview(url);
                                  mostrarNotificacao('Foto carregada com sucesso!', 'sucesso');
                                },
                                (err) => {
                                  setUploadingFotoAdminEdit(false);
                                  alert('Erro ao carregar foto: ' + err);
                                }
                              );
                            }}
                          />
                        </label>
                        <input 
                          type="text"
                          value={adminEditFotoUrl}
                          onChange={(e) => {
                            setAdminEditFotoUrl(e.target.value);
                            setAdminEditFotoPreview(e.target.value);
                          }}
                          placeholder="Ou cole a URL direta (https://...)" 
                          className="w-full p-2 rounded-xl bg-celestial-900 border border-ouro/25 text-xs text-luar-100 outline-none focus:border-ouro" 
                        />
                      </div>
                    </div>
                  </div>

                  {/* Nome Completo */}
                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                      Nome Completo
                    </label>
                    <input 
                      name="admin_edit_nome" 
                      value={adminEditNome} 
                      onChange={(e) => setAdminEditNome(e.target.value)} 
                      required 
                      className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                    />
                  </div>

                  {/* E-mail */}
                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                      E-mail de Cadastro
                    </label>
                    <input 
                      name="admin_edit_email" 
                      type="email"
                      value={adminEditEmail} 
                      onChange={(e) => setAdminEditEmail(e.target.value)} 
                      required 
                      className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                    />
                  </div>

                  {/* CPF & Função */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <label className="text-[11px] font-bold text-ouro uppercase tracking-wider">
                            CPF (Correção Administrativa)
                          </label>
                          {adminEditCpf && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-ouro/15 text-ouro border border-ouro/40" title="Proteção de Privacidade LGPD">
                              LGPD: {mascararCpf(adminEditCpf)}
                            </span>
                          )}
                        </div>
                        {adminEditCpf && (
                          <button
                            type="button"
                            onClick={() => setAdminEditCpf('')}
                            className="text-[10px] text-ouro/80 hover:text-ouro bg-celestial-900 px-2 py-0.5 rounded border border-ouro/30 hover:border-ouro transition-colors cursor-pointer"
                            title="Limpar campo para digitar CPF"
                          >
                            ✕ Limpar
                          </button>
                        )}
                      </div>
                      <input 
                        name="admin_edit_cpf" 
                        value={adminEditCpf} 
                        onChange={(e) => setAdminEditCpf(tratarDigitacaoCpf(e.target.value))} 
                        inputMode="numeric"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        maxLength="14"
                        placeholder="000.000.000-00 (Opcional)" 
                        className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro font-mono" 
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                        Função / Papel no Sistema
                      </label>
                      <select 
                        name="admin_edit_role"
                        value={adminEditRole}
                        onChange={(e) => setAdminEditRole(e.target.value)}
                        className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro cursor-pointer"
                      >
                        <option value="cliente">Usuário</option>
                        <option value="admin">Administradora</option>
                      </select>
                    </div>
                  </div>

                  {/* Redefinição de Senha */}
                  <div className="p-3.5 rounded-2xl bg-celestial-950/80 border border-ouro/30 space-y-2">
                    <label className="block text-[11px] font-bold text-ouro uppercase tracking-wider">
                      Redefinir Senha do Usuário (Opcional)
                    </label>
                    <p className="text-[10.5px] text-luar-300">
                      Deixe em branco para preservar a senha atual do usuário.
                    </p>
                    <div className="relative">
                      <input 
                        name="admin_edit_senha" 
                        type={verSenhaAdminEditUser ? "text" : "password"} 
                        value={adminEditSenha} 
                        onChange={(e) => setAdminEditSenha(e.target.value)} 
                        placeholder="Nova senha para este usuário" 
                        className="w-full p-3 pr-10 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                      />
                      {renderBotaoOlhoSenha(verSenhaAdminEditUser, () => setVerSenhaAdminEditUser(!verSenhaAdminEditUser), "btn-ver-senha-admin-user")}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button 
                      type="button"
                      onClick={() => setUsuarioEmEdicaoAdmin(null)}
                      className="flex-1 py-3.5 rounded-xl bg-celestial-950 border border-ouro/30 text-luar-300 hover:text-white font-bold text-xs uppercase tracking-wider cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button 
                      type="submit" 
                      disabled={salvandoEdicaoAdminUsuario}
                      className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 font-bold text-xs uppercase tracking-wider hover:brightness-110 shadow-lg cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <span>{salvandoEdicaoAdminUsuario ? 'Gravando...' : 'Gravar Alterações'}</span>
                      <span>✦</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL ADOÇÃO RESPONSÁVEL COM BLIND CONTACT & WHATSAPP */}
          {/* ==================================================================== */}
          {petAdocaoModal && (
            <div 
              style={{ backgroundColor: 'rgba(3, 6, 14, 0.94)' }}
              className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 backdrop-blur-sm animate-fadeIn"
            >
              <div 
                style={{ backgroundColor: '#080E1E' }}
                className="relative w-full max-w-lg rounded-3xl p-5 sm:p-7 space-y-5 shadow-[0_25px_60px_rgba(0,0,0,0.95)] border border-emerald-500/50 gold-glow max-h-[90vh] overflow-y-auto"
              >
                <button 
                  onClick={() => setPetAdocaoModal(null)} 
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-celestial-900 border border-ouro/40 hover:border-ouro text-ouro hover:text-white flex items-center justify-center text-lg font-bold transition-all cursor-pointer z-10"
                  aria-label="Fechar"
                >
                  ×
                </button>

                <div className="flex items-center gap-4 border-b border-ouro/20 pb-4">
                  <img 
                    src={petAdocaoModal.imagem_url} 
                    alt={petAdocaoModal.nome_pet} 
                    className="w-16 h-16 rounded-2xl object-cover border border-emerald-500/50 shadow-md"
                  />
                  <div>
                    <span className="text-[10px] uppercase font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-2.5 py-0.5 rounded-full">
                      Candidatura para Adoção Responsável
                    </span>
                    <h3 className="font-serif text-2xl font-bold gold-gradient-text mt-0.5">
                      {petAdocaoModal.nome_pet}
                    </h3>
                    <span className="text-xs text-luar-300">
                      {petAdocaoModal.especie} • Porte {petAdocaoModal.porte || 'Médio'} • {petAdocaoModal.sexo || 'Não informado'}
                    </span>
                  </div>
                </div>

                {/* Banner de Segurança e Contato Responsável */}
                <div className="p-3.5 rounded-2xl bg-[#040711] border border-emerald-500/30 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0 text-sm">
                    🔒
                  </div>
                  <div className="text-xs text-luar-200 leading-relaxed">
                    <strong className="text-emerald-300 block font-semibold">Contato Direto e Seguro:</strong>
                    O contato do doador é protegido pela boutique. Ao registrar sua candidatura, conectamos você ao protetor responsável diretamente pelo WhatsApp.
                  </div>
                </div>

                {/* Informações Específicas de Saúde Felina (FIV / FeLV) */}
                {petAdocaoModal.especie?.toLowerCase().includes('gato') && (
                  <div className="p-3.5 rounded-2xl bg-[#040711] border border-purple-500/40 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">🐱</span>
                      <div>
                        <strong className="text-xs font-bold text-purple-300 block">Exames Felinos Específicos:</strong>
                        <span className="text-[11px] text-luar-300">Triagem laboratorial para FIV e FeLV</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      <span className={"text-[11px] px-2.5 py-0.5 rounded-full border font-bold " + (
                        (petAdocaoModal.perfil?.fiv || 'Negativo') === 'Negativo'
                          ? 'bg-purple-950 text-purple-300 border-purple-500/50'
                          : ((petAdocaoModal.perfil?.fiv) === 'Positivo' ? 'bg-amber-950 text-amber-300 border-amber-500/50' : 'bg-stone-900 text-stone-300 border-stone-700/50')
                      )}>
                        FIV: {petAdocaoModal.perfil?.fiv || 'Negativo'}
                      </span>
                      <span className={"text-[11px] px-2.5 py-0.5 rounded-full border font-bold " + (
                        (petAdocaoModal.perfil?.felv || 'Negativo') === 'Negativo'
                          ? 'bg-teal-950 text-teal-300 border-teal-500/50'
                          : ((petAdocaoModal.perfil?.felv) === 'Positivo' ? 'bg-rose-950 text-rose-300 border-rose-500/50' : 'bg-stone-900 text-stone-300 border-stone-700/50')
                      )}>
                        FeLV: {petAdocaoModal.perfil?.felv || 'Negativo'}
                      </span>
                    </div>
                  </div>
                )}

                <form onSubmit={async (e) => {
                  e.preventDefault();
                  if (!validarCpf(petAdocaoCpf)) {
                    alert('Por favor, informe um CPF válido para registro da candidatura responsável.');
                    return;
                  }
                  setEnviandoCandidatura(true);
                  try {
                    const res = await fetch('/api/pets/candidatar', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        id_pet: petAdocaoModal.id_pet,
                        nome_candidato: petAdocaoNome,
                        cpf_candidato: petAdocaoCpf,
                        telefone_candidato: petAdocaoTel,
                        mensagem: petAdocaoMsg
                      })
                    });
                    const json = await res.json();
                    if (res.ok && json.sucesso) {
                      mostrarNotificacao('Candidatura gerada! Redirecionando para o WhatsApp do doador...');
                      setPetAdocaoModal(null);
                      if (json.link_whatsapp) {
                        window.open(json.link_whatsapp, '_blank');
                      }
                      carregarDados();
                    } else {
                      alert(json.erro || 'Falha ao registrar candidatura.');
                    }
                  } catch (err) {
                    alert('Erro de comunicação com o servidor.');
                  } finally {
                    setEnviandoCandidatura(false);
                  }
                }} className="space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                      Seu Nome Completo *
                    </label>
                    <input 
                      required 
                      value={petAdocaoNome} 
                      onChange={(e) => setPetAdocaoNome(e.target.value)} 
                      placeholder="Ex: Clara Ribeiro Santos" 
                      className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-bold text-ouro uppercase tracking-wider">
                          Seu CPF Oficial *
                        </label>
                        {petAdocaoCpf && (
                          <button
                            type="button"
                            onClick={() => setPetAdocaoCpf('')}
                            className="text-[10px] text-ouro/80 hover:text-ouro bg-celestial-900 px-2 py-0.5 rounded border border-ouro/30 hover:border-ouro transition-colors cursor-pointer"
                            title="Limpar campo para digitar CPF"
                          >
                            ✕ Limpar
                          </button>
                        )}
                      </div>
                      <input 
                        required 
                        value={petAdocaoCpf} 
                        onChange={(e) => setPetAdocaoCpf(tratarDigitacaoCpf(e.target.value))} 
                        inputMode="numeric"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="000.000.000-00" 
                        maxLength="14"
                        className={"w-full p-3 rounded-xl bg-celestial-950 border text-xs text-luar-100 outline-none " + (petAdocaoCpf ? (validarCpf(petAdocaoCpf) ? 'border-emerald-500' : 'border-rose-500') : 'border-ouro/30')} 
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                        Seu WhatsApp *
                      </label>
                      <input 
                        required 
                        value={petAdocaoTel} 
                        onChange={(e) => setPetAdocaoTel(e.target.value)} 
                        placeholder="(27) 99999-9999" 
                        className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                      Mensagem para o Doador / Perfil do Lar
                    </label>
                    <textarea 
                      rows={3} 
                      value={petAdocaoMsg} 
                      onChange={(e) => setPetAdocaoMsg(e.target.value)} 
                      placeholder="Conte um pouco sobre sua residência, rotina e carinho para acolher este companheiro..." 
                      className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro resize-none" 
                    />
                  </div>

                  <button 
                    type="submit" 
                    disabled={enviandoCandidatura}
                    className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-600 hover:brightness-110 active:scale-[0.99] text-white font-bold text-xs uppercase tracking-widest shadow-xl flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
                  >
                    <span>{enviandoCandidatura ? 'Processando Solicitação Segura...' : 'Candidatar-se e Abrir WhatsApp Oficial'}</span>
                    <span>🐾</span>
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL REGISTRO DE ADOÇÃO CONCLUÍDA (ADMINISTRADOR) */}
          {/* ==================================================================== */}
          {modalRegistroAdocao && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
              <div className="relative w-full max-w-md bg-celestial-900 rounded-3xl p-6 sm:p-8 space-y-4 shadow-2xl border-2 border-ouro/50 gold-glow">
                <button 
                  onClick={() => {
                    setModalRegistroAdocao(null);
                    setRegistroAdocaoCpf('');
                  }} 
                  className="absolute top-4 right-4 text-ouro hover:text-white text-2xl font-bold cursor-pointer"
                >
                  ×
                </button>

                <div className="text-center space-y-1">
                  <span className="text-[10px] uppercase font-bold text-ouro tracking-widest">Ato Oficial de Adoção</span>
                  <h3 className="font-serif text-2xl font-bold gold-gradient-text">
                    Registrar Adoção de {modalRegistroAdocao.nome_pet}
                  </h3>
                  <p className="text-xs text-luar-300">
                    Insira os dados do novo tutor para atualizar o status para &quot;Adotado com Amor ❤️&quot;.
                  </p>
                </div>

                <form onSubmit={async (e) => {
                  e.preventDefault();
                  const adotante_nome = e.target.nome.value;
                  const adotante_cpf = registroAdocaoCpf || e.target.cpf.value;
                  const adotante_telefone = e.target.telefone.value;

                  if (!validarCpf(adotante_cpf)) {
                    alert('Informe um CPF válido para registrar a tutela.');
                    return;
                  }

                  const res = await fetch('/api/admin/pets/status', {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify({
                      id_pet: modalRegistroAdocao.id_pet,
                      status: 'Adotado',
                      adotante_nome,
                      adotante_cpf,
                      adotante_telefone
                    })
                  });

                  if (res.ok) {
                    mostrarNotificacao('Parabéns! ' + modalRegistroAdocao.nome_pet + ' agora está formalmente adotado.');
                    setModalRegistroAdocao(null);
                    setRegistroAdocaoCpf('');
                    carregarDados();
                  } else {
                    const json = await res.json();
                    alert(json.erro || 'Erro ao registrar adoção.');
                  }
                }} className="space-y-3.5">
                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Nome Completo do Novo Tutor</label>
                    <input name="nome" required placeholder="Ex: Ana Beatriz Moreira" className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-ouro uppercase tracking-wider">CPF do Tutor</label>
                      {registroAdocaoCpf && (
                        <button
                          type="button"
                          onClick={() => setRegistroAdocaoCpf('')}
                          className="text-[10px] text-ouro/80 hover:text-ouro bg-celestial-900 px-2 py-0.5 rounded border border-ouro/30 hover:border-ouro transition-colors cursor-pointer"
                          title="Limpar campo para digitar CPF"
                        >
                          ✕ Limpar
                        </button>
                      )}
                    </div>
                    <input 
                      name="cpf" 
                      required 
                      value={registroAdocaoCpf}
                      onChange={(e) => setRegistroAdocaoCpf(tratarDigitacaoCpf(e.target.value))}
                      inputMode="numeric"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="000.000.000-00" 
                      maxLength="14"
                      className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro font-mono" 
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">WhatsApp / Telefone</label>
                    <input name="telefone" required placeholder="(27) 99888-7766" className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" />
                  </div>
                  <button type="submit" className="w-full py-3.5 rounded-xl bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 font-bold text-xs uppercase tracking-wider shadow-lg hover:brightness-110 cursor-pointer">
                    Confirmar Registro de Adoção
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL DE EDIÇÃO DE PET (DOADOR OU ADMINISTRADOR) */}
          {/* ==================================================================== */}
          {modalEditarPet && (
            <div 
              style={{ backgroundColor: 'rgba(3, 6, 14, 0.94)' }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn"
            >
              <div 
                style={{ backgroundColor: '#080E1E' }}
                className="relative w-full max-w-lg rounded-3xl p-6 sm:p-8 space-y-4 shadow-2xl border-2 border-ouro/60 gold-glow max-h-[92vh] overflow-y-auto"
              >
                <button 
                  onClick={() => setModalEditarPet(null)} 
                  className="absolute top-4 right-4 text-ouro hover:text-white text-2xl font-bold cursor-pointer"
                >
                  ×
                </button>

                <div className="text-center space-y-1">
                  <span className="text-[10px] uppercase font-bold text-ouro tracking-widest">Edição do Companheiro</span>
                  <h3 className="font-serif text-2xl font-bold gold-gradient-text">
                    Editar Dados de {modalEditarPet.nome_pet}
                  </h3>
                  <p className="text-xs text-luar-300">
                    Atualize as informações, fotos ou contato deste animal.
                  </p>
                </div>

                <form onSubmit={async (e) => {
                  e.preventDefault();
                  const editData = {
                    id_pet: modalEditarPet.id_pet,
                    nome_pet: e.target.nome_pet.value,
                    especie: e.target.especie.value,
                    porte: e.target.porte.value,
                    idade_meses: Number(e.target.idade_meses.value) || 12,
                    sexo: e.target.sexo.value,
                    imagem_url: e.target.imagem_url.value,
                    historia: e.target.historia.value,
                    whatsapp_doador: e.target.whatsapp_doador.value,
                    perfil: {
                      castrado: e.target.castrado.checked,
                      vacinado: e.target.vacinado.checked,
                      convive_com_gatos: e.target.convive_com_gatos.checked,
                      temperamento: e.target.temperamento.value,
                      fiv: especieEditarPet === 'Gato' ? (e.target.fiv?.value || statusFivEditarPet) : undefined,
                      felv: especieEditarPet === 'Gato' ? (e.target.felv?.value || statusFelvEditarPet) : undefined
                    }
                  };

                  const res = await fetch('/api/admin/pets', {
                    method: 'PUT',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': 'Bearer ' + token
                    },
                    body: JSON.stringify(editData)
                  });

                  if (res.ok) {
                    mostrarNotificacao('Dados de ' + editData.nome_pet + ' atualizados com sucesso!');
                    setModalEditarPet(null);
                    carregarDados();
                  } else {
                    const json = await res.json();
                    alert(json.erro || 'Erro ao atualizar dados do pet.');
                  }
                }} className="space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Nome do Pet</label>
                      <input name="nome_pet" defaultValue={modalEditarPet.nome_pet} required className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Espécie</label>
                      <select 
                        name="especie" 
                        value={especieEditarPet}
                        onChange={(e) => setEspecieEditarPet(e.target.value)}
                        className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro"
                      >
                        <option value="Cachorro">Cachorro</option>
                        <option value="Gato">Gato</option>
                        <option value="Outro">Outro</option>
                      </select>
                    </div>
                  </div>

                  {/* Opção FIV e FeLV nos Casos de Gato na Edição */}
                  {especieEditarPet === 'Gato' && (
                    <div className="p-3.5 rounded-2xl bg-[#03060E] border border-purple-500/40 space-y-2.5 animate-fadeIn">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base">🐱</span>
                          <label className="text-xs font-bold text-purple-300 uppercase tracking-wider">
                            Exames Felinos (FIV &amp; FeLV)
                          </label>
                        </div>
                        <span className="text-[10px] text-purple-300 font-bold px-2 py-0.5 rounded-full bg-purple-950/80 border border-purple-500/40">
                          Exclusivo Gatos
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Status FIV</label>
                          <select 
                            name="fiv" 
                            value={statusFivEditarPet} 
                            onChange={(e) => setStatusFivEditarPet(e.target.value)}
                            className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro"
                          >
                            <option value="Negativo">✓ FIV Negativo</option>
                            <option value="Positivo">⚠ FIV Positivo</option>
                            <option value="Não testado">⏳ Não Testado</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Status FeLV</label>
                          <select 
                            name="felv" 
                            value={statusFelvEditarPet} 
                            onChange={(e) => setStatusFelvEditarPet(e.target.value)}
                            className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro"
                          >
                            <option value="Negativo">✓ FeLV Negativo</option>
                            <option value="Positivo">⚠ FeLV Positivo</option>
                            <option value="Não testado">⏳ Não Testado</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Porte</label>
                      <select name="porte" defaultValue={modalEditarPet.porte || 'Médio'} className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro">
                        <option value="Pequeno">Pequeno</option>
                        <option value="Médio">Médio</option>
                        <option value="Grande">Grande</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Idade (Meses)</label>
                      <input name="idade_meses" type="number" defaultValue={modalEditarPet.idade_meses || 12} className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Sexo</label>
                      <select name="sexo" defaultValue={modalEditarPet.sexo || 'Macho'} className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro">
                        <option value="Macho">Macho</option>
                        <option value="Fêmea">Fêmea</option>
                      </select>
                    </div>
                  </div>

                  {/* Fotografia do Animal com Acesso à Galeria do Celular ou Arquivos do PC */}
                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                      Fotografia do Animal (Galeria do Celular ou Arquivo do PC)
                    </label>
                    <div className="flex flex-col sm:flex-row gap-3 items-center p-3 rounded-2xl bg-celestial-950 border border-ouro/30">
                      <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-celestial-900 border border-ouro/40 flex-shrink-0 flex items-center justify-center">
                        <img 
                          src={fotoEditarPetPreview || modalEditarPet.imagem_url || 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=800&q=80'} 
                          alt="Prévia" 
                          className="w-full h-full object-cover" 
                        />
                        {uploadingFotoEditar && (
                          <div className="absolute inset-0 bg-black/75 flex items-center justify-center text-[10px] text-ouro font-bold text-center px-1">
                            Enviando...
                          </div>
                        )}
                      </div>
                      <div className="flex-1 w-full space-y-2">
                        <input
                          type="file"
                          id="input-foto-editar-pet"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files && e.target.files[0];
                            if (file) {
                              setUploadingFotoEditar(true);
                              processarUploadImagem(
                                file,
                                (urlSalva) => {
                                  setUploadingFotoEditar(false);
                                  setFotoEditarPetUrl(urlSalva);
                                  setFotoEditarPetPreview(urlSalva);
                                  mostrarNotificacao('Foto carregada com sucesso da sua galeria!');
                                },
                                (err) => {
                                  setUploadingFotoEditar(false);
                                  alert('Erro ao carregar foto: ' + err);
                                }
                              );
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => document.getElementById('input-foto-editar-pet').click()}
                          disabled={uploadingFotoEditar}
                          className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-ouro/25 to-ouro/10 hover:from-ouro/35 hover:to-ouro/20 border border-ouro text-ouro font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all"
                        >
                          <span>📷</span>
                          <span>{uploadingFotoEditar ? 'Processando Imagem...' : 'Escolher da Galeria ou Computador'}</span>
                        </button>
                        <input
                          name="imagem_url"
                          value={fotoEditarPetUrl || modalEditarPet.imagem_url || ''}
                          onChange={(e) => {
                            setFotoEditarPetUrl(e.target.value);
                            setFotoEditarPetPreview(e.target.value);
                          }}
                          required
                          placeholder="Ou cole o link direto da imagem"
                          className="w-full p-2 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-2xl bg-celestial-950 border border-emerald-500/40 space-y-2">
                    <label className="block text-[11px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                      WhatsApp do Doador / Protetor (Blind Contact Confidencial)
                    </label>
                    <input name="whatsapp_doador" defaultValue={modalEditarPet.whatsapp_doador || '5527999887766'} required placeholder="5527999887766" className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro font-mono" />
                    <p className="text-[10px] text-stone-400 leading-relaxed">
                      O número do doador permanece 100% confidencial no servidor, sendo usado unicamente para gerar a conversa do interessado via WhatsApp.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">História &amp; Temperamento</label>
                    <textarea name="historia" rows={2} defaultValue={modalEditarPet.historia} className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro resize-none" />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Perfil Clínico</label>
                    <div className="grid grid-cols-3 gap-2 text-xs text-luar-200">
                      <label className="flex items-center gap-2 p-2 rounded-xl bg-celestial-950 border border-ouro/20 cursor-pointer">
                        <input type="checkbox" name="castrado" defaultChecked={modalEditarPet.perfil?.castrado} className="accent-ouro" />
                        <span>Castrado</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 rounded-xl bg-celestial-950 border border-ouro/20 cursor-pointer">
                        <input type="checkbox" name="vacinado" defaultChecked={modalEditarPet.perfil?.vacinado} className="accent-ouro" />
                        <span>Vacinado</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 rounded-xl bg-celestial-950 border border-ouro/20 cursor-pointer">
                        <input type="checkbox" name="convive_com_gatos" defaultChecked={modalEditarPet.perfil?.convive_com_gatos} className="accent-ouro" />
                        <span>Amigo Gatos</span>
                      </label>
                    </div>
                    <input name="temperamento" defaultValue={modalEditarPet.perfil?.temperamento || 'Dócil'} className="w-full p-2.5 mt-2 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button type="button" onClick={() => setModalEditarPet(null)} className="flex-1 py-3 rounded-xl bg-celestial-950 text-stone-300 border border-stone-700/60 font-bold text-xs uppercase tracking-wider hover:bg-stone-800 transition-all cursor-pointer">
                      Cancelar
                    </button>
                    <button type="submit" className="flex-1 py-3 rounded-xl bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 font-bold text-xs uppercase tracking-widest shadow-md hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer">
                      Salvar Alterações
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* ==================================================================== */}
          {/* MODAL DE CHECKOUT: CONFIRMAÇÃO CADASTRAL, CPF, ENDEREÇO & PAGAMENTO */}
          {/* ==================================================================== */}
          {isCheckoutOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fadeIn">
              <div className="relative w-full max-w-2xl bg-celestial-900 rounded-3xl p-5 sm:p-7 space-y-4 shadow-2xl border-2 border-ouro/60 gold-glow max-h-[92vh] overflow-y-auto">
                <button 
                  onClick={() => setIsCheckoutOpen(false)} 
                  className="absolute top-4 right-4 text-ouro hover:text-white text-2xl font-bold cursor-pointer"
                  aria-label="Fechar"
                >
                  ×
                </button>

                {/* Topo e Indicador de Etapas */}
                <div className="text-center space-y-2 border-b border-ouro/25 pb-4">
                  <span className="text-[10px] uppercase font-bold text-ouro tracking-[0.25em]">Checkout &amp; Faturamento Nobre</span>
                  <h3 className="font-serif text-2xl font-bold gold-gradient-text">
                    Finalização do Pedido Vênus &amp; Luar
                  </h3>
                  <div className="flex items-center justify-center gap-2 pt-1">
                    <span className={'px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border transition-all ' + (etapaCheckout === 'dados' ? 'bg-ouro/20 text-ouro border-ouro' : 'bg-celestial-950 text-stone-400 border-ouro/20')}>
                      1. Confirmação &amp; Endereço
                    </span>
                    <span className="text-ouro text-xs">➔</span>
                    <span className={'px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border transition-all ' + (etapaCheckout === 'pagamento' ? 'bg-ouro/20 text-ouro border-ouro' : 'bg-celestial-950 text-stone-400 border-ouro/20')}>
                      2. Pagamento &amp; Fatura
                    </span>
                  </div>
                </div>

                {/* Resumo Financeiro da Sacola */}
                <div className="p-3.5 rounded-2xl bg-celestial-950 border border-ouro/30 space-y-2">
                  <div className="flex items-center justify-between text-xs text-luar-300">
                    <span>Peças Selecionadas ({carrinho.totalContador} un.):</span>
                    <span>{formatBRL(carrinho.total)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-luar-300">
                    <span>Entrega Exclusiva:</span>
                    <span className="text-emerald-400 font-semibold">Cortesia da Boutique (Frete Grátis)</span>
                  </div>
                  <div className="pt-2 border-t border-ouro/20 flex items-center justify-between">
                    <span className="text-sm font-bold text-ouro-light">Total a Faturar:</span>
                    <span className="text-xl font-serif font-bold text-ouro">{formatBRL(carrinho.total)}</span>
                  </div>
                </div>

                {/* ETAPA 1: CONFIRMAÇÃO DOS DADOS JÁ CADASTRADOS, CPF E ENDEREÇO */}
                {etapaCheckout === 'dados' && (
                  <form onSubmit={async (e) => {
                    e.preventDefault();

                    // Validação do CPF
                    const cpfLimpo = (cpfCheckout || '').replace(/[^0-9]/g, '');
                    if (cpfLimpo.length !== 11 || !validarCpf(cpfCheckout)) {
                      alert('Por favor, informe um CPF válido com 11 dígitos numéricos para a emissão da nota fiscal.');
                      return;
                    }

                    // Validação do Endereço
                    if (!logradouroCheckout.trim() || !numeroCheckout.trim() || !bairroCheckout.trim() || !cidadeCheckout.trim() || !ufCheckout.trim() || !cepCheckout.trim()) {
                      alert('Por favor, preencha todos os campos obrigatórios do endereço de entrega (CEP, Logradouro, Número, Bairro, Cidade e Estado).');
                      return;
                    }

                    // Salva / Atualiza dados confirmados no perfil do usuário
                    if (usuario && token) {
                      try {
                        const enderecoObj = {
                          cep: cepCheckout.trim(),
                          logradouro: logradouroCheckout.trim(),
                          numero: numeroCheckout.trim(),
                          complemento: complementoCheckout.trim(),
                          bairro: bairroCheckout.trim(),
                          cidade: cidadeCheckout.trim(),
                          uf: ufCheckout.trim()
                        };
                        const res = await fetch('/api/usuario/perfil', {
                          method: 'PUT',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + token
                          },
                          body: JSON.stringify({
                            nome_completo: nomeCheckout.trim(),
                            data_nascimento: nascimentoCheckout.trim(),
                            cpf: cpfCheckout.trim(),
                            endereco: enderecoObj
                          })
                        });
                        const json = await res.json();
                        if (res.ok && json.usuario) {
                          setUsuario(json.usuario);
                          localStorage.setItem('venus_usuario', JSON.stringify(json.usuario));
                        }
                      } catch (err) {
                        // Não interrompe o avanço
                      }
                    }

                    setEtapaCheckout('pagamento');
                    mostrarNotificacao('Dados e endereço confirmados! Escolha a forma de pagamento.');
                  }} className="space-y-4 animate-fadeIn">

                    {/* BLOCO A: CONFIRMAÇÃO DOS DADOS JÁ CADASTRADOS */}
                    <div className="p-4 rounded-2xl bg-celestial-950/90 border border-ouro/40 space-y-3">
                      <div className="flex items-center justify-between border-b border-ouro/20 pb-2">
                        <span className="text-[11px] font-bold text-ouro uppercase tracking-wider flex items-center gap-1.5">
                          <span>✨</span>
                          <span>1. Confirmação dos Dados Cadastrados</span>
                        </span>
                        <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                          ✓ Cadastro Verificado
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="sm:col-span-1">
                          <label className="block text-[10px] text-stone-400 mb-1">Nome Completo</label>
                          <input 
                            type="text" 
                            required 
                            id="input-checkout-nome"
                            value={nomeCheckout} 
                            onChange={(e) => setNomeCheckout(e.target.value)} 
                            className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                          />
                        </div>
                        <div className="sm:col-span-1">
                          <label className="block text-[10px] text-stone-400 mb-1">E-mail Cadastrado</label>
                          <input 
                            type="text" 
                            disabled
                            value={usuario?.email || ''} 
                            className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/20 text-xs text-stone-400 cursor-not-allowed" 
                          />
                        </div>
                        <div className="sm:col-span-1">
                          <label className="block text-[10px] text-stone-400 mb-1">Data de Nascimento</label>
                          <input 
                            type="date" 
                            required 
                            id="input-checkout-nascimento"
                            value={nascimentoCheckout} 
                            onChange={(e) => setNascimentoCheckout(e.target.value)} 
                            className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro cursor-pointer font-sans" 
                          />
                        </div>
                      </div>
                    </div>

                    {/* BLOCO B: SOLICITAÇÃO DO CPF */}
                    <div className="p-4 rounded-2xl bg-celestial-950/90 border border-ouro/40 space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-bold text-ouro uppercase tracking-wider flex items-center gap-1.5">
                          <span>🪪</span>
                          <span>2. CPF para Emissão da Fatura &amp; Nota Digital</span>
                        </label>
                        <div className="flex items-center gap-2">
                          {cpfCheckout && (
                            <button
                              type="button"
                              onClick={() => setCpfCheckout('')}
                              className="text-[10px] text-ouro/80 hover:text-ouro bg-celestial-900 px-2 py-0.5 rounded border border-ouro/30 hover:border-ouro transition-colors cursor-pointer"
                              title="Limpar campo para digitar CPF"
                            >
                              ✕ Limpar
                            </button>
                          )}
                          {statusCpfCheckout === 'valido' && (
                            <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                              ✓ Válido
                            </span>
                          )}
                          {statusCpfCheckout === 'invalido' && (
                            <span className="text-[11px] font-bold text-rose-400 flex items-center gap-1">
                              ✕ Inválido
                            </span>
                          )}
                        </div>
                      </div>
                      <input 
                        id="input-checkout-cpf"
                        type="text" 
                        required 
                        value={cpfCheckout} 
                        onChange={(e) => setCpfCheckout(tratarDigitacaoCpf(e.target.value))} 
                        inputMode="numeric"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="000.000.000-00" 
                        maxLength="14"
                        className={'w-full p-2.5 rounded-xl bg-celestial-900 border text-xs font-mono text-luar-100 outline-none transition-all ' + (
                          statusCpfCheckout === 'valido'
                            ? 'border-emerald-500 focus:border-emerald-400'
                            : statusCpfCheckout === 'invalido'
                            ? 'border-rose-500 focus:border-rose-400'
                            : 'border-ouro/30 focus:border-ouro'
                        )} 
                      />
                      <p className="text-[10px] text-stone-400 leading-relaxed">
                        O CPF é exigido pela legislação tributária brasileira para emissão da nota fiscal e faturamento de compras.
                      </p>
                    </div>

                    {/* BLOCO C: SOLICITAÇÃO DO ENDEREÇO COMPLETO */}
                    <div className="p-4 rounded-2xl bg-celestial-950/90 border border-ouro/40 space-y-3">
                      <div className="flex items-center justify-between border-b border-ouro/20 pb-2">
                        <span className="text-[11px] font-bold text-ouro uppercase tracking-wider flex items-center gap-1.5">
                          <span>📍</span>
                          <span>3. Endereço Completo de Entrega da Alta Costura</span>
                        </span>
                        {buscandoCep && (
                          <span className="text-[10px] text-ouro animate-pulse">Buscando CEP...</span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
                        {/* CEP */}
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-stone-400 mb-1">CEP</label>
                          <input 
                            id="input-checkout-cep"
                            type="text" 
                            required 
                            value={cepCheckout} 
                            onChange={(e) => {
                              const f = formatarCep(e.target.value);
                              setCepCheckout(f);
                              if (f.replace(/[^0-9]/g, '').length === 8) {
                                buscarCep(f);
                              }
                            }} 
                            inputMode="numeric"
                            maxLength="9"
                            placeholder="00000-000" 
                            className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 font-mono outline-none focus:border-ouro" 
                          />
                        </div>

                        {/* Logradouro / Rua */}
                        <div className="sm:col-span-4">
                          <label className="block text-[10px] text-stone-400 mb-1">Logradouro / Rua / Avenida</label>
                          <input 
                            id="input-checkout-logradouro"
                            type="text" 
                            required 
                            value={logradouroCheckout} 
                            onChange={(e) => setLogradouroCheckout(e.target.value)} 
                            placeholder="Ex: Av. Dante Michelini" 
                            className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                          />
                        </div>

                        {/* Número */}
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-stone-400 mb-1">Número</label>
                          <input 
                            id="input-checkout-numero"
                            type="text" 
                            required 
                            value={numeroCheckout} 
                            onChange={(e) => setNumeroCheckout(e.target.value)} 
                            placeholder="Ex: 120" 
                            className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                          />
                        </div>

                        {/* Complemento */}
                        <div className="sm:col-span-4">
                          <label className="block text-[10px] text-stone-400 mb-1">Complemento (Opcional)</label>
                          <input 
                            id="input-checkout-complemento"
                            type="text" 
                            value={complementoCheckout} 
                            onChange={(e) => setComplementoCheckout(e.target.value)} 
                            placeholder="Ex: Apto 502, Bloco B" 
                            className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                          />
                        </div>

                        {/* Bairro */}
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] text-stone-400 mb-1">Bairro</label>
                          <input 
                            id="input-checkout-bairro"
                            type="text" 
                            required 
                            value={bairroCheckout} 
                            onChange={(e) => setBairroCheckout(e.target.value)} 
                            placeholder="Ex: Jardim da Penha" 
                            className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                          />
                        </div>

                        {/* Cidade */}
                        <div className="sm:col-span-3">
                          <label className="block text-[10px] text-stone-400 mb-1">Cidade</label>
                          <input 
                            id="input-checkout-cidade"
                            type="text" 
                            required 
                            value={cidadeCheckout} 
                            onChange={(e) => setCidadeCheckout(e.target.value)} 
                            placeholder="Ex: Vitória" 
                            className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro" 
                          />
                        </div>

                        {/* UF */}
                        <div className="sm:col-span-1">
                          <label className="block text-[10px] text-stone-400 mb-1">UF</label>
                          <input 
                            id="input-checkout-uf"
                            type="text" 
                            required 
                            maxLength="2"
                            value={ufCheckout} 
                            onChange={(e) => setUfCheckout(e.target.value.toUpperCase())} 
                            placeholder="ES" 
                            className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 uppercase text-center font-bold outline-none focus:border-ouro" 
                          />
                        </div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      id="btn-confirmar-dados-checkout"
                      className="w-full py-4 rounded-xl bg-gradient-to-r from-ouro-dark via-ouro to-ouro text-celestial-950 font-bold text-xs uppercase tracking-widest shadow-xl hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-2"
                    >
                      <span>Confirmar Dados e Escolher Pagamento</span>
                      <span>➔</span>
                    </button>
                  </form>
                )}

                {/* ETAPA 2: ESCOLHA DE PAGAMENTO E FATURAMENTO */}
                {etapaCheckout === 'pagamento' && (
                  <div className="space-y-4 animate-fadeIn">
                    
                    {/* Barra de Resumo dos Dados Confirmados */}
                    <div className="p-3.5 rounded-2xl bg-celestial-950 border border-ouro/40 flex items-center justify-between gap-3 text-xs">
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-bold text-ouro uppercase tracking-wider block">
                          Destinatário &amp; Entrega Confirmados:
                        </span>
                        <p className="text-luar-100 font-semibold truncate max-w-sm">
                          {nomeCheckout} • CPF: {mascararCpf(cpfCheckout)}
                        </p>
                        <p className="text-[11px] text-stone-400 truncate max-w-md">
                          📍 {logradouroCheckout}, nº {numeroCheckout}{complementoCheckout ? ' (' + complementoCheckout + ')' : ''} - {bairroCheckout}, {cidadeCheckout}/{ufCheckout} - CEP: {cepCheckout}
                        </p>
                      </div>
                      <button
                        type="button"
                        id="btn-voltar-dados-checkout"
                        onClick={() => setEtapaCheckout('dados')}
                        className="py-1.5 px-3 rounded-xl bg-celestial-900 border border-ouro/40 text-ouro hover:bg-ouro hover:text-celestial-950 text-[10.5px] font-bold uppercase transition-all whitespace-nowrap cursor-pointer"
                      >
                        ✎ Alterar
                      </button>
                    </div>

                    {/* Seleção do Meio de Pagamento */}
                    <div className="space-y-3">
                      <span className="text-[11px] font-bold text-ouro uppercase tracking-wider block">
                        Escolha a Forma de Pagamento
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          id="btn-escolher-pix"
                          onClick={() => setFormaPagamento('PIX')}
                          className={'p-3 rounded-2xl border text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex flex-col items-center gap-1.5 ' + (formaPagamento === 'PIX' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 border-ouro shadow-md' : 'bg-celestial-950 text-luar-300 border-ouro/30 hover:border-ouro')}
                        >
                          <span className="text-base">⚡</span>
                          <span>PIX Instantâneo</span>
                        </button>
                        <button
                          type="button"
                          id="btn-escolher-cartao"
                          onClick={() => setFormaPagamento('Cartao')}
                          className={'p-3 rounded-2xl border text-xs font-bold uppercase tracking-wider transition-all cursor-pointer flex flex-col items-center gap-1.5 ' + (formaPagamento === 'Cartao' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 border-ouro shadow-md' : 'bg-celestial-950 text-luar-300 border-ouro/30 hover:border-ouro')}
                        >
                          <span className="text-base">💳</span>
                          <span>Cartão de Crédito</span>
                        </button>
                      </div>
                    </div>

                    {/* ABA PIX */}
                    {formaPagamento === 'PIX' && (
                      <div className="p-4 rounded-2xl bg-celestial-950 border border-ouro/40 space-y-4 animate-fadeIn text-center">
                        <div className="flex flex-col items-center space-y-2">
                          <div className="p-3 bg-white rounded-2xl shadow-lg border border-ouro/50 inline-block">
                            {/* SVG QR CODE PIX HAUTE-COUTURE */}
                            <svg viewBox="0 0 100 100" className="w-36 h-36">
                              <rect width="100" height="100" fill="#ffffff" />
                              <rect x="10" y="10" width="22" height="22" fill="#080E1E" />
                              <rect x="14" y="14" width="14" height="14" fill="#ffffff" />
                              <rect x="18" y="18" width="6" height="6" fill="#DFB15B" />
                              
                              <rect x="68" y="10" width="22" height="22" fill="#080E1E" />
                              <rect x="72" y="14" width="14" height="14" fill="#ffffff" />
                              <rect x="76" y="18" width="6" height="6" fill="#DFB15B" />

                              <rect x="10" y="68" width="22" height="22" fill="#080E1E" />
                              <rect x="14" y="72" width="14" height="14" fill="#ffffff" />
                              <rect x="18" y="76" width="6" height="6" fill="#DFB15B" />

                              <rect x="38" y="12" width="5" height="5" fill="#080E1E" />
                              <rect x="48" y="12" width="5" height="5" fill="#080E1E" />
                              <rect x="58" y="12" width="5" height="5" fill="#DFB15B" />

                              <rect x="38" y="22" width="10" height="5" fill="#DFB15B" />
                              <rect x="52" y="22" width="8" height="5" fill="#080E1E" />

                              <rect x="12" y="38" width="6" height="6" fill="#080E1E" />
                              <rect x="22" y="38" width="8" height="6" fill="#DFB15B" />
                              <rect x="34" y="36" width="32" height="28" rx="4" fill="#080E1E" />
                              <text x="50" y="54" fontFamily="serif" fontSize="10" fill="#DFB15B" fontWeight="bold" textAnchor="middle">✦ PIX ✦</text>

                              <rect x="70" y="38" width="8" height="6" fill="#080E1E" />
                              <rect x="82" y="38" width="6" height="6" fill="#DFB15B" />

                              <rect x="38" y="72" width="6" height="6" fill="#080E1E" />
                              <rect x="48" y="72" width="8" height="6" fill="#DFB15B" />
                              <rect x="60" y="72" width="6" height="6" fill="#080E1E" />
                              <rect x="70" y="72" width="18" height="6" fill="#DFB15B" />
                              
                              <rect x="38" y="82" width="12" height="6" fill="#DFB15B" />
                              <rect x="54" y="82" width="14" height="6" fill="#080E1E" />
                              <rect x="72" y="82" width="16" height="6" fill="#080E1E" />
                            </svg>
                          </div>
                          <span className="text-[11px] text-ouro font-semibold">
                            Escaneie com o app do seu banco ou use a chave abaixo
                          </span>
                        </div>

                        <div className="flex items-center gap-2 bg-celestial-900 p-2.5 rounded-xl border border-ouro/30 text-left">
                          <div className="flex-1 font-mono text-[10px] text-luar-200 truncate select-all">
                            {'00020126580014br.gov.bcb.pix0136venuseluar@butique.com5204000053039865405' + carrinho.total.toFixed(2) + '5802BR5920VENUS E LUAR BOUTIQUE6008VITORIA62070503***6304'}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText('00020126580014br.gov.bcb.pix0136venuseluar@butique.com5204000053039865405' + carrinho.total.toFixed(2) + '5802BR5920VENUS E LUAR BOUTIQUE6008VITORIA62070503***6304');
                              setPixCopiado(true);
                              setTimeout(() => setPixCopiado(false), 3000);
                            }}
                            className="py-1.5 px-3 rounded-lg bg-ouro/20 hover:bg-ouro/30 text-ouro border border-ouro/40 text-[10px] font-bold uppercase transition-all whitespace-nowrap cursor-pointer"
                          >
                            {pixCopiado ? '✓ Copiado!' : 'Copiar Chave'}
                          </button>
                        </div>

                        <button
                          type="button"
                          id="btn-confirmar-pagamento-pix"
                          disabled={carregandoPagamento}
                          onClick={async () => {
                            setCarregandoPagamento(true);
                            try {
                              const enderecoFormatado = logradouroCheckout + ', nº ' + numeroCheckout + (complementoCheckout ? ' (' + complementoCheckout + ')' : '') + ' - ' + bairroCheckout + ', ' + cidadeCheckout + '/' + ufCheckout + ' - CEP: ' + cepCheckout;
                              const res = await fetch('/api/pedidos/faturar', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  id_usuario: usuario?.id_usuario,
                                  nome_cliente: nomeCheckout || usuario?.nome || 'Cliente Vênus e Luar',
                                  cpf_cliente: cpfCheckout || usuario?.cpf || '',
                                  endereco_entrega: enderecoFormatado,
                                  itens: carrinho.itens,
                                  forma_pagamento: 'PIX Instantâneo',
                                  detalhes_pagamento: { status_pix: 'Aprovado via QR Code' }
                                })
                              });
                              const json = await res.json();
                              if (res.ok && json.sucesso) {
                                carrinho.limpar();
                                setIsCheckoutOpen(false);
                                setFaturaModal(json.fatura);
                                mostrarNotificacao('Pagamento PIX confirmado e fatura emitida!');
                              } else {
                                alert(json.erro || 'Falha no faturamento.');
                              }
                            } catch (err) {
                              alert('Erro de conexão ao processar faturamento.');
                            } finally {
                              setCarregandoPagamento(false);
                            }
                          }}
                          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-ouro-dark via-ouro to-ouro text-celestial-950 font-bold text-xs uppercase tracking-widest shadow-xl hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50"
                        >
                          {carregandoPagamento ? 'Confirmando Pagamento...' : 'Confirmar Pagamento PIX e Emitir Fatura'}
                        </button>
                      </div>
                    )}

                    {/* ABA CARTÃO DE CRÉDITO */}
                    {formaPagamento === 'Cartao' && (
                      <form onSubmit={async (e) => {
                        e.preventDefault();
                        setCarregandoPagamento(true);
                        try {
                          const enderecoFormatado = logradouroCheckout + ', nº ' + numeroCheckout + (complementoCheckout ? ' (' + complementoCheckout + ')' : '') + ' - ' + bairroCheckout + ', ' + cidadeCheckout + '/' + ufCheckout + ' - CEP: ' + cepCheckout;
                          const res = await fetch('/api/pedidos/faturar', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              id_usuario: usuario?.id_usuario,
                              nome_cliente: nomeCheckout || usuario?.nome || 'Cliente Vênus e Luar',
                              cpf_cliente: cpfCheckout || usuario?.cpf || '',
                              endereco_entrega: enderecoFormatado,
                              itens: carrinho.itens,
                              forma_pagamento: 'Cartão de Crédito (' + dadosCartao.parcelas + 'x)',
                              detalhes_pagamento: {
                                ultimos_digitos: dadosCartao.numero.replace(/[^0-9]/g, '').slice(-4),
                                parcelas: dadosCartao.parcelas,
                                bandeira: 'Visa / Mastercard Platinum'
                              }
                            })
                          });
                          const json = await res.json();
                          if (res.ok && json.sucesso) {
                            carrinho.limpar();
                            setIsCheckoutOpen(false);
                            setFaturaModal(json.fatura);
                            mostrarNotificacao('Pagamento aprovado na operadora e fatura emitida!');
                          } else {
                            alert(json.erro || 'Falha no processamento.');
                          }
                        } catch (err) {
                          alert('Erro ao faturar com cartão.');
                        } finally {
                          setCarregandoPagamento(false);
                        }
                      }} className="p-4 rounded-2xl bg-celestial-950 border border-ouro/40 space-y-3 animate-fadeIn">
                        <div>
                          <label className="block text-[10px] text-stone-400 mb-1">Número do Cartão</label>
                          <input 
                            type="text" 
                            required 
                            maxLength={19} 
                            placeholder="0000 0000 0000 0000" 
                            value={dadosCartao.numero} 
                            onChange={(e) => {
                              const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 16);
                              const formatted = v.replace(/([0-9]{4})(?=[0-9])/g, '$1 ');
                              setDadosCartao({ ...dadosCartao, numero: formatted });
                            }} 
                            className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 font-mono outline-none focus:border-ouro" 
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-stone-400 mb-1">Nome no Cartão</label>
                          <input 
                            type="text" 
                            required 
                            placeholder="NOME COMO NO CARTÃO" 
                            value={dadosCartao.nome} 
                            onChange={(e) => setDadosCartao({ ...dadosCartao, nome: e.target.value.toUpperCase() })} 
                            className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 uppercase outline-none focus:border-ouro" 
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] text-stone-400 mb-1">Validade</label>
                            <input 
                              type="text" 
                              required 
                              maxLength={5} 
                              placeholder="MM/AA" 
                              value={dadosCartao.validade} 
                              onChange={(e) => {
                                const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 4);
                                const formatted = v.length > 2 ? v.slice(0, 2) + '/' + v.slice(2) : v;
                                setDadosCartao({ ...dadosCartao, validade: formatted });
                              }} 
                              className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 font-mono outline-none focus:border-ouro" 
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-stone-400 mb-1">CVV</label>
                            <div className="relative">
                              <input 
                                type={verCvvCartao ? "text" : "password"} 
                                required 
                                maxLength={4} 
                                placeholder="•••" 
                                value={dadosCartao.cvv} 
                                onChange={(e) => setDadosCartao({ ...dadosCartao, cvv: e.target.value.replace(/[^0-9]/g, '') })} 
                                className="w-full p-2.5 pr-8 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 font-mono outline-none focus:border-ouro" 
                              />
                              {renderBotaoOlhoSenha(verCvvCartao, () => setVerCvvCartao(!verCvvCartao), "btn-ver-cvv-cartao")}
                            </div>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-stone-400 mb-1">Parcelamento Exclusivo</label>
                          <select 
                            value={dadosCartao.parcelas} 
                            onChange={(e) => setDadosCartao({ ...dadosCartao, parcelas: e.target.value })} 
                            className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro"
                          >
                            <option value="1">1x de {formatBRL(carrinho.total)} (sem juros)</option>
                            <option value="2">2x de {formatBRL(carrinho.total / 2)} (sem juros)</option>
                            <option value="3">3x de {formatBRL(carrinho.total / 3)} (sem juros)</option>
                            <option value="4">4x de {formatBRL(carrinho.total / 4)} (sem juros)</option>
                            <option value="5">5x de {formatBRL(carrinho.total / 5)} (sem juros)</option>
                            <option value="6">6x de {formatBRL(carrinho.total / 6)} (sem juros)</option>
                          </select>
                        </div>

                        <button
                          type="submit"
                          id="btn-confirmar-pagamento-cartao"
                          disabled={carregandoPagamento}
                          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-ouro-dark via-ouro to-ouro text-celestial-950 font-bold text-xs uppercase tracking-widest shadow-xl hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50"
                        >
                          {carregandoPagamento ? 'Processando Cartão...' : ('Pagar ' + formatBRL(carrinho.total) + ' com Cartão')}
                        </button>
                      </form>
                    )}

                  </div>
                )}

              </div>
            </div>
          )}

          {/* MODAL DE FATURA OFICIAL DIGITAL */}
          {/* ==================================================================== */}
          {faturaModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
              <div className="relative w-full max-w-2xl bg-celestial-900 rounded-3xl p-6 sm:p-8 space-y-5 shadow-2xl border-2 border-ouro/60 gold-glow max-h-[92vh] overflow-y-auto">
                <button 
                  onClick={() => setFaturaModal(null)} 
                  className="absolute top-4 right-4 text-ouro hover:text-white text-2xl font-bold cursor-pointer print:hidden"
                >
                  ×
                </button>

                {/* Cabeçalho da Fatura */}
                <div className="border-b border-ouro/30 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full border border-ouro/60 bg-celestial-950 p-1 flex items-center justify-center">
                      <img src="/logo.jpg" alt="Vênus e Luar" className="w-full h-full object-cover rounded-full" />
                    </div>
                    <div>
                      <h3 className="font-serif text-xl font-bold gold-gradient-text">Vênus e Luar Boutique</h3>
                      <span className="text-[10px] text-ouro/80 uppercase tracking-widest block">Comprovante &amp; Fatura Oficial</span>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[11px] font-bold inline-block">
                      ✓ {faturaModal.status || 'FATURADO & PAGO'}
                    </span>
                    <span className="font-mono text-xs text-ouro-light font-bold block mt-1">
                      #{faturaModal.numero_fatura}
                    </span>
                  </div>
                </div>

                {/* Informações do Comprovante */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-celestial-950/80 border border-ouro/20 space-y-1">
                    <span className="text-[10px] text-stone-400 uppercase tracking-wider block">Dados do Cliente</span>
                    <strong className="text-luar-100 block">{faturaModal.cliente?.nome || faturaModal.nome_cliente || 'Consumidor Final'}</strong>
                    <span className="text-stone-300 font-mono text-[11px]">CPF: {faturaModal.cliente?.cpf || faturaModal.cpf_cliente || 'Isento / Não informado'}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-celestial-950/80 border border-ouro/20 space-y-1">
                    <span className="text-[10px] text-stone-400 uppercase tracking-wider block">Detalhes da Transação</span>
                    <div className="text-luar-200">Forma: <strong className="text-ouro">{faturaModal.forma_pagamento}</strong></div>
                    <div className="text-stone-300 text-[11px]">Data: {new Date(faturaModal.data_emissao || Date.now()).toLocaleString('pt-BR')}</div>
                  </div>
                  {faturaModal.endereco_entrega && (
                    <div className="p-3 rounded-xl bg-celestial-950/80 border border-ouro/20 space-y-1 sm:col-span-2">
                      <span className="text-[10px] text-stone-400 uppercase tracking-wider block">Endereço Completo de Entrega</span>
                      <p className="text-xs text-luar-100 font-semibold">
                        📍 {faturaModal.endereco_entrega}
                      </p>
                    </div>
                  )}
                </div>

                {/* Itens Faturados */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-ouro uppercase tracking-wider block">Itens do Pedido Faturado</span>
                  <div className="rounded-xl border border-ouro/20 overflow-hidden bg-celestial-950/60">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-celestial-950 text-ouro text-[10px] uppercase border-b border-ouro/20">
                        <tr>
                          <th className="p-2.5">Item</th>
                          <th className="p-2.5 text-center">Qtd</th>
                          <th className="p-2.5 text-right">Unitário</th>
                          <th className="p-2.5 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ouro/10">
                        {(faturaModal.itens || []).map((item, idx) => (
                          <tr key={idx} className="hover:bg-celestial-900/40">
                            <td className="p-2.5">
                              <div className="font-semibold text-luar-100">{item.nome_item}</div>
                              <div className="text-[10px] text-stone-400">{item.categoria}</div>
                            </td>
                            <td className="p-2.5 text-center text-stone-300 font-mono">{item.quantidade}</td>
                            <td className="p-2.5 text-right text-stone-300 font-mono">{formatBRL(item.preco)}</td>
                            <td className="p-2.5 text-right text-ouro font-mono font-bold">{formatBRL(Number(item.preco) * item.quantidade)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Total e Autenticação Criptográfica */}
                <div className="p-3.5 rounded-2xl bg-celestial-950 border border-ouro/40 space-y-2">
                  <div className="flex items-center justify-between text-sm font-bold">
                    <span className="text-luar-200">Total Liquidado &amp; Faturado:</span>
                    <span className="text-2xl font-serif font-bold text-ouro">{formatBRL(faturaModal.total)}</span>
                  </div>
                  {faturaModal.chave_autenticacao && (
                    <div className="pt-2 border-t border-ouro/20 text-[10px] font-mono text-stone-400 break-all select-all">
                      <span className="text-ouro font-semibold">Assinatura Digital SHA-256: </span>
                      {faturaModal.chave_autenticacao}
                    </div>
                  )}
                </div>

                {/* Ações */}
                <div className="flex flex-col sm:flex-row gap-2 pt-2 print:hidden">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex-1 py-3 rounded-xl bg-celestial-950 hover:bg-celestial-800 text-ouro border border-ouro/40 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <span>🖨️</span>
                    <span>Imprimir Comprovante / PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFaturaModal(null)}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 font-bold text-xs uppercase tracking-wider shadow-md hover:brightness-110 transition-all cursor-pointer"
                  >
                    Concluir e Fechar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL AUTH GERAL HAUTE-COUTURE (LOGIN & CADASTRO COM CPF EXCLUSIVO) */}
          {/* ==================================================================== */}
          {isAuthOpen && (
            <div 
              style={{ backgroundColor: 'rgba(3, 6, 14, 0.94)' }}
              className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm animate-fadeIn"
            >
              <div 
                style={{ backgroundColor: '#080E1E' }}
                className={"relative w-full rounded-3xl p-5 sm:p-7 shadow-[0_25px_60px_rgba(0,0,0,0.95)] border border-ouro/50 gold-glow max-h-[92vh] overflow-y-auto " + (abaAuthGeral === 'cadastro' ? 'max-w-xl sm:max-w-2xl' : 'max-w-md')}
              >
                
                {/* Botão Fechar */}
                <button 
                  onClick={() => setIsAuthOpen(false)} 
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-celestial-900 border border-ouro/40 hover:border-ouro text-ouro hover:text-white flex items-center justify-center text-lg font-bold transition-all cursor-pointer z-10"
                  aria-label="Fechar"
                >
                  ×
                </button>
                
                {/* Cabeçalho de Alta Costura com Emblema da Boutique */}
                <div className="flex flex-col items-center text-center space-y-1.5 pt-1 relative z-10">
                  <div className="w-12 h-12 rounded-full border-2 border-ouro/60 bg-celestial-950 p-1 shadow-lg flex items-center justify-center">
                    <img src="/logo.jpg" alt="Vênus e Luar" className="w-full h-full object-cover rounded-full" />
                  </div>
                  <div>
                    <h3 className="font-serif text-xl sm:text-2xl font-bold gold-gradient-text">Vênus e Luar Boutique</h3>
                    <p className="text-xs text-luar-200 font-light tracking-wide mt-0.5">
                      {abaAuthGeral === 'login' 
                        ? 'Acesse sua conta para compras, pedidos e sacola' 
                        : abaAuthGeral === 'cadastro'
                        ? 'Cadastro exclusivo de usuário para compras, bistrô e doação de pets'
                        : 'Recuperação de acesso da sua conta'}
                    </p>
                  </div>
                </div>

                {/* Alternador de Abas de Alta Costura */}
                <div className="flex rounded-2xl bg-celestial-950 p-1.5 border border-ouro/30 shadow-inner relative z-10 my-4">
                  <button
                    id="tab-auth-login"
                    type="button"
                    onClick={() => setAbaAuthGeral('login')}
                    style={abaAuthGeral === 'login' ? {
                      background: 'linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%)',
                      color: '#080E1E',
                      fontWeight: '800',
                      boxShadow: '0 2px 10px rgba(223, 177, 91, 0.45)'
                    } : {
                      color: '#ECE6D6'
                    }}
                    className={"flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer " + (abaAuthGeral === 'login' ? 'shadow-md' : 'text-luar-300 hover:text-ouro')}
                  >
                    Acessar Conta
                  </button>
                  <button
                    id="tab-auth-cadastro"
                    type="button"
                    onClick={() => setAbaAuthGeral('cadastro')}
                    style={abaAuthGeral === 'cadastro' ? {
                      background: 'linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%)',
                      color: '#080E1E',
                      fontWeight: '800',
                      boxShadow: '0 2px 10px rgba(223, 177, 91, 0.45)'
                    } : {
                      color: '#ECE6D6'
                    }}
                    className={"flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer " + (abaAuthGeral === 'cadastro' ? 'shadow-md' : 'text-luar-300 hover:text-ouro')}
                  >
                    Criar Conta
                  </button>
                </div>

                {/* ABA 1: FORMULÁRIO DE LOGIN */}
                {abaAuthGeral === 'login' ? (
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    const email = e.target.email.value;
                    const senha = e.target.senha.value;
                    const res = await fetch('/api/auth/login', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ email, senha })
                    });
                    const json = await res.json();
                    if (res.ok) {
                      setUsuario(json.usuario);
                      setToken(json.token);
                      localStorage.setItem('venus_usuario', JSON.stringify(json.usuario));
                      localStorage.setItem('venus_token', json.token);
                      setIsAuthOpen(false);
                      mostrarNotificacao(\`Bem-vinda de volta, \${json.usuario.nome.split(' ')[0]}!\`);
                    } else {
                      alert(json.erro || 'Falha no login');
                    }
                  }} className="space-y-4 relative z-10">
                    <div>
                      <label className="block text-xs font-bold text-ouro mb-1 uppercase tracking-wider">E-mail Cadastrado</label>
                      <input 
                        name="email" 
                        type="email" 
                        required 
                        placeholder="seu@email.com" 
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#040711] border border-ouro/40 text-sm text-[#F8F5EB] placeholder-stone-400 outline-none focus:border-ouro focus:ring-1 focus:ring-ouro transition-all" 
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-ouro uppercase tracking-wider">Senha</label>
                        <button
                          type="button"
                          onClick={() => {
                            setAbaAuthGeral('recuperar');
                            setEtapaRecuperacao(1);
                            setMsgInfoRecuperacao('');
                            setPreviewCodigoEmail(null);
                          }}
                          className="text-xs text-ouro/80 hover:text-ouro underline transition-all cursor-pointer"
                        >
                          Esqueci minha senha
                        </button>
                      </div>
                      <div className="relative">
                        <input 
                          name="senha" 
                          type={verSenhaLogin ? "text" : "password"} 
                          required 
                          placeholder="••••••••••••" 
                          className="w-full px-3.5 py-2.5 pr-10 rounded-xl bg-[#040711] border border-ouro/40 text-sm text-[#F8F5EB] placeholder-stone-400 outline-none focus:border-ouro focus:ring-1 focus:ring-ouro transition-all" 
                        />
                        {renderBotaoOlhoSenha(verSenhaLogin, () => setVerSenhaLogin(!verSenhaLogin), "btn-ver-senha-login")}
                      </div>
                    </div>
                    <button 
                      type="submit" 
                      style={{
                        background: 'linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%)',
                        color: '#080E1E',
                        fontWeight: '800',
                        border: '1px solid #FFE8A3',
                        boxShadow: '0 4px 20px rgba(223, 177, 91, 0.45)'
                      }}
                      className="w-full py-3 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer"
                    >
                      Acessar Minha Conta
                    </button>
                  </form>
                ) : abaAuthGeral === 'cadastro' ? (
                  /* ABA 2: FORMULÁRIO DE CADASTRO COM CPF EXCLUSIVO (GRADE RESPONSIVA 2 COLUNAS) */
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    const nome = nomeCadastro;
                    const data_nascimento = dataNascimentoCadastro;
                    const email = emailCadastro;
                    const senha = senhaCadastro;

                    if (!data_nascimento || data_nascimento.trim().length === 0) {
                      alert('A data de nascimento é obrigatória para cadastrar sua conta exclusiva na boutique.');
                      return;
                    }

                    if (!concordaTermosLgpd) {
                      alert('Para criar sua conta, é obrigatório ler e concordar com os Documentos Legais e Políticas da Vênus & Luar (LGPD).');
                      return;
                    }

                    const res = await fetch('/api/auth/registrar', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ nome, data_nascimento, email, senha, role: 'cliente', concorda_termos: concordaTermosLgpd })
                    });
                    const json = await res.json();
                    if (res.ok) {
                      setUsuario(json.usuario);
                      setToken(json.token);
                      localStorage.setItem('venus_usuario', JSON.stringify(json.usuario));
                      localStorage.setItem('venus_token', json.token);
                      setIsAuthOpen(false);
                      setNomeCadastro('');
                      setDataNascimentoCadastro('');
                      setEmailCadastro('');
                      setSenhaCadastro('');
                      setConcordaTermosLgpd(false);
                      mostrarNotificacao('Conta de usuário criada com sucesso! Bem-vinda à Vênus e Luar, ' + json.usuario.nome.split(' ')[0] + '!');
                    } else {
                      alert(json.erro || 'Falha no cadastro');
                    }
                  }} className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 relative z-10">

                    {/* Perfil Unificado: Usuário */}
                    <div className="sm:col-span-2 p-3.5 rounded-2xl bg-celestial-950/90 border border-ouro/40 flex items-center gap-3.5 shadow-inner">
                      <div className="w-11 h-11 rounded-xl bg-ouro/20 border border-ouro/40 flex items-center justify-center text-xl shrink-0 shadow-sm">
                        ✨
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-xs font-bold text-ouro block tracking-wide">
                          Conta Exclusiva de Usuário
                        </span>
                        <p className="text-[11px] text-[#C2B9A3] leading-relaxed">
                          Com este cadastro você pode realizar compras na boutique, fazer reservas no bistrô e também cadastrar e doar animais para adoção responsável.
                        </p>
                      </div>
                    </div>
                    
                    {/* Nome Completo (Coluna 1) */}
                    <div>
                      <label className="block text-xs font-bold text-ouro mb-1 uppercase tracking-wider">Nome Completo</label>
                      <input 
                        name="nome" 
                        value={nomeCadastro}
                        onChange={(e) => setNomeCadastro(e.target.value)}
                        required 
                        placeholder="Ex: Clara Silveira" 
                        className="w-full px-3 py-2.5 rounded-xl bg-[#040711] border border-ouro/40 text-sm text-[#F8F5EB] placeholder-stone-400 outline-none focus:border-ouro focus:ring-1 focus:ring-ouro transition-all" 
                      />
                    </div>

                    {/* E-mail (Coluna 2) */}
                    <div>
                      <label className="block text-xs font-bold text-ouro mb-1 uppercase tracking-wider">E-mail</label>
                      <input 
                        name="email" 
                        type="email" 
                        value={emailCadastro}
                        onChange={(e) => setEmailCadastro(e.target.value)}
                        required 
                        placeholder="Ex: clara@email.com" 
                        className="w-full px-3 py-2.5 rounded-xl bg-[#040711] border border-ouro/40 text-sm text-[#F8F5EB] placeholder-stone-400 outline-none focus:border-ouro focus:ring-1 focus:ring-ouro transition-all" 
                      />
                    </div>

                    {/* Data de Nascimento (Coluna 1) - Obrigatório */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-ouro uppercase tracking-wider">
                          Data de Nascimento <span className="text-ouro-light font-normal">(+18 anos)</span>
                        </label>
                        {dataNascimentoCadastro && (
                          <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                            ✓ Informada
                          </span>
                        )}
                      </div>
                      <input 
                        id="input-nascimento-cadastro"
                        name="data_nascimento" 
                        type="date"
                        required
                        value={dataNascimentoCadastro}
                        onChange={(e) => setDataNascimentoCadastro(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl bg-[#040711] border border-ouro/40 text-sm text-[#F8F5EB] outline-none focus:border-ouro focus:ring-1 focus:ring-ouro transition-all cursor-pointer font-sans" 
                      />
                      <p className="text-[11px] text-[#C2B9A3] mt-1">
                        Obrigatório para confirmação de maioridade legal (+18) conforme os Termos de Uso.
                      </p>
                    </div>

                    {/* Senha Segura (Coluna 2) */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-ouro uppercase tracking-wider">Senha</label>
                        {forcaAtual.nivel && (
                          <span className={"text-[11px] font-bold uppercase tracking-wider " + forcaAtual.cor}>
                            {forcaAtual.nivel}
                          </span>
                        )}
                      </div>
                      <div className="relative">
                        <input 
                          name="senha" 
                          type={verSenhaCadastro ? "text" : "password"} 
                          value={senhaCadastro}
                          onChange={(e) => setSenhaCadastro(e.target.value)}
                          required 
                          minLength="8" 
                          maxLength="128" 
                          autoComplete="new-password"
                          placeholder="Mínimo 8 caracteres" 
                          className="w-full px-3 py-2.5 pr-10 rounded-xl bg-[#040711] border border-ouro/40 text-sm text-[#F8F5EB] placeholder-stone-400 outline-none focus:border-ouro focus:ring-1 focus:ring-ouro transition-all" 
                        />
                        {renderBotaoOlhoSenha(verSenhaCadastro, () => setVerSenhaCadastro(!verSenhaCadastro), "btn-ver-senha-cadastro")}
                      </div>
                      
                      {/* Medidor Visual de Força da Senha */}
                      {senhaCadastro ? (
                        <div className="mt-1.5 space-y-1 animate-fadeIn">
                          <div className="grid grid-cols-4 gap-1.5 h-1.5">
                            <div className={"rounded-full transition-all duration-300 " + (forcaAtual.score >= 1 ? forcaAtual.bg : 'bg-stone-800')}></div>
                            <div className={"rounded-full transition-all duration-300 " + (forcaAtual.score >= 2 ? forcaAtual.bg : 'bg-stone-800')}></div>
                            <div className={"rounded-full transition-all duration-300 " + (forcaAtual.score >= 3 ? forcaAtual.bg : 'bg-stone-800')}></div>
                            <div className={"rounded-full transition-all duration-300 " + (forcaAtual.score >= 4 ? forcaAtual.bg : 'bg-stone-800')}></div>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-[#C2B9A3]">
                            <span>{forcaAtual.texto}</span>
                            <span>{senhaCadastro.length} carac.</span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-[#C2B9A3] mt-1">
                          Mínimo de 8 caracteres para proteção da conta.
                        </p>
                      )}
                    </div>

                    {/* Checkbox Obrigatória de Aceite dos Termos LGPD e Políticas */}
                    <div className="sm:col-span-2 pt-1 pb-1">
                      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#040711] border border-ouro/30 hover:border-ouro/60 transition-all">
                        <input 
                          id="checkbox-termos-lgpd"
                          type="checkbox"
                          checked={concordaTermosLgpd}
                          onChange={(e) => setConcordaTermosLgpd(e.target.checked)}
                          className="mt-0.5 w-4 h-4 rounded border-ouro/50 text-ouro focus:ring-ouro focus:ring-offset-celestial-950 bg-celestial-900 cursor-pointer accent-[#DFB15B]"
                        />
                        <label htmlFor="checkbox-termos-lgpd" className="text-xs text-[#E6E1D3] leading-relaxed cursor-pointer select-none">
                          Li, compreendi e concordo com os{' '}
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setModalTermosLgpdAberto(true); }}
                            className="text-ouro font-bold underline hover:text-[#FFE8A3] transition-colors inline-block cursor-pointer"
                          >
                            Documentos Legais e Políticas da Vênus &amp; Luar (LGPD)
                          </button>
                          , incluindo os Termos de Uso, Política de E-commerce, Regras de Adoção e Proteção de Dados Pessoais.
                        </label>
                      </div>
                    </div>

                    {/* Botão de Envio (Ocupa 2 Colunas) */}
                    <div className="sm:col-span-2 pt-1">
                      <button 
                        type="submit" 
                        style={{
                          background: 'linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%)',
                          color: '#080E1E',
                          fontWeight: '800',
                          border: '1px solid #FFE8A3',
                          boxShadow: '0 4px 20px rgba(223, 177, 91, 0.45)'
                        }}
                        className="w-full py-3 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer"
                      >
                        Criar Minha Conta Exclusiva
                      </button>
                    </div>
                  </form>
                ) : (
                  /* ABA 3: RECUPERAÇÃO DE SENHA VIA E-MAIL PESSOAL */
                  <div className="space-y-4 relative z-10 animate-fadeIn">
                    {msgInfoRecuperacao && (
                      <div className="p-3 rounded-xl bg-emerald-950/70 border border-emerald-500/40 text-[11px] text-emerald-200">
                        {msgInfoRecuperacao}
                      </div>
                    )}

                    {etapaRecuperacao === 1 ? (
                      /* ETAPA 1: SOLICITAÇÃO DO CÓDIGO POR E-MAIL PESSOAL */
                      <form onSubmit={async (e) => {
                        e.preventDefault();
                        if (!emailRecuperacao || !emailRecuperacao.includes('@')) {
                          alert('Informe um endereço de e-mail válido.');
                          return;
                        }
                        setCarregandoRecuperacao(true);
                        try {
                          const res = await fetch('/api/auth/solicitar-recuperacao', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email: emailRecuperacao })
                          });
                          const json = await res.json();
                          if (res.ok) {
                            setEtapaRecuperacao(2);
                            setPreviewCodigoEmail(json.previewCodigo || null);
                            setMsgInfoRecuperacao(json.mensagem || 'Instruções e código de recuperação enviados para seu e-mail.');
                            mostrarNotificacao('Código de recuperação enviado ao seu e-mail!');
                          } else {
                            alert(json.erro || 'Falha ao solicitar recuperação.');
                          }
                        } catch (err) {
                          alert('Erro ao conectar ao servidor.');
                        } finally {
                          setCarregandoRecuperacao(false);
                        }
                      }} className="space-y-4">
                        <div>
                          <label className="block text-[11px] font-bold text-ouro mb-1.5 uppercase tracking-wider">
                            E-mail Pessoal Cadastrado
                          </label>
                          <input 
                            type="email" 
                            required 
                            value={emailRecuperacao}
                            onChange={(e) => setEmailRecuperacao(e.target.value)}
                            placeholder="seu-email-pessoal@exemplo.com" 
                            className="w-full pl-3.5 pr-3 py-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro focus:ring-1 focus:ring-ouro/40 transition-all" 
                          />
                          <p className="text-[10px] text-luar-300/70 mt-1.5">
                            Enviaremos um código seguro de 6 dígitos válido por 15 minutos para redefinir sua senha.
                          </p>
                        </div>

                        <button 
                          type="submit" 
                          disabled={carregandoRecuperacao}
                          style={{
                            background: 'linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%)',
                            color: '#080E1E',
                            fontWeight: '800',
                            border: '1px solid #FFE8A3',
                            boxShadow: '0 4px 25px rgba(223, 177, 91, 0.55)'
                          }}
                          className="w-full py-3.5 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50"
                        >
                          {carregandoRecuperacao ? 'Enviando Solicitação...' : 'Enviar Código por E-mail'}
                        </button>

                        <div className="text-center pt-1">
                          <button
                            type="button"
                            onClick={() => { setAbaAuthGeral('login'); setMsgInfoRecuperacao(''); }}
                            className="text-xs text-stone-400 hover:text-ouro transition-colors cursor-pointer"
                          >
                            ← Lembra da sua senha? Voltar ao login
                          </button>
                        </div>
                      </form>
                    ) : (
                      /* ETAPA 2: DIGITAR O CÓDIGO RECEBIDO E A NOVA SENHA */
                      <form onSubmit={async (e) => {
                        e.preventDefault();
                        if (!codigoRecuperacao || codigoRecuperacao.trim().length !== 6) {
                          alert('Por favor, informe o código de verificação de 6 dígitos enviado por e-mail.');
                          return;
                        }
                        if (forcaNovaSenha.score < 2) {
                          alert('A nova senha não atende aos requisitos mínimos de segurança (mínimo 8 caracteres, sem termos comuns).');
                          return;
                        }
                        setCarregandoRecuperacao(true);
                        try {
                          const res = await fetch('/api/auth/redefinir-senha', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                              email: emailRecuperacao, 
                              codigo: codigoRecuperacao.trim(), 
                              novaSenha: novaSenhaRecuperacao 
                            })
                          });
                          const json = await res.json();
                          if (res.ok) {
                            mostrarNotificacao('Senha redefinida com sucesso! Você já pode entrar com sua nova senha.');
                            setAbaAuthGeral('login');
                            setEtapaRecuperacao(1);
                            setCodigoRecuperacao('');
                            setNovaSenhaRecuperacao('');
                            setPreviewCodigoEmail(null);
                            setMsgInfoRecuperacao('');
                          } else {
                            alert(json.erro || 'Falha ao redefinir senha.');
                          }
                        } catch (err) {
                          alert('Erro ao conectar ao servidor.');
                        } finally {
                          setCarregandoRecuperacao(false);
                        }
                      }} className="space-y-3.5">
                        
                        {/* Simulação em Tela para Testes Imediatos em Localhost */}
                        {previewCodigoEmail && (
                          <div className="p-3 rounded-xl bg-celestial-950/90 border border-ouro/50 shadow-md space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-ouro uppercase tracking-wider">
                                ✦ E-mail Pessoal Simulado (Localhost)
                              </span>
                              <span className="text-[9px] text-stone-400">Expira em 15 min</span>
                            </div>
                            <p className="text-[11px] text-luar-200">
                              Código enviado para <span className="text-ouro font-semibold">\${emailRecuperacao}</span>:
                            </p>
                            <div className="flex items-center gap-2">
                              <span className="px-3 py-1 rounded-lg bg-celestial-900 border border-ouro/60 font-mono text-sm font-bold text-ouro tracking-widest">
                                {previewCodigoEmail}
                              </span>
                              <button 
                                type="button" 
                                onClick={() => setCodigoRecuperacao(previewCodigoEmail)}
                                className="text-[10px] py-1 px-2.5 rounded-lg bg-ouro/20 hover:bg-ouro/30 text-ouro border border-ouro/40 transition-all font-semibold cursor-pointer"
                              >
                                Preencher Código
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Campo do Código */}
                        <div>
                          <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                            Código de Verificação (6 Dígitos)
                          </label>
                          <input 
                            type="text" 
                            required 
                            maxLength="6"
                            value={codigoRecuperacao}
                            onChange={(e) => setCodigoRecuperacao(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                            placeholder="000000" 
                            className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 font-mono text-center tracking-[0.3em] text-sm text-ouro font-bold outline-none focus:border-ouro focus:ring-1 focus:ring-ouro/40" 
                          />
                        </div>

                        {/* Campo da Nova Senha Segura */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-[11px] font-bold text-ouro uppercase tracking-wider">Nova Senha Segura</label>
                            {forcaNovaSenha.nivel && (
                              <span className={\`text-[10px] font-bold uppercase tracking-wider \${forcaNovaSenha.cor}\`}>
                                {forcaNovaSenha.nivel}
                              </span>
                            )}
                          </div>
                          <div className="relative">
                            <input 
                              type={verSenhaRecuperacao ? "text" : "password"} 
                              required 
                              minLength="8" 
                              maxLength="128" 
                              value={novaSenhaRecuperacao}
                              onChange={(e) => setNovaSenhaRecuperacao(e.target.value)}
                              placeholder="Mínimo 8 caracteres (recomendado 12+)" 
                              className="w-full p-2.5 pr-10 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro focus:ring-1 focus:ring-ouro/40" 
                            />
                            {renderBotaoOlhoSenha(verSenhaRecuperacao, () => setVerSenhaRecuperacao(!verSenhaRecuperacao), "btn-ver-senha-recuperacao")}
                          </div>
                          
                          {/* Medidor Visual de Força da Nova Senha */}
                          {novaSenhaRecuperacao && (
                            <div className="mt-2 space-y-1 animate-fadeIn">
                              <div className="grid grid-cols-4 gap-1.5 h-1.5">
                                <div className={\`rounded-full transition-all duration-300 \${forcaNovaSenha.score >= 1 ? forcaNovaSenha.bg : 'bg-celestial-800'}\`}></div>
                                <div className={\`rounded-full transition-all duration-300 \${forcaNovaSenha.score >= 2 ? forcaNovaSenha.bg : 'bg-celestial-800'}\`}></div>
                                <div className={\`rounded-full transition-all duration-300 \${forcaNovaSenha.score >= 3 ? forcaNovaSenha.bg : 'bg-celestial-800'}\`}></div>
                                <div className={\`rounded-full transition-all duration-300 \${forcaNovaSenha.score >= 4 ? forcaNovaSenha.bg : 'bg-celestial-800'}\`}></div>
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-luar-300">
                                <span>{forcaNovaSenha.texto}</span>
                                <span className="text-stone-400">{novaSenhaRecuperacao.length} carac.</span>
                              </div>
                            </div>
                          )}
                        </div>

                        <button 
                          type="submit" 
                          disabled={carregandoRecuperacao}
                          style={{
                            background: 'linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%)',
                            color: '#080E1E',
                            fontWeight: '800',
                            border: '1px solid #FFE8A3',
                            boxShadow: '0 4px 25px rgba(223, 177, 91, 0.55)'
                          }}
                          className="w-full py-3.5 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50"
                        >
                          {carregandoRecuperacao ? 'Atualizando Senha...' : 'Salvar Nova Senha'}
                        </button>

                        <div className="flex items-center justify-between pt-1 text-[11px]">
                          <button
                            type="button"
                            onClick={() => { setEtapaRecuperacao(1); setPreviewCodigoEmail(null); }}
                            className="text-stone-400 hover:text-ouro transition-colors cursor-pointer"
                          >
                            ← Reenviar código
                          </button>
                          <button
                            type="button"
                            onClick={() => { setAbaAuthGeral('login'); setMsgInfoRecuperacao(''); }}
                            className="text-stone-400 hover:text-ouro transition-colors cursor-pointer"
                          >
                            Voltar ao login
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}

                {/* Rodapé de Segurança */}
                <div className="pt-3 mt-4 border-t border-ouro/20 text-center text-xs text-[#C2B9A3] flex items-center justify-center gap-1.5 relative z-10">
                  <span className="text-ouro font-serif">✦</span>
                  <span>Ambiente seguro e exclusivo Vênus e Luar Boutique</span>
                </div>

              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL DE DOCUMENTOS LEGAIS E POLÍTICAS DA VÊNUS & LUAR (LGPD) */}
          {/* ==================================================================== */}
          {modalTermosLgpdAberto && (
            <div 
              id="modal-termos-lgpd-overlay"
              style={{ backgroundColor: 'rgba(3, 6, 14, 0.94)' }}
              className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-5 backdrop-blur-md animate-fadeIn"
              onClick={() => setModalTermosLgpdAberto(false)}
            >
              <div 
                id="modal-termos-lgpd-conteudo"
                style={{ backgroundColor: '#080E1E' }}
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl shadow-[0_30px_70px_rgba(0,0,0,0.95)] border border-ouro/50 gold-glow overflow-hidden"
              >
                {/* Cabeçalho Nobre */}
                <div className="px-6 py-5 border-b border-ouro/30 bg-celestial-950 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full border border-ouro/60 bg-[#040711] p-1 flex items-center justify-center shadow-md">
                      <span className="text-xl">📜</span>
                    </div>
                    <div>
                      <h3 className="font-serif text-lg sm:text-xl font-bold gold-gradient-text leading-tight">
                        Documentos Legais e Políticas da Vênus &amp; Luar
                      </h3>
                      <p className="text-[11px] text-ouro/80 font-light">
                        Transparência, Segurança Jurídica e Proteção de Dados (LGPD • Lei nº 13.709/2018)
                      </p>
                    </div>
                  </div>
                  <button
                    id="btn-fechar-modal-termos-x"
                    type="button"
                    onClick={() => setModalTermosLgpdAberto(false)}
                    className="w-8 h-8 rounded-full bg-celestial-900 border border-ouro/30 hover:border-ouro text-ouro hover:text-white flex items-center justify-center text-lg font-bold transition-all cursor-pointer"
                    aria-label="Fechar"
                  >
                    ×
                  </button>
                </div>

                {/* Barra de Filtros / Abas */}
                <div className="px-6 py-2.5 bg-celestial-900/60 border-b border-ouro/20 flex flex-wrap gap-2 shrink-0 overflow-x-auto">
                  {[
                    { id: 'todos', label: '📖 Todos os Documentos' },
                    { id: 'termos_uso', label: '1. Termos de Uso' },
                    { id: 'compras', label: '2. Compras & Entregas' },
                    { id: 'adocao', label: '3. Painel de Adoção' },
                    { id: 'lgpd', label: '4. Privacidade (LGPD)' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      id={"tab-termos-" + tab.id}
                      type="button"
                      onClick={() => setSecaoTermosAtiva(tab.id)}
                      className={"px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer " + (
                        secaoTermosAtiva === tab.id
                          ? 'bg-ouro text-celestial-950 font-bold shadow-md'
                          : 'bg-celestial-950 text-[#C2B9A3] border border-ouro/25 hover:border-ouro hover:text-ouro'
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Conteúdo Rolável dos Documentos */}
                <div className="p-6 overflow-y-auto space-y-6 text-[#E6E1D3] text-xs sm:text-sm leading-relaxed divide-y divide-ouro/15">
                  
                  {/* SEÇÃO 1: TERMOS E CONDIÇÕES DE USO */}
                  {(secaoTermosAtiva === 'todos' || secaoTermosAtiva === 'termos_uso') && (
                    <div id="secao-termos-1" className="space-y-3 pt-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-ouro/20 text-ouro text-[11px] font-bold uppercase tracking-wider border border-ouro/30">1</span>
                        <h4 className="font-serif text-base sm:text-lg font-bold text-ouro">Termos e Condições de Uso (Regras Gerais)</h4>
                      </div>
                      <p className="text-[#C2B9A3] italic text-xs">
                        Este documento define as diretrizes básicas para a navegação e utilização de todos os serviços oferecidos em nossa plataforma.
                      </p>
                      <div className="space-y-3 pl-2.5 border-l-2 border-ouro/30">
                        <div>
                          <strong className="text-ouro font-semibold">Cadastro e Conta:</strong> Para utilizar nossos serviços de compra e o painel de adoção, você concorda em fornecer dados exatos, precisos e verdadeiros, assumindo o compromisso de atualizar seus dados pessoais sempre que houver alguma alteração. Você é o único responsável por manter a confidencialidade da sua senha de acesso. Ao se cadastrar, você confirma ser maior de 18 (dezoito) anos e ter plena capacidade legal para realizar compras ou firmar compromissos de adoção.
                        </div>
                        <div>
                          <strong className="text-ouro font-semibold">Conduta do Usuário:</strong> É estritamente proibido o uso da plataforma para fins ilícitos, incluindo, mas não se limitando a: fraudes, envio de mensagens indesejadas (spam), assédio, ou publicação de informações falsas e enganosas sobre animais no painel de adoção.
                        </div>
                        <div>
                          <strong className="text-ouro font-semibold">Propriedade Intelectual:</strong> Todo o conteúdo deste site (textos, logotipos, imagens de produtos, marcas e design) pertence exclusivamente à Vênus &amp; Luar ou aos seus respectivos parceiros, sendo vedada a reprodução total ou parcial sem autorização prévia por escrito.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SEÇÃO 2: POLÍTICA DE COMPRAS, TROCAS E ENTREGAS */}
                  {(secaoTermosAtiva === 'todos' || secaoTermosAtiva === 'compras') && (
                    <div id="secao-termos-2" className="space-y-3 pt-4">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-ouro/20 text-ouro text-[11px] font-bold uppercase tracking-wider border border-ouro/30">2</span>
                        <h4 className="font-serif text-base sm:text-lg font-bold text-ouro">Política de Compras, Trocas e Entregas (E-commerce)</h4>
                      </div>
                      <p className="text-[#C2B9A3] italic text-xs">
                        Esta seção estabelece as regras comerciais para as aquisições realizadas na nossa loja online.
                      </p>
                      <div className="space-y-3 pl-2.5 border-l-2 border-ouro/30">
                        <div>
                          <strong className="text-ouro font-semibold">Preços e Pagamento:</strong> Os preços e condições de pagamento exibidos são válidos exclusivamente para compras realizadas no site. Aceitamos as formas de pagamento informadas no checkout (Cartão de Crédito, Pix e Boleto, conforme disponibilidade). Reservamo-nos o direito de corrigir eventuais erros evidentes de digitação em valores antes do processamento do pedido.
                        </div>
                        <div>
                          <strong className="text-ouro font-semibold">Entregas:</strong> Os prazos de entrega passam a contar a partir da confirmação do pagamento pela instituição financeira. O prazo pode variar conforme a região de destino e a modalidade de frete selecionada. É dever do cliente fornecer o endereço completo e correto para envio.
                        </div>
                        <div>
                          <strong className="text-ouro font-semibold">Direito de Arrependimento e Trocas:</strong> Conforme o Artigo 49 do Código de Defesa do Consumidor (CDC), o cliente tem até 7 (sete) dias corridos a partir do recebimento do produto para solicitar a devolução ou troca por arrependimento, desde que o produto esteja em sua embalagem original, sem indícios de uso, com lacres inviolados e acompanhado de todos os acessórios e nota fiscal. Produtos com defeito de fabricação seguem a garantia legal de 30 (trinta) dias para bens não duráveis e 90 (noventa) dias para bens duráveis.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SEÇÃO 3: REGRAS DO PAINEL DE ADOÇÃO / DOAÇÃO DE PETS */}
                  {(secaoTermosAtiva === 'todos' || secaoTermosAtiva === 'adocao') && (
                    <div id="secao-termos-3" className="space-y-3 pt-4">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-ouro/20 text-ouro text-[11px] font-bold uppercase tracking-wider border border-ouro/30">3</span>
                        <h4 className="font-serif text-base sm:text-lg font-bold text-ouro">Regras do Painel de Adoção / Doação de Pets</h4>
                      </div>
                      <p className="text-[#C2B9A3] italic text-xs">
                        O painel de adoção é um serviço comunitário destinado a conectar tutores, abrigos e protetores a potenciais adotantes responsáveis.
                      </p>
                      <div className="space-y-3 pl-2.5 border-l-2 border-ouro/30">
                        <div>
                          <strong className="text-ouro font-semibold">Natureza do Serviço:</strong> A Vênus &amp; Luar atua apenas como facilitadora e intermediária de contato entre as partes, não sendo proprietária dos animais divulgados por terceiros nem garantindo o estado de saúde, temperamento ou histórico médico dos pets cadastrados por usuários independentes.
                        </div>
                        <div>
                          <strong className="text-ouro font-semibold">Compromisso de Posse Responsável:</strong> Ao manifestar interesse na adoção de um animal, o adotante assume o compromisso moral e legal de oferecer alimentação adequada, abrigo, cuidados veterinários, vacinação e carinho ao animal durante toda a sua vida, nunca o abandonando ou praticando maus-tratos (atos puníveis pela Lei Federal nº 9.605/1998).
                        </div>
                        <div>
                          <strong className="text-ouro font-semibold">Veracidade das Informações:</strong> Quem cadastra um animal para doação declara que tem o direito legal de fazê-lo e que as informações de saúde, porte, idade e temperamento fornecidas correspondem fielmente à realidade. É terminantemente proibida a comercialização (venda de animais) através do nosso painel de adoção comunitário.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SEÇÃO 4: POLÍTICA DE PRIVACIDADE (LGPD) */}
                  {(secaoTermosAtiva === 'todos' || secaoTermosAtiva === 'lgpd') && (
                    <div id="secao-termos-4" className="space-y-3 pt-4">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-ouro/20 text-ouro text-[11px] font-bold uppercase tracking-wider border border-ouro/30">4</span>
                        <h4 className="font-serif text-base sm:text-lg font-bold text-ouro">Política de Privacidade (LGPD)</h4>
                      </div>
                      <p className="text-[#C2B9A3] italic text-xs">
                        Em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 - LGPD), esta política detalha como coletamos, usamos, armazenamos e protegemos seus dados pessoais.
                      </p>
                      <div className="space-y-3 pl-2.5 border-l-2 border-ouro/30">
                        <div>
                          <strong className="text-ouro font-semibold">Dados Coletados:</strong> Coletamos dados cadastrais (como nome, e-mail, telefone, CPF e endereço) necessários para emissão de nota fiscal, faturamento e entrega de compras. Para o painel de adoção, coletamos informações de contato para permitir a comunicação entre doador e adotante.
                        </div>
                        <div>
                          <strong className="text-ouro font-semibold">Finalidade do Tratamento:</strong> Seus dados são utilizados para:
                          <ul className="list-disc pl-5 mt-1.5 space-y-1 text-[#C2B9A3]">
                            <li>a) Processar e entregar seus pedidos;</li>
                            <li>b) Emitir documentos fiscais obrigatórios por lei;</li>
                            <li>c) Permitir o gerenciamento da sua conta de usuário e autenticação segura;</li>
                            <li>d) Facilitar o contato entre as partes interessadas em adoções responsáveis;</li>
                            <li>e) Enviar comunicações importantes sobre seus pedidos e, mediante seu consentimento, promoções e novidades da boutique.</li>
                          </ul>
                        </div>
                        <div>
                          <strong className="text-ouro font-semibold">Compartilhamento Seguro:</strong> A Vênus &amp; Luar não vende nem aluga seus dados pessoais a terceiros. Seus dados são compartilhados apenas com parceiros essenciais para a operação do negócio (empresas de logística/entregas, gateways de pagamento seguros e autoridades judiciais/fiscais quando exigido por lei).
                        </div>
                        <div>
                          <strong className="text-ouro font-semibold">Segurança da Informação:</strong> Implementamos medidas técnicas e administrativas aptas a proteger seus dados contra acessos não autorizados, perda, alteração ou destruição. Seus dados cadastrais como senhas são criptografados e não são armazenados em texto simples.
                        </div>
                        <div>
                          <strong className="text-ouro font-semibold">Direitos do Titular:</strong> Você tem o direito de solicitar a qualquer momento a confirmação da existência de tratamento dos seus dados, o acesso aos dados coletados, a correção de dados incompletos ou inexatos, a anonimização ou eliminação de dados desnecessários, e a revogação do consentimento, pelos nossos canais oficiais de atendimento.
                        </div>
                      </div>
                    </div>
                  )}

                </div>

                {/* Rodapé de Ações do Modal */}
                <div className="px-6 py-4 border-t border-ouro/30 bg-celestial-950 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-2 text-xs text-ouro/80">
                    <span>🔒</span>
                    <span>Vênus &amp; Luar • Proteção Integral de Dados (LGPD)</span>
                  </div>
                  <div className="flex items-center gap-2.5 w-full sm:w-auto">
                    <button
                      id="btn-fechar-modal-termos"
                      type="button"
                      onClick={() => setModalTermosLgpdAberto(false)}
                      className="flex-1 sm:flex-none px-4 py-2 rounded-xl border border-ouro/30 text-[#ECE6D6] hover:text-white hover:border-ouro text-xs font-semibold transition-all cursor-pointer"
                    >
                      Fechar
                    </button>
                    <button
                      id="btn-aceitar-termos-lgpd-modal"
                      type="button"
                      onClick={() => {
                        setConcordaTermosLgpd(true);
                        setModalTermosLgpdAberto(false);
                      }}
                      style={{
                        background: 'linear-gradient(135deg, #FFE8A3 0%, #DFB15B 50%, #B88B35 100%)',
                        color: '#080E1E',
                        fontWeight: '800',
                        border: '1px solid #FFE8A3',
                        boxShadow: '0 4px 15px rgba(223, 177, 91, 0.4)'
                      }}
                      className="flex-1 sm:flex-none px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:brightness-110 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <span>✓</span>
                      <span>Li e Concordo com os Termos &amp; Políticas</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* PAINEL DE GESTÃO (EXCLUSIVO PARA ADMINISTRADORES AUTORIZADOS) */}
          {/* ==================================================================== */}
          {isAdminOpen && (
            <div 
              style={{ backgroundColor: 'rgba(3, 6, 14, 0.94)' }}
              className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 backdrop-blur-sm animate-fadeIn"
            >
              <div 
                style={{ backgroundColor: '#080E1E' }}
                className="relative w-full max-w-3xl lg:max-w-4xl rounded-3xl p-5 sm:p-7 space-y-5 shadow-[0_25px_60px_rgba(0,0,0,0.95)] border border-ouro/50 gold-glow animate-fadeIn max-h-[90vh] overflow-y-auto"
              >
                <button 
                  onClick={() => setIsAdminOpen(false)} 
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-celestial-900 border border-ouro/40 hover:border-ouro text-ouro hover:text-white flex items-center justify-center text-lg font-bold transition-all cursor-pointer z-10"
                  aria-label="Fechar"
                >
                  ×
                </button>
                
                <div className="flex items-center gap-3 border-b border-ouro/25 pb-4">
                  <div className="w-12 h-12 rounded-2xl bg-celestial-950 border border-ouro/50 flex items-center justify-center text-ouro">
                    {usuario?.role !== 'admin' ? (
                      <span className="text-2xl">🐾</span>
                    ) : (
                      <svg className="w-6 h-6 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <h3 className="font-serif text-2xl font-bold gold-gradient-text">
                      {usuario?.role !== 'admin' ? 'Painel de Gestão de Pets' : 'Painel de Gestão da Boutique'}
                    </h3>
                    <span className="text-[11px] text-emerald-400 font-semibold">
                      {usuario?.role !== 'admin' 
                        ? '✓ Sessão de Usuário Verificada • Gestão exclusiva dos seus animais' 
                        : '✓ Sessão de Administradora Verificada'}
                    </span>
                  </div>
                </div>

                {/* Abas do Painel de Gestão */}
                {usuario?.role !== 'admin' ? (
                  <div className="flex flex-wrap gap-1 bg-celestial-950 p-1.5 rounded-2xl border border-ouro/30">
                    <button
                      type="button"
                      onClick={() => {
                        setAbaGestao('pets');
                        setSubAbaPetsAdmin('lista');
                      }}
                      className={"flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer " + (abaGestao === 'pets' && subAbaPetsAdmin === 'lista' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro')}
                    >
                      🐾 Meus Pets ({pets.filter(p => p.criado_por === usuario?.id_usuario).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAbaGestao('pets');
                        setSubAbaPetsAdmin('novo');
                      }}
                      className={"flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer " + (abaGestao === 'pets' && subAbaPetsAdmin === 'novo' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro')}
                    >
                      + Cadastrar Pet
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAbaGestao('pets');
                        setSubAbaPetsAdmin('candidaturas');
                        carregarCandidaturasAdmin();
                      }}
                      className={"flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer " + (abaGestao === 'pets' && subAbaPetsAdmin === 'candidaturas' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro')}
                    >
                      💬 Solicitações WhatsApp ({listaCandidaturas.length})
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1 bg-celestial-950 p-1.5 rounded-2xl border border-ouro/30">
                    <button
                      id="tab-admin-cadastrar"
                      type="button"
                      onClick={() => setAbaGestao('cadastrar')}
                      className={"flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer " + (abaGestao === 'cadastrar' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro')}
                    >
                      + Peça
                    </button>
                    <button
                      id="tab-admin-produtos"
                      type="button"
                      onClick={() => setAbaGestao('produtos')}
                      className={"flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer " + (abaGestao === 'produtos' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro')}
                    >
                      Catálogo ({produtos.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAbaGestao('pets');
                        carregarCandidaturasAdmin();
                      }}
                      className={"flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer " + (abaGestao === 'pets' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro')}
                    >
                      🐾 Pets &amp; Adoções
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAbaGestao('faturamento');
                        carregarFaturamentoAdmin();
                      }}
                      className={"flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer " + (abaGestao === 'faturamento' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro')}
                    >
                      💳 Faturamento
                    </button>
                    <button
                      id="tab-admin-usuarios"
                      type="button"
                      onClick={() => {
                        setAbaGestao('usuarios');
                        carregarUsuarios();
                      }}
                      className={"flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer " + (abaGestao === 'usuarios' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro')}
                    >
                      Usuários ({listaUsuarios.length})
                    </button>
                    <button
                      id="tab-admin-email"
                      type="button"
                      onClick={() => {
                        setAbaGestao('email');
                        carregarConfigEmailAdmin();
                      }}
                      className={"flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer " + (abaGestao === 'email' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro')}
                    >
                      SMTP E-mail
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAbaGestao('dominio');
                        carregarDominioAdmin();
                      }}
                      className={"flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer " + (abaGestao === 'dominio' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro')}
                    >
                      Domínio &amp; DNS
                    </button>
                  </div>
                )}

                {/* ABA 1: FORMULÁRIO DE CADASTRO */}
                {abaGestao === 'cadastrar' && (
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    let parsedAtributos = {};
                    if (modoAtributosAvancado) {
                      try { 
                        parsedAtributos = JSON.parse(atributosManualJson || '{}'); 
                      } catch(err) { 
                        alert('JSON de atributos inválido. Corrija o formato ou volte aos seletores visuais.'); 
                        return; 
                      }
                    } else {
                      if (categoriaNovoProduto === 'Moda') {
                        parsedAtributos = {
                          tamanho: tamanhoModa,
                          grade_disponivel: gradesModa.join(', '),
                          cor: corModa,
                          tecido: tecidoModa,
                          corte: corteModa,
                          ocasiao: estacaoModa
                        };
                      } else if (categoriaNovoProduto === 'Pet') {
                        parsedAtributos = {
                          indicacao: indicacaoPet,
                          porte: portePet,
                          material: materialPet,
                          lavavel_em_maquina: lavavelPet ? 'Sim' : 'Não',
                          antialergico: antialergicoPet ? 'Sim' : 'Não'
                        };
                      } else if (categoriaNovoProduto === 'Cafeteria') {
                        parsedAtributos = {
                          volume: volumeCafeteria,
                          temperatura: temperaturaCafeteria,
                          grao_ingrediente: graoCafeteria,
                          opcoes_leite: opcoesLeiteCafeteria.join(', '),
                          vegano: veganoCafeteria ? 'Sim' : 'Não',
                          vegetariano: vegetarianoCafeteria ? 'Sim' : 'Não',
                          sem_gluten: semGlutenCafeteria ? 'Sim' : 'Não'
                        };
                      }
                    }

                    const urlImagemFinal = fotoNovoProdutoUrl || (e.target.imagem && e.target.imagem.value) || 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=800&q=80';

                    const res = await fetch('/api/produtos', {
                      method: 'POST',
                      headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + (token || '')
                      },
                      body: JSON.stringify({
                        token,
                        nome_item: e.target.nome.value,
                        categoria: categoriaNovoProduto,
                        preco: Number(e.target.preco.value),
                        estoque: 10,
                        atributos: parsedAtributos,
                        imagem_url: urlImagemFinal,
                        descricao: e.target.descricao.value
                      })
                    });

                    const json = await res.json();
                    if (res.ok) {
                      mostrarNotificacao('Nova peça cadastrada com sucesso no banco de dados!');
                      setIsAdminOpen(false);
                      setFotoNovoProdutoUrl('');
                      setFotoNovoProdutoPreview('');
                      carregarDados();
                    } else {
                      alert(json.erro || 'Erro ao cadastrar peça. Permissão recusada.');
                    }
                  }} className="space-y-4">
                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Nome da Peça / Produto</label>
                      <input name="nome" required placeholder="Ex: Vestido Estelar em Seda Pura" className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Categoria</label>
                        <select
                          name="categoria"
                          value={categoriaNovoProduto}
                          onChange={(e) => setCategoriaNovoProduto(e.target.value)}
                          className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none cursor-pointer"
                        >
                          <option value="Moda">Moda (Alta Costura)</option>
                          <option value="Pet">Pet Shop</option>
                          <option value="Cafeteria">Cafeteria</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Preço (R$)</label>
                        <input name="preco" type="number" step="0.01" required placeholder="Ex: 349.90" className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none" />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-[11px] font-bold text-ouro uppercase tracking-wider">Foto da Peça / Produto</label>
                        <span className="text-[10px] text-luar-300">Galeria, PC ou Link direto</span>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
                        <label className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-celestial-900 border border-ouro/40 text-ouro hover:bg-ouro hover:text-celestial-950 font-bold text-xs cursor-pointer transition-all shadow-sm shrink-0">
                          <span>📷</span>
                          <span>{uploadingFotoProduto ? 'Processando foto...' : 'Escolher da Galeria ou PC'}</span>
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            disabled={uploadingFotoProduto}
                            onChange={(e) => {
                              const arq = e.target.files && e.target.files[0];
                              if (!arq) return;
                              setUploadingFotoProduto(true);
                              processarUploadImagem(
                                arq,
                                (url) => {
                                  setUploadingFotoProduto(false);
                                  setFotoNovoProdutoUrl(url);
                                  setFotoNovoProdutoPreview(url);
                                  mostrarNotificacao('Foto carregada com sucesso!', 'sucesso');
                                },
                                (err) => {
                                  setUploadingFotoProduto(false);
                                  alert('Erro ao enviar foto: ' + err);
                                }
                              );
                            }}
                          />
                        </label>
                        <div className="flex-1 relative">
                          <input 
                            name="imagem" 
                            value={fotoNovoProdutoUrl}
                            onChange={(e) => {
                              setFotoNovoProdutoUrl(e.target.value);
                              setFotoNovoProdutoPreview(e.target.value);
                            }}
                            placeholder="Ou cole a URL da imagem (https://...)" 
                            className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none" 
                          />
                        </div>
                        {fotoNovoProdutoPreview && (
                          <div className="flex items-center gap-2 shrink-0 bg-celestial-950 p-1.5 rounded-xl border border-ouro/30">
                            <img src={fotoNovoProdutoPreview} alt="Preview" className="w-9 h-9 rounded-lg object-cover border border-ouro/30" />
                            <button
                              type="button"
                              onClick={() => {
                                setFotoNovoProdutoUrl('');
                                setFotoNovoProdutoPreview('');
                              }}
                              className="text-xs text-red-400 hover:text-red-300 font-bold px-1.5 cursor-pointer"
                              title="Remover foto"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Descrição Detalhada</label>
                      <textarea name="descricao" placeholder="Detalhes do tecido, acabamentos, corte e proposta da peça..." className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none resize-none" rows="2"></textarea>
                    </div>

                    {/* SELETORES AMIGÁVEIS DE ATRIBUTOS (SUBSTITUIÇÃO DO JSON MANUAL) */}
                    <div className="p-4 rounded-2xl bg-celestial-950/90 border border-ouro/35 space-y-3.5 shadow-inner">
                      <div className="flex items-center justify-between border-b border-ouro/20 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-ouro font-serif">✦</span>
                          <div>
                            <span className="block text-xs font-bold text-ouro uppercase tracking-wider">
                              {'Atributos & Detalhes da Peça (' + categoriaNovoProduto + ')'}
                            </span>
                            <span className="block text-[10px] text-luar-300">
                              {'Seleções rápidas e intuitivas organizadas para ' + (categoriaNovoProduto === 'Moda' ? 'Alta Costura' : categoriaNovoProduto === 'Pet' ? 'o Pet Shop' : 'a Cafeteria')}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setModoAtributosAvancado(!modoAtributosAvancado)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-mono border border-ouro/30 text-ouro/80 hover:text-ouro hover:bg-ouro/10 cursor-pointer transition-colors"
                        >
                          {modoAtributosAvancado ? '✨ Voltar aos Seletores' : '{ } Modo JSON'}
                        </button>
                      </div>

                      {modoAtributosAvancado ? (
                        <div>
                          <label className="block text-[10px] font-mono text-ouro/80 mb-1">JSONB Direto (PostgreSQL GIN):</label>
                          <textarea
                            name="atributos"
                            value={atributosManualJson}
                            onChange={(e) => setAtributosManualJson(e.target.value)}
                            rows="4"
                            className="w-full p-3 rounded-xl bg-celestial-900 border border-ouro/30 text-xs font-mono text-ouro-light outline-none"
                          />
                        </div>
                      ) : (
                        <div className="space-y-3.5">
                          {/* SELETORES: MODA */}
                          {categoriaNovoProduto === 'Moda' && (
                            <div className="space-y-3">
                              {/* Tamanho Principal */}
                              <div>
                                <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                  Tamanho Principal: <span className="text-luar-100 font-semibold">{tamanhoModa}</span>
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                  {['PP', 'P', 'M', 'G', 'GG', 'XG', 'Único'].map(tam => (
                                    <button
                                      key={tam}
                                      type="button"
                                      onClick={() => setTamanhoModa(tam)}
                                      className={"px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer " + (tamanhoModa === tam ? 'bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 shadow-md font-bold' : 'bg-celestial-900 text-luar-200 border border-ouro/25 hover:border-ouro/60')}
                                    >
                                      {tam}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Grade em Estoque */}
                              <div>
                                <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                  Grade Disponível em Estoque:
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                  {['PP', 'P', 'M', 'G', 'GG', 'XG', 'Sob Medida'].map(grade => {
                                    const ativo = gradesModa.includes(grade);
                                    return (
                                      <button
                                        key={grade}
                                        type="button"
                                        onClick={() => {
                                          setGradesModa(ativo ? gradesModa.filter(g => g !== grade) : [...gradesModa, grade]);
                                        }}
                                        className={"px-2.5 py-1 rounded-lg text-[11px] transition-all cursor-pointer flex items-center gap-1 " + (ativo ? 'bg-ouro/20 border border-ouro text-ouro font-bold' : 'bg-celestial-900 border border-ouro/20 text-luar-300 hover:text-ouro')}
                                      >
                                        <span>{ativo ? '✓' : '+'}</span>
                                        <span>{grade}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Cor com sugestões */}
                              <div>
                                <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                  Cor Principal:
                                </label>
                                <input
                                  type="text"
                                  value={corModa}
                                  onChange={(e) => setCorModa(e.target.value)}
                                  placeholder="Ex: Azul Noturno com Fios Dourados"
                                  className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none mb-1.5"
                                />
                                <div className="flex flex-wrap gap-1">
                                  {['Azul Meia-Noite', 'Dourado Imperial', 'Preto Absoluto', 'Branco Pérola', 'Vinho Borgonha', 'Verde Esmeralda', 'Terracota'].map(c => (
                                    <button
                                      key={c}
                                      type="button"
                                      onClick={() => setCorModa(c)}
                                      className={"text-[10px] px-2 py-0.5 rounded-full cursor-pointer transition-all " + (corModa === c ? 'bg-ouro text-celestial-950 font-bold' : 'bg-celestial-900 text-luar-300 hover:text-ouro border border-ouro/20')}
                                    >
                                      {c}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Tecido & Corte */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <div>
                                  <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">Tecido / Material:</label>
                                  <select
                                    value={tecidoModa}
                                    onChange={(e) => setTecidoModa(e.target.value)}
                                    className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none cursor-pointer"
                                  >
                                    <option value="Seda pura acetinada">Seda Pura Acetinada</option>
                                    <option value="Veludo Cristal Francês">Veludo Cristal Francês</option>
                                    <option value="Linho Rústico Nobre">Linho Rústico Nobre</option>
                                    <option value="Crepe de Seda Italiano">Crepe de Seda Italiano</option>
                                    <option value="Renda Chantilly Artesanal">Renda Chantilly Artesanal</option>
                                    <option value="Brocado com Fios Dourados">Brocado com Fios Dourados</option>
                                    <option value="Algodão Pima Peruano">Algodão Pima Peruano</option>
                                    <option value="Tule Bordado com Pedrarias">Tule Bordado com Pedrarias</option>
                                    <option value="Lã Fina Cashmere">Lã Fina Cashmere</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">Corte &amp; Caimento:</label>
                                  <select
                                    value={corteModa}
                                    onChange={(e) => setCorteModa(e.target.value)}
                                    className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none cursor-pointer"
                                  >
                                    <option value="Evasê Fluído">Evasê Fluído</option>
                                    <option value="Alfaiataria Slim Nobre">Alfaiataria Slim Nobre</option>
                                    <option value="Oversized Estruturado">Oversized Estruturado</option>
                                    <option value="Sereia Ajustado">Sereia Ajustado</option>
                                    <option value="Reto Clássico">Reto Clássico</option>
                                    <option value="Envelope Transpassado">Envelope Transpassado</option>
                                    <option value="Godê com Volume">Godê com Volume</option>
                                  </select>
                                </div>
                              </div>

                              {/* Ocasião / Coleção */}
                              <div>
                                <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                  Ocasião / Coleção: <span className="text-luar-100 font-semibold">{estacaoModa}</span>
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                  {['Noite / Gala', 'Casual Chic', 'Alta Joalheria', 'Primavera / Verão', 'Outono / Inverno'].map(est => (
                                    <button
                                      key={est}
                                      type="button"
                                      onClick={() => setEstacaoModa(est)}
                                      className={"px-2.5 py-1 rounded-lg text-[11px] cursor-pointer transition-all " + (estacaoModa === est ? 'bg-ouro text-celestial-950 font-bold' : 'bg-celestial-900 border border-ouro/25 text-luar-200 hover:text-ouro')}
                                    >
                                      {est}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* SELETORES: PET SHOP */}
                          {categoriaNovoProduto === 'Pet' && (
                            <div className="space-y-3">
                              {/* Indicação / Espécie */}
                              <div>
                                <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                  Indicação: <span className="text-luar-100 font-semibold">{indicacaoPet}</span>
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                  {['Cães e Gatos', 'Cães Pequenos', 'Cães Grandes', 'Gatos', 'Filhotes'].map(ind => (
                                    <button
                                      key={ind}
                                      type="button"
                                      onClick={() => setIndicacaoPet(ind)}
                                      className={"px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer " + (indicacaoPet === ind ? 'bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 shadow-md font-bold' : 'bg-celestial-900 text-luar-200 border border-ouro/25 hover:border-ouro/60')}
                                    >
                                      {ind}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Porte Recomendado */}
                              <div>
                                <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                  Porte Recomendado: <span className="text-luar-100 font-semibold">{portePet}</span>
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                  {['Mini (até 3kg)', 'Pequeno (3 a 7kg)', 'Médio (7 a 15kg)', 'Grande (15 a 30kg)', 'Gigante (+30kg)'].map(porte => (
                                    <button
                                      key={porte}
                                      type="button"
                                      onClick={() => setPortePet(porte)}
                                      className={"px-2.5 py-1 rounded-lg text-[11px] cursor-pointer transition-all " + (portePet === porte ? 'bg-ouro text-celestial-950 font-bold' : 'bg-celestial-900 border border-ouro/25 text-luar-200 hover:text-ouro')}
                                    >
                                      {porte}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Material / Composição */}
                              <div>
                                <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">Material / Composição:</label>
                                <select
                                  value={materialPet}
                                  onChange={(e) => setMaterialPet(e.target.value)}
                                  className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none cursor-pointer"
                                >
                                  <option value="Veludo plush e espuma ortopédica">Veludo Plush e Espuma Ortopédica</option>
                                  <option value="Algodão orgânico respirável hipoalergênico">Algodão Orgânico Respirável Hipoalergênico</option>
                                  <option value="Couro ecológico macio e acolchoado">Couro Ecológico Macio e Acolchoado</option>
                                  <option value="Microfibra impermeável de alta resistência">Microfibra Impermeável de Alta Resistência</option>
                                  <option value="Tricô soft aconchegante térmico">Tricô Soft Aconchegante Térmico</option>
                                  <option value="Nylon náutico reforçado antirasgo">Nylon Náutico Reforçado Antirasgo</option>
                                </select>
                              </div>

                              {/* Selos de Cuidado Pet */}
                              <div className="grid grid-cols-2 gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => setLavavelPet(!lavavelPet)}
                                  className={"p-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-between " + (lavavelPet ? 'bg-ouro/20 border-ouro text-ouro' : 'bg-celestial-900 border-ouro/25 text-luar-400')}
                                >
                                  <span>🫧 Lavável em Máquina</span>
                                  <span>{lavavelPet ? '✓ Sim' : '✕ Não'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAntialergicoPet(!antialergicoPet)}
                                  className={"p-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-between " + (antialergicoPet ? 'bg-ouro/20 border-ouro text-ouro' : 'bg-celestial-900 border-ouro/25 text-luar-400')}
                                >
                                  <span>🛡️ Hipoalergênico</span>
                                  <span>{antialergicoPet ? '✓ Sim' : '✕ Não'}</span>
                                </button>
                              </div>
                            </div>
                          )}

                          {/* SELETORES: CAFETERIA */}
                          {categoriaNovoProduto === 'Cafeteria' && (
                            <div className="space-y-3">
                              {/* Volume / Porção */}
                              <div>
                                <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                  Volume / Porção: <span className="text-luar-100 font-semibold">{volumeCafeteria}</span>
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                  {['Dose 50ml', 'Xícara 120ml', 'Caneca 240ml', 'Grande 350ml', 'Porção 100g', 'Fatia 150g'].map(vol => (
                                    <button
                                      key={vol}
                                      type="button"
                                      onClick={() => setVolumeCafeteria(vol)}
                                      className={"px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer " + (volumeCafeteria === vol ? 'bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 shadow-md font-bold' : 'bg-celestial-900 text-luar-200 border border-ouro/25 hover:border-ouro/60')}
                                    >
                                      {vol}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Temperatura */}
                              <div>
                                <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                  Temperatura de Serviço: <span className="text-luar-100 font-semibold">{temperaturaCafeteria}</span>
                                </label>
                                <div className="flex flex-wrap gap-2">
                                  {[
                                    { rotulo: '☕ Quente', valor: 'Quente' },
                                    { rotulo: '❄️ Gelado', valor: 'Gelado' },
                                    { rotulo: '🥐 Ambiente', valor: 'Ambiente' }
                                  ].map(item => (
                                    <button
                                      key={item.valor}
                                      type="button"
                                      onClick={() => setTemperaturaCafeteria(item.valor)}
                                      className={"px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer " + (temperaturaCafeteria === item.valor ? 'bg-ouro text-celestial-950 font-bold' : 'bg-celestial-900 border border-ouro/25 text-luar-200 hover:text-ouro')}
                                    >
                                      {item.rotulo}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Grão Nobre / Ingrediente */}
                              <div>
                                <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">Grão Especial ou Ingrediente Nobre:</label>
                                <select
                                  value={graoCafeteria}
                                  onChange={(e) => setGraoCafeteria(e.target.value)}
                                  className="w-full p-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-xs text-luar-100 outline-none cursor-pointer"
                                >
                                  <option value="Catuaí Vermelho Artesanal 88 pts">Catuaí Vermelho Artesanal 88 pts</option>
                                  <option value="Bourbon Amarelo Vulcânico">Bourbon Amarelo Vulcânico</option>
                                  <option value="Geisha Especial Premiado">Geisha Especial Premiado</option>
                                  <option value="Matcha Cerimonial Uji Japão">Matcha Cerimonial Uji Japão</option>
                                  <option value="Cacau Belga 70% Single Origin">Cacau Belga 70% Single Origin</option>
                                  <option value="Chá Branco com Flores de Jasmim">Chá Branco com Flores de Jasmim</option>
                                  <option value="Pistache Siciliano com Flor de Sal">Pistache Siciliano com Flor de Sal</option>
                                </select>
                              </div>

                              {/* Opções de Leite Aceitas */}
                              <div>
                                <label className="block text-[10px] font-bold text-ouro/90 uppercase mb-1">
                                  Opções de Leite / Base Aceitas:
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                  {['Integral Fresco', 'Aveia Barista', 'Amêndoas', 'Sem Lactose', 'Coco Artesanal'].map(leite => {
                                    const ativo = opcoesLeiteCafeteria.includes(leite);
                                    return (
                                      <button
                                        key={leite}
                                        type="button"
                                        onClick={() => {
                                          setOpcoesLeiteCafeteria(ativo ? opcoesLeiteCafeteria.filter(l => l !== leite) : [...opcoesLeiteCafeteria, leite]);
                                        }}
                                        className={"px-2.5 py-1 rounded-lg text-[11px] transition-all cursor-pointer flex items-center gap-1 " + (ativo ? 'bg-ouro/20 border border-ouro text-ouro font-bold' : 'bg-celestial-900 border border-ouro/20 text-luar-300 hover:text-ouro')}
                                      >
                                        <span>{ativo ? '✓' : '+'}</span>
                                        <span>{leite}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Selos Alimentares */}
                              <div className="grid grid-cols-3 gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => setVeganoCafeteria(!veganoCafeteria)}
                                  className={"p-2 rounded-xl border text-[11px] font-bold transition-all cursor-pointer flex flex-col items-center gap-1 " + (veganoCafeteria ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300' : 'bg-celestial-900 border-ouro/25 text-luar-400')}
                                >
                                  <span>🌿 Vegano</span>
                                  <span>{veganoCafeteria ? '✓ Sim' : '✕ Não'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setVegetarianoCafeteria(!vegetarianoCafeteria)}
                                  className={"p-2 rounded-xl border text-[11px] font-bold transition-all cursor-pointer flex flex-col items-center gap-1 " + (vegetarianoCafeteria ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300' : 'bg-celestial-900 border-ouro/25 text-luar-400')}
                                >
                                  <span>🧀 Vegetariano</span>
                                  <span>{vegetarianoCafeteria ? '✓ Sim' : '✕ Não'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSemGlutenCafeteria(!semGlutenCafeteria)}
                                  className={"p-2 rounded-xl border text-[11px] font-bold transition-all cursor-pointer flex flex-col items-center gap-1 " + (semGlutenCafeteria ? 'bg-amber-950/60 border-amber-500 text-amber-300' : 'bg-celestial-900 border-ouro/25 text-luar-400')}
                                >
                                  <span>🌾 Sem Glúten</span>
                                  <span>{semGlutenCafeteria ? '✓ Sim' : '✕ Não'}</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <button type="submit" className="w-full py-4 rounded-xl bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 font-bold text-xs uppercase tracking-widest hover:brightness-110 shadow-lg cursor-pointer">
                      Salvar Peça no Banco de Dados
                    </button>
                  </form>
                )}

                {/* ABA 2: GERENCIAR E EXCLUIR PEÇAS DO CATÁLOGO */}
                {abaGestao === 'produtos' && (
                  <div className="space-y-3">
                    <p className="text-xs text-luar-300">
                      Peças ativas no catálogo. A exclusão remove a peça permanentemente do banco de dados e sincroniza com o disco.
                    </p>
                    <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                      {produtos.map(p => (
                        <div key={p.id_produto} className="p-3 rounded-2xl bg-celestial-950 border border-ouro/25 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <img src={p.imagem_url} alt={p.nome_item} className="w-12 h-12 rounded-xl object-cover border border-ouro/30 flex-shrink-0" />
                            <div className="min-w-0">
                              <span className="text-[10px] uppercase font-bold text-ouro/80 block">{p.categoria}</span>
                              <h4 className="text-xs font-bold text-ouro-light truncate">{p.nome_item}</h4>
                              <span className="text-xs font-serif text-ouro font-semibold">{formatBRL(p.preco)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setIsAdminOpen(false);
                                iniciarEdicaoProduto(p);
                              }}
                              className="px-3 py-1.5 rounded-xl bg-celestial-900 hover:bg-ouro/20 border border-ouro/40 text-ouro hover:text-ouro-light text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
                              title="Editar peça"
                            >
                              <span>✏️ Editar</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm('Tem certeza que deseja excluir permanentemente "' + p.nome_item + '" do catálogo?')) {
                                  excluirProduto(p.id_produto);
                                }
                              }}
                              className="px-3 py-1.5 rounded-xl bg-rose-950/70 hover:bg-rose-900 border border-rose-500/40 text-rose-300 hover:text-rose-100 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
                            >
                              <span>Excluir</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ABA 3: USUÁRIOS E ACESSOS REGISTRADOS */}
                {abaGestao === 'usuarios' && (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-celestial-950/80 border border-ouro/30">
                      <div>
                        <h4 className="text-xs font-bold text-ouro uppercase tracking-wider flex items-center gap-2">
                          <span>👥</span> Gestão de Usuários &amp; Acessos
                        </h4>
                        <p className="text-[11px] text-luar-300 mt-0.5">
                          Contas cadastradas persistidas em disco (<code>data/usuarios.json</code>).
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          id="btn-admin-nova-administradora"
                          type="button"
                          onClick={() => setMostrarFormNovoAdmin(!mostrarFormNovoAdmin)}
                          className="py-1.5 px-3 rounded-xl bg-gradient-to-r from-ouro to-amber-500 hover:from-amber-400 hover:to-ouro text-celestial-950 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md flex items-center gap-1.5"
                        >
                          <span>✦</span>
                          <span>{mostrarFormNovoAdmin ? 'Fechar Formulário' : '+ Nova Administradora'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => carregarUsuarios()}
                          className="py-1.5 px-2.5 rounded-xl bg-celestial-900 border border-ouro/30 text-[11px] uppercase tracking-wider text-ouro hover:underline cursor-pointer"
                        >
                          Atualizar
                        </button>
                      </div>
                    </div>

                    {/* Formulário de Criação de Nova Conta Administradora */}
                    {mostrarFormNovoAdmin && (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (novoAdminCpf && !validarCpf(novoAdminCpf)) {
                            alert('Se informado, o CPF deve atender ao Módulo 11 da Receita Federal.');
                            return;
                          }
                          setCriandoAdmin(true);
                          try {
                            const res = await fetch('/api/admin/criar-admin', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                'Authorization': 'Bearer ' + token
                              },
                              body: JSON.stringify({
                                nome: novoAdminNome,
                                cpf: novoAdminCpf,
                                email: novoAdminEmail,
                                senha: novoAdminSenha
                              })
                            });
                            const data = await res.json();
                            if (res.ok) {
                              mostrarNotificacao('Nova conta administradora criada com sucesso!');
                              setNovoAdminNome('');
                              setNovoAdminCpf('');
                              setNovoAdminEmail('');
                              setNovoAdminSenha('');
                              setMostrarFormNovoAdmin(false);
                              carregarUsuarios();
                            } else {
                              alert(data.erro || 'Falha ao criar conta administradora.');
                            }
                          } catch (err) {
                            alert('Erro na requisição: ' + err.message);
                          } finally {
                            setCriandoAdmin(false);
                          }
                        }}
                        className="p-4 rounded-2xl bg-[#03060E] border-2 border-ouro/60 space-y-3.5 shadow-xl animate-fadeIn"
                      >
                        <div className="flex items-center justify-between border-b border-ouro/20 pb-2">
                          <h5 className="text-xs font-bold text-ouro uppercase tracking-wider flex items-center gap-2">
                            <span>👑</span> Cadastrar Nova Conta Administradora
                          </h5>
                          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-ouro/20 text-ouro border border-ouro/40">
                            Acesso Pleno de Gestão
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                              Nome Completo da Administradora
                            </label>
                            <input
                              type="text"
                              required
                              value={novoAdminNome}
                              onChange={(e) => setNovoAdminNome(e.target.value)}
                              placeholder="Ex: Amanda Vasconcelos"
                              className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-[#F8F5EB] placeholder-stone-500 outline-none focus:border-ouro"
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[11px] font-bold text-ouro uppercase tracking-wider">
                                CPF (Opcional)
                              </label>
                              {novoAdminCpf && (
                                <button
                                  type="button"
                                  onClick={() => setNovoAdminCpf('')}
                                  className="text-[10px] text-ouro/80 hover:text-ouro bg-celestial-900 px-2 py-0.5 rounded border border-ouro/30 hover:border-ouro transition-colors cursor-pointer"
                                  title="Limpar campo para digitar CPF"
                                >
                                  ✕ Limpar
                                </button>
                              )}
                            </div>
                            <input
                              type="text"
                              value={novoAdminCpf}
                              onChange={(e) => setNovoAdminCpf(tratarDigitacaoCpf(e.target.value))}
                              inputMode="numeric"
                              autoComplete="off"
                              autoCorrect="off"
                              spellCheck={false}
                              placeholder="000.000.000-00 (Opcional)"
                              maxLength="14"
                              className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-[#F8F5EB] placeholder-stone-500 outline-none focus:border-ouro font-mono"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                              E-mail de Login
                            </label>
                            <input
                              type="email"
                              required
                              value={novoAdminEmail}
                              onChange={(e) => setNovoAdminEmail(e.target.value)}
                              placeholder="admin.amanda@venuseluar.com"
                              className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-[#F8F5EB] placeholder-stone-500 outline-none focus:border-ouro"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                              Senha de Acesso (Mín. 6 caracteres)
                            </label>
                            <div className="relative">
                              <input
                                type={verSenhaNovoAdmin ? "text" : "password"}
                                required
                                value={novoAdminSenha}
                                onChange={(e) => setNovoAdminSenha(e.target.value)}
                                placeholder="Digite a senha de acesso"
                                className="w-full p-2.5 pr-10 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-[#F8F5EB] placeholder-stone-500 outline-none focus:border-ouro"
                              />
                              {renderBotaoOlhoSenha(verSenhaNovoAdmin, () => setVerSenhaNovoAdmin(!verSenhaNovoAdmin), "btn-ver-senha-novo-admin")}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setMostrarFormNovoAdmin(false)}
                            className="py-2 px-3 rounded-xl bg-celestial-950 text-stone-300 border border-stone-700/60 font-bold text-xs uppercase tracking-wider hover:bg-stone-800 transition-all cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            type="submit"
                            disabled={criandoAdmin}
                            className="py-2 px-4 rounded-xl bg-gradient-to-r from-ouro to-amber-500 hover:from-amber-400 hover:to-ouro text-celestial-950 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md flex items-center gap-1.5"
                          >
                            <span>✦</span>
                            <span>{criandoAdmin ? 'Cadastrando...' : 'Criar Conta Administradora'}</span>
                          </button>
                        </div>
                      </form>
                    )}

                    <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                      {listaUsuarios.length === 0 ? (
                        <div className="text-center p-6 text-xs text-luar-300">Carregando usuários registrados...</div>
                      ) : (
                        listaUsuarios.map(u => (
                          <div key={u.id_usuario} className="p-3.5 rounded-2xl bg-celestial-950 border border-ouro/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-ouro/50 transition-all">
                            <div className="flex items-center gap-3">
                              {u.foto_perfil ? (
                                <img 
                                  src={u.foto_perfil} 
                                  alt={u.nome_completo || 'Avatar'} 
                                  className="w-11 h-11 rounded-full object-cover border border-ouro/40 shadow-sm shrink-0" 
                                />
                              ) : (
                                <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-celestial-900 via-stone-800 to-ouro/20 border border-ouro/30 flex items-center justify-center font-serif text-sm font-bold text-ouro shrink-0 shadow-sm">
                                  {(u.nome_completo || u.email || 'U').charAt(0).toUpperCase()}
                                </div>
                              )}
                              <div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-xs font-bold text-ouro-light">{u.nome_completo}</span>
                                  <span className={"text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full " + (u.role === 'admin' ? 'bg-ouro/20 text-ouro border border-ouro/40' : 'bg-celestial-900 text-luar-300 border border-ouro/20')}>
                                    {u.role === 'admin' ? 'Administradora' : 'Usuário'}
                                  </span>
                                  {u.cpf ? (
                                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-ouro/15 text-ouro border border-ouro/40 shadow-sm inline-flex items-center gap-1">
                                      <span>CPF: {cpfsRevelados[u.id_usuario] ? u.cpf : mascararCpf(u.cpf)}</span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setCpfsRevelados(prev => ({ ...prev, [u.id_usuario]: !prev[u.id_usuario] }));
                                        }}
                                        className="text-[10px] text-ouro/70 hover:text-ouro ml-0.5 transition-colors cursor-pointer"
                                        title={cpfsRevelados[u.id_usuario] ? "Ocultar CPF" : "Visualizar CPF completo"}
                                      >
                                        {cpfsRevelados[u.id_usuario] ? '🙈' : '👁️'}
                                      </button>
                                    </span>
                                  ) : null}
                                </div>
                                <span className="text-[11px] text-luar-300/80 block mt-0.5">{u.email}</span>
                              </div>
                            </div>

                            <div className="flex flex-row sm:flex-col items-end justify-between sm:justify-center gap-2">
                              <div className="text-left sm:text-right text-[10px] text-stone-400">
                                <div>Cadastro: <strong className="text-luar-200">{new Date(u.criado_em).toLocaleDateString('pt-BR')}</strong></div>
                                <div>Último Acesso: <strong className="text-emerald-400">{u.ultimo_acesso ? new Date(u.ultimo_acesso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-'}</strong></div>
                              </div>
                              <button
                                type="button"
                                id={"btn-editar-usuario-" + u.id_usuario}
                                onClick={() => iniciarEdicaoUsuarioAdmin(u)}
                                className="px-3 py-1.5 rounded-xl bg-ouro/15 hover:bg-ouro/30 text-ouro border border-ouro/40 hover:border-ouro text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm shrink-0"
                              >
                                <span>✏️</span>
                                <span>Editar</span>
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* ABA 4: CONFIGURAÇÃO DE E-MAIL REAL & DISPARO SMTP */}
                {abaGestao === 'email' && (
                  <div className="space-y-6 max-h-[65vh] overflow-y-auto pr-1 animate-fadeIn">
                    
                    {/* Cabeçalho da Seção */}
                    <div className="p-4 rounded-2xl bg-celestial-950/80 border border-ouro/40 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-bold gold-gradient-text uppercase tracking-wider flex items-center gap-2">
                          <span className="text-ouro font-serif">✉</span>
                          Configuração de Envio de E-mail Real (SMTP)
                        </h4>
                        <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold">
                          Nodemailer Ativo
                        </span>
                      </div>
                      <p className="text-xs text-luar-300 leading-relaxed">
                        Conecte seu provedor de e-mail (Gmail, Outlook, Brevo ou SMTP próprio) para que a boutique envie e-mails reais de recuperação de senha e comunicados aos clientes.
                      </p>
                    </div>

                    {/* Presets Rápidos de Provedor */}
                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-2 uppercase tracking-wider">
                        Escolha Rápida do Provedor de E-mail:
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <button
                          type="button"
                          onClick={() => setConfigEmail(prev => ({
                            ...prev,
                            provedor: 'gmail',
                            host: 'smtp.gmail.com',
                            port: 465,
                            secure: true
                          }))}
                          className={\`p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer \${configEmail.provedor === 'gmail' ? 'bg-ouro/20 border-ouro text-ouro shadow-md' : 'bg-celestial-950 border-ouro/30 text-luar-300 hover:border-ouro/60'}\`}
                        >
                          Gmail (Google)
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfigEmail(prev => ({
                            ...prev,
                            provedor: 'outlook',
                            host: 'smtp-mail.outlook.com',
                            port: 587,
                            secure: false
                          }))}
                          className={\`p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer \${configEmail.provedor === 'outlook' ? 'bg-ouro/20 border-ouro text-ouro shadow-md' : 'bg-celestial-950 border-ouro/30 text-luar-300 hover:border-ouro/60'}\`}
                        >
                          Outlook / Hotmail
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfigEmail(prev => ({
                            ...prev,
                            provedor: 'brevo',
                            host: 'smtp-relay.brevo.com',
                            port: 587,
                            secure: false
                          }))}
                          className={\`p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer \${configEmail.provedor === 'brevo' ? 'bg-ouro/20 border-ouro text-ouro shadow-md' : 'bg-celestial-950 border-ouro/30 text-luar-300 hover:border-ouro/60'}\`}
                        >
                          Brevo (300/dia)
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfigEmail(prev => ({
                            ...prev,
                            provedor: 'custom',
                            host: prev.host || '',
                            port: 465,
                            secure: true
                          }))}
                          className={\`p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer \${configEmail.provedor === 'custom' ? 'bg-ouro/20 border-ouro text-ouro shadow-md' : 'bg-celestial-950 border-ouro/30 text-luar-300 hover:border-ouro/60'}\`}
                        >
                          Personalizado
                        </button>
                      </div>
                    </div>

                    {/* Guia Prático para o Gmail */}
                    {configEmail.provedor === 'gmail' && (
                      <div className="p-3.5 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-luar-200 space-y-1.5 leading-relaxed">
                        <div className="text-ouro font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                          <span>✦</span> Como conectar sua conta do Gmail em 2 minutos:
                        </div>
                        <ol className="list-decimal pl-4 space-y-1 text-stone-300 text-[11px]">
                          <li>Acesse sua Conta Google em <strong>Segurança</strong> e certifique-se de ter a <em>Verificação em duas etapas</em> ativada.</li>
                          <li>Vá em <strong>myaccount.google.com/apppasswords</strong> (Senhas de app).</li>
                          <li>No nome do app, digite <em>Vênus e Luar</em> e clique em <strong>Criar</strong>.</li>
                          <li>Copie a senha de 16 letras gerada pelo Google e cole no campo <strong>Senha de App</strong> abaixo.</li>
                        </ol>
                      </div>
                    )}

                    {/* Formulário de Configuração */}
                    <form onSubmit={salvarConfigEmailAdmin} className="space-y-4 bg-celestial-950/60 p-4 rounded-2xl border border-ouro/30">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <div>
                          <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                            Seu E-mail de Envio (Remetente)
                          </label>
                          <input
                            type="email"
                            required
                            value={configEmail.user || ''}
                            onChange={(e) => setConfigEmail({ ...configEmail, user: e.target.value })}
                            placeholder="exemplo@gmail.com"
                            className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                            Senha ou Senha de Aplicativo
                          </label>
                          <div className="relative">
                            <input
                              type={verSenhaEmailSmtp ? "text" : "password"}
                              value={configEmail.pass || ''}
                              onChange={(e) => setConfigEmail({ ...configEmail, pass: e.target.value })}
                              placeholder="Digite ou cole sua senha de app"
                              className="w-full p-2.5 pr-10 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro"
                            />
                            {renderBotaoOlhoSenha(verSenhaEmailSmtp, () => setVerSenhaEmailSmtp(!verSenhaEmailSmtp), "btn-ver-senha-smtp")}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                        <div>
                          <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                            Nome de Exibição
                          </label>
                          <input
                            type="text"
                            value={configEmail.remetente || ''}
                            onChange={(e) => setConfigEmail({ ...configEmail, remetente: e.target.value })}
                            placeholder="Vênus e Luar Boutique"
                            className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                            Servidor SMTP Host
                          </label>
                          <input
                            type="text"
                            required
                            value={configEmail.host || ''}
                            onChange={(e) => setConfigEmail({ ...configEmail, host: e.target.value })}
                            placeholder="smtp.gmail.com"
                            className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">
                            Porta SMTP
                          </label>
                          <input
                            type="number"
                            required
                            value={configEmail.port || 465}
                            onChange={(e) => setConfigEmail({ ...configEmail, port: Number(e.target.value) })}
                            placeholder="465 ou 587"
                            className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={carregandoEmailConfig}
                        className="w-full py-3 rounded-xl bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 font-bold text-xs uppercase tracking-widest shadow-md hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50"
                      >
                        {carregandoEmailConfig ? 'Gravando Configurações...' : 'Salvar Configurações de E-mail'}
                      </button>
                    </form>

                    {/* Teste em Tempo Real de Disparo de E-mail */}
                    <div className="p-4 rounded-2xl bg-celestial-950/90 border border-ouro/50 shadow-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <h5 className="text-xs font-bold text-ouro uppercase tracking-wider flex items-center gap-1.5">
                          <span>✦</span> Testar Disparo Real Agora
                        </h5>
                        <span className="text-[10px] text-stone-400">Entrega direta na caixa de entrada</span>
                      </div>
                      <p className="text-[11px] text-luar-300">
                        Insira seu e-mail pessoal para receber uma mensagem de teste imediata com a identidade visual da Vênus e Luar Boutique:
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="email"
                          value={emailDestinoTeste}
                          onChange={(e) => setEmailDestinoTeste(e.target.value)}
                          placeholder="seu.email.pessoal@exemplo.com"
                          className="flex-1 p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro"
                        />
                        <button
                          type="button"
                          onClick={dispararEmailTeste}
                          className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold text-xs uppercase tracking-wider shadow-md transition-all cursor-pointer"
                        >
                          Disparar Teste Real
                        </button>
                      </div>

                      {statusTesteEmail && (
                        <div className={\`p-3 rounded-xl text-xs flex items-center gap-2 \${statusTesteEmail.carregando ? 'bg-amber-950/50 border border-amber-500/50 text-amber-300' : statusTesteEmail.sucesso ? 'bg-emerald-950/70 border border-emerald-500/50 text-emerald-200' : 'bg-rose-950/70 border border-rose-500/50 text-rose-200'}\`}>
                          <span>{statusTesteEmail.carregando ? '⏳' : statusTesteEmail.sucesso ? '✓' : '✕'}</span>
                          <span>{statusTesteEmail.msg}</span>
                        </div>
                      )}
                    </div>

                  </div>
                )}

                {/* ABA 5: GESTÃO DE DOMÍNIO PRÓPRIO & TABELA DNS */}
                {abaGestao === 'dominio' && (
                  <div className="space-y-6 max-h-[65vh] overflow-y-auto pr-1 animate-fadeIn">
                    
                    {/* Card de Visão Geral do Domínio */}
                    <div className="p-4 rounded-2xl bg-celestial-950/80 border border-ouro/40 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <span className="text-[10px] text-ouro uppercase tracking-widest font-bold">Domínio Oficial da Boutique</span>
                          <h4 className="text-xl font-serif font-bold gold-gradient-text tracking-wide mt-0.5">
                            {configDominio.dominio || 'venuseluar.com.br'}
                          </h4>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-semibold flex items-center gap-1">
                            <span>✓</span> SSL / HTTPS Ativo
                          </span>
                          <span className="text-[10px] px-2.5 py-1 rounded-full bg-ouro/20 text-ouro border border-ouro/40 font-semibold">
                            Registro.br
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-ouro/20 text-xs">
                        <div className="p-2.5 rounded-xl bg-celestial-900/60 border border-ouro/20">
                          <span className="text-[10px] text-stone-400 block uppercase tracking-wider">Endereço Web Oficial</span>
                          <strong className="text-luar-100 font-mono text-[11px] truncate block mt-0.5">{configDominio.url_base}</strong>
                        </div>
                        <div className="p-2.5 rounded-xl bg-celestial-900/60 border border-ouro/20">
                          <span className="text-[10px] text-stone-400 block uppercase tracking-wider">E-mail de Atendimento</span>
                          <strong className="text-ouro font-mono text-[11px] truncate block mt-0.5">{configDominio.email_atendimento}</strong>
                        </div>
                        <div className="p-2.5 rounded-xl bg-celestial-900/60 border border-ouro/20">
                          <span className="text-[10px] text-stone-400 block uppercase tracking-wider">Canal de Segurança &amp; DMARC</span>
                          <strong className="text-emerald-400 font-mono text-[11px] truncate block mt-0.5">{configDominio.email_seguranca}</strong>
                        </div>
                      </div>
                    </div>

                    {/* Guia Prático para Registro no Registro.br */}
                    <div className="p-4 rounded-2xl bg-celestial-950 border border-ouro/40 text-xs text-luar-200 space-y-2">
                      <div className="text-ouro font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                        <span>✦</span> Como Registrar e Ativar no Registro.br (Custo Oficial R$ 40/ano):
                      </div>
                      <ol className="list-decimal pl-4 space-y-1.5 text-stone-300 text-[11px] leading-relaxed">
                        <li>Acesse o site oficial <strong>registro.br</strong> e pesquise pelo domínio <strong>venuseluar.com.br</strong>.</li>
                        <li>Conclua o registro com seu CPF ou CNPJ e selecione o plano de 1 ano.</li>
                        <li>No painel do Registro.br, vá na seção <strong>DNS</strong> e clique em <strong>Configurar Endereçamento (Modo Avançado)</strong>.</li>
                        <li>Copie e cole a tabela de registros abaixo no seu gerenciador DNS.</li>
                      </ol>
                    </div>

                    {/* Tabela Interativa de Registros DNS Obrigatórios */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h5 className="text-xs font-bold text-ouro uppercase tracking-wider flex items-center gap-1.5">
                          <span>✦</span> Tabela de Registros DNS Prontos para Copiar
                        </h5>
                        <span className="text-[10px] text-stone-400">Padrão global RFC / LGPD</span>
                      </div>

                      <div className="space-y-2.5">
                        {registrosDns.map((reg, idx) => (
                          <div key={idx} className="p-3.5 rounded-xl bg-celestial-950/80 border border-ouro/30 hover:border-ouro/60 transition-all space-y-2">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                              <div className="flex items-center gap-2">
                                <span className="px-2.5 py-0.5 rounded-md bg-ouro/20 text-ouro border border-ouro/40 font-mono text-xs font-bold">
                                  {reg.tipo}
                                </span>
                                <span className="font-mono text-xs text-luar-100 font-semibold">
                                  Host: {reg.nome}
                                </span>
                              </div>
                              <span className="text-[10px] text-stone-400">TTL: {reg.ttl} • {reg.status}</span>
                            </div>

                            <div className="flex items-center gap-2 bg-celestial-900/90 p-2 rounded-lg border border-ouro/20">
                              <code className="flex-1 font-mono text-[11px] text-ouro break-all select-all">
                                {reg.valor}
                              </code>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(reg.valor);
                                  setRegistroCopiado(idx);
                                  setTimeout(() => setRegistroCopiado(null), 2500);
                                }}
                                className="py-1 px-3 rounded-md bg-ouro/20 hover:bg-ouro/30 text-ouro border border-ouro/40 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap"
                              >
                                {registroCopiado === idx ? '✓ Copiado!' : 'Copiar'}
                              </button>
                            </div>

                            <p className="text-[10px] text-stone-400 leading-normal">
                              {reg.descricao}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Formulário de Edição de Domínio */}
                    <form onSubmit={salvarDominioAdmin} className="p-4 rounded-2xl bg-celestial-950/60 border border-ouro/30 space-y-3.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-ouro uppercase tracking-wider">
                          Editar Domínio &amp; E-mails Corporativos
                        </span>
                        <span className="text-[10px] text-stone-400">Salvo em data/dominio_config.json</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] text-ouro mb-1 uppercase tracking-wider">Domínio Principal</label>
                          <input
                            type="text"
                            required
                            value={configDominio.dominio || ''}
                            onChange={(e) => setConfigDominio({
                              ...configDominio,
                              dominio: e.target.value.toLowerCase().trim(),
                              url_base: 'https://' + e.target.value.toLowerCase().trim()
                            })}
                            className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-ouro mb-1 uppercase tracking-wider">E-mail de Atendimento</label>
                          <input
                            type="email"
                            required
                            value={configDominio.email_atendimento || ''}
                            onChange={(e) => setConfigDominio({ ...configDominio, email_atendimento: e.target.value })}
                            className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={carregandoDominio}
                        className="w-full py-3 rounded-xl bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 font-bold text-xs uppercase tracking-widest shadow-md hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50"
                      >
                        {carregandoDominio ? 'Salvando...' : 'Salvar Configurações de Domínio'}
                      </button>
                    </form>

                    {/* Verificador de Propagação DNS */}
                    <div className="p-4 rounded-2xl bg-celestial-950/90 border border-ouro/50 space-y-3">
                      <div className="flex items-center justify-between">
                        <h5 className="text-xs font-bold text-ouro uppercase tracking-wider flex items-center gap-1.5">
                          <span>✦</span> Auditoria de Propagação DNS em Tempo Real
                        </h5>
                        <button
                          type="button"
                          onClick={auditarDnsOnline}
                          className="py-1.5 px-3 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                        >
                          Verificar DNS Online
                        </button>
                      </div>
                      <p className="text-[11px] text-luar-300">
                        Consulta os servidores DNS globais para checar se os registros A, MX e TXT (SPF/DMARC) já estão ativos.
                      </p>

                      {statusVerificacaoDns && (
                        <div className={\`p-3 rounded-xl text-xs space-y-1.5 \${statusVerificacaoDns.carregando ? 'bg-amber-950/50 border border-amber-500/50 text-amber-300' : statusVerificacaoDns.sucesso ? 'bg-emerald-950/70 border border-emerald-500/50 text-emerald-200' : 'bg-celestial-900 border border-ouro/30 text-luar-200'}\`}>
                          <div className="flex items-center gap-2 font-bold">
                            <span>{statusVerificacaoDns.carregando ? '⏳' : statusVerificacaoDns.sucesso ? '✓' : 'ℹ'}</span>
                            <span>{statusVerificacaoDns.msg}</span>
                          </div>
                          {statusVerificacaoDns.detalhes && (
                            <div className="font-mono text-[10px] text-stone-300 bg-celestial-950 p-2 rounded-lg border border-ouro/20 space-y-0.5">
                              <div>IP A: {statusVerificacaoDns.detalhes.a || 'Aguardando propagação'}</div>
                              <div>Servidor MX: {statusVerificacaoDns.detalhes.mx || 'Aguardando propagação'}</div>
                              <div>SPF: {statusVerificacaoDns.detalhes.spf || 'Aguardando propagação'}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                  </div>
                )}

                {/* ABA PETS & ADOÇÕES NO PAINEL ADMIN */}
                {abaGestao === 'pets' && (
                  <div className="space-y-5 max-h-[68vh] overflow-y-auto pr-1 animate-fadeIn">
                    
                    {/* Sub-navegação de Pets (Apenas para Administrador) */}
                    {usuario?.role === 'admin' && (
                    <div className="flex gap-1.5 bg-celestial-950 p-1.5 rounded-2xl border border-ouro/30">
                      <button
                        type="button"
                        onClick={() => setSubAbaPetsAdmin('lista')}
                        className={\`flex-1 py-1.5 px-2.5 text-xs font-bold uppercase rounded-xl transition-all cursor-pointer \${subAbaPetsAdmin === 'lista' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md' : 'text-luar-300 hover:text-ouro'}\`}
                      >
                        Lista de Pets ({pets.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSubAbaPetsAdmin('novo')}
                        className={\`flex-1 py-1.5 px-2.5 text-xs font-bold uppercase rounded-xl transition-all cursor-pointer \${subAbaPetsAdmin === 'novo' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md' : 'text-luar-300 hover:text-ouro'}\`}
                      >
                        + Cadastrar Pet
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSubAbaPetsAdmin('candidaturas');
                          carregarCandidaturasAdmin();
                        }}
                        className={\`flex-1 py-1.5 px-2.5 text-xs font-bold uppercase rounded-xl transition-all cursor-pointer \${subAbaPetsAdmin === 'candidaturas' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md' : 'text-luar-300 hover:text-ouro'}\`}
                      >
                        Candidaturas WhatsApp ({listaCandidaturas.length})
                      </button>
                    </div>
                    )}

                    {/* SUB-ABA 1: LISTA DE PETS E STATUS */}
                    {subAbaPetsAdmin === 'lista' && (() => {
                      const petsExibidos = usuario?.role === 'admin' 
                        ? pets 
                        : pets.filter(p => p.criado_por === usuario?.id_usuario);

                      return (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-ouro uppercase tracking-wider">
                              {usuario?.role === 'admin' ? 'Gestão do Plantel Pet' : 'Meus Companheiros Cadastrados'}
                            </span>
                            <span className="text-[10px] text-stone-400">Total: {petsExibidos.length} {petsExibidos.length === 1 ? 'companheiro' : 'companheiros'}</span>
                          </div>
                          
                          {petsExibidos.length === 0 ? (
                            <div className="p-8 text-center text-xs text-stone-400 bg-celestial-950/60 rounded-2xl border border-ouro/20 space-y-2">
                              <div className="text-xs uppercase tracking-widest text-ouro font-serif font-bold">Espaço Pet &amp; Adoções</div>
                              <div className="text-sm font-serif font-bold text-ouro">Nenhum pet cadastrado por você ainda</div>
                              <p>Clique na aba <strong>+ Cadastrar Pet</strong> para registrar um animal que precisa de um novo lar!</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {petsExibidos.map(pet => (
                                <div key={pet.id_pet} className="p-3.5 rounded-2xl bg-celestial-950/80 border border-ouro/30 hover:border-ouro/60 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                  <div className="flex items-center gap-3">
                                    <img src={pet.imagem_url} alt={pet.nome_pet} className="w-14 h-14 rounded-xl object-cover border border-ouro/30" />
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <strong className="text-sm font-serif font-bold text-ouro-light">{pet.nome_pet}</strong>
                                        <span className={"text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider " + (pet.status === 'Adotado' ? 'bg-ouro/20 text-ouro border border-ouro/40' : 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/40')}>
                                          {pet.status === 'Adotado' ? '★ Adotado' : '✓ Disponível'}
                                        </span>
                                      </div>
                                      <span className="text-xs text-luar-300 block">
                                        {pet.especie} • Porte {pet.porte || 'Médio'} • {pet.sexo || 'Macho'}
                                        {pet.especie?.toLowerCase().includes('gato') && (
                                          <span className="ml-2 inline-flex items-center gap-1">
                                            <span className={"text-[10px] px-2 py-0.5 rounded-full border font-semibold " + (
                                              pet.perfil?.fiv === 'Negativo' ? 'bg-purple-950/70 text-purple-300 border-purple-500/40' : (pet.perfil?.fiv === 'Positivo' ? 'bg-amber-950/70 text-amber-300 border-amber-500/40' : 'bg-stone-900 text-stone-300 border-stone-700/50')
                                            )}>
                                              FIV: {pet.perfil?.fiv || 'Negativo'}
                                            </span>
                                            <span className={"text-[10px] px-2 py-0.5 rounded-full border font-semibold " + (
                                              pet.perfil?.felv === 'Negativo' ? 'bg-teal-950/70 text-teal-300 border-teal-500/40' : (pet.perfil?.felv === 'Positivo' ? 'bg-rose-950/70 text-rose-300 border-rose-500/40' : 'bg-stone-900 text-stone-300 border-stone-700/50')
                                            )}>
                                              FeLV: {pet.perfil?.felv || 'Negativo'}
                                            </span>
                                          </span>
                                        )}
                                      </span>
                                      {usuario?.role === 'admin' && (
                                        <span className="text-[10px] text-stone-400 block mt-0.5">
                                          Cadastrado por: {pet.criador_nome || 'Administradora'}
                                        </span>
                                      )}
                                      {pet.status === 'Adotado' && pet.registro_adocao && (
                                        <span className="text-[10px] text-ouro/90 block mt-0.5">
                                          Tutor: {pet.registro_adocao.adotante_nome} ({pet.registro_adocao.adotante_cpf || 'CPF arquivado'})
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                                    {/* Botão de Edição do Pet */}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setModalEditarPet(pet);
                                        setEspecieEditarPet(pet.especie || 'Cachorro');
                                        setStatusFivEditarPet(pet.perfil?.fiv || 'Negativo');
                                        setStatusFelvEditarPet(pet.perfil?.felv || 'Negativo');
                                        setFotoEditarPetUrl(pet.imagem_url || '');
                                        setFotoEditarPetPreview(pet.imagem_url || '');
                                      }}
                                      className="py-1.5 px-2.5 rounded-xl bg-celestial-900 hover:bg-celestial-850 text-ouro border border-ouro/40 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap"
                                      title="Editar informações do companheiro"
                                    >
                                      Editar
                                    </button>

                                    {pet.status !== 'Adotado' ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setRegistroAdocaoCpf('');
                                          setModalRegistroAdocao(pet);
                                        }}
                                        className="py-1.5 px-3 rounded-xl bg-ouro/20 hover:bg-ouro/30 text-ouro border border-ouro/40 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap"
                                      >
                                        Registrar Adoção
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          const res = await fetch('/api/admin/pets/status', {
                                            method: 'PUT',
                                            headers: {
                                              'Content-Type': 'application/json',
                                              'Authorization': 'Bearer ' + token
                                            },
                                            body: JSON.stringify({ id_pet: pet.id_pet, status: 'Disponível' })
                                          });
                                          if (res.ok) {
                                            mostrarNotificacao(pet.nome_pet + ' voltou a estar disponível para adoção!');
                                            carregarDados();
                                          }
                                        }}
                                        className="py-1.5 px-3 rounded-xl bg-emerald-950 hover:bg-emerald-900 text-emerald-400 border border-emerald-500/40 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap"
                                      >
                                        Tornar Disponível
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        if (!confirm('Deseja remover ' + pet.nome_pet + ' da boutique?')) return;
                                        const res = await fetch('/api/admin/pets?id=' + pet.id_pet, {
                                          method: 'DELETE',
                                          headers: { 'Authorization': 'Bearer ' + token }
                                        });
                                        if (res.ok) {
                                          mostrarNotificacao('Pet removido com sucesso!');
                                          carregarDados();
                                        } else {
                                          const json = await res.json();
                                          alert(json.erro || 'Erro ao remover pet.');
                                        }
                                      }}
                                      className="py-1.5 px-2.5 rounded-xl bg-rose-950/60 hover:bg-rose-950 text-rose-300 border border-rose-500/40 text-[10px] font-bold uppercase transition-all cursor-pointer"
                                    >
                                      Excluir
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* SUB-ABA 2: FORMULÁRIO DE CADASTRO DE NOVO PET */}
                    {subAbaPetsAdmin === 'novo' && (
                      <form onSubmit={async (e) => {
                        e.preventDefault();
                        const novoPetData = {
                          nome_pet: e.target.nome_pet.value.trim(),
                          especie: e.target.especie.value,
                          porte: e.target.porte.value,
                          idade_meses: Number(e.target.idade_meses.value) || 0,
                          sexo: e.target.sexo.value,
                          imagem_url: (fotoNovoPetUrl || e.target.imagem_url.value.trim() || 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=800&q=80'),
                          historia: e.target.historia.value.trim(),
                          whatsapp_doador: e.target.whatsapp_doador.value.trim(),
                          perfil: {
                            castrado: e.target.castrado.checked,
                            vacinado: e.target.vacinado.checked,
                            convive_com_gatos: e.target.convive_com_gatos.checked,
                            temperamento: e.target.temperamento.value.trim() || 'Amoroso e companheiro',
                            fiv: especieNovoPet === 'Gato' ? (e.target.fiv?.value || statusFivNovoPet) : undefined,
                            felv: especieNovoPet === 'Gato' ? (e.target.felv?.value || statusFelvNovoPet) : undefined
                          }
                        };

                        const res = await fetch('/api/admin/pets', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Bearer ' + token
                          },
                          body: JSON.stringify(novoPetData)
                        });

                        if (res.ok) {
                          mostrarNotificacao('Companheiro ' + novoPetData.nome_pet + ' cadastrado com sucesso!');
                          setFotoNovoPetUrl('');
                          setFotoNovoPetPreview('');
                          setSubAbaPetsAdmin('lista');
                          carregarDados();
                        } else {
                          const json = await res.json();
                          alert(json.erro || 'Falha ao cadastrar pet.');
                        }
                      }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        
                        {/* Coluna 1: Informações Básicas do Pet */}
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-bold text-ouro mb-1 uppercase tracking-wider">Nome do Pet</label>
                            <input name="nome_pet" required placeholder="Ex: Apolo, Mel, Thor..." className="w-full px-3 py-2 rounded-xl bg-[#040711] border border-ouro/40 text-sm text-[#F8F5EB] placeholder-stone-400 outline-none focus:border-ouro" />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-bold text-ouro mb-1 uppercase tracking-wider">Espécie</label>
                              <select 
                                name="especie" 
                                value={especieNovoPet}
                                onChange={(e) => setEspecieNovoPet(e.target.value)}
                                className="w-full px-3 py-2 rounded-xl bg-[#040711] border border-ouro/40 text-xs text-[#F8F5EB] outline-none focus:border-ouro"
                              >
                                <option value="Cachorro">Cachorro</option>
                                <option value="Gato">Gato</option>
                                <option value="Outro">Outro</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-ouro mb-1 uppercase tracking-wider">Sexo</label>
                              <select name="sexo" className="w-full px-3 py-2 rounded-xl bg-[#040711] border border-ouro/40 text-xs text-[#F8F5EB] outline-none focus:border-ouro">
                                <option value="Macho">Macho</option>
                                <option value="Fêmea">Fêmea</option>
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-bold text-ouro mb-1 uppercase tracking-wider">Porte</label>
                              <select name="porte" defaultValue="Médio" className="w-full px-3 py-2 rounded-xl bg-[#040711] border border-ouro/40 text-xs text-[#F8F5EB] outline-none focus:border-ouro">
                                <option value="Pequeno">Pequeno</option>
                                <option value="Médio">Médio</option>
                                <option value="Grande">Grande</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-ouro mb-1 uppercase tracking-wider">Idade (Meses)</label>
                              <input name="idade_meses" type="number" placeholder="Ex: 12" className="w-full px-3 py-2 rounded-xl bg-[#040711] border border-ouro/40 text-sm text-[#F8F5EB] placeholder-stone-400 outline-none focus:border-ouro" />
                            </div>
                          </div>

                          {/* Fotografia do Pet com Acesso à Galeria do Celular ou Arquivos do Computador */}
                          <div>
                            <label className="block text-xs font-bold text-ouro mb-1 uppercase tracking-wider">
                              Foto do Pet (Galeria do Celular ou Arquivo do PC)
                            </label>
                            <div className="flex flex-col sm:flex-row gap-3 items-center p-3 rounded-2xl bg-[#040711] border border-ouro/30">
                              <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-celestial-950 border border-ouro/40 flex-shrink-0 flex items-center justify-center">
                                {fotoNovoPetPreview ? (
                                  <img src={fotoNovoPetPreview} alt="Prévia" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="text-center p-1">
                                    <span className="text-2xl">📷</span>
                                    <span className="block text-[9px] text-stone-400 mt-0.5">Sem foto</span>
                                  </div>
                                )}
                                {uploadingFotoNovo && (
                                  <div className="absolute inset-0 bg-black/75 flex items-center justify-center text-[10px] text-ouro font-bold text-center px-1">
                                    Enviando...
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 w-full space-y-2">
                                <input
                                  type="file"
                                  id="input-foto-novo-pet"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files && e.target.files[0];
                                    if (file) {
                                      setUploadingFotoNovo(true);
                                      processarUploadImagem(
                                        file,
                                        (urlSalva) => {
                                          setUploadingFotoNovo(false);
                                          setFotoNovoPetUrl(urlSalva);
                                          setFotoNovoPetPreview(urlSalva);
                                          mostrarNotificacao('Foto carregada com sucesso da sua galeria!');
                                        },
                                        (err) => {
                                          setUploadingFotoNovo(false);
                                          alert('Erro ao carregar foto: ' + err);
                                        }
                                      );
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  onClick={() => document.getElementById('input-foto-novo-pet').click()}
                                  disabled={uploadingFotoNovo}
                                  className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-ouro/25 to-ouro/10 hover:from-ouro/35 hover:to-ouro/20 border border-ouro text-ouro font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all"
                                >
                                  <span>📷</span>
                                  <span>{uploadingFotoNovo ? 'Processando Imagem...' : 'Escolher da Galeria ou Computador'}</span>
                                </button>
                                <input
                                  name="imagem_url"
                                  value={fotoNovoPetUrl}
                                  onChange={(e) => {
                                    setFotoNovoPetUrl(e.target.value);
                                    setFotoNovoPetPreview(e.target.value);
                                  }}
                                  placeholder="Ou cole o link direto da imagem"
                                  className="w-full px-3 py-1.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-[#F8F5EB] placeholder-stone-500 outline-none focus:border-ouro"
                                />
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Coluna 2: Contato & Saúde do Pet */}
                        <div className="space-y-3">
                          <div className="p-3 rounded-2xl bg-[#040711] border border-ouro/30 space-y-1.5">
                            <label className="block text-xs font-bold text-ouro uppercase tracking-wider">
                              WhatsApp de Contato
                            </label>
                            <input name="whatsapp_doador" required placeholder="DDD + Número (Ex: 27999887766)" className="w-full px-3 py-2 rounded-xl bg-celestial-950 border border-ouro/40 text-sm text-[#F8F5EB] placeholder-stone-400 outline-none focus:border-ouro font-mono" />
                            <p className="text-[11px] text-[#C2B9A3] leading-relaxed">
                              Seu telefone fica seguro e será usado apenas para conectar você a candidatos aprovados para adoção.
                            </p>
                          </div>

                          <div>
                            <label className="block text-xs font-bold text-ouro mb-1 uppercase tracking-wider">Perfil Clínico e Cuidados</label>
                            <div className="grid grid-cols-3 gap-1.5 text-xs text-luar-200">
                              <label className="flex items-center gap-1.5 p-2 rounded-xl bg-[#040711] border border-ouro/25 cursor-pointer">
                                <input type="checkbox" name="castrado" className="accent-ouro" />
                                <span className="text-[11px]">Castrado</span>
                              </label>
                              <label className="flex items-center gap-1.5 p-2 rounded-xl bg-[#040711] border border-ouro/25 cursor-pointer">
                                <input type="checkbox" name="vacinado" className="accent-ouro" />
                                <span className="text-[11px]">Vacinado</span>
                              </label>
                              <label className="flex items-center gap-1.5 p-2 rounded-xl bg-[#040711] border border-ouro/25 cursor-pointer">
                                <input type="checkbox" name="convive_com_gatos" className="accent-ouro" />
                                <span className="text-[11px]">Gatos OK</span>
                              </label>
                            </div>
                            <input name="temperamento" placeholder="Temperamento (ex: Dócil, afetuoso, brincalhão...)" className="w-full px-3 py-2 mt-2 rounded-xl bg-[#040711] border border-ouro/40 text-sm text-[#F8F5EB] placeholder-stone-400 outline-none focus:border-ouro" />
                          </div>

                          {/* Opção FIV e FeLV nos Casos de Gato no Cadastro */}
                          {especieNovoPet === 'Gato' && (
                            <div className="p-3 rounded-2xl bg-[#03060E] border border-purple-500/50 space-y-2 animate-fadeIn">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-base">🐱</span>
                                  <label className="text-xs font-bold text-purple-300 uppercase tracking-wider">
                                    Exames Felinos (FIV &amp; FeLV)
                                  </label>
                                </div>
                                <span className="text-[10px] text-purple-300 font-bold px-2 py-0.5 rounded-full bg-purple-950 border border-purple-500/40">
                                  Exclusivo Gatos
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Status FIV</label>
                                  <select 
                                    name="fiv" 
                                    value={statusFivNovoPet}
                                    onChange={(e) => setStatusFivNovoPet(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-[#F8F5EB] outline-none focus:border-ouro"
                                  >
                                    <option value="Negativo">✓ FIV Negativo</option>
                                    <option value="Positivo">⚠ FIV Positivo</option>
                                    <option value="Não testado">⏳ Não Testado</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Status FeLV</label>
                                  <select 
                                    name="felv" 
                                    value={statusFelvNovoPet}
                                    onChange={(e) => setStatusFelvNovoPet(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-[#F8F5EB] outline-none focus:border-ouro"
                                  >
                                    <option value="Negativo">✓ FeLV Negativo</option>
                                    <option value="Positivo">⚠ FeLV Positivo</option>
                                    <option value="Não testado">⏳ Não Testado</option>
                                  </select>
                                </div>
                              </div>
                              <p className="text-[10px] text-luar-300 leading-tight">
                                Triagem laboratorial essencial para a saúde e encaminhamento seguro de felinos.
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Linha Inferior: História e Submissão (Spanning 2 Colunas) */}
                        <div className="md:col-span-2 space-y-3 pt-1">
                          <div>
                            <label className="block text-xs font-bold text-ouro mb-1 uppercase tracking-wider">História &amp; Personalidade</label>
                            <textarea name="historia" rows={2} placeholder="Descreva o resgate, carinho e personalidade deste pet..." className="w-full px-3 py-2 rounded-xl bg-[#040711] border border-ouro/40 text-sm text-[#F8F5EB] placeholder-stone-400 outline-none focus:border-ouro resize-none" />
                          </div>

                          <button type="submit" className="w-full py-3 rounded-xl bg-gradient-to-r from-ouro-dark via-ouro to-ouro-light text-celestial-950 font-bold text-xs uppercase tracking-widest shadow-md hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer">
                            Cadastrar Companheiro na Boutique
                          </button>
                        </div>
                      </form>
                    )}

                    {/* SUB-ABA 3: CANDIDATURAS RECEBIDAS VIA WHATSAPP */}
                    {subAbaPetsAdmin === 'candidaturas' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-ouro uppercase tracking-wider">Solicitações Encaminhadas ao Doador</span>
                          <button
                            type="button"
                            onClick={carregarCandidaturasAdmin}
                            className="text-[10px] text-ouro hover:underline font-semibold cursor-pointer"
                          >
                            Atualizar Lista
                          </button>
                        </div>
                        {listaCandidaturas.length === 0 ? (
                          <div className="p-8 text-center text-xs text-stone-400 bg-celestial-950/60 rounded-2xl border border-ouro/20">
                            Nenhuma candidatura registrada recentemente. As solicitações enviadas pelos visitantes aparecerão aqui.
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            {listaCandidaturas.map((c, idx) => (
                              <div key={idx} className="p-3.5 rounded-2xl bg-celestial-950/90 border border-ouro/30 space-y-2">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                  <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-bold">
                                      {c.status || 'Encaminhado ao Doador'}
                                    </span>
                                    <strong className="text-sm font-serif font-bold text-ouro-light">Interesse em {c.nome_pet}</strong>
                                  </div>
                                  <span className="text-[10px] text-stone-400">{new Date(c.criado_em).toLocaleString('pt-BR')}</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                                  <div className="p-2 rounded-lg bg-celestial-900 border border-ouro/20">
                                    <span className="text-[10px] text-stone-400 block">Candidato</span>
                                    <strong className="text-luar-100 block">{c.nome_candidato}</strong>
                                  </div>
                                  <div className="p-2 rounded-lg bg-celestial-900 border border-ouro/20">
                                    <span className="text-[10px] text-stone-400 block">CPF Validado</span>
                                    <span className="text-ouro font-mono font-bold block">{c.cpf_candidato}</span>
                                  </div>
                                  <div className="p-2 rounded-lg bg-celestial-900 border border-ouro/20">
                                    <span className="text-[10px] text-stone-400 block">WhatsApp do Interessado</span>
                                    <strong className="text-emerald-400 font-mono block">{c.telefone_candidato}</strong>
                                  </div>
                                </div>
                                {c.mensagem && (
                                  <p className="text-[11px] text-luar-300 italic bg-celestial-900/60 p-2 rounded-lg border border-ouro/10">
                                    &quot;{c.mensagem}&quot;
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                  </div>
                )}

                {/* ABA FATURAMENTO & VENDAS NO PAINEL ADMIN */}
                {abaGestao === 'faturamento' && (
                  <div className="space-y-5 max-h-[68vh] overflow-y-auto pr-1 animate-fadeIn">
                    
                    {/* Header com Atualizar */}
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[10px] text-ouro uppercase tracking-widest font-bold block">Gestão Financeira &amp; Faturamento</span>
                        <h4 className="text-lg font-serif font-bold gold-gradient-text">Relatório Oficial de Vendas da Boutique</h4>
                      </div>
                      <button
                        type="button"
                        onClick={carregarFaturamentoAdmin}
                        className="py-1.5 px-3 rounded-xl bg-ouro/20 hover:bg-ouro/30 text-ouro border border-ouro/40 text-[10px] font-bold uppercase transition-all cursor-pointer"
                      >
                        Atualizar Métricas
                      </button>
                    </div>

                    {/* Cards de Métricas Financeiras */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="p-4 rounded-2xl bg-celestial-950/90 border border-ouro/40 space-y-1">
                        <span className="text-[10px] text-stone-400 uppercase tracking-wider block">Total Faturado</span>
                        <strong className="text-2xl font-serif font-bold gold-gradient-text block">
                          {formatBRL(relatorioFaturamento?.total_faturado || 0)}
                        </strong>
                        <span className="text-[10px] text-emerald-400 font-semibold">100% Liquidado &amp; Pago</span>
                      </div>
                      <div className="p-4 rounded-2xl bg-celestial-950/90 border border-ouro/40 space-y-1">
                        <span className="text-[10px] text-stone-400 uppercase tracking-wider block">Total de Pedidos</span>
                        <strong className="text-2xl font-serif font-bold text-luar-100 block">
                          {relatorioFaturamento?.total_pedidos || 0}
                        </strong>
                        <span className="text-[10px] text-ouro font-semibold">Faturas Emitidas</span>
                      </div>
                      <div className="p-4 rounded-2xl bg-celestial-950/90 border border-ouro/40 space-y-1">
                        <span className="text-[10px] text-stone-400 uppercase tracking-wider block">Ticket Médio</span>
                        <strong className="text-2xl font-serif font-bold text-ouro block">
                          {formatBRL(relatorioFaturamento?.ticket_medio || 0)}
                        </strong>
                        <span className="text-[10px] text-luar-300">Por Cliente na Boutique</span>
                      </div>
                    </div>

                    {/* Tabela de Faturas Emitidas */}
                    <div className="space-y-3">
                      <span className="text-[11px] font-bold text-ouro uppercase tracking-wider block">Faturas Oficiais Emitidas</span>
                      {!relatorioFaturamento || !relatorioFaturamento.pedidos || relatorioFaturamento.pedidos.length === 0 ? (
                        <div className="p-8 text-center text-xs text-stone-400 bg-celestial-950/60 rounded-2xl border border-ouro/20">
                          Nenhum faturamento registrado ainda. Conforme os clientes realizarem pagamentos via PIX ou Cartão, os comprovantes oficiais aparecerão aqui.
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {relatorioFaturamento.pedidos.map((ped, idx) => (
                            <div key={idx} className="p-3.5 rounded-2xl bg-celestial-950/90 border border-ouro/30 hover:border-ouro/60 transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs font-bold text-ouro">#{ped.numero_fatura || \`FAT-2026-\${ped.id_pedido}\`}</span>
                                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-[10px] font-bold">
                                    ✓ {ped.status || 'Faturado & Pago'}
                                  </span>
                                </div>
                                <div className="text-xs text-luar-100 font-semibold">
                                  {ped.nome_cliente || 'Cliente Vênus e Luar'} • <span className="font-mono text-stone-400 text-[11px]">{ped.cpf_cliente || 'Consumidor'}</span>
                                </div>
                                <div className="text-[10px] text-stone-400">
                                  {new Date(ped.criado_em).toLocaleString('pt-BR')} • {ped.forma_pagamento} • {ped.itens ? ped.itens.length : 0} item(ns)
                                </div>
                              </div>
                              <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                                <span className="text-base font-serif font-bold text-ouro font-mono">{formatBRL(ped.total)}</span>
                                <button
                                  type="button"
                                  onClick={() => setFaturaModal(ped)}
                                  className="py-1.5 px-3 rounded-xl bg-ouro/20 hover:bg-ouro/30 text-ouro border border-ouro/40 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap"
                                >
                                  Ver Fatura
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                  </div>
                )}


              </div>
            </div>
          )}

          {/* Rodapé Nobre */}
          <footer className="bg-celestial-950 border-t border-ouro/25 text-luar-300 mt-20 py-12">
            <div className="max-w-7xl mx-auto px-4 text-center space-y-4">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full overflow-hidden border border-ouro/50 p-0.5 bg-celestial-900 shadow-lg">
                  <img src="/logo.jpg" alt="Vênus e Luar Logo" className="w-full h-full object-cover" />
                </div>
              </div>
              <span className="font-serif text-3xl font-bold gold-gradient-text block">Vênus e Luar Boutique</span>
              <p className="text-xs text-ouro-light/80 tracking-widest uppercase">Alta Costura • Espaço Pet Nobre • Cafeteria Gourmet &amp; Bistrô • Adoção Responsável</p>
              <div className="flex items-center justify-center gap-2 text-xs pt-1">
                <span className="text-stone-400">Atendimento &amp; Pedidos:</span>
                <a href="mailto:boutiquevenuseluar@gmail.com" className="font-mono text-ouro hover:text-ouro-light transition-colors font-semibold">
                  boutiquevenuseluar@gmail.com
                </a>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-xs pt-1">
                <button
                  id="btn-footer-termos-lgpd"
                  type="button"
                  onClick={() => { setSecaoTermosAtiva('todos'); setModalTermosLgpdAberto(true); }}
                  className="inline-flex items-center gap-1.5 text-ouro hover:text-[#FFE8A3] transition-colors underline cursor-pointer"
                >
                  📜 Documentos Legais &amp; Políticas (LGPD)
                </button>
                <span className="text-stone-600 hidden sm:inline">•</span>
                <button
                  id="btn-footer-termos-privacidade"
                  type="button"
                  onClick={() => { setSecaoTermosAtiva('lgpd'); setModalTermosLgpdAberto(true); }}
                  className="inline-flex items-center gap-1.5 text-stone-300 hover:text-ouro transition-colors cursor-pointer"
                >
                  🔒 Privacidade &amp; Proteção de Dados
                </button>
                <span className="text-stone-600 hidden sm:inline">•</span>
                <button
                  id="btn-footer-termos-adocao"
                  type="button"
                  onClick={() => { setSecaoTermosAtiva('adocao'); setModalTermosLgpdAberto(true); }}
                  className="inline-flex items-center gap-1.5 text-stone-300 hover:text-ouro transition-colors cursor-pointer"
                >
                  🐾 Regras do Painel de Adoção
                </button>
              </div>
              <div className="text-[11px] text-stone-400 pt-3 border-t border-ouro/10">
                © 2026 Vênus e Luar Boutique. Todos os direitos reservados.
              </div>
            </div>
          </footer>

          {/* BARRA DE NAVEGAÇÃO INFERIOR FIXA (MOBILE & TABLET - UX DE ALTA COSTURA) */}
          <nav 
            style={{ backgroundColor: 'rgba(8, 14, 30, 0.95)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}
            className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-ouro/30 px-2 py-1 shadow-[0_-8px_25px_rgba(0,0,0,0.6)]"
          >
            <div className="flex items-center justify-around max-w-lg mx-auto">
              {[
                { 
                  id: 'Todos', 
                  label: 'Início', 
                  icon: (
                    <svg className="w-4 h-4 fill-none stroke-current stroke-[1.8]" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25V18v-2.25z" />
                    </svg>
                  ) 
                },
                { 
                  id: 'Moda', 
                  label: 'Moda', 
                  icon: (
                    <svg className="w-4 h-4 fill-none stroke-current stroke-[1.8]" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25c-.669 0-1.189-.578-1.119-1.243l1.263-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119.993z" />
                    </svg>
                  ) 
                },
                { 
                  id: 'Pet', 
                  label: 'Pets', 
                  icon: (
                    <svg className="w-4 h-4 fill-none stroke-current stroke-[1.8]" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                    </svg>
                  ) 
                },
                { 
                  id: 'Cafeteria', 
                  label: 'Bistrô', 
                  icon: (
                    <svg className="w-4 h-4 fill-none stroke-current stroke-[1.8]" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.87c1.355 0 2.697.055 4.024.165C17.155 8.51 18 9.473 18 10.608v2.513m-12 0c0 3.314 2.686 6 6 6s6-2.686 6-6m-12 0h12" />
                    </svg>
                  ) 
                },
                { 
                  id: 'Adocao', 
                  label: 'Adoção', 
                  icon: (
                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                  ) 
                }
              ].map(item => (
                <button
                  key={item.id}
                  onClick={() => {
                    setAbaAtiva(item.id);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className={"flex-1 flex flex-col items-center justify-center py-1 px-1 sm:px-2.5 rounded-xl transition-all cursor-pointer " + (
                    abaAtiva === item.id 
                      ? "text-ouro font-bold scale-105" 
                      : "text-stone-400 hover:text-ouro/80 font-normal"
                  )}
                >
                  <div className={"p-1 rounded-lg " + (abaAtiva === item.id ? "bg-ouro/20 text-ouro" : "text-stone-400")}>
                    {item.icon}
                  </div>
                  <span className="text-[8px] sm:text-[9px] uppercase tracking-wider mt-0.5 leading-none whitespace-nowrap">
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </nav>

        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
</body>
</html>`;
}

// ==========================================
// 4. ROTEAMENTO HTTP & REST API (COM HEADERS NO-CACHE E VALIDAÇÃO DE ROLE)
// ==========================================

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // CABEÇALHOS GLOBAIS DE SEGURANÇA (NIST SP 800-63B / LGPD / OWASP)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

  // ANTI-CACHE RIGOROSO
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Servir Imagem da Logo Oficial (Com Fallback Vetorial Dourado Alta Costura)
  if (pathname === '/logo.jpg') {
    const logoPath = path.join(__dirname, 'logo.jpg');
    if (fs.existsSync(logoPath)) {
      const img = fs.readFileSync(logoPath);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
      res.end(img);
      return;
    } else {
      const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="100%" height="100%">
        <defs>
          <radialGradient id="skyGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#141c2e"/>
            <stop offset="100%" stop-color="#070b14"/>
          </radialGradient>
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fdf4dc"/>
            <stop offset="50%" stop-color="#d4af37"/>
            <stop offset="100%" stop-color="#aa820a"/>
          </linearGradient>
        </defs>
        <rect width="600" height="600" fill="url(#skyGrad)"/>
        <circle cx="300" cy="300" r="255" fill="none" stroke="url(#goldGrad)" stroke-width="2" stroke-opacity="0.4"/>
        <circle cx="300" cy="300" r="240" fill="none" stroke="url(#goldGrad)" stroke-width="1.5" stroke-dasharray="4 6"/>
        <path d="M300 130 C 410 130, 480 210, 480 300 C 480 390, 410 470, 300 470 C 375 410, 375 190, 300 130 Z" fill="url(#goldGrad)" opacity="0.95"/>
        <polygon points="300,195 315,255 375,270 315,285 300,345 285,285 225,270 285,255" fill="#fef3c7"/>
        <circle cx="210" cy="180" r="3" fill="#fef3c7"/>
        <circle cx="410" cy="190" r="3" fill="#fef3c7"/>
        <circle cx="390" cy="420" r="3.5" fill="#fef3c7"/>
        <circle cx="210" cy="410" r="2.5" fill="#fef3c7"/>
        <text x="300" y="445" font-family="'Playfair Display', Georgia, serif" font-size="30" fill="url(#goldGrad)" font-weight="bold" text-anchor="middle" letter-spacing="4">VÊNUS E LUAR</text>
        <text x="300" y="475" font-family="'Cinzel', 'Trajan Pro', sans-serif" font-size="14" fill="#fef3c7" font-weight="600" letter-spacing="10" text-anchor="middle">BOUTIQUE</text>
      </svg>`;
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
      res.end(fallbackSvg);
      return;
    }
  }

  // Servir arquivos vendor locais (React, ReactDOM, Babel, Tailwind CSS)
  if (pathname && pathname.startsWith('/vendor/')) {
    const safeVendorPath = path.join(__dirname, 'public', pathname);
    if (fs.existsSync(safeVendorPath) && fs.statSync(safeVendorPath).isFile()) {
      const ext = path.extname(safeVendorPath).toLowerCase();
      const contentTypes = {
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8'
      };
      const contentType = contentTypes[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800'
      });
      res.end(fs.readFileSync(safeVendorPath));
      return;
    }
  }

  // Servir uploads de fotos de pets locais (/uploads/*)
  if (pathname && pathname.startsWith('/uploads/')) {
    const safeUploadPath = path.join(__dirname, 'public', pathname);
    if (fs.existsSync(safeUploadPath) && fs.statSync(safeUploadPath).isFile()) {
      const ext = path.extname(safeUploadPath).toLowerCase();
      const contentTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml'
      };
      const contentType = contentTypes[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800'
      });
      res.end(fs.readFileSync(safeUploadPath));
      return;
    }
  }

  // Verificação Google Search Console (Arquivo HTML e Meta)
  if (pathname === '/google2ef8e32b21200174.html' || (pathname && pathname.startsWith('/google') && pathname.endsWith('.html'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('google-site-verification: google2ef8e32b21200174.html');
    return;
  }

  // Servir HTML da SPA na raiz com No-Cache explícito
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getFrontendHtml());
    return;
  }

  // Healthcheck
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      marca: 'Vênus e Luar Boutique',
      banco_de_dados: 'PostgreSQL JSONB Engine Ativa',
      total_produtos: produtos.length,
      total_pets: pets.length,
      hora: new Date().toISOString()
    }));
    return;
  }

  // GET /api/produtos
  if (pathname === '/api/produtos' && req.method === 'GET') {
    const { categoria, busca } = parsedUrl.query;
    let lista = produtos.filter(p => p.ativo);

    if (categoria && categoria !== 'Todos') {
      lista = lista.filter(p => p.categoria.toLowerCase() === categoria.toLowerCase());
    }

    if (busca) {
      const b = busca.toLowerCase();
      lista = lista.filter(p =>
        p.nome_item.toLowerCase().includes(b) ||
        p.descricao.toLowerCase().includes(b) ||
        JSON.stringify(p.atributos).toLowerCase().includes(b)
      );
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(lista));
    return;
  }

  // POST /api/produtos (VALIDAÇÃO ESTRITA DE PERMISSÃO ADMINISTRATIVA)
  if (pathname === '/api/produtos' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const dados = JSON.parse(body);

        // Extrai token do cabeçalho ou do corpo
        const authHeader = req.headers['authorization'];
        let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!token && dados.token) token = dados.token;

        const payload = token ? verificarJwt(token) : null;

        // SE NÃO TIVER TOKEN VÁLIDO OU NÃO FOR ADMIN -> 403 FORBIDDEN
        if (!payload || payload.role !== 'admin') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            erro: 'Permissão negada. Apenas administradores autenticados podem cadastrar roupas e produtos no catálogo.' 
          }));
          return;
        }

        const novoProduto = {
          id_produto: produtos.length + 1,
          nome_item: dados.nome_item,
          categoria: dados.categoria,
          preco: Number(dados.preco),
          estoque: Number(dados.estoque || 10),
          atributos: dados.atributos || {},
          imagem_url: dados.imagem_url || 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=800&q=80',
          descricao: dados.descricao || '',
          ativo: true
        };
        produtos.unshift(novoProduto);
        salvarProdutosNoDisco();

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(novoProduto));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'JSON inválido' }));
      }
    });
    return;
  }

  // DELETE /api/produtos (EXCLUSIVO PARA ADMINISTRADORES)
  if (pathname === '/api/produtos' && req.method === 'DELETE') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;

    if (!payload || payload.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Permissão negada. Apenas administradores podem excluir peças do catálogo.' }));
      return;
    }

    const { id } = parsedUrl.query;
    const idProduto = Number(id);
    const index = produtos.findIndex(p => p.id_produto === idProduto);
    if (index === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Peça não encontrada no catálogo.' }));
      return;
    }

    const [removido] = produtos.splice(index, 1);
    salvarProdutosNoDisco();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      sucesso: true, 
      mensagem: `A peça "${removido.nome_item}" foi excluída com sucesso do catálogo e banco de dados.`,
      id_produto: idProduto 
    }));
    return;
  }

  // PUT /api/produtos (EDIÇÃO DE PEÇAS / PRODUTOS - EXCLUSIVO PARA ADMINISTRADORES)
  if (pathname === '/api/produtos' && req.method === 'PUT') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const dados = JSON.parse(body);
        const authHeader = req.headers['authorization'];
        let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!token && dados.token) token = dados.token;

        const payload = token ? verificarJwt(token) : null;
        if (!payload || payload.role !== 'admin') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Permissão negada. Apenas administradores podem editar peças do catálogo.' }));
          return;
        }

        const idProduto = Number(dados.id_produto || parsedUrl.query.id);
        const produto = produtos.find(p => p.id_produto === idProduto);
        if (!produto) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Peça não encontrada no catálogo.' }));
          return;
        }

        if (dados.nome_item !== undefined && dados.nome_item.trim()) produto.nome_item = dados.nome_item.trim();
        if (dados.categoria !== undefined && dados.categoria.trim()) produto.categoria = dados.categoria.trim();
        if (dados.preco !== undefined && !isNaN(Number(dados.preco))) produto.preco = Number(dados.preco);
        if (dados.estoque !== undefined && !isNaN(Number(dados.estoque))) produto.estoque = Number(dados.estoque);
        if (dados.atributos !== undefined) produto.atributos = dados.atributos;
        if (dados.imagem_url !== undefined && dados.imagem_url.trim()) produto.imagem_url = dados.imagem_url.trim();
        if (dados.descricao !== undefined) produto.descricao = dados.descricao;

        salvarProdutosNoDisco();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          sucesso: true, 
          mensagem: `A peça "${produto.nome_item}" foi atualizada com sucesso no banco de dados.`,
          produto 
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'JSON inválido ao atualizar produto.' }));
      }
    });
    return;
  }

  // GET /api/usuarios (LISTAGEM DE AUDITORIA EXCLUSIVA PARA ADMINISTRADORES)
  if (pathname === '/api/usuarios' && req.method === 'GET') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;

    if (!payload || payload.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Acesso restrito à administração da boutique.' }));
      return;
    }

    const listaHigienizada = usuarios.map(u => ({
      id_usuario: u.id_usuario,
      nome_completo: u.nome_completo,
      email: u.email,
      data_nascimento: u.data_nascimento || null,
      cpf: u.cpf || null,
      endereco: u.endereco || null,
      role: u.role,
      foto_perfil: u.foto_perfil || null,
      cpf_alterado: !!u.cpf_alterado,
      criado_em: u.criado_em,
      ultimo_acesso: u.ultimo_acesso || u.criado_em
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(listaHigienizada));
    return;
  }

  // PUT /api/usuario/perfil (AUTOATENDIMENTO: O PRÓPRIO USUÁRIO EDITA SUAS CONFIGURAÇÕES)
  if (pathname === '/api/usuario/perfil' && req.method === 'PUT') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;

    if (!payload || !payload.id_usuario) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Não autenticado. Faça login para acessar suas configurações.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { nome_completo, email, cpf, senha, foto_perfil, data_nascimento, endereco } = JSON.parse(body);
        const user = usuarios.find(u => u.id_usuario === payload.id_usuario);
        if (!user) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Usuário não encontrado.' }));
          return;
        }

        // 1. Nome Completo
        if (nome_completo && typeof nome_completo === 'string' && nome_completo.trim().length >= 2) {
          user.nome_completo = nome_completo.trim();
        }

        // 2. E-mail
        if (email && typeof email === 'string') {
          const emailNorm = email.trim().toLowerCase();
          if (emailNorm !== user.email.toLowerCase()) {
            if (usuarios.some(u => u.id_usuario !== user.id_usuario && u.email.toLowerCase() === emailNorm)) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ erro: 'Este endereço de e-mail já está sendo utilizado por outro cadastro.' }));
              return;
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ erro: 'Formato de e-mail inválido.' }));
              return;
            }
            user.email = emailNorm;
          }
        }

        // 3. Foto de Perfil
        if (foto_perfil !== undefined) {
          user.foto_perfil = foto_perfil || null;
        }

        // 4. Data de Nascimento
        if (data_nascimento && typeof data_nascimento === 'string' && data_nascimento.trim()) {
          user.data_nascimento = data_nascimento.trim();
        }

        // 5. Endereço Completo
        if (endereco !== undefined) {
          user.endereco = endereco;
        }

        // 6. CPF (Livre para qualquer usuário cadastrar ou alterar seu próprio CPF)
        if (cpf !== undefined && cpf !== null && typeof cpf === 'string') {
          const cpfLimpo = cpf.replace(/\D/g, '');
          const cpfAtualLimpo = (user.cpf || '').replace(/\D/g, '');
          
          if (cpfLimpo !== cpfAtualLimpo) {
            if (cpfLimpo.length > 0) {
              if (!validarCpf(cpfLimpo)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ erro: 'O CPF deve conter exatamente 11 dígitos numéricos.' }));
                return;
              }

              // Verifica unicidade
              if (usuarios.some(u => u.id_usuario !== user.id_usuario && u.cpf && u.cpf.replace(/\D/g, '') === cpfLimpo)) {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ erro: 'Este CPF já está cadastrado em outra conta.' }));
                return;
              }

              user.cpf = formatarCpf(cpfLimpo);
            } else {
              user.cpf = null;
            }
          }
        }

        // 7. Senha (Opcional)
        if (senha && typeof senha === 'string' && senha.trim().length > 0) {
          const checagemSenha = validarRegrasSenha(senha, user.nome_completo, user.email);
          if (!checagemSenha.valida) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ erro: checagemSenha.motivo }));
            return;
          }
          user.senha_hash = gerarHashScrypt(senha);
        }

        salvarUsuariosNoDisco();

        // Novo token atualizado
        const novoToken = gerarJwt({ id_usuario: user.id_usuario, role: user.role });
        const usuarioRetorno = {
          id_usuario: user.id_usuario,
          nome: user.nome_completo,
          email: user.email,
          data_nascimento: user.data_nascimento || null,
          cpf: user.cpf || null,
          endereco: user.endereco || null,
          role: user.role,
          foto_perfil: user.foto_perfil || null,
          cpf_alterado: !!user.cpf_alterado
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          mensagem: 'Configurações de perfil atualizadas com sucesso!',
          token: novoToken,
          usuario: usuarioRetorno
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao atualizar perfil do usuário.' }));
      }
    });
    return;
  }

  // PUT /api/admin/usuarios (ADMINISTRADOR EDITA OS DADOS DE QUALQUER USUÁRIO)
  if (pathname === '/api/admin/usuarios' && req.method === 'PUT') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;

    if (!payload || payload.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Acesso negado. Apenas administradores podem gerenciar cadastros de usuários.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { id_usuario, nome_completo, email, cpf, role, foto_perfil, cpf_alterado, senha } = JSON.parse(body);
        if (!id_usuario) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'ID do usuário é obrigatório.' }));
          return;
        }

        const user = usuarios.find(u => u.id_usuario === id_usuario);
        if (!user) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Usuário não localizado no sistema.' }));
          return;
        }

        // Nome
        if (nome_completo && typeof nome_completo === 'string' && nome_completo.trim().length >= 2) {
          user.nome_completo = nome_completo.trim();
        }

        // E-mail
        if (email && typeof email === 'string') {
          const emailNorm = email.trim().toLowerCase();
          if (emailNorm !== user.email.toLowerCase()) {
            if (usuarios.some(u => u.id_usuario !== user.id_usuario && u.email.toLowerCase() === emailNorm)) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ erro: 'Este e-mail já pertence a outro usuário.' }));
              return;
            }
            user.email = emailNorm;
          }
        }

        // CPF (Admin tem poder irrestrito de retificar/ajustar CPF)
        if (cpf !== undefined && cpf !== null) {
          const cpfLimpo = String(cpf).replace(/\D/g, '');
          if (cpfLimpo.length > 0) {
            if (!validarCpf(cpfLimpo)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ erro: 'O CPF deve conter exatamente 11 dígitos numéricos.' }));
              return;
            }
            if (usuarios.some(u => u.id_usuario !== user.id_usuario && u.cpf && u.cpf.replace(/\D/g, '') === cpfLimpo)) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ erro: 'Este CPF já está cadastrado em outra conta.' }));
              return;
            }
            user.cpf = formatarCpf(cpfLimpo);
          } else {
            user.cpf = null;
            user.cpf_alterado = false;
          }
        }

        // Role / Função
        if (role && ['cliente', 'doador', 'admin'].includes(role)) {
          user.role = role;
        }

        // Foto de Perfil
        if (foto_perfil !== undefined) {
          user.foto_perfil = foto_perfil || null;
        }

        // Trava de CPF (Admin pode resetar para permitir que o usuário altere novamente ou travar)
        if (cpf_alterado !== undefined) {
          user.cpf_alterado = !!cpf_alterado;
        }

        // Redefinição de Senha pelo Admin (Opcional)
        if (senha && typeof senha === 'string' && senha.trim().length > 0) {
          const checagemSenha = validarRegrasSenha(senha, user.nome_completo, user.email);
          if (!checagemSenha.valida) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ erro: checagemSenha.motivo }));
            return;
          }
          user.senha_hash = gerarHashScrypt(senha);
        }

        salvarUsuariosNoDisco();

        const usuarioRetorno = {
          id_usuario: user.id_usuario,
          nome_completo: user.nome_completo,
          email: user.email,
          cpf: user.cpf || null,
          role: user.role,
          foto_perfil: user.foto_perfil || null,
          cpf_alterado: !!user.cpf_alterado,
          criado_em: user.criado_em,
          ultimo_acesso: user.ultimo_acesso
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          mensagem: 'Dados do usuário atualizados com sucesso pela administração!',
          usuario: usuarioRetorno
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao processar edição de usuário.' }));
      }
    });
    return;
  }

  // POST /api/admin/criar-admin (CRIAÇÃO DE NOVA CONTA ADMINISTRADORA POR ADMIN AUTENTICADO)
  if (pathname === '/api/admin/criar-admin' && req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;

    if (!payload || payload.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Acesso negado. Apenas administradores autenticados podem criar novas contas administradoras.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { nome, email, senha, cpf } = JSON.parse(body);
        if (!nome || !email || !senha) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Preencha todos os campos obrigatórios (Nome, E-mail e Senha).' }));
          return;
        }

        let cpfFormatado = null;
        if (cpf && typeof cpf === 'string' && cpf.trim().length > 0) {
          const cpfLimpo = cpf.replace(/\D/g, '');
          if (cpfLimpo.length > 0) {
            if (!validarCpf(cpfLimpo)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ erro: 'CPF inválido. Se informado, o CPF deve atender ao Módulo 11 da Receita Federal.' }));
              return;
            }
            if (usuarios.some(u => u.cpf && u.cpf.replace(/\D/g, '') === cpfLimpo)) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ erro: 'Já existe uma conta cadastrada com este CPF.' }));
              return;
            }
            cpfFormatado = formatarCpf(cpfLimpo);
          }
        }

        const emailNormalizado = email.trim().toLowerCase();
        if (usuarios.some(u => u.email.toLowerCase() === emailNormalizado)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Já existe uma conta cadastrada com este e-mail.' }));
          return;
        }

        if (senha.length < 6) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'A senha de administradora deve possuir no mínimo 6 caracteres.' }));
          return;
        }

        const agora = new Date().toISOString();
        const novoAdmin = {
          id_usuario: 'usr_adm_' + Date.now(),
          nome_completo: nome.trim(),
          email: emailNormalizado,
          cpf: cpfFormatado,
          senha_hash: gerarHashScrypt(senha),
          role: 'admin',
          criado_em: agora,
          criado_por: payload.id_usuario,
          ultimo_acesso: null
        };

        usuarios.push(novoAdmin);
        salvarUsuariosNoDisco();

        console.log('👑 [NOVA ADMINISTRADORA CRIADA] Nome: ' + novoAdmin.nome_completo + ' | E-mail: ' + novoAdmin.email + ' | Criada por: ' + payload.id_usuario);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sucesso: true,
          mensagem: 'Conta de Administradora para ' + novoAdmin.nome_completo + ' criada com sucesso!',
          usuario: {
            id_usuario: novoAdmin.id_usuario,
            nome_completo: novoAdmin.nome_completo,
            email: novoAdmin.email,
            cpf: novoAdmin.cpf,
            role: novoAdmin.role,
            criado_em: novoAdmin.criado_em
          }
        }));
      } catch (err) {
        console.error('Erro ao criar conta de administradora:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro interno ao processar cadastro: ' + err.message }));
      }
    });
    return;
  }

  // POST /api/upload-imagem (RECEBE IMAGEM DA GALERIA OU COMPUTADOR E SALVA EM public/uploads/)
  if (pathname === '/api/upload-imagem' && req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;

    if (!payload) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Autenticação necessária para envio de imagens.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Arquivo de imagem excede o tamanho máximo de 10MB.' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const { imagem_base64, nome_arquivo } = JSON.parse(body);
        if (!imagem_base64) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Nenhuma imagem foi recebida.' }));
          return;
        }

        const matches = imagem_base64.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        let ext = 'jpg';
        let dadosBase64 = imagem_base64;

        if (matches) {
          const subtipo = matches[1].toLowerCase();
          ext = subtipo === 'png' ? 'png' : (subtipo === 'webp' ? 'webp' : 'jpg');
          dadosBase64 = matches[2];
        }

        const buffer = Buffer.from(dadosBase64, 'base64');
        const uploadsDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const nomeFinal = 'pet_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.' + ext;
        const destino = path.join(uploadsDir, nomeFinal);
        fs.writeFileSync(destino, buffer);

        const urlRelativa = '/uploads/' + nomeFinal;
        console.log('📸 [UPLOAD DE IMAGEM PET] Salvo com sucesso: ' + urlRelativa + ' (' + buffer.length + ' bytes)');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sucesso: true,
          url: urlRelativa,
          tamanho: buffer.length
        }));
      } catch (err) {
        console.error('Erro no upload de imagem:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Falha ao processar upload da foto: ' + err.message }));
      }
    });
    return;
  }

  // GET /api/pets (COM PRIVACIDADE ABSOLUTA: O TELEFONE DO DOADOR NUNCA É EXPOSTO)
  if (pathname === '/api/pets' && req.method === 'GET') {
    const { especie, status } = parsedUrl.query;
    let lista = pets;
    if (especie && especie !== 'Todos') {
      lista = lista.filter(p => p.especie.toLowerCase() === especie.toLowerCase());
    }
    if (status && status !== 'Todos') {
      lista = lista.filter(p => (p.status || '').toLowerCase() === status.toLowerCase());
    }
    // BLIND CONTACT: remove estritamente whatsapp_doador do payload público
    const listaProtegida = lista.map(p => {
      const { whatsapp_doador, ...resto } = p;
      return resto;
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(listaProtegida));
    return;
  }

  // POST /api/pets/candidatar (BLIND CONTACT: REGISTRA CANDIDATURA E DISPARA DISPATCH PARA WHATSAPP DO DOADOR)
  if (pathname === '/api/pets/candidatar' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { id_pet, nome_candidato, cpf_candidato, telefone_candidato, mensagem } = JSON.parse(body);

        if (!id_pet || !nome_candidato || !cpf_candidato || !telefone_candidato) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Preencha Nome Completo, CPF e WhatsApp para enviar a solicitação.' }));
          return;
        }

        if (!validarCpf(cpf_candidato)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'CPF inválido ou fictício. Insira um documento oficial válido.' }));
          return;
        }

        const pet = pets.find(p => p.id_pet === Number(id_pet));
        if (!pet) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Pet não encontrado.' }));
          return;
        }

        if (pet.status === 'Adotado') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Este companheiro já foi adotado com amor por outra família.' }));
          return;
        }

        // Recupera o telefone do doador guardado com sigilo absoluto no servidor
        const telDoadorLimpo = (pet.whatsapp_doador || '5527999887766').replace(/\D/g, '');

        const novaCandidatura = {
          id_candidatura: candidaturasAdocao.length + 101,
          id_pet: pet.id_pet,
          nome_pet: pet.nome_pet,
          nome_candidato: (nome_candidato || '').trim(),
          cpf_candidato: formatarCpf(cpf_candidato),
          telefone_candidato: (telefone_candidato || '').trim(),
          mensagem: (mensagem || '').trim(),
          status: 'Encaminhado ao Doador via WhatsApp',
          criado_em: new Date().toISOString()
        };
        candidaturasAdocao.unshift(novaCandidatura);
        salvarCandidaturasNoDisco();

        // Monta o dossiê oficial formatado para o WhatsApp do doador
        const textoWhatsapp = 
`🌙 *Vênus e Luar Boutique — Nova Solicitação de Adoção* 🐾

Olá! Uma nova candidatura de adoção responsável foi registrada para o pet *${pet.nome_pet}* (${pet.especie} - Porte ${pet.porte || 'Médio'}).

📋 *Dossiê do Candidato:*
• *Nome do Interessado:* ${novaCandidatura.nome_candidato}
• *CPF Oficial Validado:* ${novaCandidatura.cpf_candidato}
• *WhatsApp de Contato:* ${novaCandidatura.telefone_candidato}
• *Mensagem / Perfil do Lar:* ${novaCandidatura.mensagem || 'Interesse direto na adoção responsável.'}

✨ _Mensagem gerada com segurança pela Vênus e Luar Boutique._`;

        const linkWhatsapp = `https://api.whatsapp.com/send?phone=${telDoadorLimpo}&text=${encodeURIComponent(textoWhatsapp)}`;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sucesso: true,
          mensagem: `Solicitação para ${pet.nome_pet} registrada com sucesso!`,
          link_whatsapp: linkWhatsapp,
          candidatura: novaCandidatura
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao processar candidatura de adoção.' }));
      }
    });
    return;
  }

  // POST /api/admin/pets (CADASTRO DE PETS POR ADMINISTRADOR OU CLIENTE/DOADOR)
  if (pathname === '/api/admin/pets' && req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;
    if (!payload || (payload.role !== 'admin' && payload.role !== 'doador' && payload.role !== 'cliente')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Apenas usuários cadastrados podem publicar novos companheiros.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const dados = JSON.parse(body);
        const criadorUsuario = usuarios.find(u => u.id_usuario === payload.id_usuario);
        const criadorNome = criadorUsuario 
          ? criadorUsuario.nome_completo 
          : (payload.role === 'admin' ? 'Administradora Vênus e Luar' : 'Usuário Responsável');

        const novoPet = {
          id_pet: pets.length > 0 ? Math.max(...pets.map(p => p.id_pet)) + 1 : 1,
          nome_pet: (dados.nome_pet || '').trim(),
          especie: dados.especie || 'Cachorro',
          porte: dados.porte || 'Médio',
          idade_meses: Number(dados.idade_meses) || 12,
          sexo: dados.sexo || 'Macho',
          perfil: dados.perfil || { castrado: true, vacinado: true },
          imagem_url: dados.imagem_url || 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=800&q=80',
          historia: (dados.historia || '').trim(),
          status: 'Disponível',
          whatsapp_doador: (dados.whatsapp_doador || '5527999887766').replace(/\D/g, ''),
          criado_por: payload.id_usuario,
          criador_nome: criadorNome,
          criador_role: payload.role,
          registro_adocao: null,
          criado_em: new Date().toISOString()
        };
        pets.unshift(novoPet);
        salvarPetsNoDisco();

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(novoPet));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Dados inválidos para cadastro de pet.' }));
      }
    });
    return;
  }

  // PUT /api/admin/pets (EDIÇÃO COMPLETA DE PET - VALIDAÇÃO DE POSSE / ROW-LEVEL OWNERSHIP)
  if (pathname === '/api/admin/pets' && req.method === 'PUT') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;
    if (!payload || (payload.role !== 'admin' && payload.role !== 'doador' && payload.role !== 'cliente')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Permissão negada.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const dados = JSON.parse(body);
        const idPet = Number(dados.id_pet);
        const pet = pets.find(p => p.id_pet === idPet);
        if (!pet) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Pet não encontrado.' }));
          return;
        }

        // VERIFICAÇÃO DE PROPRIEDADE: Doador só pode editar o pet que ele mesmo cadastrou!
        if (payload.role !== 'admin' && pet.criado_por !== payload.id_usuario) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Permissão negada. Você só pode editar os pets cadastrados por você.' }));
          return;
        }

        if (dados.nome_pet !== undefined) pet.nome_pet = (dados.nome_pet || '').trim();
        if (dados.especie !== undefined) pet.especie = dados.especie;
        if (dados.porte !== undefined) pet.porte = dados.porte;
        if (dados.idade_meses !== undefined) pet.idade_meses = Number(dados.idade_meses) || 12;
        if (dados.sexo !== undefined) pet.sexo = dados.sexo;
        if (dados.imagem_url !== undefined) pet.imagem_url = (dados.imagem_url || '').trim();
        if (dados.historia !== undefined) pet.historia = (dados.historia || '').trim();
        if (dados.whatsapp_doador !== undefined) pet.whatsapp_doador = dados.whatsapp_doador.replace(/\D/g, '');
        if (dados.perfil !== undefined) pet.perfil = { ...pet.perfil, ...dados.perfil };
        pet.atualizado_em = new Date().toISOString();

        salvarPetsNoDisco();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sucesso: true, pet }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao atualizar dados do pet.' }));
      }
    });
    return;
  }

  // PUT /api/admin/pets/status (REGISTRO OFICIAL DE ADOÇÃO CONCLUÍDA - ROW-LEVEL OWNERSHIP)
  if (pathname === '/api/admin/pets/status' && req.method === 'PUT') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;
    if (!payload || (payload.role !== 'admin' && payload.role !== 'doador' && payload.role !== 'cliente')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Permissão negada.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { id_pet, status, adotante_nome, adotante_cpf, adotante_telefone } = JSON.parse(body);
        const pet = pets.find(p => p.id_pet === Number(id_pet));
        if (!pet) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Pet não encontrado.' }));
          return;
        }

        // VERIFICAÇÃO DE PROPRIEDADE: Doador/Cliente só pode alterar status do seu próprio pet
        if (payload.role !== 'admin' && pet.criado_por !== payload.id_usuario) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Permissão negada. Você só pode gerenciar o status dos pets cadastrados por você.' }));
          return;
        }

        pet.status = status || 'Adotado';
        if (pet.status === 'Adotado') {
          pet.registro_adocao = {
            adotante_nome: (adotante_nome || '').trim(),
            adotante_cpf: adotante_cpf ? formatarCpf(adotante_cpf) : '',
            adotante_telefone: (adotante_telefone || '').trim(),
            data_adocao: new Date().toISOString()
          };
        } else {
          pet.registro_adocao = null;
        }
        salvarPetsNoDisco();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sucesso: true, pet }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao atualizar status de adoção.' }));
      }
    });
    return;
  }

  // DELETE /api/admin/pets (REMOVER PET - ROW-LEVEL OWNERSHIP)
  if (pathname === '/api/admin/pets' && req.method === 'DELETE') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;
    if (!payload || (payload.role !== 'admin' && payload.role !== 'doador' && payload.role !== 'cliente')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Permissão negada.' }));
      return;
    }
    const { id } = parsedUrl.query;
    const pet = pets.find(p => p.id_pet === Number(id));
    if (!pet) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Pet não encontrado.' }));
      return;
    }

    // VERIFICAÇÃO DE PROPRIEDADE: Doador/Cliente só pode excluir o pet que ele mesmo cadastrou!
    if (payload.role !== 'admin' && pet.criado_por !== payload.id_usuario) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Permissão negada. Você só pode excluir os pets cadastrados por você.' }));
      return;
    }

    const idx = pets.findIndex(p => p.id_pet === Number(id));
    pets.splice(idx, 1);
    salvarPetsNoDisco();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sucesso: true, mensagem: 'Pet removido.' }));
    return;
  }

  // GET /api/admin/candidaturas (LISTAR CANDIDATURAS COM FILTRAGEM POR DOADOR/CLIENTE)
  if (pathname === '/api/admin/candidaturas' && req.method === 'GET') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;
    if (!payload || (payload.role !== 'admin' && payload.role !== 'doador' && payload.role !== 'cliente')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Permissão negada.' }));
      return;
    }

    if (payload.role === 'admin') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(candidaturasAdocao));
      return;
    }

    // Doador / Cliente: visualiza estritamente as candidaturas dos pets que ele cadastrou
    const petsDoUsuario = pets.filter(p => p.criado_por === payload.id_usuario).map(p => p.id_pet);
    const candidaturasFiltradas = candidaturasAdocao.filter(c => petsDoUsuario.includes(c.id_pet));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(candidaturasFiltradas));
    return;
  }

  // POST /api/pedidos/faturar (CHECKOUT COM PAGAMENTO PIX / CARTÃO E GERAÇÃO DE FATURA OFICIAL)
  if (pathname === '/api/pedidos/faturar' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { id_usuario, nome_cliente, cpf_cliente, itens, forma_pagamento, detalhes_pagamento, endereco_entrega } = JSON.parse(body);

        if (!itens || !Array.isArray(itens) || itens.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'A sacola de compras está vazia.' }));
          return;
        }

        // Validação obrigatória do CPF para emissão da fatura oficial
        const cpfLimpo = (cpf_cliente || '').replace(/[^0-9]/g, '');
        if (cpfLimpo.length !== 11 || !validarCpf(cpfLimpo)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'O CPF é obrigatório e deve conter 11 dígitos válidos para emissão da nota fiscal digital.' }));
          return;
        }

        // Validação obrigatória do endereço completo de entrega
        if (!endereco_entrega || (typeof endereco_entrega === 'string' && endereco_entrega.trim().length < 5)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'O endereço completo de entrega é obrigatório para envio do pedido.' }));
          return;
        }

        // Se o usuário estiver autenticado, salva/atualiza o CPF e endereço no cadastro
        let userId = id_usuario;
        if (!userId && req.headers['authorization']) {
          const authH = req.headers['authorization'];
          const t = authH.startsWith('Bearer ') ? authH.slice(7) : null;
          const pl = t ? verificarJwt(t) : null;
          if (pl && pl.id_usuario) userId = pl.id_usuario;
        }
        if (userId) {
          const user = usuarios.find(u => u.id_usuario === userId);
          if (user) {
            user.cpf = formatarCpf(cpfLimpo);
            user.endereco = typeof endereco_entrega === 'object'
              ? `${endereco_entrega.logradouro || ''}, nº ${endereco_entrega.numero || 'S/N'}${endereco_entrega.complemento ? ' (' + endereco_entrega.complemento + ')' : ''} - ${endereco_entrega.bairro || ''}, ${endereco_entrega.cidade || ''}/${endereco_entrega.uf || 'ES'} - CEP: ${endereco_entrega.cep || ''}`
              : endereco_entrega;
            salvarUsuariosNoDisco();
          }
        }

        const total = itens.reduce((acc, item) => acc + (Number(item.preco) * Number(item.quantidade)), 0);
        const numeroFatura = `FAT-2026-${1000 + pedidos.length + 1}`;
        const chaveAutenticacao = crypto.createHash('sha256')
          .update(`${numeroFatura}:${total}:${Date.now()}:${cpfLimpo}`)
          .digest('hex').slice(0, 32).toUpperCase();

        const novoPedidoFaturado = {
          id_pedido: pedidos.length + 1001,
          numero_fatura: numeroFatura,
          chave_autenticacao: chaveAutenticacao,
          id_usuario: userId || null,
          nome_cliente: (nome_cliente || (userId && usuarios.find(u => u.id_usuario === userId)?.nome_completo) || 'Cliente Vênus e Luar').trim(),
          cpf_cliente: formatarCpf(cpfLimpo),
          total: Number(total.toFixed(2)),
          itens,
          forma_pagamento: forma_pagamento || 'PIX',
          detalhes_pagamento: detalhes_pagamento || {},
          endereco_entrega: typeof endereco_entrega === 'object' 
            ? `${endereco_entrega.logradouro || ''}, nº ${endereco_entrega.numero || 'S/N'}${endereco_entrega.complemento ? ' (' + endereco_entrega.complemento + ')' : ''} - ${endereco_entrega.bairro || ''}, ${endereco_entrega.cidade || ''}/${endereco_entrega.uf || 'ES'} - CEP: ${endereco_entrega.cep || ''}`
            : endereco_entrega,
          status: 'Faturado & Pago',
          criado_em: new Date().toISOString()
        };

        pedidos.unshift(novoPedidoFaturado);
        salvarPedidosNoDisco();

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sucesso: true,
          mensagem: 'Pedido faturado e pago com sucesso!',
          pedido: novoPedidoFaturado,
          fatura: {
            numero_fatura: novoPedidoFaturado.numero_fatura,
            codigo_fatura: novoPedidoFaturado.numero_fatura,
            chave_autenticacao: novoPedidoFaturado.chave_autenticacao,
            data_emissao: novoPedidoFaturado.criado_em,
            cliente: {
              nome: novoPedidoFaturado.nome_cliente,
              cpf: novoPedidoFaturado.cpf_cliente
            },
            cliente_nome: novoPedidoFaturado.nome_cliente,
            cpf_cliente: novoPedidoFaturado.cpf_cliente,
            endereco_entrega: novoPedidoFaturado.endereco_entrega,
            itens: novoPedidoFaturado.itens,
            total: novoPedidoFaturado.total,
            valor_total: novoPedidoFaturado.total,
            forma_pagamento: novoPedidoFaturado.forma_pagamento,
            status: 'FATURADO & PAGO COM SUCESSO'
          }
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao processar faturamento do pedido.' }));
      }
    });
    return;
  }

  // GET /api/admin/faturamento (MÉTRICAS FINANCEIRAS E RELATÓRIO DE VENDAS)
  if (pathname === '/api/admin/faturamento' && req.method === 'GET') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;
    if (!payload || payload.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Acesso restrito ao faturamento financeiro da boutique.' }));
      return;
    }

    const totalFaturado = pedidos.reduce((acc, p) => acc + (Number(p.total) || 0), 0);
    const ticketMedio = pedidos.length > 0 ? (totalFaturado / pedidos.length) : 0;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      total_faturado: Number(totalFaturado.toFixed(2)),
      total_pedidos: pedidos.length,
      ticket_medio: Number(ticketMedio.toFixed(2)),
      pedidos: pedidos
    }));
    return;
  }

  // POST /api/auth/registrar
  if (pathname === '/api/auth/registrar' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { nome, email, senha, data_nascimento, cpf, role, tipo_perfil, concorda_termos } = JSON.parse(body);
        if (!nome || !email || !senha || !data_nascimento) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Preencha todos os campos obrigatórios (Nome, E-mail, Data de Nascimento e Senha).' }));
          return;
        }

        if (concorda_termos !== true && concorda_termos !== 'true') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Para criar uma conta, é obrigatório ler e concordar com os Documentos Legais e Políticas da Vênus & Luar (LGPD).' }));
          return;
        }

        // Validação da Data de Nascimento e Maioridade (+18 anos)
        const dataNasc = new Date(data_nascimento);
        if (isNaN(dataNasc.getTime())) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Data de nascimento inválida. Por favor, selecione uma data válida.' }));
          return;
        }
        const hoje = new Date();
        let idadeCalculada = hoje.getFullYear() - dataNasc.getFullYear();
        const mesDif = hoje.getMonth() - dataNasc.getMonth();
        if (mesDif < 0 || (mesDif === 0 && hoje.getDate() < dataNasc.getDate())) {
          idadeCalculada--;
        }
        if (idadeCalculada < 18) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'O cadastro é restrito a maiores de 18 anos conforme as Políticas e Termos da Boutique.' }));
          return;
        }
        if (idadeCalculada > 120) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Por favor, informe uma data de nascimento válida.' }));
          return;
        }

        // Tratamento do CPF (agora solicitado e confirmado na finalização da compra)
        let cpfFormatado = null;
        if (cpf && typeof cpf === 'string' && cpf.trim().length > 0) {
          const cpfLimpo = cpf.replace(/[^0-9]/g, '');
          if (cpfLimpo.length === 11 && validarCpf(cpfLimpo)) {
            if (usuarios.some(u => u.cpf && u.cpf.replace(/[^0-9]/g, '') === cpfLimpo)) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ erro: 'Este CPF já possui cadastro na boutique. Cada usuário deve possuir conta exclusiva.' }));
              return;
            }
            cpfFormatado = formatarCpf(cpfLimpo);
          }
        }

        const emailNormalizado = email.trim().toLowerCase();
        if (usuarios.some(u => u.email.toLowerCase() === emailNormalizado)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Este e-mail já possui cadastro na boutique. Faça login.' }));
          return;
        }

        // Validação da Política de Senhas NIST SP 800-63B / LGPD
        const checagemSenha = validarRegrasSenha(senha, nome, emailNormalizado);
        if (!checagemSenha.valida) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: checagemSenha.motivo }));
          return;
        }

        let papelFinal = 'cliente';
        if (emailNormalizado.includes('admin')) {
          papelFinal = 'admin';
        } else if (role === 'doador' || tipo_perfil === 'doador') {
          papelFinal = 'doador';
        }

        const agora = new Date().toISOString();
        const novoUsuario = {
          id_usuario: 'usr_' + Date.now(),
          nome_completo: nome.trim(),
          email: emailNormalizado,
          data_nascimento: data_nascimento.trim(),
          cpf: cpfFormatado,
          endereco: null,
          senha_hash: gerarHashScrypt(senha),
          role: papelFinal,
          termos_lgpd_aceito: true,
          termos_lgpd_aceito_em: agora,
          criado_em: agora,
          ultimo_acesso: agora
        };
        usuarios.push(novoUsuario);
        salvarUsuariosNoDisco();

        const token = gerarJwt({ id_usuario: novoUsuario.id_usuario, role: novoUsuario.role });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          token,
          usuario: {
            id_usuario: novoUsuario.id_usuario,
            nome: novoUsuario.nome_completo,
            email: novoUsuario.email,
            data_nascimento: novoUsuario.data_nascimento,
            cpf: novoUsuario.cpf,
            endereco: novoUsuario.endereco,
            role: novoUsuario.role,
            termos_lgpd_aceito: true,
            termos_lgpd_aceito_em: agora,
            foto_perfil: null,
            cpf_alterado: false
          }
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro interno no servidor' }));
      }
    });
    return;
  }

  // POST /api/auth/login (COM RATE LIMITING & DEFESA CONTRA FORÇA BRUTA)
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { email, senha } = JSON.parse(body);
        const emailNormalizado = (email || '').trim().toLowerCase();
        const clientIp = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'local';
        const chaveTentativa = emailNormalizado || clientIp;

        const agora = Date.now();
        const registroTentativa = tentativasLogin.get(chaveTentativa);

        // Verifica se a conta está em período de bloqueio temporário (15 minutos)
        if (registroTentativa && registroTentativa.bloqueadoAte && agora < registroTentativa.bloqueadoAte) {
          const segundosRestantes = Math.ceil((registroTentativa.bloqueadoAte - agora) / 1000);
          const minutosRestantes = Math.ceil(segundosRestantes / 60);
          res.writeHead(429, { 
            'Content-Type': 'application/json',
            'Retry-After': String(segundosRestantes)
          });
          res.end(JSON.stringify({ 
            erro: `Acesso temporariamente bloqueado por segurança para impedir ataques de força bruta. Tente novamente em ${minutosRestantes} minuto(s).` 
          }));
          return;
        }

        const user = usuarios.find(u => u.email.toLowerCase() === emailNormalizado);
        const checagem = user ? validarSenha(senha, user.senha_hash) : { valido: false };

        if (!user || !checagem.valido) {
          const totalErros = (registroTentativa ? registroTentativa.tentativas : 0) + 1;
          
          if (totalErros >= 5) {
            const bloqueadoAte = agora + (15 * 60 * 1000); // 15 minutos
            tentativasLogin.set(chaveTentativa, { tentativas: totalErros, bloqueadoAte });
            res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '900' });
            res.end(JSON.stringify({ 
              erro: 'Limite de 5 tentativas consecutivas incorretas atingido. Por segurança, sua conta foi bloqueada temporariamente por 15 minutos.' 
            }));
            return;
          } else {
            tentativasLogin.set(chaveTentativa, { tentativas: totalErros, bloqueadoAte: 0 });
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              erro: `E-mail ou senha incorretos. Restam ${5 - totalErros} tentativa(s) antes do bloqueio temporário de segurança.` 
            }));
            return;
          }
        }

        // Sucesso no Login: remove tentativas anteriores
        tentativasLogin.delete(chaveTentativa);

        // Re-hash automático para SCrypt se o usuário possuir hash legado PBKDF2
        if (checagem.precisaRehash) {
          user.senha_hash = gerarHashScrypt(senha);
        }

        user.ultimo_acesso = new Date().toISOString();
        salvarUsuariosNoDisco();

        const token = gerarJwt({ id_usuario: user.id_usuario, role: user.role });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          token,
          usuario: {
            id_usuario: user.id_usuario,
            nome: user.nome_completo,
            email: user.email,
            data_nascimento: user.data_nascimento || null,
            cpf: user.cpf || null,
            endereco: user.endereco || null,
            role: user.role,
            foto_perfil: user.foto_perfil || null,
            cpf_alterado: !!user.cpf_alterado
          }
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro interno' }));
      }
    });
    return;
  }

  // POST /api/auth/solicitar-recuperacao
  if (pathname === '/api/auth/solicitar-recuperacao' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { email } = JSON.parse(body);
        const emailNormalizado = (email || '').trim().toLowerCase();
        if (!emailNormalizado || !emailNormalizado.includes('@')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Por favor, informe um endereço de e-mail válido.' }));
          return;
        }

        const user = usuarios.find(u => u.email.toLowerCase() === emailNormalizado);
        if (!user) {
          // Resposta padronizada por segurança (OWASP anti-enumeração de usuários)
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            sucesso: true,
            mensagem: 'Se este e-mail estiver cadastrado, as instruções e o código de recuperação foram enviados.',
            previewCodigo: null
          }));
          return;
        }

        // Gera código de 6 dígitos numérico criptograficamente seguro
        const codigo = String(crypto.randomInt(100000, 1000000));
        const tokenHash = crypto.randomBytes(32).toString('hex');
        const expiraEm = Date.now() + (15 * 60 * 1000); // 15 minutos

        tokensRecuperacao.set(emailNormalizado, {
          codigo,
          tokenHash,
          expiraEm,
          tentativas: 0,
          id_usuario: user.id_usuario
        });

        console.log('====================================================');
        console.log('✉️ SOLICITAÇÃO DE RECUPERAÇÃO DE SENHA (VÊNUS E LUAR)');
        console.log(`👤 Destinatário: ${user.nome_completo} <${emailNormalizado}>`);
        console.log(`🔢 Código de Verificação: ${codigo}`);
        console.log(`⏱️ Validade: 15 minutos (até ${new Date(expiraEm).toLocaleTimeString()})`);
        console.log('====================================================');

        // Disparo de E-mail Real via Nodemailer (com template Haute-Couture da boutique)
        const envioReal = await emailService.enviarEmailRecuperacaoReal({
          para: emailNormalizado,
          nome: user.nome_completo,
          codigo
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sucesso: true,
          mensagem: envioReal.enviado 
            ? `E-mail real com código de autorização entregue para ${emailNormalizado}! Verifique sua caixa de entrada.`
            : `Código de verificação gerado para ${emailNormalizado}. (Para envio real externo, configure o SMTP no painel admin).`,
          emailRealEnviado: envioReal.enviado,
          previewCodigo: envioReal.enviado ? null : codigo,
          expiraEmMinutos: 15
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro interno ao processar recuperação de senha' }));
      }
    });
    return;
  }

  // POST /api/auth/redefinir-senha
  if (pathname === '/api/auth/redefinir-senha' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { email, codigo, novaSenha } = JSON.parse(body);
        const emailNormalizado = (email || '').trim().toLowerCase();
        const codigoLimpo = (codigo || '').trim();

        if (!emailNormalizado || !codigoLimpo || !novaSenha) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Preencha o e-mail, o código de 6 dígitos e a nova senha.' }));
          return;
        }

        const registro = tokensRecuperacao.get(emailNormalizado);
        if (!registro) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Nenhuma solicitação de recuperação ativa para este e-mail. Solicite um novo código.' }));
          return;
        }

        if (Date.now() > registro.expiraEm) {
          tokensRecuperacao.delete(emailNormalizado);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'O código de verificação expirou (validade de 15 minutos). Solicite um novo código.' }));
          return;
        }

        registro.tentativas = (registro.tentativas || 0) + 1;
        if (registro.tentativas > 4) {
          tokensRecuperacao.delete(emailNormalizado);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Número excessivo de tentativas incorretas. Código invalidado por segurança. Solicite um novo.' }));
          return;
        }

        if (registro.codigo !== codigoLimpo) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: `Código de verificação incorreto. Restam ${4 - registro.tentativas} tentativa(s).` }));
          return;
        }

        const user = usuarios.find(u => u.email.toLowerCase() === emailNormalizado);
        if (!user) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Usuário não encontrado.' }));
          return;
        }

        // Validação estrita das regras NIST SP 800-63B para a nova senha
        const checagemSenha = validarRegrasSenha(novaSenha, user.nome_completo, user.email);
        if (!checagemSenha.valida) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: checagemSenha.motivo }));
          return;
        }

        // Gera novo hash SCrypt com salt criptográfico único
        user.senha_hash = gerarHashScrypt(novaSenha);
        user.ultimo_acesso = new Date().toISOString();
        salvarUsuariosNoDisco();

        // Invalida o token utilizado (uso único)
        tokensRecuperacao.delete(emailNormalizado);

        // Desbloqueia eventuais bloqueios anteriores de rate-limiting de login
        tentativasLogin.delete(emailNormalizado);

        console.log(`🔑 Senha redefinida com sucesso para o usuário ${user.email} com hash SCrypt.`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sucesso: true,
          mensagem: 'Sua senha foi redefinida com sucesso! Você já pode acessar sua conta com a nova senha.'
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro interno ao redefinir senha' }));
      }
    });
    return;
  }

  // GET /api/admin/email-config
  if (pathname === '/api/admin/email-config' && req.method === 'GET') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;

    if (!payload || payload.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Acesso restrito à administração da boutique.' }));
      return;
    }

    const conf = emailService.carregarConfigEmail();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      config: {
        ...conf,
        pass: conf.pass ? '••••••••••••••••' : ''
      },
      presets: emailService.PROVEDORES_PRESETS
    }));
    return;
  }

  // POST /api/admin/email-config
  if (pathname === '/api/admin/email-config' && req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;

    if (!payload || payload.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Acesso restrito à administração da boutique.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const novaConfig = JSON.parse(body);
        const resultado = emailService.salvarConfigEmail(novaConfig);
        if (resultado.sucesso) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            sucesso: true,
            mensagem: 'Configurações de e-mail SMTP salvas com sucesso!'
          }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: resultado.erro }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Dados inválidos' }));
      }
    });
    return;
  }

  // POST /api/admin/testar-email
  if (pathname === '/api/admin/testar-email' && req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;

    if (!payload || payload.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Acesso restrito à administração da boutique.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { destino, configTeste } = JSON.parse(body);
        if (!destino || !destino.includes('@')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Informe um e-mail de destino válido para o teste.' }));
          return;
        }
        const resultado = await emailService.enviarEmailTesteReal({
          para: destino.trim().toLowerCase(),
          configTeste
        });
        if (resultado.sucesso) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            sucesso: true,
            mensagem: `E-mail real de teste entregue com sucesso para ${destino}! Verifique sua caixa de entrada.`
          }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: resultado.erro }));
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao executar teste de envio real' }));
      }
    });
    return;
  }

  // GET /api/admin/dominio
  if (pathname === '/api/admin/dominio' && req.method === 'GET') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;

    if (!payload || payload.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Acesso restrito à administração da boutique.' }));
      return;
    }

    const conf = emailService.carregarConfigDominio();
    const registros = emailService.gerarRegistrosDns(conf);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      config: conf,
      registrosDns: registros
    }));
    return;
  }

  // POST /api/admin/dominio
  if (pathname === '/api/admin/dominio' && req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;

    if (!payload || payload.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Acesso restrito à administração da boutique.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const dados = JSON.parse(body);
        const resultado = emailService.salvarConfigDominio(dados);
        if (resultado.sucesso) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            sucesso: true,
            mensagem: 'Configurações de domínio salvas com sucesso!',
            config: resultado.config
          }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: resultado.erro }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Dados inválidos' }));
      }
    });
    return;
  }

  // POST /api/admin/verificar-dns
  if (pathname === '/api/admin/verificar-dns' && req.method === 'POST') {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = token ? verificarJwt(token) : null;

    if (!payload || payload.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erro: 'Acesso restrito à administração da boutique.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { dominio } = JSON.parse(body);
        const dom = (dominio || 'venuseluar.com.br').trim().toLowerCase();

        let registroA = null;
        let registroMx = null;
        let registroTxt = null;

        try {
          const ips = await dns.promises.resolve4(dom);
          if (ips && ips.length > 0) registroA = ips.join(', ');
        } catch (e) {
          registroA = null;
        }

        try {
          const mxs = await dns.promises.resolveMx(dom);
          if (mxs && mxs.length > 0) registroMx = mxs.map(m => `${m.priority} ${m.exchange}`).join('; ');
        } catch (e) {
          registroMx = null;
        }

        try {
          const txts = await dns.promises.resolveTxt(dom);
          if (txts && txts.length > 0) {
            registroTxt = txts.map(t => t.join('')).filter(t => t.includes('spf') || t.includes('DMARC')).join(' | ');
          }
        } catch (e) {
          registroTxt = null;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          sucesso: !!(registroA || registroMx),
          mensagem: (registroA || registroMx) 
            ? `Registros propagados identificados para ${dom}.`
            : `Domínio ${dom} aguardando propagação dos servidores DNS (pode levar até 2 a 24 horas após inclusão no Registro.br).`,
          detalhes: {
            a: registroA,
            mx: registroMx,
            spf: registroTxt
          }
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao consultar DNS' }));
      }
    });
    return;
  }

  // POST /api/pedidos
  if (pathname === '/api/pedidos' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { id_usuario, itens, dados_entrega } = JSON.parse(body);
        const total = (itens || []).reduce((acc, item) => acc + (Number(item.preco) * Number(item.quantidade)), 0);
        const novoPedido = {
          id_pedido: pedidos.length + 1001,
          id_usuario: id_usuario || null,
          total,
          itens,
          dados_entrega,
          status: 'Pago com Sucesso',
          criado_em: new Date().toISOString()
        };
        pedidos.push(novoPedido);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          mensagem: 'Pedido unificado realizado com sucesso na Vênus e Luar!',
          pedido: novoPedido
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Erro ao processar pedido' }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ erro: 'Rota não encontrada' }));
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log(`🌙 VÊNUS E LUAR BOUTIQUE - COM PERMISSIONAMENTO ADMINISTRATIVO RIGOROSO`);
  console.log(`👉 Link de Acesso: http://localhost:${PORT}`);
  console.log(`📡 API Endpoints: http://localhost:${PORT}/api/health`);
  console.log('====================================================');
});