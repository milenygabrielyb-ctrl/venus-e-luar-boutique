# Maison & Pet Bistrô - Software para Boutique Conceito
### Nichos Unificados: Moda & Acessórios, Pet Shop & Adoção Responsável, Cafeteria Especial

---

## 🏛️ 1. Banco de Dados: Modelagem PostgreSQL com JSONB
Para unificar nichos tão diferentes sem criar dezenas de tabelas auxiliares (ex: uma tabela para tamanhos de roupas e outra para tipos de leite do café), utilizamos o tipo de dado **JSONB** do PostgreSQL com **Índices GIN**.
Isso mantém a integridade relacional para preços e estoque, mas dá flexibilidade absoluta para os atributos.

### DDL das Tabelas Principais (`backend/src/database/schema.sql`):
```sql
-- 1. Usuários (Clientes e Admins)
CREATE TABLE usuarios (
    id_usuario UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome_completo VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    senha_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'cliente',
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabela Central de Produtos (Moda, Pet e Café)
CREATE TABLE produtos (
    id_produto SERIAL PRIMARY KEY,
    nome_item VARCHAR(150) NOT NULL,
    categoria VARCHAR(50) NOT NULL,
    preco DECIMAL(10, 2) NOT NULL,
    estoque INT NOT NULL DEFAULT 0,
    atributos JSONB NOT NULL DEFAULT '{}'::jsonb,
    imagem_url TEXT,
    descricao TEXT,
    ativo BOOLEAN DEFAULT TRUE
);

-- 3. Tabela de Pets para Adoção (Isolada do fluxo comercial)
CREATE TABLE pets_adocao (
    id_pet SERIAL PRIMARY KEY,
    nome_pet VARCHAR(100) NOT NULL,
    especie VARCHAR(50) NOT NULL,
    perfil JSONB NOT NULL DEFAULT '{}'::jsonb,
    imagem_url TEXT,
    historia TEXT,
    status VARCHAR(30) DEFAULT 'Disponível',
    criado_em TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índices GIN para consultas velozes em JSONB
CREATE INDEX idx_produtos_atributos ON produtos USING GIN (atributos);
CREATE INDEX idx_pets_perfil ON pets_adocao USING GIN (perfil);
```

---

## ⚡ 2. Backend: Node.js + TypeScript com Auth In-House
- **Criptografia In-House**: Senhas criptografadas com `bcrypt` (12 salt rounds contra força bruta).
- **Sessões JWT**: Token seguro emitido com `jsonwebtoken` e validade de 2 horas.
- **Consultas JSONB**: Endpoints com suporte a filtros flexíveis.
- **Engine Resiliente Integrada**: Funciona perfeitamente conectado a um PostgreSQL real ou com fallback em memória instantâneo pré-carregado com os dados do `seed.sql`.

---

## 🛍️ 3. Frontend: React + Zustand com Persistência
- **Carrinho Unificado**: Permite adicionar um vestido floral de linho, um brinquedo para pet e um cappuccino italiano em uma única sacola de compras.
- **Zustand + LocalStorage**: O carrinho persiste mesmo se o cliente recarregar ou fechar a aba.
- **Design Conceito**: Tipografia editorial, paleta acolhedora, modais dinâmicos para visualização de atributos JSONB e formulário de candidatura para adoção responsável de pets.

---

## 🚀 Como Executar o Projeto

### Servidor de Produção Unificado (Monólito Haute Couture):
```bash
npm install
npm start
# Servidor disponível em: http://localhost:3000
```

### Backend Tradicional (TypeScript / PostgreSQL):
```bash
cd backend
npm install
npm run dev
# Servidor disponível em: http://localhost:3001
```

### Frontend Tradicional (Vite / React):
```bash
cd frontend
npm install
npm run dev
# Aplicação disponível em: http://localhost:5173
```

### Docker (Opcional para PostgreSQL 16 local):
```bash
docker compose up -d
```
