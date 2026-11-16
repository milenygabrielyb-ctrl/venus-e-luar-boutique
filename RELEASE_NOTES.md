# 📜 Release Notes • Vênus & Luar Boutique & PDV Omnichannel

Documento oficial de notas de lançamento e evolução arquitetural do ecossistema tecnológico **Vênus & Luar Haute Couture**, desde a concepção inicial até a versão atual em produção.

---

## 🌟 Visão Geral do Ecossistema

O ecossistema **Vênus & Luar** é uma plataforma de luxo omnichannel que unifica:
1. **E-commerce & Alta Costura** (Porta 3000): Vitrines de vestidos, joias, bolsas e sapatos de luxo com checkout digital (Cartão e PIX instantâneo).
2. **Cafeteria & Bistrô**: Comandas inteligentes para mesas e consumo local, integradas ao monitor de cozinha (**KDS**).
3. **Espaço Pet & Adoção Responsável**: Cuidados de luxo para pets e processos de adoção responsável integrada.
4. **PDV Independente Frente de Caixa** (Porta 3001): Terminal rápido para operação física de balcão, leitor óptico EAN-13, controle de turno de caixa, sangrias, suprimentos e fechamento com conferência cega.
5. **Motor Fiscal SEFAZ-ES (NFC-e / NF-e)**: Conformidade fiscal completa no modelo MOC 4.00, emissão de cupons 80mm com QR Code oficial e chaves de acesso de 44 dígitos.
6. **Infraestrutura Relacional SQLite ACID**: Suporte multi-processo nativo (`node:sqlite`) em modo WAL com 17 tabelas relacionais.

---

## 📅 Linha do Tempo & Histórico de Versões

```mermaid
timeline
    title Linha do Tempo do Ecossistema Vênus & Luar
    section 2026 Q1 : Fundação
        v1.0.0 : Boutique E-commerce Haute Couture : Checkout Digital & Catálogo
        v1.2.0 : Módulo Cafeteria & Bistrô : Comandas de Mesas & Cardápio
        v1.5.0 : Adoção Pet Responsável : Cuidados de Luxo & Animais
    section 2026 Q2 : Engenharia Fiscal & SQLite
        v1.8.0 : Gestão de Equipe & Perfis : Operadores e Permissões
        v2.0.0 : Migração SQLite Relacional : 17 Tabelas WAL & Motor SEFAZ-ES
    section 2026 Q3 : PDV Independente & Omnichannel
        v2.1.0 : PDV Frente de Caixa (3001) : Fluxo Guiado em 4 Etapas
        v2.2.0 : Autenticação & Cadastro Inicial : Padronização Pessoa Física (CPF)
        v2.3.0 : Correção Fuso Horário UTC-3 : Cadastro Ágil de Clientes no Caixa
        v2.4.0 : Suíte Avançada de Varejo : WhatsApp, Caixa Turno, Bip EAN-13, KDS, DRE & Render
```

---

### [v2.4.0] - 2026-11-16 • *Suíte Omnichannel Avançada & Cloud Deploy*

#### 🚀 Novas Funcionalidades
- **📲 Envio de Cupom & Fatura no WhatsApp**:
  - Botão de 1 clique no modal de cupom fiscal do PDV e no checkout do E-commerce.
  - Geração de mensagem com formatação executiva (número da fatura, data em horário de Brasília, itens, total, forma de pagamento e autenticação digital SHA-256).
  - Sanitização automática de telefones celulares no padrão `55DDD9XXXXXXXX`.
- **💵 Controle de Turno de Caixa no PDV**:
  - **Abertura de Caixa**: Registro obrigatório de Fundo de Troco Inicial com identificação do operador responsável.
  - **Suprimento de Caixa**: Entrada de valores para reforço de troco com motivo justificado.
  - **Sangria de Caixa**: Retirada de segurança periódica para cofre com rastreamento de auditoria.
  - **Fechamento de Caixa com Conferência Cega**: O operador informa o valor em cédulas/moedas contadas; o sistema cruza com o saldo esperado (Fundo Inicial + Suprimentos - Sangrias + Vendas em Dinheiro) e gera o espelho com a **Quebra/Sobra de Caixa** e totais por forma de pagamento.
- **🏷️ Leitor de Código de Barras (EAN-13 / Bip Rápido)**:
  - Integração do input de busca ao scanner óptico USB/Bluetooth.
  - Ao pressionar `Enter` com código de barras, SKU ou ID do produto, o item é inserido automaticamente no carrinho.
  - Feedback sonoro agradável com sintetizador Web Audio API (`AudioContext`) e toast visual instantâneo.
- **☕ KDS (Kitchen Display System) para Copa & Bistrô**:
  - Tela dedicada para o barista/copa visualizar pedidos da cafeteria em tempo real.
  - Gestão de ciclo de vida do pedido: `🕒 Na Fila` ➔ `🔥 Em Preparo` ➔ `✅ Pronto para Servir` ➔ `🍽️ Entregue`.
- **📊 DRE Simplificado & Margens no Monitor de Vendas**:
  - Ribom financeiro executivo consolidando: Faturamento Bruto, Deduções Fiscais do Simples Nacional (4.5%), CPV Estimado (~35%), Margem e Lucro Líquido Real (~60.5%) e Ticket Médio Omnichannel.
- **☁️ Arquitetura Multi-Serviço Cloud no Render (`render.yaml`)**:
  - Configuração automatizada para hospedar `venus-e-luar-boutique` (Porta 3000) e `pdv-venus` (Porta 3001) com Node.js 22.11.0 e timezone `America/Sao_Paulo`.

---

### [v2.3.0] - 2026-11-16 • *Conformidade Fiscal de Fuso Horário & Cadastro Balcão*

#### 🔧 Correções & Melhorias
- **🕒 Correção do Fuso Horário SEFAZ (Horário Oficial de Brasília UTC-3)**:
  - Eliminação da divergência de 3 horas em servidores em nuvem (Render, AWS, etc.) através de `process.env.TZ = 'America/Sao_Paulo'`.
  - Função utilitária `getBrasiliaIsoString()` gerando carimbos SEFAZ no formato `YYYY-MM-DDTHH:mm:ss-03:00`.
- **👤 Cadastro Ágil de Clientes no Balcão**:
  - Modal dinâmico permitindo cadastrar novos clientes Pessoa Física diretamente no Passo 1 do PDV sem interromper o atendimento.
  - Correção de expressão regular de limpeza de CPF para padrão universal `/[^0-9]/g`, prevenindo erros de escape em strings template do Node.js.
  - Seleção e preenchimento instantâneo do cliente recém-cadastrado na venda ativa com selo de validação `✓ PF Válida`.

---

### [v2.2.0] - 2026-11-15 • *Autenticação Operacional & Padronização Pessoa Física*

#### 🚀 Novas Funcionalidades
- **🔐 Portal de Login & Cadastro de Operadores no PDV**:
  - Tela de guarda obrigatória na inicialização do PDV (`/` ou `/pdv`).
  - Abas para: Login de Operador, Cadastro Inicial de Novo Operador e Seleção Rápida de Equipe.
  - Armazenamento de sessão de caixa em `localStorage` para agilidade no atendimento contínuo.
- **🏛️ Padronização Exclusiva de Pessoa Física**:
  - Unificação do ecossistema para atendimento exclusivo a Pessoas Físicas com validação rigorosa de CPF de 11 dígitos (rejeição de sequências inválidas como `111.111.111-11`).
  - Remoção de complexidade tributária PJ desnecessária, focando na experiência de alta joalheria e moda feminina.

---

### [v2.1.0] - 2026-11-14 • *Terminal PDV Independente (Frente de Caixa Balcão)*

#### 🚀 Novas Funcionalidades
- **🖥️ Sistema Dedicado na Porta 3001 (`pdv/server.js`)**:
  - Layout profissional de 3 colunas simultâneas (Comandas Bistrô, Catálogo de Produtos e Frente de Caixa Ativo).
  - Fluxo obrigatório guiado em 4 etapas:
    - **Passo 1**: Identificação de Cliente Pessoa Física (Busca preditiva por nome/CPF).
    - **Passo 2**: Adição de produtos (Venda avulsa física ou importação de comanda do bistrô).
    - **Passo 3**: Condições de pagamento (Dinheiro com cálculo automático de troco, Cartões ou PIX).
    - **Passo 4**: Faturamento fiscal, baixa de estoque e emissão de cupom 80mm.
- **📝 Aba de Cadastro Inicial no PDV**:
  - Gestão visual direta de Clientes PF, Produtos e Dados da Loja Física.
  - Ajuste de estoque físico e preços em tempo real.

---

### [v2.0.0] - 2026-11-12 • *Arquitetura Relacional SQLite ACID & Motor SEFAZ-ES*

#### 🏗️ Engenharia & Banco de Dados
- **💾 Implementação de SQLite Relacional (`storage/database.sqlite`)**:
  - Uso do módulo nativo `node:sqlite` (`DatabaseSync`) disponível no Node.js >= 22.5.0.
  - Concorrência de alta velocidade em modo WAL (`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;`).
  - 17 tabelas relacionais com chaves estrangeiras ativas (`foreign_keys = ON`).
- **🧾 Motor Fiscal Omnichannel SEFAZ-ES**:
  - Emissão de NFC-e (Modelo 65) e NF-e (Modelo 55).
  - Snapshot de tributação por item (`ncm`, `cest`, `cfop`, `csosn`, `icms_base`, `icms_rate`, etc.).
  - Assinatura digital SHA-256 e geração de URL de validação pública na SEFAZ do Espírito Santo.
- **📦 Alocação FEFO & Baixa Automática de Insumos**:
  - Rastreabilidade de lotes com vencimento mais próximo (*First Expired, First Out*).
  - Dedução automática de receitas de cafeteria quando pratos/bebidas são comercializados.

---

### [v1.8.0] - 2026-11-10 • *Gestão de Equipe & Perfis de Acesso*

#### 👥 Funcionalidades
- **Módulo de Equipe & Colaboradores**:
  - Perfis de acesso granulares: Administradora, Gerente, Operadora de Caixa, Barista e Vendedora.
  - Matriz de permissões para Caixa, Estoque, Produtos, Faturamento e Espaço Pet.

---

### [v1.5.0] - 2026-11-05 • *Espaço Pet & Adoção Responsável*

#### 🐾 Funcionalidades
- **Módulo Pet de Alta Categoria**:
  - Vitrine de produtos, acessórios e caminhas de luxo para animais de estimação.
  - Galeria de bichinhos disponíveis para adoção responsável com formulário de candidatura.
  - Conexão entre o bem-estar animal e a experiência acolhedora da boutique física.

---

### [v1.2.0] - 2026-11-01 • *Cafeteria & Bistrô Integrado*

#### ☕ Funcionalidades
- **Cardápio Digital & Comandas**:
  - Bebidas artesanais (cafés especiais, chás selecionados, croissants e doces finos).
  - Abertura de comandas por mesa ou balcão.
  - Suporte ao consumo local integrado com faturamento no caixa físico.

---

### [v1.0.0] - 2026-10-25 • *Fundação da Boutique Haute Couture*

#### 👗 Lançamento Inicial
- **Vênus & Luar Boutique**:
  - Design visual Haute Couture nas paletas Preto Celestial, Ouro Nobre e Rosa Champanhe.
  - Catálogo de vestidos de festa, joias, calçados e bolsas de alto padrão.
  - Carrinho de compras reativo e checkout digital completo.
  - Totalmente zero-dependency no backend (Node.js nativo Vanilla HTTP).

---

## 🛠️ Guia de Deploy no Render (Web Services)

Para subir o ecossistema completo na nuvem do Render, crie **dois Web Services independentes** a partir do repositório `milenygabrielyb-ctrl/venus-e-luar-boutique`:

| Campo | Serviço 1: E-commerce Boutique | Serviço 2: PDV Frente de Caixa |
| :--- | :--- | :--- |
| **Name** | `venus-e-luar-boutique` | `pdv-venus` |
| **Language** | `Node` | `Node` |
| **Branch** | `main` | `main` |
| **Region** | `Oregon (US West)` | `Oregon (US West)` |
| **Root Directory** | *(Deixar em branco)* | *(Deixar em branco)* |
| **Build Command** | `npm install` | `npm install` |
| **Start Command** | `node app-server.js` | `node pdv/server.js` *(ou `npm run start:pdv`)* |
| **Instance Type** | `Free` | `Free` |
| **Env Var: `NODE_VERSION`** | `22.11.0` *(Obrigatório para `node:sqlite`)* | `22.11.0` *(Obrigatório para `node:sqlite`)* |
| **Env Var: `TZ`** | `America/Sao_Paulo` | `America/Sao_Paulo` |
| **Env Var de Ligação** | `PDV_URL = https://pdv-venus.onrender.com` | `BOUTIQUE_URL = https://venus-e-luar-boutique.onrender.com` |

---

*Vênus & Luar Haute Couture • Documentação mantida pelo time de engenharia.*
