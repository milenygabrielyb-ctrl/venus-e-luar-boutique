-- =====================================================================
-- VÊNUS & LUAR BOUTIQUE - DDL SCHEMA RELACIONAL INICIAL (17 TABELAS)
-- Motor: SQLite (node:sqlite) com modo WAL e integridade referencial ativa
-- =====================================================================

-- 1. TABELA DE EMPRESAS / MATRIZ
CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    trade_name TEXT NOT NULL,                     -- Nome Fantasia: Vênus & Luar Boutique
    legal_name TEXT NOT NULL,                     -- Razão Social Ltda
    cnpj TEXT UNIQUE,                             -- CNPJ (ou nulo na fase pré-CNPJ)
    state_registration TEXT,                      -- Inscrição Estadual (IE em ES)
    tax_regime TEXT NOT NULL DEFAULT 'simples_nacional',
    crt INTEGER NOT NULL DEFAULT 1,               -- 1 = Simples Nacional, 3 = Regime Normal
    uf TEXT NOT NULL DEFAULT 'ES',                -- UF Matriz
    city_code TEXT NOT NULL DEFAULT '3205200',    -- Código IBGE Vila Velha - ES (3205200)
    address_street TEXT NOT NULL,
    address_number TEXT NOT NULL,
    address_neighborhood TEXT NOT NULL,
    address_zip TEXT NOT NULL,
    nfce_csc_token_id TEXT,                       -- Identificador do CSC Token (ex: '000001')
    nfce_csc_token_code TEXT,                     -- Código alfanumérico do CSC Token SEFAZ-ES
    certificate_a1_alias TEXT,                    -- Apelido do Certificado Digital e-CNPJ A1
    enable_ibs_cbs_highlight INTEGER NOT NULL DEFAULT 0, -- 0 = Desativado (Simples dispensado); 1 = Ativo
    is_sandbox_mode BOOLEAN NOT NULL DEFAULT 1,   -- 1 = Mock / Sandbox; 0 = SEFAZ Produção
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. TABELA DE PRODUTOS (CATÁLOGO MESTRE & CLASSIFICAÇÃO FISCAL)
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,                       -- Moda, Cosméticos, Pet, Cafeteria, etc.
    description TEXT,
    product_type TEXT NOT NULL,                   -- 'variant' | 'batch' | 'composite' | 'standard'
    base_price DECIMAL(10,2) NOT NULL,
    unit_of_measure TEXT NOT NULL DEFAULT 'UN',   -- UN, PC, KG, G, ML, L
    image_url TEXT,
    
    -- Flags Operacionais e de Canais
    allow_ecommerce BOOLEAN NOT NULL DEFAULT 1,   -- 0 = Apenas PDV/Bistrô Local; 1 = Permite venda online
    exchangeable BOOLEAN NOT NULL DEFAULT 1,      -- 0 = Bloqueio sanitário (Moda íntima); 1 = Troca permitida
    is_raw_material BOOLEAN NOT NULL DEFAULT 0,   -- 1 = Insumo de produção (Café em grãos, leite, etc.)
    is_active BOOLEAN NOT NULL DEFAULT 1,
    
    -- Parâmetros Fiscais (Nível do Item)
    ncm TEXT NOT NULL,
    cest TEXT,
    origin INTEGER NOT NULL DEFAULT 0,            -- 0 = Nacional, 1/2 = Importado
    is_own_production BOOLEAN NOT NULL DEFAULT 0, -- 1 = Produção própria (Bistrô); 0 = Revenda
    has_icms_st BOOLEAN NOT NULL DEFAULT 0,       -- 1 = ICMS-ST (Cosméticos, Rações, Bebidas Frias)
    is_monophasic_pis_cofins BOOLEAN NOT NULL DEFAULT 0, -- 1 = PIS/COFINS Monofásico (CST 04 Alíquota Zero)
    default_cfop TEXT,                            -- CFOP parametrizado individualmente (ex: 5102)
    
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_type ON products(product_type);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_allow_ecom ON products(allow_ecommerce);

-- 3. TABELA DE GRADE DE PRODUTOS (MODA: COR E TAMANHO)
CREATE TABLE IF NOT EXISTS product_variants (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    sku TEXT UNIQUE NOT NULL,
    ean_barcode TEXT UNIQUE,
    color TEXT NOT NULL,
    size TEXT NOT NULL,
    price_override DECIMAL(10,2),
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_variants_sku ON product_variants(sku);

-- 4. TABELA DE LOTES E VALIDADE (FEFO - COSMÉTICOS & RAÇÕES PET)
CREATE TABLE IF NOT EXISTS product_batches (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    variant_id TEXT,
    batch_number TEXT NOT NULL,
    manufacture_date DATE,
    expiration_date DATE NOT NULL,
    initial_quantity DECIMAL(10,3) NOT NULL,
    current_quantity DECIMAL(10,3) NOT NULL,
    supplier_invoice_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',        -- 'active' | 'depleted' | 'quarantine' | 'expired'
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_batches_product_fefo ON product_batches(product_id, expiration_date, status);

-- 5. TABELA DE FICHAS TÉCNICAS (BISTRÔ & CAFETERIA)
CREATE TABLE IF NOT EXISTS product_recipes (
    id TEXT PRIMARY KEY,
    composite_product_id TEXT NOT NULL,
    ingredient_product_id TEXT NOT NULL,
    quantity_required DECIMAL(10,4) NOT NULL,
    unit_of_measure TEXT NOT NULL,
    loss_factor DECIMAL(5,2) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (composite_product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (ingredient_product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_recipes_composite ON product_recipes(composite_product_id);

-- 6. TABELA DE SALDOS DE ESTOQUE OMNICHANNEL (3 ESTADOS)
CREATE TABLE IF NOT EXISTS inventory_balances (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    variant_id TEXT,
    physical_stock DECIMAL(10,3) NOT NULL DEFAULT 0,
    reserved_stock DECIMAL(10,3) NOT NULL DEFAULT 0,
    available_stock DECIMAL(10,3) GENERATED ALWAYS AS (physical_stock - reserved_stock) VIRTUAL,
    min_stock_alert DECIMAL(10,3) NOT NULL DEFAULT 2,
    location TEXT NOT NULL DEFAULT 'LOJA-VILA-VELHA',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_unique_balance 
ON inventory_balances(product_id, COALESCE(variant_id, ''), location);

CREATE INDEX IF NOT EXISTS idx_inventory_lookup ON inventory_balances(product_id, variant_id);

-- 7. TABELA DE MOVIMENTAÇÃO DE ESTOQUE (KARDEX AUDITÁVEL)
CREATE TABLE IF NOT EXISTS inventory_movements (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    variant_id TEXT,
    batch_id TEXT,
    movement_type TEXT NOT NULL,                  -- 'IN_PURCHASE' | 'OUT_SALE' | 'OUT_RECIPE_BISTRO' | 'OUT_RETURN' | 'OUT_INTERNAL_USE' | 'ADJUST_LOSS'
    quantity DECIMAL(10,3) NOT NULL,              -- Positivo para entrada, negativo para saída
    balance_after DECIMAL(10,3) NOT NULL,
    reference_order_id TEXT,
    reference_invoice_id TEXT,
    notes TEXT,
    operator_name TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_movements_prod ON inventory_movements(product_id, created_at);

-- 8. TABELA DE CLIENTES (CADASTRO UNIFICADO PF E PJ)
CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    person_type TEXT NOT NULL DEFAULT 'F',         -- 'F' = Física; 'J' = Jurídica
    name TEXT NOT NULL,
    cpf_cnpj TEXT UNIQUE NOT NULL,
    state_registration TEXT,
    email TEXT,
    phone TEXT,
    address_street TEXT,
    address_number TEXT,
    address_complement TEXT,
    address_neighborhood TEXT,
    address_city TEXT,
    address_uf TEXT NOT NULL DEFAULT 'ES',
    address_zip TEXT,
    created_via TEXT NOT NULL DEFAULT 'PDV',      -- 'PDV' | 'ECOMMERCE' | 'BISTRO'
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_document ON customers(cpf_cnpj);

-- 9. TABELA DE COMANDAS DO BISTRÔ
CREATE TABLE IF NOT EXISTS bistro_tabs (
    id TEXT PRIMARY KEY,
    tab_number TEXT NOT NULL,                     -- Ex: 'MESA-04', 'BALCAO-01'
    customer_id TEXT,
    customer_name TEXT,
    status TEXT NOT NULL DEFAULT 'open',          -- 'open' | 'billing' | 'closed' | 'cancelled'
    opened_by TEXT NOT NULL,
    opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- 10. TABELA DE ITENS DE COMANDA (KDS COPA/COZINHA)
CREATE TABLE IF NOT EXISTS bistro_tab_items (
    id TEXT PRIMARY KEY,
    tab_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    observations TEXT,
    kitchen_status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'preparing' | 'ready' | 'served'
    printed_in_kitchen BOOLEAN NOT NULL DEFAULT 0,
    added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tab_id) REFERENCES bistro_tabs(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- 11. TABELA DE PEDIDOS OMNICHANNEL
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    channel TEXT NOT NULL,                        -- 'POS_RETAIL' | 'BISTRO_TAB' | 'ECOMMERCE'
    customer_id TEXT,                             -- Opcional (nulo no balcão quando cliente não cadastra)
    customer_cpf_snapshot TEXT,                   -- CPF avulso informado no caixa
    customer_name_snapshot TEXT,                  -- Nome avulso ou 'Consumidor Final'
    status TEXT NOT NULL DEFAULT 'pending',       -- 'pending' | 'paid' | 'invoiced' | 'cancelled' | 'refunded'
    
    subtotal DECIMAL(10,2) NOT NULL,
    discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    shipping_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(10,2) NOT NULL,
    
    payment_method TEXT NOT NULL,                 -- 'CASH' | 'PIX' | 'CREDIT_CARD' | 'DEBIT_CARD'
    payment_details TEXT,
    
    bistro_tab_id TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (bistro_tab_id) REFERENCES bistro_tabs(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- 12. TABELA DE ITENS DO PEDIDO (SNAPSHOT FISCAL)
CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT,
    batch_id TEXT,
    product_name TEXT NOT NULL,
    quantity DECIMAL(10,3) NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    
    -- Snapshot Tributário
    ncm TEXT NOT NULL,
    cest TEXT,
    cfop TEXT NOT NULL,                           -- 5101, 5102, 5405, 6108, etc.
    csosn TEXT NOT NULL,                          -- 102, 500, etc.
    pis_cst TEXT NOT NULL,                        -- 04, 07, 49, etc.
    cofins_cst TEXT NOT NULL,
    icms_base DECIMAL(10,2) NOT NULL DEFAULT 0,
    icms_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
    icms_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    icms_st_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    
    -- Projeção Reforma Tributária 2026
    cbs_rate DECIMAL(5,2) NOT NULL DEFAULT 0.90,
    cbs_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    ibs_rate DECIMAL(5,2) NOT NULL DEFAULT 0.10,
    ibs_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- 13. TABELA DE CONTROLE DE SÉRIE FISCAL (NUMERAÇÃO CONTÍNUA)
CREATE TABLE IF NOT EXISTS fiscal_series_control (
    company_id TEXT NOT NULL,
    model TEXT NOT NULL,                          -- '55' (NF-e) | '65' (NFC-e)
    series INTEGER NOT NULL,
    current_number INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(company_id, model, series),
    FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- 14. TABELA DE DOCUMENTOS FISCAIS (DESACOPLADA)
CREATE TABLE IF NOT EXISTS fiscal_documents (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    order_id TEXT NOT NULL,
    model TEXT NOT NULL,                          -- '55' | '65'
    series INTEGER NOT NULL DEFAULT 1,
    document_number INTEGER NOT NULL,
    access_key TEXT UNIQUE,
    emission_type INTEGER NOT NULL DEFAULT 1,     -- 1 = Normal; 9 = Contingência Off-line
    status TEXT NOT NULL DEFAULT 'pending',       -- 'pending' | 'authorized' | 'rejected' | 'contingency' | 'cancelled'
    status_code INTEGER,
    status_reason TEXT,
    xml_content TEXT,
    protocol_number TEXT,
    qr_code_url TEXT,
    issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    contingency_reason TEXT,
    contingency_synced_at DATETIME,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_docs_key ON fiscal_documents(access_key);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_order ON fiscal_documents(order_id);

-- 15. TABELA DE NOTAS DE COMPRA DE FORNECEDORES (INBOUND)
CREATE TABLE IF NOT EXISTS inbound_invoices (
    id TEXT PRIMARY KEY,
    access_key TEXT UNIQUE NOT NULL,
    supplier_cnpj TEXT NOT NULL,
    supplier_name TEXT NOT NULL,
    invoice_number INTEGER NOT NULL,
    invoice_series INTEGER NOT NULL,
    issue_date DATETIME NOT NULL,
    total_invoice_amount DECIMAL(10,2) NOT NULL,
    raw_xml TEXT NOT NULL,
    imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 16. TABELA DE ITENS DA NOTA DE COMPRA
CREATE TABLE IF NOT EXISTS inbound_invoice_items (
    id TEXT PRIMARY KEY,
    inbound_invoice_id TEXT NOT NULL,
    supplier_item_code TEXT NOT NULL,
    supplier_item_name TEXT NOT NULL,
    ncm TEXT NOT NULL,
    cest TEXT,
    cfop_entry TEXT NOT NULL,
    cst_csosn_entry TEXT NOT NULL,
    has_st_detected BOOLEAN NOT NULL DEFAULT 0,
    quantity DECIMAL(10,3) NOT NULL,
    unit_cost DECIMAL(10,2) NOT NULL,
    batch_number TEXT,
    expiration_date DATE,
    matched_product_id TEXT,
    FOREIGN KEY (inbound_invoice_id) REFERENCES inbound_invoices(id) ON DELETE CASCADE,
    FOREIGN KEY (matched_product_id) REFERENCES products(id)
);

-- 17. TABELA DE VITRINE DE ADOÇÃO PET (SOLIDÁRIA / NÃO COMERCIAL)
CREATE TABLE IF NOT EXISTS adoption_pets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    species TEXT NOT NULL DEFAULT 'canino',       -- 'canino' | 'felino' | 'outro'
    breed TEXT NOT NULL DEFAULT 'SRD (Sem Raça Definida)',
    age TEXT,                                     -- Ex: '1 ano e 2 meses', 'Filhote'
    gender TEXT NOT NULL,                         -- 'Macho' | 'Fêmea'
    temperament TEXT,                             -- Ex: 'Dócil, brincalhão, convive bem com gatos'
    vaccinated BOOLEAN NOT NULL DEFAULT 1,
    neutered BOOLEAN NOT NULL DEFAULT 1,
    photo_url TEXT,
    status TEXT NOT NULL DEFAULT 'available',     -- 'available' | 'in_process' | 'adopted'
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_adoption_pets_status ON adoption_pets(status);
