/**
 * VÊNUS & LUAR BOUTIQUE - MIGRAÇÃO DE DADOS JSON PARA SQLITE RELACIONAL
 * 
 * Executa o schema DDL (17 tabelas) e popula:
 * 1. Matriz de Vila Velha (CRT 1 Simples Nacional)
 * 2. Séries fiscais contínuas (55 e 65)
 * 3. Catálogo mestre com tipos (variant, batch, composite, standard) e regras fiscais
 * 4. Fichas técnicas com baixa de insumos (Café em g e Leite em ml)
 * 5. Saldos de estoque omnichannel em 3 estados (físico, reservado, disponível)
 * 6. Clientes unificados (PF com CPF de 11 dígitos)
 * 7. Histórico de pedidos e snapshots fiscais
 * 8. Vitrine de adoção pet isolada
 */

const fs = require('fs');
const path = require('path');
const { getDb, execScript, transaction } = require('../database');
const sefazConfig = require('../sefaz-config');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const PRODUCTS_JSON = path.join(DATA_DIR, 'produtos.json');
const USERS_JSON = path.join(DATA_DIR, 'usuarios.json');
const ORDERS_JSON = path.join(DATA_DIR, 'pedidos.json');
const PETS_JSON = path.join(DATA_DIR, 'pets.json');
const SCHEMA_FILE = path.join(__dirname, '001_initial_schema.sql');

function carregarJson(arquivo, fallback = []) {
  try {
    if (fs.existsSync(arquivo)) {
      return JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
    }
  } catch (e) {
    console.error('Erro ao ler ' + arquivo + ':', e);
  }
  return fallback;
}

function runMigration() {
  console.log('--- 🚀 INICIANDO MIGRAÇÃO RELACIONAL OMNICHANNEL ---');
  
  // 1. Executar DDL
  const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf-8');
  execScript(schemaSql);
  console.log('✅ Schema DDL inicial executado com sucesso (17 tabelas criadas/verificadas).');

  const db = getDb();

  transaction((db) => {
    // 2. EMPRESA MATRIZ (VILA VELHA - ES)
    const stmtEmpresa = db.prepare(`
      INSERT INTO companies (
        id, trade_name, legal_name, cnpj, state_registration, tax_regime, crt, uf, city_code,
        address_street, address_number, address_neighborhood, address_zip,
        nfce_csc_token_id, nfce_csc_token_code, enable_ibs_cbs_highlight, is_sandbox_mode
      ) VALUES (
        @id, @trade_name, @legal_name, @cnpj, @state_registration, @tax_regime, @crt, @uf, @city_code,
        @address_street, @address_number, @address_neighborhood, @address_zip,
        @nfce_csc_token_id, @nfce_csc_token_code, @enable_ibs_cbs_highlight, @is_sandbox_mode
      )
      ON CONFLICT(id) DO UPDATE SET
        city_code = excluded.city_code,
        enable_ibs_cbs_highlight = excluded.enable_ibs_cbs_highlight,
        updated_at = CURRENT_TIMESTAMP;
    `);

    stmtEmpresa.run({
      id: sefazConfig.COMPANY_DEFAULT_ID,
      trade_name: 'Vênus & Luar Boutique',
      legal_name: 'Vênus & Luar Boutique Ltda',
      cnpj: '00.000.000/0001-91',
      state_registration: 'ISENTO',
      tax_regime: 'simples_nacional',
      crt: sefazConfig.CRT_SIMPLES_NACIONAL,
      uf: sefazConfig.STATE_ABBR_ES,
      city_code: sefazConfig.CITY_CODE_VILA_VELHA, // Vila Velha: 3205200
      address_street: 'Rua Santa Rosa',
      address_number: '123',
      address_neighborhood: 'Glória',
      address_zip: '29122-000',
      nfce_csc_token_id: sefazConfig.DEFAULT_CSC.CSC_ID,
      nfce_csc_token_code: sefazConfig.DEFAULT_CSC.CSC_TOKEN,
      enable_ibs_cbs_highlight: 0, // Simples Nacional dispensado conforme LC 214/2025
      is_sandbox_mode: 1
    });
    console.log('✅ Empresa Matriz configurada (Vila Velha - ES, IBGE 3205200, Simples Nacional CRT 1).');

    // 3. CONTROLE DE SÉRIE FISCAL (NUMERAÇÃO CONTÍNUA)
    const stmtSeries = db.prepare(`
      INSERT INTO fiscal_series_control (company_id, model, series, current_number)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(company_id, model, series) DO NOTHING;
    `);
    stmtSeries.run(sefazConfig.COMPANY_DEFAULT_ID, sefazConfig.MODEL_NFE, 1, 0);
    stmtSeries.run(sefazConfig.COMPANY_DEFAULT_ID, sefazConfig.MODEL_NFCE, 1, 0);
    console.log('✅ Séries fiscais contínuas inicializadas (Modelo 55 e 65).');

    // 4. INSUMOS BRUTOS DE PRODUÇÃO (CAFETERIA/BISTRÔ)
    const insumosIniciais = [
      {
        id: 'insumo_cafe_grao_kg',
        name: 'Insumo: Café em Grãos Gourmet Especial',
        category: 'Insumos',
        description: 'Grãos 100% arábica torra média para espresso e cappuccino.',
        product_type: 'standard',
        base_price: 85.00,
        unit_of_measure: 'G',
        is_raw_material: 1,
        allow_ecommerce: 0,
        ncm: '09012100',
        default_cfop: '5102',
        initial_stock: 5000 // 5.000 gramas = 5kg
      },
      {
        id: 'insumo_leite_integral_l',
        name: 'Insumo: Leite Integral Pasteurizado Especial',
        category: 'Insumos',
        description: 'Leite integral tipo A para vaporização cremosa.',
        product_type: 'standard',
        base_price: 6.50,
        unit_of_measure: 'ML',
        is_raw_material: 1,
        allow_ecommerce: 0,
        ncm: '04012010',
        default_cfop: '5102',
        initial_stock: 20000 // 20.000 ml = 20 litros
      },
      {
        id: 'insumo_cacau_po_g',
        name: 'Insumo: Cacau Nobre 70% em Pó',
        category: 'Insumos',
        description: 'Cacau para polvilhar e receitas especiais.',
        product_type: 'standard',
        base_price: 45.00,
        unit_of_measure: 'G',
        is_raw_material: 1,
        allow_ecommerce: 0,
        ncm: '18050000',
        default_cfop: '5102',
        initial_stock: 2000 // 2.000 gramas = 2kg
      }
    ];

    const stmtInsumo = db.prepare(`
      INSERT INTO products (
        id, name, category, description, product_type, base_price, unit_of_measure,
        allow_ecommerce, exchangeable, is_raw_material, is_active,
        ncm, origin, is_own_production, has_icms_st, is_monophasic_pis_cofins, default_cfop
      ) VALUES (
        @id, @name, @category, @description, @product_type, @base_price, @unit_of_measure,
        @allow_ecommerce, 0, @is_raw_material, 1,
        @ncm, 0, 0, 0, 0, @default_cfop
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        base_price = excluded.base_price;
    `);

    const stmtSaldo = db.prepare(`
      INSERT INTO inventory_balances (id, product_id, variant_id, physical_stock, reserved_stock, location)
      VALUES (?, ?, ?, ?, 0, 'LOJA-VILA-VELHA')
      ON CONFLICT(id) DO UPDATE SET physical_stock = excluded.physical_stock;
    `);

    for (const ins of insumosIniciais) {
      stmtInsumo.run({
        id: ins.id,
        name: ins.name,
        category: ins.category,
        description: ins.description,
        product_type: ins.product_type,
        base_price: ins.base_price,
        unit_of_measure: ins.unit_of_measure,
        allow_ecommerce: ins.allow_ecommerce,
        is_raw_material: ins.is_raw_material,
        ncm: ins.ncm,
        default_cfop: ins.default_cfop
      });
      stmtSaldo.run('bal_' + ins.id, ins.id, null, ins.initial_stock);
    }
    console.log('✅ Insumos de produção inseridos no estoque físico.');

    // 5. PRODUTOS DO CATÁLOGO EXISTENTE (produtos.json)
    const produtosJson = carregarJson(PRODUCTS_JSON);
    const stmtProd = db.prepare(`
      INSERT INTO products (
        id, name, category, description, product_type, base_price, unit_of_measure, image_url,
        allow_ecommerce, exchangeable, is_raw_material, is_active,
        ncm, cest, origin, is_own_production, has_icms_st, is_monophasic_pis_cofins, default_cfop
      ) VALUES (
        @id, @name, @category, @description, @product_type, @base_price, @unit_of_measure, @image_url,
        @allow_ecommerce, @exchangeable, 0, 1,
        @ncm, @cest, 0, @is_own_production, @has_icms_st, @is_monophasic_pis_cofins, @default_cfop
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        base_price = excluded.base_price,
        image_url = excluded.image_url,
        product_type = excluded.product_type,
        ncm = excluded.ncm,
        has_icms_st = excluded.has_icms_st,
        is_monophasic_pis_cofins = excluded.is_monophasic_pis_cofins,
        default_cfop = excluded.default_cfop;
    `);

    const stmtVariant = db.prepare(`
      INSERT INTO product_variants (id, product_id, sku, ean_barcode, color, size, price_override, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(sku) DO NOTHING;
    `);

    const stmtBatch = db.prepare(`
      INSERT INTO product_batches (
        id, product_id, variant_id, batch_number, manufacture_date, expiration_date,
        initial_quantity, current_quantity, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
      ON CONFLICT(id) DO NOTHING;
    `);

    for (const p of produtosJson) {
      const prodId = 'prod_' + p.id_produto;
      const cat = p.categoria || 'Moda';
      
      let productType = 'standard';
      let ncm = '61044300';
      let cest = null;
      let hasIcmsSt = 0;
      let isMonophasic = 0;
      let isOwnProduction = 0;
      let allowEcommerce = 1;
      let exchangeable = 1;
      let defaultCfop = '5102';

      if (cat === 'Moda') {
        productType = 'variant';
        ncm = '61044300';
        defaultCfop = '5102';
        exchangeable = (p.nome_item || '').toLowerCase().includes('íntima') || (p.nome_item || '').toLowerCase().includes('lingerie') ? 0 : 1;
      } else if (cat === 'Pet') {
        const isFood = (p.nome_item || '').toLowerCase().includes('snack') || (p.nome_item || '').toLowerCase().includes('ração');
        if (isFood) {
          productType = 'batch';
          ncm = '23091000';
          cest = '0300100';
          hasIcmsSt = 1;
          defaultCfop = '5405';
        } else {
          productType = 'standard';
          ncm = '42010090';
          defaultCfop = '5102';
        }
      } else if (cat === 'Cafeteria') {
        productType = 'composite';
        ncm = '21011200';
        isOwnProduction = 1;
        allowEcommerce = 0; // Apenas consumo no local / balcão
        exchangeable = 0;
        defaultCfop = '5102'; // Anexo I Simples Nacional
      }

      stmtProd.run({
        id: prodId,
        name: p.nome_item,
        category: cat,
        description: p.descricao || '',
        product_type: productType,
        base_price: Number(p.preco || 0),
        unit_of_measure: 'UN',
        image_url: p.imagem_url || '',
        allow_ecommerce: allowEcommerce,
        exchangeable: exchangeable,
        ncm: ncm,
        cest: cest,
        is_own_production: isOwnProduction,
        has_icms_st: hasIcmsSt,
        is_monophasic_pis_cofins: isMonophasic,
        default_cfop: defaultCfop
      });

      // Saldo de estoque físico
      stmtSaldo.run('bal_' + prodId, prodId, null, Number(p.estoque || 0));

      // Se for Moda (variant), criar variações de cor e tamanho
      if (productType === 'variant') {
        const sizes = ['P', 'M', 'G'];
        const cor = (p.atributos && p.atributos.cor) ? p.atributos.cor : 'Padrão';
        sizes.forEach(sz => {
          const sku = `SKU-MOD-${p.id_produto}-${sz}`;
          stmtVariant.run(`var_${p.id_produto}_${sz}`, prodId, sku, null, cor, sz, null);
        });
      }

      // Se for Pet com lote/validade
      if (productType === 'batch') {
        const batchId = `lote_pet_${p.id_produto}_2026`;
        stmtBatch.run(
          batchId, prodId, null,
          `LOTE-PET-${p.id_produto}-26`,
          '2026-01-10', '2027-12-31',
          Number(p.estoque || 20), Number(p.estoque || 20)
        );
      }
    }
    console.log(`✅ ${produtosJson.length} produtos migrados com regras fiscais e estoque.`);

    // 6. ADICIONAR LINHA DE COSMÉTICOS (COM ST E MONOFÁSICO CST 04)
    const cosmeticosIniciais = [
      {
        id: 'prod_cosm_body_splash_luar',
        name: 'Body Splash Celestial Vênus & Luar 200ml',
        category: 'Cosméticos',
        description: 'Fragrância envolvente com notas de jasmim imperial e baunilha dourada.',
        product_type: 'batch',
        base_price: 89.90,
        unit_of_measure: 'UN',
        image_url: 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?auto=format&fit=crop&w=800&q=80',
        allow_ecommerce: 1,
        exchangeable: 0,
        ncm: '33049990',
        cest: '2001600',
        has_icms_st: 1,
        is_monophasic_pis_cofins: 1,
        default_cfop: '5405',
        stock: 30,
        batch_number: 'LOTE-CSM-01',
        expiration: '2028-06-30'
      },
      {
        id: 'prod_cosm_hidratante_acetinado',
        name: 'Creme Hidratante Acetinado Corporal 250g',
        category: 'Cosméticos',
        description: 'Textura acetinada toque seco com manteiga de karité e óleo de amêndoas.',
        product_type: 'batch',
        base_price: 119.00,
        unit_of_measure: 'UN',
        image_url: 'https://images.unsplash.com/photo-1608248597359-598d1a123687?auto=format&fit=crop&w=800&q=80',
        allow_ecommerce: 1,
        exchangeable: 0,
        ncm: '33049990',
        cest: '2001600',
        has_icms_st: 1,
        is_monophasic_pis_cofins: 1,
        default_cfop: '5405',
        stock: 25,
        batch_number: 'LOTE-CSM-02',
        expiration: '2028-08-31'
      }
    ];

    for (const csm of cosmeticosIniciais) {
      stmtProd.run({
        id: csm.id,
        name: csm.name,
        category: csm.category,
        description: csm.description,
        product_type: csm.product_type,
        base_price: csm.base_price,
        unit_of_measure: csm.unit_of_measure,
        image_url: csm.image_url,
        allow_ecommerce: csm.allow_ecommerce,
        exchangeable: csm.exchangeable,
        ncm: csm.ncm,
        cest: csm.cest,
        is_own_production: 0,
        has_icms_st: csm.has_icms_st,
        is_monophasic_pis_cofins: csm.is_monophasic_pis_cofins,
        default_cfop: csm.default_cfop
      });
      stmtSaldo.run('bal_' + csm.id, csm.id, null, csm.stock);
      stmtBatch.run(
        'batch_' + csm.id, csm.id, null,
        csm.batch_number, '2026-02-01', csm.expiration,
        csm.stock, csm.stock
      );
    }
    console.log('✅ Linha de Cosméticos inserida (ST CSOSN 500 e PIS/COFINS Monofásico CST 04).');

    // 7. FICHAS TÉCNICAS (RECIPES DA CAFETERIA)
    const stmtRecipe = db.prepare(`
      INSERT INTO product_recipes (id, composite_product_id, ingredient_product_id, quantity_required, unit_of_measure, loss_factor)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING;
    `);

    // Cappuccino Vênus & Luar (prod_9): 18g de café e 150ml de leite
    stmtRecipe.run('rec_capp_cafe', 'prod_9', 'insumo_cafe_grao_kg', 18.0000, 'G', 2.0);
    stmtRecipe.run('rec_capp_leite', 'prod_9', 'insumo_leite_integral_l', 150.0000, 'ML', 5.0);
    stmtRecipe.run('rec_capp_cacau', 'prod_9', 'insumo_cacau_po_g', 5.0000, 'G', 1.0);

    // Cold Brew (prod_11): 30g de café
    stmtRecipe.run('rec_coldbrew_cafe', 'prod_11', 'insumo_cafe_grao_kg', 30.0000, 'G', 3.0);
    console.log('✅ Fichas técnicas cadastradas para baixa automática de insumos.');

    // 8. CLIENTES UNIFICADOS (usuarios.json)
    const usuariosJson = carregarJson(USERS_JSON);
    const stmtCustomer = db.prepare(`
      INSERT INTO customers (
        id, person_type, name, cpf_cnpj, email, phone,
        address_street, address_number, address_neighborhood, address_city, address_uf, address_zip,
        created_via
      ) VALUES (
        @id, 'F', @name, @cpf_cnpj, @email, @phone,
        @address_street, @address_number, @address_neighborhood, @address_city, 'ES', @address_zip,
        @created_via
      )
      ON CONFLICT(cpf_cnpj) DO UPDATE SET
        name = excluded.name,
        email = excluded.email,
        phone = excluded.phone,
        updated_at = CURRENT_TIMESTAMP;
    `);

    let cliCount = 0;
    for (const u of usuariosJson) {
      const doc = (u.cpf || '').replace(/\D/g, '');
      if (doc.length === 11) {
        stmtCustomer.run({
          id: u.id_usuario || `cli_${doc}`,
          name: u.nome_completo || u.nome || 'Cliente Cadastrado',
          cpf_cnpj: doc,
          email: u.email || `${doc}@cliente.venusluar.com.br`,
          phone: u.telefone || '(27) 99999-0000',
          address_street: (u.endereco && u.endereco.rua) || 'Rua das Flores',
          address_number: (u.endereco && u.endereco.numero) || '10',
          address_neighborhood: (u.endereco && u.endereco.bairro) || 'Glória',
          address_city: (u.endereco && u.endereco.cidade) || 'Vila Velha',
          address_zip: (u.endereco && u.endereco.cep) || '29122-000',
          created_via: u.role === 'admin' ? 'PDV' : 'ECOMMERCE'
        });
        cliCount++;
      }
    }
    console.log(`✅ ${cliCount} clientes Pessoa Física cadastrados no banco relacional.`);

    // 9. VITRINE DE ADOÇÃO PET (pets.json)
    const petsJson = carregarJson(PETS_JSON);
    const stmtPet = db.prepare(`
      INSERT INTO adoption_pets (
        id, name, species, breed, age, gender, temperament, vaccinated, neutered, photo_url, status
      ) VALUES (
        @id, @name, @species, @breed, @age, @gender, @temperament, @vaccinated, @neutered, @photo_url, @status
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        status = excluded.status;
    `);

    for (const pet of petsJson) {
      stmtPet.run({
        id: 'pet_' + pet.id_pet,
        name: pet.nome_pet,
        species: (pet.especie || 'Cachorro').toLowerCase() === 'gato' ? 'felino' : 'canino',
        breed: pet.porte || 'SRD',
        age: pet.idade_meses ? `${pet.idade_meses} meses` : 'Jovem',
        gender: pet.sexo || 'Macho',
        temperament: (pet.perfil && pet.perfil.temperamento) || 'Dócil e sociável',
        vaccinated: (pet.perfil && pet.perfil.vacinado) ? 1 : 0,
        neutered: (pet.perfil && pet.perfil.castrado) ? 1 : 0,
        photo_url: pet.imagem_url || '',
        status: (pet.status || 'Disponível').toLowerCase() === 'adotado' ? 'adopted' : 'available'
      });
    }
    console.log(`✅ ${petsJson.length} pets de adoção solidária cadastrados na vitrine.`);

    // 10. HISTÓRICO DE PEDIDOS (pedidos.json)
    const pedidosJson = carregarJson(ORDERS_JSON);
    const stmtOrder = db.prepare(`
      INSERT INTO orders (
        id, order_number, channel, customer_id, customer_cpf_snapshot, customer_name_snapshot,
        status, subtotal, discount_amount, shipping_amount, total_amount, payment_method, payment_details,
        created_at
      ) VALUES (
        @id, @order_number, @channel, @customer_id, @customer_cpf_snapshot, @customer_name_snapshot,
        @status, @subtotal, @discount_amount, @shipping_amount, @total_amount, @payment_method, @payment_details,
        @created_at
      )
      ON CONFLICT(order_number) DO NOTHING;
    `);

    const stmtOrderItem = db.prepare(`
      INSERT INTO order_items (
        id, order_id, product_id, product_name, quantity, unit_price, total_price,
        ncm, cfop, csosn, pis_cst, cofins_cst, icms_base, icms_rate, icms_amount, icms_st_amount,
        cbs_rate, cbs_amount, ibs_rate, ibs_amount
      ) VALUES (
        @id, @order_id, @product_id, @product_name, @quantity, @unit_price, @total_price,
        @ncm, @cfop, @csosn, @pis_cst, @cofins_cst, @icms_base, @icms_rate, @icms_amount, @icms_st_amount,
        @cbs_rate, @cbs_amount, @ibs_rate, @ibs_amount
      )
      ON CONFLICT(id) DO NOTHING;
    `);

    let orderCount = 0;
    for (const ord of pedidosJson) {
      const orderId = 'ord_' + (ord.id_pedido || ord.numero_pedido || Math.random().toString(36).slice(2, 9));
      const orderNumber = ord.numero_pedido || `ORD-${ord.id_pedido || orderId}`;
      const channel = ord.origem === 'bistro' ? 'BISTRO_TAB' : (ord.origem === 'pdv' ? 'POS_RETAIL' : 'ECOMMERCE');
      const total = Number(ord.total || ord.valor_total || 0);
      const subtotal = Number(ord.subtotal || total);

      // Vincular cliente se existente
      let custId = null;
      let cpfLimpo = (ord.cpf_cliente || '').replace(/\D/g, '');
      if (cpfLimpo.length === 11) {
        const found = db.prepare('SELECT id FROM customers WHERE cpf_cnpj = ?').get(cpfLimpo);
        if (found) custId = found.id;
      }

      stmtOrder.run({
        id: orderId,
        order_number: orderNumber,
        channel: channel,
        customer_id: custId,
        customer_cpf_snapshot: cpfLimpo.length === 11 ? cpfLimpo : null,
        customer_name_snapshot: ord.nome_cliente || 'Consumidor Final',
        status: ord.status === 'Entregue' || ord.status === 'Faturado' ? 'invoiced' : 'paid',
        subtotal: subtotal,
        discount_amount: Number(ord.desconto || 0),
        shipping_amount: Number(ord.frete || 0),
        total_amount: total,
        payment_method: ord.forma_pagamento || 'PIX',
        payment_details: JSON.stringify({ bandeira: ord.bandeira || 'N/A', parcelas: ord.parcelas || 1 }),
        created_at: ord.criado_em || new Date().toISOString()
      });

      if (Array.isArray(ord.itens)) {
        ord.itens.forEach((it, idx) => {
          const itId = `${orderId}_it_${idx}`;
          const prodId = it.id_produto ? `prod_${it.id_produto}` : 'prod_1';
          const qty = Number(it.quantidade || 1);
          const unitPrice = Number(it.preco || it.preco_unitario || (total / qty));
          const itTotal = qty * unitPrice;

          // Snapshot fiscal inteligente baseado na categoria
          const isSt = (it.categoria === 'Cosméticos' || (it.nome_item || '').toLowerCase().includes('snack'));
          const cfop = isSt ? '5405' : '5102';
          const csosn = isSt ? '500' : '102';
          const pisCst = isSt ? '04' : '49';

          stmtOrderItem.run({
            id: itId,
            order_id: orderId,
            product_id: prodId,
            product_name: it.nome_item || 'Item do Pedido',
            quantity: qty,
            unit_price: unitPrice,
            total_price: itTotal,
            ncm: isSt ? '33049990' : '61044300',
            cfop: cfop,
            csosn: csosn,
            pis_cst: pisCst,
            cofins_cst: pisCst,
            icms_base: isSt ? 0 : itTotal,
            icms_rate: isSt ? 0 : 4.0,
            icms_amount: isSt ? 0 : (itTotal * 0.04),
            icms_st_amount: 0,
            cbs_rate: 0.90,
            cbs_amount: Number((itTotal * 0.009).toFixed(2)),
            ibs_rate: 0.10,
            ibs_amount: Number((itTotal * 0.001).toFixed(2))
          });
        });
      }
      orderCount++;
    }
    console.log(`✅ ${orderCount} pedidos migrados com snapshots fiscais item a item.`);
  });

  console.log('--- 🎉 MIGRAÇÃO RELACIONAL OMNICHANNEL CONCLUÍDA COM SUCESSO! ---');
}

if (require.main === module) {
  try {
    runMigration();
  } catch (err) {
    console.error('❌ ERRO NA MIGRAÇÃO:', err);
    process.exit(1);
  }
}

module.exports = { runMigration };
