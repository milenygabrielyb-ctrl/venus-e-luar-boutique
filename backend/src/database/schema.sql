-- 1. Tabela de Usuários (Clientes e Admins)
CREATE TABLE IF NOT EXISTS usuarios (
    id_usuario UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome_completo VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    senha_hash VARCHAR(255) NOT NULL, -- Armazena o hash do Bcrypt
    role VARCHAR(20) DEFAULT 'cliente', -- 'cliente' ou 'admin'
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabela Central de Produtos (Moda, Pet e Café)
CREATE TABLE IF NOT EXISTS produtos (
    id_produto SERIAL PRIMARY KEY,
    nome_item VARCHAR(150) NOT NULL,
    categoria VARCHAR(50) NOT NULL, -- 'Moda', 'Pet', 'Cafeteria'
    preco DECIMAL(10, 2) NOT NULL,
    estoque INT NOT NULL DEFAULT 0,
    -- O JSONB permite armazenar grades dinâmicas e indexáveis
    -- Ex Moda: {"tamanho": "M", "estacao": "inverno", "tecido": "algodao"}
    -- Ex Pet: {"tamanho_pet": "G", "indicacao": "cães mordedores"}
    -- Ex Café: {"volume_ml": 300, "tipo_leite": "vegetal"}
    atributos JSONB NOT NULL DEFAULT '{}'::jsonb,
    imagem_url TEXT,
    descricao TEXT,
    ativo BOOLEAN DEFAULT TRUE
);

-- 3. Tabela de Pets para Adoção (Totalmente isolada do fluxo financeiro)
CREATE TABLE IF NOT EXISTS pets_adocao (
    id_pet SERIAL PRIMARY KEY,
    nome_pet VARCHAR(100) NOT NULL,
    especie VARCHAR(50) NOT NULL,
    -- JSONB para dados clínicos e comportamentais
    -- Ex: {"idade_meses": 14, "castrado": true, "convive_com_gatos": false}
    perfil JSONB NOT NULL DEFAULT '{}'::jsonb,
    imagem_url TEXT,
    historia TEXT,
    status VARCHAR(30) DEFAULT 'Disponível', -- Disponível, Triagem, Adotado
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabela de Pedidos Unificados
CREATE TABLE IF NOT EXISTS pedidos (
    id_pedido SERIAL PRIMARY KEY,
    id_usuario UUID REFERENCES usuarios(id_usuario),
    total DECIMAL(10, 2) NOT NULL,
    status VARCHAR(30) DEFAULT 'Pendente', -- 'Pendente', 'Pago', 'Entregue'
    itens JSONB NOT NULL DEFAULT '[]'::jsonb,
    dados_entrega JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Criação de Índices GIN para buscas ultra-rápidas dentro do JSONB
CREATE INDEX IF NOT EXISTS idx_produtos_atributos ON produtos USING GIN (atributos);
CREATE INDEX IF NOT EXISTS idx_pets_perfil ON pets_adocao USING GIN (perfil);
