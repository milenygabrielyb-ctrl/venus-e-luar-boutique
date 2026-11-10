import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { HeroBanner } from './components/HeroBanner';
import { CategoryTabs } from './components/CategoryTabs';
import { ProductCard } from './components/ProductCard';
import { ProductModal } from './components/ProductModal';
import { PetCard } from './components/PetCard';
import { PetAdoptionModal } from './components/PetAdoptionModal';
import { CartDrawer } from './components/CartDrawer';
import { AuthModal } from './components/AuthModal';
import { AdminModal } from './components/AdminModal';
import { PermissionModal } from './components/PermissionModal';
import { api } from './services/api';
import { Produto, PetAdocao, Usuario } from './types';
import { useAuthStore } from './store/useAuthStore';
import { useCarrinhoStore } from './store/useCarrinhoStore';
import { Heart, Sparkles } from 'lucide-react';

export const App: React.FC = () => {
  const [abaAtiva, setAbaAtiva] = useState<string>('Todos');
  const [busca, setBusca] = useState<string>('');
  
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [pets, setPets] = useState<PetAdocao[]>([]);
  const [carregando, setCarregando] = useState<boolean>(true);

  // Modais de detalhe e ação
  const [produtoSelecionado, setProdutoSelecionado] = useState<Produto | null>(null);
  const [petSelecionado, setPetSelecionado] = useState<PetAdocao | null>(null);

  // Controle de Permissionamento
  const [isPermissionamentoOpen, setIsPermissionamentoOpen] = useState(false);
  const [itemPendenteAuth, setItemPendenteAuth] = useState<{ produto: Produto; atributos?: Record<string, any> } | null>(null);

  const usuario = useAuthStore((state) => state.usuario);
  const adicionarAoCarrinho = useCarrinhoStore((state) => state.adicionarAoCarrinho);

  // Carregar dados iniciais
  const carregarDados = async () => {
    try {
      setCarregando(true);
      const [listaProdutos, listaPets] = await Promise.all([
        api.listarProdutos(),
        api.listarPets(),
      ]);
      setProdutos(listaProdutos);
      setPets(listaPets);
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregarDados();
  }, []);

  // REGRA DE PERMISSIONAMENTO: EXIGE LOGIN ANTES DE ADICIONAR AO CARRINHO
  const handleTentarAdicionarAoCarrinho = (produto: Produto, atributos?: Record<string, any>) => {
    if (!usuario) {
      setItemPendenteAuth({ produto, atributos });
      setIsPermissionamentoOpen(true);
      return;
    }
    adicionarAoCarrinho(produto, atributos);
  };

  const handleSucessoPermissionamento = (usuarioLogado: Usuario) => {
    if (itemPendenteAuth) {
      adicionarAoCarrinho(itemPendenteAuth.produto, itemPendenteAuth.atributos);
      setItemPendenteAuth(null);
    }
    setIsPermissionamentoOpen(false);
  };

  // Filtragem dos Produtos
  const produtosFiltrados = produtos.filter((prod) => {
    const categoriaCorresponde = abaAtiva === 'Todos' || prod.categoria.toLowerCase() === abaAtiva.toLowerCase();
    
    if (!busca) return categoriaCorresponde;

    const termo = busca.toLowerCase();
    const buscaNome = prod.nome_item.toLowerCase().includes(termo);
    const buscaDesc = prod.descricao.toLowerCase().includes(termo);
    const buscaAtributos = JSON.stringify(prod.atributos).toLowerCase().includes(termo);

    return categoriaCorresponde && (buscaNome || buscaDesc || buscaAtributos);
  });

  // Filtragem dos Pets
  const petsFiltrados = pets.filter((pet) => {
    if (!busca) return true;
    const termo = busca.toLowerCase();
    return (
      pet.nome_pet.toLowerCase().includes(termo) ||
      pet.especie.toLowerCase().includes(termo) ||
      pet.historia.toLowerCase().includes(termo) ||
      JSON.stringify(pet.perfil).toLowerCase().includes(termo)
    );
  });

  const handlePetAdotadoSucesso = (id_pet: number) => {
    setPets((prev) =>
      prev.map((p) => (p.id_pet === id_pet ? { ...p, status: 'Triagem' } : p))
    );
  };

  const handleProdutoCriado = (novo: Produto) => {
    setProdutos((prev) => [novo, ...prev]);
  };

  const handlePetCriado = (novo: PetAdocao) => {
    setPets((prev) => [novo, ...prev]);
  };

  return (
    <div className="min-h-screen flex flex-col bg-celestial-950 text-luar-200">
      
      {/* Topo / Navbar */}
      <Navbar abaAtiva={abaAtiva} setAbaAtiva={setAbaAtiva} />

      {/* Hero Banner acolhedor */}
      <HeroBanner setAbaAtiva={setAbaAtiva} />

      {/* Área Principal de Conteúdo */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10">
        
        {/* Abas e Busca */}
        <CategoryTabs
          abaAtiva={abaAtiva}
          setAbaAtiva={setAbaAtiva}
          busca={busca}
          setBusca={setBusca}
          totalProdutos={abaAtiva === 'Adocao' ? petsFiltrados.length : produtosFiltrados.length}
        />

        {carregando ? (
          <div className="py-20 text-center space-y-3">
            <div className="w-10 h-10 border-4 border-ouro/30 border-t-ouro rounded-full animate-spin mx-auto" />
            <p className="text-xs text-ouro font-medium">Carregando catálogo da Vênus e Luar...</p>
          </div>
        ) : abaAtiva === 'Adocao' ? (
          /* Seção Exclusiva de Adoção de Pets */
          <div className="space-y-6">
            <div className="p-8 rounded-3xl bg-gradient-to-r from-celestial-900 via-celestial-850 to-celestial-900 border border-rose-500/30 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
              <div className="space-y-2">
                <span className="text-xs uppercase font-bold text-rose-400 tracking-widest flex items-center gap-2">
                  <span>❤️</span> Adoção Responsável Integrada
                </span>
                <h2 className="font-serif text-3xl font-bold gold-gradient-text">
                  Encontre seu Novo Melhor Amigo
                </h2>
                <p className="text-xs text-luar-300 max-w-xl leading-relaxed">
                  Todos os pets resgatados passam por check-up veterinário, vacinação e castração. Seus perfis clínicos e comportamentais são armazenados em JSONB com índice GIN.
                </p>
              </div>

              <div className="bg-celestial-950 px-6 py-4 rounded-2xl border border-ouro/40 text-center shadow-lg">
                <span className="text-3xl font-serif font-bold text-ouro block">
                  {pets.filter(p => p.status === 'Disponível').length}
                </span>
                <span className="text-xs font-semibold text-luar-300">Pets Disponíveis</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {petsFiltrados.map((pet) => (
                <PetCard
                  key={pet.id_pet}
                  pet={pet}
                  onAdotar={(p) => setPetSelecionado(p)}
                />
              ))}
            </div>

            {petsFiltrados.length === 0 && (
              <div className="py-16 text-center text-xs text-ouro/70">
                Nenhum pet encontrado para este filtro de busca.
              </div>
            )}
          </div>
        ) : (
          /* Grade de Produtos (Moda, Pet, Cafeteria) */
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {produtosFiltrados.map((prod) => (
                <ProductCard
                  key={prod.id_produto}
                  produto={prod}
                  onVerDetalhes={(p) => setProdutoSelecionado(p)}
                  onAdicionar={(p) => handleTentarAdicionarAoCarrinho(p)}
                />
              ))}
            </div>

            {produtosFiltrados.length === 0 && (
              <div className="py-16 text-center text-xs text-ouro/70">
                Nenhum produto encontrado com o termo informado.
              </div>
            )}
          </div>
        )}

      </main>

      {/* Modais e Gavetas Globais */}
      <ProductModal
        produto={produtoSelecionado}
        onClose={() => setProdutoSelecionado(null)}
        onAdicionar={(p, attrs) => handleTentarAdicionarAoCarrinho(p, attrs)}
      />

      <PetAdoptionModal
        pet={petSelecionado}
        onClose={() => setPetSelecionado(null)}
        onSucesso={handlePetAdotadoSucesso}
      />

      {/* Modal de Permissionamento Obrigatório */}
      <PermissionModal
        isOpen={isPermissionamentoOpen}
        onClose={() => setIsPermissionamentoOpen(false)}
        produtoPendente={itemPendenteAuth}
        onSucesso={handleSucessoPermissionamento}
      />

      <CartDrawer />
      <AuthModal />
      <AdminModal
        onProdutoCriado={handleProdutoCriado}
        onPetCriado={handlePetCriado}
      />

      {/* Rodapé Elegante */}
      <footer className="bg-celestial-950 text-luar-300 mt-20 border-t border-ouro/25 py-12">
        <div className="max-w-7xl mx-auto px-4 text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full overflow-hidden border border-ouro/50 p-0.5 bg-celestial-900 shadow-lg">
              <img src="/logo.jpg" alt="Vênus e Luar Logo" className="w-full h-full object-cover" />
            </div>
          </div>
          <span className="font-serif text-3xl font-bold gold-gradient-text block">
            Vênus e Luar Boutique
          </span>
          <p className="text-xs text-ouro-light/80 tracking-widest uppercase">
            Alta Costura • Espaço Pet Nobre • Cafeteria Gourmet & Bistrô • Adoção Responsável
          </p>
          <div className="text-[11px] text-stone-400 pt-4 border-t border-ouro/10">
            © 2026 Vênus e Luar Boutique. Todos os direitos reservados.
          </div>
        </div>
      </footer>

    </div>
  );
};

export default App;
