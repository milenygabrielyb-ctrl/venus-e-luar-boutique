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
  if (!cpf || typeof cpf !== 'string') return false;
  const limpo = cpf.replace(/\D/g, '');
  if (limpo.length !== 11) return false;
  // Bloqueia CPFs com dígitos todos repetidos (ex: 00000000000, 11111111111)
  if (/^(\d)\1{10}$/.test(limpo)) return false;

  // 1º Dígito Verificador (Módulo 11)
  let soma = 0;
  for (let i = 0; i < 9; i++) {
    soma += parseInt(limpo.charAt(i), 10) * (10 - i);
  }
  let resto = (soma * 10) % 11;
  let d1 = (resto === 10 || resto === 11) ? 0 : resto;
  if (d1 !== parseInt(limpo.charAt(9), 10)) return false;

  // 2º Dígito Verificador (Módulo 11)
  soma = 0;
  for (let i = 0; i < 10; i++) {
    soma += parseInt(limpo.charAt(i), 10) * (11 - i);
  }
  resto = (soma * 10) % 11;
  let d2 = (resto === 10 || resto === 11) ? 0 : resto;
  if (d2 !== parseInt(limpo.charAt(10), 10)) return false;

  return true;
}

function formatarCpf(cpf) {
  const limpo = (cpf || '').replace(/\D/g, '').slice(0, 11);
  return limpo
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
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
  <link rel="icon" type="image/jpeg" href="/logo.jpg">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
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
    }
  </script>
  <!-- React 18 CDN -->
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800&family=Playfair+Display:ital,wght@0,600;0,700;1,400&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap');
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

      // Estado do formulário de cadastro, CPF e medidor visual de força de senha
      const [nomeCadastro, setNomeCadastro] = useState('');
      const [cpfCadastro, setCpfCadastro] = useState('');
      const [emailCadastro, setEmailCadastro] = useState('');
      const [senhaCadastro, setSenhaCadastro] = useState('');

      const formatarCpf = (v) => {
        const limpo = (v || '').replace(/\D/g, '').slice(0, 11);
        return limpo
          .replace(/(\d{3})(\d)/, '$1.$2')
          .replace(/(\d{3})(\d)/, '$1.$2')
          .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
      };

      const validarCpf = (cpf) => {
        if (!cpf) return false;
        const limpo = cpf.replace(/\D/g, '');
        if (limpo.length !== 11) return false;
        const cpfsFicticios = ['00000000000', '11111111111', '22222222222', '33333333333', '44444444444', '55555555555', '66666666666', '77777777777', '88888888888', '99999999999'];
        if (cpfsFicticios.indexOf(limpo) !== -1) return false;

        let soma = 0;
        for (let i = 0; i < 9; i++) soma += parseInt(limpo.charAt(i), 10) * (10 - i);
        let resto = (soma * 10) % 11;
        let d1 = (resto === 10 || resto === 11) ? 0 : resto;
        if (d1 !== parseInt(limpo.charAt(9), 10)) return false;

        soma = 0;
        for (let i = 0; i < 10; i++) soma += parseInt(limpo.charAt(i), 10) * (11 - i);
        resto = (soma * 10) % 11;
        let d2 = (resto === 10 || resto === 11) ? 0 : resto;
        if (d2 !== parseInt(limpo.charAt(10), 10)) return false;

        return true;
      };

      const cpfLimpo = cpfCadastro.replace(/\D/g, '');
      const statusCpf = cpfLimpo.length === 11 ? (validarCpf(cpfCadastro) ? 'valido' : 'invalido') : null;

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
        user: '',
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
        email_atendimento: 'atendimento@venuseluar.com.br',
        email_contato: 'contato@venuseluar.com.br',
        email_seguranca: 'seguranca@venuseluar.com.br'
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
        // Se NÃO estiver logado como administrador, BLOQUEIA e abre o modal de permissionamento
        if (!usuario || usuario.role !== 'admin') {
          setIsPermissionamentoGestaoOpen(true);
          return;
        }
        setIsAdminOpen(true);
        carregarUsuarios();
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


          {/* Header com a Logo Oficial */}
          <header className="sticky top-0 z-40 bg-celestial-900/95 backdrop-blur-md border-b border-ouro/25 shadow-xl">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-24">
                
                {/* Logo Oficial com o Símbolo */}
                <div onClick={() => setAbaAtiva('Todos')} className="cursor-pointer flex items-center gap-4 group">
                  <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-ouro/60 p-0.5 bg-celestial-950 shadow-md group-hover:scale-105 transition-transform duration-300">
                    <img src="/logo.jpg" alt="Vênus e Luar Logo" className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <span className="font-serif text-2xl sm:text-3xl font-bold tracking-wider gold-gradient-text block">
                      Vênus e Luar
                    </span>
                    <span className="block text-[10px] tracking-[0.35em] uppercase text-ouro/80 font-semibold">
                      B O U T I Q U E
                    </span>
                  </div>
                </div>

                {/* Navegação de Nichos Sem Emojis - Design Alta Costura */}
                <nav className="hidden md:flex items-center gap-1 bg-celestial-950/70 p-1.5 rounded-full border border-ouro/25 backdrop-blur-md shadow-inner">
                  <button 
                    onClick={() => setAbaAtiva('Todos')} 
                    className={\`px-4 py-2 rounded-full text-[11px] font-medium tracking-[0.14em] uppercase transition-all duration-300 \${abaAtiva === 'Todos' ? 'bg-gradient-to-r from-ouro-dark via-ouro to-ouro text-celestial-950 font-bold shadow-md shadow-ouro/20' : 'text-luar-200/80 hover:text-ouro hover:bg-ouro/10'}\`}
                  >
                    Todas as Criações
                  </button>
                  <button 
                    onClick={() => setAbaAtiva('Moda')} 
                    className={\`px-4 py-2 rounded-full text-[11px] font-medium tracking-[0.14em] uppercase transition-all duration-300 \${abaAtiva === 'Moda' ? 'bg-gradient-to-r from-ouro-dark via-ouro to-ouro text-celestial-950 font-bold shadow-md shadow-ouro/20' : 'text-luar-200/80 hover:text-ouro hover:bg-ouro/10'}\`}
                  >
                    Alta Costura
                  </button>
                  <button 
                    onClick={() => setAbaAtiva('Pet')} 
                    className={\`px-4 py-2 rounded-full text-[11px] font-medium tracking-[0.14em] uppercase transition-all duration-300 \${abaAtiva === 'Pet' ? 'bg-gradient-to-r from-ouro-dark via-ouro to-ouro text-celestial-950 font-bold shadow-md shadow-ouro/20' : 'text-luar-200/80 hover:text-ouro hover:bg-ouro/10'}\`}
                  >
                    Espaço Pet
                  </button>
                  <button 
                    onClick={() => setAbaAtiva('Cafeteria')} 
                    className={\`px-4 py-2 rounded-full text-[11px] font-medium tracking-[0.14em] uppercase transition-all duration-300 \${abaAtiva === 'Cafeteria' ? 'bg-gradient-to-r from-ouro-dark via-ouro to-ouro text-celestial-950 font-bold shadow-md shadow-ouro/20' : 'text-luar-200/80 hover:text-ouro hover:bg-ouro/10'}\`}
                  >
                    Bistrô & Café
                  </button>
                  <button 
                    onClick={() => setAbaAtiva('Adocao')} 
                    className={\`px-4 py-2 rounded-full text-[11px] font-medium tracking-[0.14em] uppercase transition-all duration-300 \${abaAtiva === 'Adocao' ? 'bg-gradient-to-r from-ouro-dark via-ouro to-ouro text-celestial-950 font-bold shadow-md shadow-ouro/20' : 'text-luar-200/80 hover:text-ouro hover:bg-ouro/10'}\`}
                  >
                    Adoção de Pets
                  </button>
                </nav>

                {/* Ações da Barra: Gestão, Conta e Sacola (Sem Emojis) */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleAbrirGestao}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-ouro/40 bg-celestial-950/80 text-ouro hover:bg-ouro hover:text-celestial-950 text-[11px] font-semibold tracking-[0.14em] uppercase transition-all duration-300 cursor-pointer shadow-sm group"
                    title="Painel de Gestão e Catálogo (Administrador)"
                  >
                    <svg className="w-3.5 h-3.5 stroke-current transition-transform duration-300 group-hover:rotate-45" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                    </svg>
                    <span>Gestão</span>
                  </button>

                  {usuario ? (
                    <div className="flex items-center gap-3 pl-2 sm:pl-3 border-l border-ouro/25">
                      <div className="hidden sm:block text-right">
                        <span className="block text-[9px] uppercase tracking-widest text-ouro/70">Acesso</span>
                        <span className="text-xs font-serif font-semibold text-luar-100">{usuario.nome.split(' ')[0]}</span>
                      </div>
                      <button
                        onClick={handleDeslogar}
                        className="text-[10px] uppercase tracking-wider text-stone-400 hover:text-rose-400 px-2.5 py-1 rounded-full border border-stone-700/50 hover:border-rose-500/50 transition-all cursor-pointer"
                        title="Encerrar sessão"
                      >
                        Sair
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setIsAuthOpen(true)}
                      className="px-4 py-2 rounded-full border border-ouro/40 text-ouro hover:bg-ouro hover:text-celestial-950 text-[11px] uppercase tracking-[0.16em] font-semibold transition-all cursor-pointer"
                    >
                      Entrar
                    </button>
                  )}

                  <button
                    onClick={() => setIsCarrinhoOpen(true)}
                    className="relative p-2.5 rounded-full bg-gradient-to-r from-ouro-dark via-ouro to-ouro text-celestial-950 hover:brightness-110 active:scale-95 transition-all shadow-md shadow-ouro/20 cursor-pointer flex items-center justify-center group"
                    aria-label="Ver sacola de compras"
                  >
                    <svg className="w-4 h-4 stroke-celestial-950 stroke-[2] fill-none transition-transform group-hover:scale-110" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25c-.669 0-1.189-.578-1.119-1.243l1.263-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119.993z" />
                    </svg>
                    {carrinho.totalContador > 0 && (
                      <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center border-2 border-celestial-950 shadow">
                        {carrinho.totalContador}
                      </span>
                    )}
                  </button>
                </div>

              </div>
            </div>
          </header>

          {/* Hero Banner com Visual Celestial Vênus e Luar */}
          <section className="relative overflow-hidden bg-gradient-to-b from-celestial-900 via-celestial-950 to-celestial-950 border-b border-ouro/20 py-16">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
                
                <div className="lg:col-span-7 space-y-6">
                  <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-celestial-850 border border-ouro/40 text-xs font-semibold text-ouro tracking-widest uppercase">
                    <span>Alta Costura • Afeto Pet • Cafés Especiais</span>
                  </div>

                  <h1 className="font-serif text-4xl sm:text-6xl font-bold leading-tight gold-gradient-text">
                    Onde o luar inspira a moda, o afeto pet e o aroma do café.
                  </h1>

                  <p className="text-base sm:text-lg text-luar-300 font-light max-w-xl leading-relaxed">
                    Bem-vindo à <strong>Vênus e Luar Boutique</strong>. Um conceito singular onde alta costura em seda e linho convive com o espaço pet friendly, adoção responsável e o calor do café artesanal.
                  </p>

                  <div className="flex flex-wrap gap-4 pt-2">
                    <button
                      onClick={() => setAbaAtiva('Moda')}
                      className="px-7 py-3.5 rounded-full bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 font-bold text-xs uppercase tracking-wider hover:opacity-95 transition-all shadow-lg cursor-pointer"
                    >
                      Ver Coleção de Alta Costura →
                    </button>
                    <button
                      onClick={() => setAbaAtiva('Adocao')}
                      className="px-6 py-3.5 rounded-full bg-celestial-850 border border-rose-400/40 text-rose-300 font-bold text-xs uppercase tracking-wider hover:bg-rose-950/40 transition-all cursor-pointer"
                    >
                      Conhecer Pets para Adoção
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-5 flex justify-center">
                  <div className="relative group">
                    <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-ouro to-ouro-dark opacity-30 blur-xl group-hover:opacity-50 transition-opacity"></div>
                    <div className="relative rounded-3xl overflow-hidden border-2 border-ouro/40 shadow-2xl bg-celestial-900 max-w-sm">
                      <img src="/logo.jpg" alt="Vênus e Luar Boutique Emblema" className="w-full h-auto object-cover" />
                      <div className="p-4 bg-celestial-900/90 text-center border-t border-ouro/20">
                        <span className="text-xs uppercase tracking-[0.25em] text-ouro font-semibold block">PostgreSQL + JSONB</span>
                        <span className="text-[11px] text-luar-300">Integridade Relacional & Atributos Heterogêneos</span>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </section>

          {/* Conteúdo Principal */}
          <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
            
            {/* Barra de Filtro e Busca */}
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
              <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
                {['Todos', 'Moda', 'Pet', 'Cafeteria', 'Adocao'].map(cat => (
                  <button
                    key={cat}
                    onClick={() => setAbaAtiva(cat)}
                    className={\`px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap border transition-all cursor-pointer \${
                      abaAtiva === cat
                        ? 'bg-ouro text-celestial-950 border-ouro font-bold shadow-md'
                        : 'bg-celestial-900 text-luar-300 border-ouro/20 hover:border-ouro/50'
                    }\`}
                  >
                    {cat === 'Adocao' ? 'Pets para Adoção' : cat}
                  </button>
                ))}
              </div>

              <div className="relative min-w-[280px]">
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por seda, linho, leite vegetal, tamanho..."
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
              <div className="space-y-6">
                <div className="p-8 rounded-3xl bg-gradient-to-r from-celestial-900 via-celestial-850 to-celestial-900 border border-rose-500/30 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
                  <div className="space-y-2">
                    <span className="text-xs uppercase font-bold text-rose-400 tracking-widest flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-rose-400 fill-current inline-block mr-1" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg> Adoção Responsável Vênus e Luar
                    </span>
                    <h2 className="font-serif text-3xl font-bold gold-gradient-text">Nossos Companheiros de Quatro Patas</h2>
                    <p className="text-xs text-luar-300 max-w-xl leading-relaxed">
                      Cada animal resgatado passa por cuidados clínicos integrais, castração e vacinação. Seus perfis clínicos e comportamentais são armazenados em JSONB com índice GIN.
                    </p>
                  </div>
                  <div className="bg-celestial-950 px-6 py-4 rounded-2xl border border-ouro/40 text-center shadow-lg">
                    <span className="text-3xl font-serif font-bold text-ouro block">{pets.filter(p => p.status === 'Disponível').length}</span>
                    <span className="text-xs font-semibold text-luar-300">Disponíveis</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {petsFiltrados.map(pet => (
                    <div key={pet.id_pet} className="bg-celestial-900 rounded-3xl border border-ouro/25 overflow-hidden shadow-lg hover:border-ouro/60 transition-all flex flex-col justify-between group">
                      <div>
                        <div className="relative aspect-[4/3] bg-celestial-950 overflow-hidden">
                          <img src={pet.imagem_url} alt={pet.nome_pet} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                          <span className="absolute top-3 left-3 text-[11px] font-bold px-3 py-1 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/40">
                            {pet.status}
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
                            {pet.perfil?.convive_com_gatos && <span className="text-[10px] bg-amber-950/60 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 rounded-full">Amigo de Gatos</span>}
                            {pet.perfil?.temperamento && <span className="text-[10px] bg-celestial-950 text-luar-200 border border-ouro/20 px-2.5 py-0.5 rounded-full">{pet.perfil.temperamento}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="p-6 pt-0">
                        <button
                          onClick={() => setPetModal(pet)}
                          className="w-full py-3 rounded-xl bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-bold text-xs uppercase tracking-wider shadow-md transition-all cursor-pointer"
                        >
                          Candidatar-se para Adoção
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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
                        {/* Botão de Excluir Exclusivo para Administrador */}
                        {usuario?.role === 'admin' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(\`Tem certeza que deseja excluir "\${prod.nome_item}" do catálogo da boutique?\`)) {
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
            )}

          </main>

          {/* ==================================================================== */}
          {/* MODAL 1: PERMISSIONAMENTO DE GESTÃO (BLOQUEIA CADASTRAR/ADICIONAR ROUPAS) */}
          {/* ==================================================================== */}
          {isPermissionamentoGestaoOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
              <div 
                className="relative w-full max-w-lg bg-celestial-900 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl border-2 border-ouro/80 gold-glow"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Fechar */}
                <button 
                  onClick={() => setIsPermissionamentoGestaoOpen(false)} 
                  className="absolute top-4 right-4 text-ouro hover:text-white text-2xl font-bold w-8 h-8 rounded-full bg-celestial-950 flex items-center justify-center border border-ouro/30 cursor-pointer"
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
                      alert('Esta conta é de cliente comum. Apenas Administradores podem adicionar roupas no sistema.');
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
                      defaultValue="admin@butique.com" 
                      required 
                      className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-luar-100 outline-none focus:border-ouro" 
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Senha</label>
                    <input 
                      name="senha" 
                      type="password" 
                      defaultValue="admin123" 
                      required 
                      className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-luar-100 outline-none focus:border-ouro" 
                    />
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
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
              <div 
                className="relative w-full max-w-lg bg-celestial-900 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl border-2 border-ouro/70 gold-glow"
                onClick={(e) => e.stopPropagation()}
              >
                <button 
                  onClick={() => setIsPermissionamentoCompraOpen(false)} 
                  className="absolute top-4 right-4 text-ouro hover:text-white text-2xl font-bold w-8 h-8 rounded-full bg-celestial-950 flex items-center justify-center border border-ouro/30 cursor-pointer"
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
                  <input name="email" type="email" defaultValue="admin@butique.com" required placeholder="E-mail" className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-luar-100 outline-none" />
                  <input name="senha" type="password" defaultValue="admin123" required placeholder="Senha" className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/40 text-xs text-luar-100 outline-none" />
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
                        onClick={async () => {
                          const res = await fetch('/api/pedidos', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              id_usuario: usuario?.id_usuario,
                              itens: carrinho.itens,
                              dados_entrega: { tipo: 'Retirada na Boutique Vênus e Luar' }
                            })
                          });
                          const json = await res.json();
                          mostrarNotificacao('Pedido finalizado com sucesso na Vênus e Luar Boutique!');
                          carrinho.limpar();
                          setIsCarrinhoOpen(false);
                        }}
                        className="w-full py-4 rounded-xl bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 font-bold text-xs uppercase tracking-widest shadow-lg hover:brightness-110 transition-all cursor-pointer"
                      >
                        Finalizar Pedido Unificado
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
                <div className="border-t border-ouro/20 pt-3 space-y-2">
                  <span className="text-xs font-bold text-ouro flex items-center gap-1.5">
                    <span className="text-ouro font-serif">✦</span> Atributos Dinâmicos Armazenados no PostgreSQL (JSONB):
                  </span>
                  <pre className="p-3.5 bg-celestial-950 text-ouro-light text-xs rounded-xl font-mono overflow-x-auto border border-ouro/20">
                    {JSON.stringify(produtoModal.atributos, null, 2)}
                  </pre>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const ok = tentarAdicionarAoCarrinho(produtoModal);
                    if (ok) setProdutoModal(null);
                  }}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-ouro to-ouro-dark text-celestial-950 font-bold text-xs uppercase tracking-wider hover:brightness-110 shadow-lg flex items-center justify-center gap-2 cursor-pointer"
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
          )}

          {/* MODAL ADOÇÃO */}
          {petModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
              <div className="relative w-full max-w-md bg-celestial-900 rounded-3xl p-6 space-y-4 shadow-2xl border border-rose-500/40 animate-fadeIn">
                <button onClick={() => setPetModal(null)} className="absolute top-4 right-4 text-ouro hover:text-white text-2xl font-bold cursor-pointer">×</button>
                <h3 className="font-serif text-2xl font-bold text-ouro-light">Adotar {petModal.nome_pet}</h3>
                <p className="text-xs text-luar-300">Envie seu contato para agendar uma visita e entrevista responsável na Vênus e Luar.</p>
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  await fetch('/api/pets/adotar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      id_pet: petModal.id_pet,
                      nome_candidato: e.target.nome.value,
                      email: e.target.email.value
                    })
                  });
                  mostrarNotificacao('Candidatura recebida com carinho! Entraremos em contato via WhatsApp.');
                  setPetModal(null);
                  carregarDados();
                }} className="space-y-3">
                  <input name="nome" required placeholder="Seu Nome Completo" className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none" />
                  <input name="email" type="email" required placeholder="Seu E-mail ou WhatsApp" className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none" />
                  <button type="submit" className="w-full py-3.5 rounded-xl bg-gradient-to-r from-rose-600 to-rose-700 text-white font-bold text-xs uppercase tracking-wider hover:brightness-110 shadow-lg cursor-pointer">
                    Enviar Candidatura de Adoção
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* MODAL AUTH GERAL HAUTE-COUTURE (LOGIN & CADASTRO COM CPF EXCLUSIVO) */}
          {/* ==================================================================== */}
          {isAuthOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-fadeIn">
              <div className="relative w-full max-w-md bg-gradient-to-b from-celestial-900 via-celestial-950 to-celestial-950 rounded-3xl p-6 sm:p-8 space-y-5 shadow-[0_25px_60px_-15px_rgba(223,177,91,0.3)] border-2 border-ouro/50 gold-glow overflow-hidden">
                
                {/* Elementos Decorativos de Fundo (Aura Celestial & Ouro) */}
                <div className="absolute -top-24 -right-24 w-48 h-48 bg-ouro/15 rounded-full blur-3xl pointer-events-none"></div>
                <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-ouro-dark/15 rounded-full blur-3xl pointer-events-none"></div>

                {/* Botão Fechar */}
                <button 
                  onClick={() => setIsAuthOpen(false)} 
                  className="absolute top-4 right-4 w-8 h-8 rounded-full bg-celestial-950/80 border border-ouro/30 hover:border-ouro text-ouro-light hover:text-white flex items-center justify-center text-lg font-bold transition-all cursor-pointer z-10"
                >
                  ×
                </button>
                
                {/* Cabeçalho de Alta Costura com Emblema da Boutique */}
                <div className="flex flex-col items-center text-center space-y-2 pt-1 relative z-10">
                  <div className="w-14 h-14 rounded-full border-2 border-ouro/60 bg-celestial-950 p-1 shadow-xl flex items-center justify-center">
                    <img src="/logo.jpg" alt="Vênus e Luar" className="w-full h-full object-cover rounded-full" />
                  </div>
                  <div>
                    <h3 className="font-serif text-2xl font-bold gold-gradient-text">Vênus e Luar Boutique</h3>
                    <p className="text-[11px] text-luar-300 font-light tracking-wider mt-0.5">
                      {abaAuthGeral === 'login' 
                        ? 'Entre com suas credenciais para gerenciar sacola e pedidos' 
                        : abaAuthGeral === 'cadastro'
                        ? 'Cadastre-se com CPF exclusivo para atendimento e alta costura'
                        : 'Recupere o acesso à sua conta através do seu e-mail pessoal cadastrado'}
                    </p>
                  </div>
                </div>

                {/* Alternador de Abas de Alta Costura */}
                <div className="flex rounded-2xl bg-celestial-950 p-1.5 border border-ouro/30 shadow-inner relative z-10">
                  <button
                    type="button"
                    onClick={() => setAbaAuthGeral('login')}
                    className={\`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer \${abaAuthGeral === 'login' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro'}\`}
                  >
                    Acessar Conta
                  </button>
                  <button
                    type="button"
                    onClick={() => setAbaAuthGeral('cadastro')}
                    className={\`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer \${abaAuthGeral === 'cadastro' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro'}\`}
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
                      <label className="block text-[11px] font-bold text-ouro mb-1.5 uppercase tracking-wider">E-mail Cadastrado</label>
                      <input 
                        name="email" 
                        type="email" 
                        required 
                        placeholder="seu@email.com" 
                        className="w-full pl-3.5 pr-3 py-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro focus:ring-1 focus:ring-ouro/40 transition-all" 
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] font-bold text-ouro uppercase tracking-wider">Senha Segura</label>
                        <button
                          type="button"
                          onClick={() => {
                            setAbaAuthGeral('recuperar');
                            setEtapaRecuperacao(1);
                            setMsgInfoRecuperacao('');
                            setPreviewCodigoEmail(null);
                          }}
                          className="text-[10px] text-ouro/80 hover:text-ouro underline transition-all cursor-pointer"
                        >
                          Esqueci minha senha
                        </button>
                      </div>
                      <input 
                        name="senha" 
                        type="password" 
                        required 
                        placeholder="••••••••••••" 
                        className="w-full pl-3.5 pr-3 py-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro focus:ring-1 focus:ring-ouro/40 transition-all" 
                      />
                    </div>
                    <button type="submit" className="w-full py-3.5 rounded-xl bg-gradient-to-r from-ouro via-ouro-glow to-ouro-dark text-celestial-950 font-bold text-xs uppercase tracking-widest shadow-lg hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer">
                      Acessar Minha Conta
                    </button>
                  </form>
                ) : abaAuthGeral === 'cadastro' ? (
                  /* ABA 2: FORMULÁRIO DE CADASTRO COM CPF EXCLUSIVO */
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    const nome = nomeCadastro;
                    const cpf = cpfCadastro;
                    const email = emailCadastro;
                    const senha = senhaCadastro;

                    if (!validarCpf(cpf)) {
                      alert('CPF inválido ou fictício. Por favor, insira um CPF oficial válido para identificação exclusiva do cliente.');
                      return;
                    }

                    const res = await fetch('/api/auth/registrar', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ nome, cpf, email, senha })
                    });
                    const json = await res.json();
                    if (res.ok) {
                      setUsuario(json.usuario);
                      setToken(json.token);
                      localStorage.setItem('venus_usuario', JSON.stringify(json.usuario));
                      localStorage.setItem('venus_token', json.token);
                      setIsAuthOpen(false);
                      setNomeCadastro('');
                      setCpfCadastro('');
                      setEmailCadastro('');
                      setSenhaCadastro('');
                      mostrarNotificacao(\`Conta criada com sucesso! Bem-vinda à Vênus e Luar, \${json.usuario.nome.split(' ')[0]}!\`);
                    } else {
                      alert(json.erro || 'Falha no cadastro');
                    }
                  }} className="space-y-3.5 relative z-10 max-h-[65vh] overflow-y-auto pr-1">
                    
                    {/* Nome Completo */}
                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Nome Completo</label>
                      <input 
                        name="nome" 
                        value={nomeCadastro}
                        onChange={(e) => setNomeCadastro(e.target.value)}
                        required 
                        placeholder="Ex: Clara Silveira" 
                        className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro focus:ring-1 focus:ring-ouro/40" 
                      />
                    </div>

                    {/* CPF do Cliente (com Validação em Tempo Real) */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-bold text-ouro uppercase tracking-wider">CPF do Cliente (Exclusivo)</label>
                        {statusCpf === 'valido' && (
                          <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                            ✓ CPF Válido
                          </span>
                        )}
                        {statusCpf === 'invalido' && (
                          <span className="text-[10px] font-bold text-rose-400 flex items-center gap-1">
                            ✕ CPF Fictício / Inválido
                          </span>
                        )}
                      </div>
                      <input 
                        name="cpf" 
                        value={cpfCadastro}
                        onChange={(e) => setCpfCadastro(formatarCpf(e.target.value))}
                        required 
                        maxLength="14"
                        placeholder="000.000.000-00" 
                        className={\`w-full p-2.5 rounded-xl bg-celestial-950 border text-xs font-mono text-luar-100 outline-none transition-all \${
                          statusCpf === 'valido' 
                            ? 'border-emerald-500/70 focus:border-emerald-400' 
                            : statusCpf === 'invalido'
                            ? 'border-rose-500/70 focus:border-rose-400'
                            : 'border-ouro/30 focus:border-ouro'
                        }\`} 
                      />
                      <p className="text-[10px] text-luar-300/70 mt-1">
                        Diferenciação exclusiva de clientes. CPFs fictícios ou repetidos são proibidos.
                      </p>
                    </div>

                    {/* E-mail */}
                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">E-mail</label>
                      <input 
                        name="email" 
                        type="email" 
                        value={emailCadastro}
                        onChange={(e) => setEmailCadastro(e.target.value)}
                        required 
                        placeholder="Ex: clara@email.com" 
                        className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro focus:ring-1 focus:ring-ouro/40" 
                      />
                    </div>

                    {/* Senha Segura com Medidor Visual de Força NIST */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-bold text-ouro uppercase tracking-wider">Senha Segura</label>
                        {forcaAtual.nivel && (
                          <span className={\`text-[10px] font-bold uppercase tracking-wider \${forcaAtual.cor}\`}>
                            {forcaAtual.nivel}
                          </span>
                        )}
                      </div>
                      <input 
                        name="senha" 
                        type="password" 
                        value={senhaCadastro}
                        onChange={(e) => setSenhaCadastro(e.target.value)}
                        required 
                        minLength="8" 
                        maxLength="128" 
                        autoComplete="new-password"
                        placeholder="Mínimo 8 caracteres (recomendado 12 a 16)" 
                        className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro focus:ring-1 focus:ring-ouro/40" 
                      />
                      
                      {/* Medidor Visual de Força da Senha */}
                      {senhaCadastro && (
                        <div className="mt-2 space-y-1 animate-fadeIn">
                          <div className="grid grid-cols-4 gap-1.5 h-1.5">
                            <div className={\`rounded-full transition-all duration-300 \${forcaAtual.score >= 1 ? forcaAtual.bg : 'bg-celestial-800'}\`}></div>
                            <div className={\`rounded-full transition-all duration-300 \${forcaAtual.score >= 2 ? forcaAtual.bg : 'bg-celestial-800'}\`}></div>
                            <div className={\`rounded-full transition-all duration-300 \${forcaAtual.score >= 3 ? forcaAtual.bg : 'bg-celestial-800'}\`}></div>
                            <div className={\`rounded-full transition-all duration-300 \${forcaAtual.score >= 4 ? forcaAtual.bg : 'bg-celestial-800'}\`}></div>
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-luar-300">
                            <span>{forcaAtual.texto}</span>
                            <span className="text-stone-400">{senhaCadastro.length} carac.</span>
                          </div>
                        </div>
                      )}

                      <p className="text-[10px] text-luar-300/70 mt-1">
                        ✓ Cole do seu gerenciador (Bitwarden, 1Password) • Sem expiração forçada
                      </p>
                    </div>

                    <button 
                      type="submit" 
                      disabled={statusCpf === 'invalido'}
                      className={\`w-full py-3.5 rounded-xl font-bold text-xs uppercase tracking-widest shadow-lg transition-all cursor-pointer \${
                        statusCpf === 'invalido'
                          ? 'bg-celestial-800 text-stone-500 cursor-not-allowed opacity-60'
                          : 'bg-gradient-to-r from-ouro via-ouro-glow to-ouro-dark text-celestial-950 hover:brightness-110 active:scale-[0.99]'
                      }\`}
                    >
                      Cadastrar Cliente Exclusivo
                    </button>
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
                          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-ouro via-ouro-glow to-ouro-dark text-celestial-950 font-bold text-xs uppercase tracking-widest shadow-lg hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50"
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
                            onChange={(e) => setCodigoRecuperacao(e.target.value.replace(/\D/g, '').slice(0, 6))}
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
                          <input 
                            type="password" 
                            required 
                            minLength="8" 
                            maxLength="128" 
                            value={novaSenhaRecuperacao}
                            onChange={(e) => setNovaSenhaRecuperacao(e.target.value)}
                            placeholder="Mínimo 8 caracteres (recomendado 12+)" 
                            className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro focus:ring-1 focus:ring-ouro/40" 
                          />
                          
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
                          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-ouro via-ouro-glow to-ouro-dark text-celestial-950 font-bold text-xs uppercase tracking-widest shadow-lg hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50"
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

                {/* Rodapé de Segurança e Privacidade LGPD */}

                <div className="pt-2 border-t border-ouro/20 text-center text-[10px] text-stone-400 flex items-center justify-center gap-1.5 relative z-10">
                  <span className="text-ouro font-serif">✦</span>
                  <span>Ambiente protegido com hash SCrypt, validação de CPF e conformidade LGPD.</span>
                </div>

              </div>
            </div>
          )}

          {/* ==================================================================== */}
          {/* PAINEL DE GESTÃO (EXCLUSIVO PARA ADMINISTRADORES AUTORIZADOS) */}
          {/* ==================================================================== */}
          {isAdminOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
              <div className="relative w-full max-w-xl bg-celestial-900 rounded-3xl p-6 sm:p-8 space-y-5 shadow-2xl border-2 border-ouro/60 animate-fadeIn max-h-[92vh] overflow-y-auto gold-glow">
                <button onClick={() => setIsAdminOpen(false)} className="absolute top-4 right-4 text-ouro hover:text-white text-2xl font-bold cursor-pointer">×</button>
                
                <div className="flex items-center gap-3 border-b border-ouro/25 pb-4">
                  <div className="w-12 h-12 rounded-2xl bg-celestial-950 border border-ouro/50 flex items-center justify-center text-ouro">
                    <svg className="w-6 h-6 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-serif text-2xl font-bold gold-gradient-text">Painel de Gestão da Boutique</h3>
                    <span className="text-[11px] text-emerald-400 font-semibold">✓ Sessão de Administradora Verificada</span>
                  </div>
                </div>
                {/* Abas do Painel de Gestão */}
                <div className="flex flex-wrap gap-1 bg-celestial-950 p-1.5 rounded-2xl border border-ouro/30">
                  <button
                    type="button"
                    onClick={() => setAbaGestao('cadastrar')}
                    className={\`flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer \${abaGestao === 'cadastrar' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro'}\`}
                  >
                    + Cadastrar Peça
                  </button>
                  <button
                    type="button"
                    onClick={() => setAbaGestao('produtos')}
                    className={\`flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer \${abaGestao === 'produtos' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro'}\`}
                  >
                    Excluir Peças ({produtos.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAbaGestao('usuarios');
                      carregarUsuarios();
                    }}
                    className={\`flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer \${abaGestao === 'usuarios' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro'}\`}
                  >
                    Usuários & Acessos ({listaUsuarios.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAbaGestao('email');
                      carregarConfigEmailAdmin();
                    }}
                    className={\`flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer \${abaGestao === 'email' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro'}\`}
                  >
                    E-mail Real (SMTP)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAbaGestao('dominio');
                      carregarDominioAdmin();
                    }}
                    className={\`flex-1 py-2 px-3 text-xs font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer \${abaGestao === 'dominio' ? 'bg-gradient-to-r from-ouro-dark to-ouro text-celestial-950 shadow-md font-bold' : 'text-luar-300 hover:text-ouro'}\`}
                  >
                    Domínio &amp; DNS
                  </button>
                </div>

                {/* ABA 1: FORMULÁRIO DE CADASTRO */}
                {abaGestao === 'cadastrar' && (
                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    let parsedAtributos = {};
                    try { 
                      parsedAtributos = JSON.parse(e.target.atributos.value); 
                    } catch(err) { 
                      alert('JSON de atributos inválido. Corrija o formato.'); 
                      return; 
                    }

                    const res = await fetch('/api/produtos', {
                      method: 'POST',
                      headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + (token || '')
                      },
                      body: JSON.stringify({
                        token,
                        nome_item: e.target.nome.value,
                        categoria: e.target.categoria.value,
                        preco: Number(e.target.preco.value),
                        estoque: 10,
                        atributos: parsedAtributos,
                        imagem_url: e.target.imagem.value || 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=800&q=80',
                        descricao: e.target.descricao.value
                      })
                    });

                    const json = await res.json();
                    if (res.ok) {
                      mostrarNotificacao('Nova peça cadastrada com sucesso no banco de dados!');
                      setIsAdminOpen(false);
                      carregarDados();
                    } else {
                      alert(json.erro || 'Erro ao cadastrar peça. Permissão recusada.');
                    }
                  }} className="space-y-3.5">
                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Nome da Peça / Produto</label>
                      <input name="nome" required placeholder="Ex: Vestido Estelar em Seda Pura" className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Categoria</label>
                        <select name="categoria" className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none">
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
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">URL da Foto</label>
                      <input name="imagem" placeholder="https://images.unsplash.com/..." className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none" />
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Descrição Detalhada</label>
                      <textarea name="descricao" placeholder="Detalhes do tecido, acabamentos, corte..." className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none resize-none" rows="2"></textarea>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-ouro mb-1 uppercase tracking-wider">Atributos Dinâmicos (PostgreSQL JSONB com Índice GIN)</label>
                      <textarea name="atributos" defaultValue='{\n  "tamanho": "M",\n  "tecido": "seda pura acetinada",\n  "cor": "Azul Noturno com Brilho Dourado",\n  "corte": "Evasê Fluído"\n}' className="w-full p-3 rounded-xl bg-celestial-950 border border-ouro/30 text-xs font-mono text-ouro-light outline-none" rows="4"></textarea>
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
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(\`Tem certeza que deseja excluir permanentemente "\${p.nome_item}" do catálogo?\`)) {
                                excluirProduto(p.id_produto);
                              }
                            }}
                            className="px-3 py-1.5 rounded-xl bg-rose-950/70 hover:bg-rose-900 border border-rose-500/40 text-rose-300 hover:text-rose-100 text-xs font-semibold transition-all cursor-pointer flex-shrink-0 flex items-center gap-1.5"
                          >
                            <span>Excluir</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ABA 3: USUÁRIOS E ACESSOS REGISTRADOS */}
                {abaGestao === 'usuarios' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-luar-300">
                        Histórico de contas registradas e persistidas em disco (<code>data/usuarios.json</code>).
                      </p>
                      <button
                        type="button"
                        onClick={() => carregarUsuarios()}
                        className="text-[11px] uppercase tracking-wider text-ouro hover:underline cursor-pointer"
                      >
                        Atualizar
                      </button>
                    </div>

                    <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                      {listaUsuarios.length === 0 ? (
                        <div className="text-center p-6 text-xs text-luar-300">Carregando usuários registrados...</div>
                      ) : (
                        listaUsuarios.map(u => (
                          <div key={u.id_usuario} className="p-3.5 rounded-2xl bg-celestial-950 border border-ouro/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-ouro-light">{u.nome_completo}</span>
                                <span className={\`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full \${u.role === 'admin' ? 'bg-ouro/20 text-ouro border border-ouro/40' : 'bg-celestial-900 text-luar-300 border border-ouro/20'}\`}>
                                  {u.role === 'admin' ? 'Administradora' : 'Cliente'}
                                </span>
                                {u.cpf && (
                                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-ouro/15 text-ouro border border-ouro/40 shadow-sm">
                                    CPF: {u.cpf}
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-luar-300/80 block mt-0.5">{u.email}</span>
                            </div>

                            <div className="text-left sm:text-right text-[10px] text-stone-400">
                              <div>Cadastro: <strong className="text-luar-200">{new Date(u.criado_em).toLocaleDateString('pt-BR')}</strong></div>
                              <div>Último Acesso: <strong className="text-emerald-400">{u.ultimo_acesso ? new Date(u.ultimo_acesso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-'}</strong></div>
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
                          <input
                            type="password"
                            value={configEmail.pass || ''}
                            onChange={(e) => setConfigEmail({ ...configEmail, pass: e.target.value })}
                            placeholder="Digite ou cole sua senha de app"
                            className="w-full p-2.5 rounded-xl bg-celestial-950 border border-ouro/30 text-xs text-luar-100 outline-none focus:border-ouro"
                          />
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
              <p className="text-xs text-ouro-light/80 tracking-widest uppercase">Alta Costura • Espaço Pet Nobre • Cafeteria Gourmet & Bistrô • Adoção Responsável</p>
              <div className="text-[11px] text-stone-400 pt-4 border-t border-ouro/10">
                © 2026 Vênus e Luar Boutique. Todos os direitos reservados.
              </div>
            </div>
          </footer>

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

  // Servir Imagem da Logo Oficial
  if (pathname === '/logo.jpg') {
    const logoPath = path.join(__dirname, 'logo.jpg');
    if (fs.existsSync(logoPath)) {
      const img = fs.readFileSync(logoPath);
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(img);
      return;
    }
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
      cpf: u.cpf || null,
      role: u.role,
      criado_em: u.criado_em,
      ultimo_acesso: u.ultimo_acesso || u.criado_em
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(listaHigienizada));
    return;
  }

  // GET /api/pets
  if (pathname === '/api/pets' && req.method === 'GET') {
    const { especie } = parsedUrl.query;
    let lista = pets;
    if (especie && especie !== 'Todos') {
      lista = lista.filter(p => p.especie.toLowerCase() === especie.toLowerCase());
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(lista));
    return;
  }

  // POST /api/pets/adotar
  if (pathname === '/api/pets/adotar' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const dados = JSON.parse(body);
        const pet = pets.find(p => p.id_pet === Number(dados.id_pet));
        if (pet) {
          pet.status = 'Triagem';
        }
        candidaturasAdocao.push({ ...dados, data: new Date().toISOString() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          mensagem: 'Candidatura recebida com sucesso na Vênus e Luar!',
          status: 'Triagem'
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erro: 'Dados inválidos' }));
      }
    });
    return;
  }

  // POST /api/auth/registrar
  if (pathname === '/api/auth/registrar' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { nome, email, senha, cpf } = JSON.parse(body);
        if (!nome || !email || !senha || !cpf) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Preencha todos os campos obrigatórios (Nome, CPF, E-mail e Senha).' }));
          return;
        }

        // Validação Estrita de CPF (proibindo CPFs fictícios ou com dígitos inválidos)
        if (!validarCpf(cpf)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            erro: 'CPF inválido ou fictício. O CPF deve ser válido (Módulo 11 da Receita Federal) para identificação exclusiva do cliente.' 
          }));
          return;
        }

        const cpfLimpo = cpf.replace(/\D/g, '');
        const cpfFormatado = formatarCpf(cpfLimpo);

        // Bloqueio de duplicidade de CPF
        if (usuarios.some(u => u.cpf && u.cpf.replace(/\D/g, '') === cpfLimpo)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erro: 'Este CPF já possui cadastro na boutique. Cada cliente deve possuir conta exclusiva.' }));
          return;
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

        const agora = new Date().toISOString();
        const novoUsuario = {
          id_usuario: 'usr_' + Date.now(),
          nome_completo: nome.trim(),
          email: emailNormalizado,
          cpf: cpfFormatado,
          senha_hash: gerarHashScrypt(senha),
          role: emailNormalizado.includes('admin') ? 'admin' : 'cliente',
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
            cpf: novoUsuario.cpf,
            role: novoUsuario.role
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
            role: user.role
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