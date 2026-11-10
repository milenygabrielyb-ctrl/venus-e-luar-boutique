-- Inserir Produtos de Moda, Pet e Cafeteria
INSERT INTO produtos (nome_item, categoria, preco, estoque, atributos, imagem_url, descricao, ativo) VALUES
-- MODA
(
    'Vestido Floral Midi Linho',
    'Moda',
    289.90,
    15,
    '{"tamanho": "M", "estacao": "primavera/verao", "tecido": "linho com viscose", "cor": "Off-white Floral", "corte": "Evasê", "grades_disponiveis": ["P", "M", "G"]}'::jsonb,
    'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=800&q=80',
    'Vestido midi sofisticado com caimento fluído em tecido natural e estampa botânica exclusiva da boutique.',
    true
),
(
    'Blazer Alfaiataria Minimalista',
    'Moda',
    429.00,
    8,
    '{"tamanho": "G", "estacao": "todas", "tecido": "alfaiataria premium", "cor": "Bege Areia", "forrado": true, "grades_disponiveis": ["PP", "P", "M", "G"]}'::jsonb,
    'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=800&q=80',
    'Blazer estruturado com botões rajados em madrepérola e corte de alta costura.',
    true
),
(
    'Camisa Oversized Seda & Algodão',
    'Moda',
    219.50,
    20,
    '{"tamanho": "U", "estacao": "todas", "tecido": "misto seda e algodao egípicio", "cor": "Verde Oliva", "grades_disponiveis": ["Unico"]}'::jsonb,
    'https://images.unsplash.com/photo-1598554747436-c9293d6a588f?auto=format&fit=crop&w=800&q=80',
    'Peça atemporal e versátil com toque sedoso e elegância despojada para qualquer ocasião.',
    true
),
(
    'Bolsa Baguete Couro Artesanal',
    'Moda',
    349.00,
    6,
    '{"material": "couro legítimo ecológico", "cor": "Caramelo", "fecho": "ímã dourado", "compartimentos": 3}'::jsonb,
    'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=800&q=80',
    'Acessório confeccionado à mão por artesãos locais com acabamento impecável.',
    true
),

-- PET
(
    'Cama Nuvem Ortopédica Plush',
    'Pet',
    189.90,
    12,
    '{"tamanho_pet": "M", "indicacao": "cães e gatos", "lavavel": true, "enchimento": "espuma viscoelástica antialérgica", "cor": "Cinza Mescla"}'::jsonb,
    'https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?auto=format&fit=crop&w=800&q=80',
    'Cama com efeito calmante e alívio de articulações para o sono perfeito do seu pet.',
    true
),
(
    'Coleira e Guia Couro Botânico',
    'Pet',
    119.00,
    25,
    '{"tamanho_pet": "P/M", "indicacao": "todos os portes", "material": "couro vegetal curtido a óleo", "ferragens": "latão escovado", "inclui_placa_gravacao": true}'::jsonb,
    'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?auto=format&fit=crop&w=800&q=80',
    'Conjunto resistente e estiloso, desenhado para harmonizar com o estilo dos tutores modernos.',
    true
),
(
    'Snack Gourmet Salmão & Alecrim 150g',
    'Pet',
    34.90,
    40,
    '{"tipo": "petisco funcional", "ingredientes_nobres": true, "livre_corantes": true, "indicacao": "cães adultos e idosos"}'::jsonb,
    'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?auto=format&fit=crop&w=800&q=80',
    'Petisco 100% natural, rico em Ômega-3 para pelos sedosos e articulações saudáveis.',
    true
),
(
    'Brinquedo Corda Orgânica Trançada',
    'Pet',
    45.00,
    18,
    '{"tamanho_pet": "M/G", "indicacao": "cães mordedores", "material": "algodão cru 100% biodegradável", "ajuda_tartaro": true}'::jsonb,
    'https://images.unsplash.com/photo-1535294435445-d7249524ef2e?auto=format&fit=crop&w=800&q=80',
    'Divertido e seguro, limpa os dentes enquanto o pet brinca de puxar.',
    true
),

-- CAFETERIA
(
    'Cappuccino Italiano Artesanal',
    'Cafeteria',
    18.50,
    100,
    '{"volume_ml": 240, "tipo_leite": "vegetal ou integral", "grao": "Catuaí Vermelho 86 pts", "opcoes_leite": ["Aveia Barista", "Amêndoas", "Integral Fresco", "Sem Lactose"], "temperatura": "quente"}'::jsonb,
    'https://images.unsplash.com/photo-1534778101976-62847782c213?auto=format&fit=crop&w=800&q=80',
    'Espresso duplo cremoso com leite vaporizado sedoso e polvilhado de cacau 70% da Bahia.',
    true
),
(
    'Croissant Amêndoas & Manteiga Francesa',
    'Cafeteria',
    22.00,
    25,
    '{"fermentacao": "natural 36h", "recheio": "creme frangipane", "cobertura": "amêndoas laminadas", "vegano": false}'::jsonb,
    'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=800&q=80',
    'Croissant folhado tradicional com massa crocante por fora e interior aerado amanteigado.',
    true
),
(
    'Cold Brew com Infusão Cítrica de Tangerina',
    'Cafeteria',
    19.00,
    50,
    '{"volume_ml": 350, "extracao": "a frio por 18 horas", "grao": "Mogiana Paulista", "acidez": "brilhante e frutada", "vegano": true}'::jsonb,
    'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?auto=format&fit=crop&w=800&q=80',
    'Café extraído a frio extremamente refrescante servido com gelo artesanal e toque de tangerina.',
    true
),
(
    'Toast Rústico de Queijo Brie & Mel de Cacau',
    'Cafeteria',
    28.00,
    20,
    '{"pao": "sourdough multigrãos", "ingredientes": ["Queijo Brie da Serra", "Mel de Cacau Orgânico", "Nozes Pecan tostadas"], "vegetariano": true}'::jsonb,
    'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=800&q=80',
    'Fatia generosa tostada na brasa, harmonização perfeita com cafés filtrados.',
    true
);

-- Inserir Pets para Adoção Responsável
INSERT INTO pets_adocao (nome_pet, especie, perfil, imagem_url, historia, status) VALUES
(
    'Pipoca',
    'Cachorro',
    '{"idade_meses": 14, "porte": "Médio", "castrado": true, "vacinado": true, "convive_com_gatos": true, "convive_com_criancas": true, "energia": "Moderada", "temperamento": "Carinhosa e calma"}'::jsonb,
    'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=800&q=80',
    'Resgatada nas redondezas da boutique, Pipoca ama receber cafuné e fica super à vontade ao lado dos clientes que tomam café.',
    'Disponível'
),
(
    'Theo',
    'Cachorro',
    '{"idade_meses": 8, "porte": "Grande", "castrado": true, "vacinado": true, "convive_com_gatos": false, "convive_com_criancas": true, "energia": "Alta", "temperamento": "Brincalhão e curioso"}'::jsonb,
    'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=800&q=80',
    'Theo é um filhotão cheio de alegria que adora correr na grama e aprender novos comandos com facilidade.',
    'Disponível'
),
(
    'Mel',
    'Gato',
    '{"idade_meses": 6, "porte": "Pequeno", "castrado": true, "vacinado": true, "convive_com_gatos": true, "convive_com_criancas": true, "energia": "Baixa", "temperamento": "Dorminhoca e ronronadora"}'::jsonb,
    'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=800&q=80',
    'Mel é uma gatinha doce de olhos expressivos que adora se aninhar no colo enquanto você lê um bom livro.',
    'Disponível'
);
