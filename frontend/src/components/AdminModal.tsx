import React, { useState } from 'react';
import { X, Plus, ShieldPlus, Sparkles, Check, Database } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { api } from '../services/api';
import { CategoriaProduto, Produto, PetAdocao } from '../types';

interface AdminModalProps {
  onProdutoCriado: (produto: Produto) => void;
  onPetCriado: (pet: PetAdocao) => void;
}

export const AdminModal: React.FC<AdminModalProps> = ({ onProdutoCriado, onPetCriado }) => {
  const isAdminModalOpen = useAuthStore((state) => state.isAdminModalOpen);
  const fecharAdminModal = useAuthStore((state) => state.fecharAdminModal);

  const [abaAdmin, setAbaAdmin] = useState<'produto' | 'pet'>('produto');

  // Form Produto
  const [nomeItem, setNomeItem] = useState('');
  const [categoria, setCategoria] = useState<CategoriaProduto>('Moda');
  const [preco, setPreco] = useState('');
  const [estoque, setEstoque] = useState('10');
  const [imagemUrl, setImagemUrl] = useState('');
  const [descricao, setDescricao] = useState('');
  const [atributosJson, setAtributosJson] = useState('{\n  "tamanho": "M",\n  "tecido": "seda natural",\n  "cor": "Dourado Champagne"\n}');

  // Atributos Amigáveis Visuais
  const [modoAvancado, setModoAvancado] = useState(false);
  const [tamanhoModa, setTamanhoModa] = useState('M');
  const [gradesModa, setGradesModa] = useState<string[]>(['PP', 'P', 'M', 'G']);
  const [corModa, setCorModa] = useState('Dourado Champagne');
  const [tecidoModa, setTecidoModa] = useState('Seda natural');
  const [corteModa, setCorteModa] = useState('Evasê Fluído');

  const [portePet, setPortePet] = useState('Médio');
  const [indicacaoPet, setIndicacaoPet] = useState('Cães e Gatos');
  const [materialPet, setMaterialPet] = useState('Algodão sustentável e plush');
  const [lavavelPet, setLavavelPet] = useState(true);

  const [volumeCafeteria, setVolumeCafeteria] = useState('Caneca 240ml');
  const [temperaturaCafeteria, setTemperaturaCafeteria] = useState('Quente');
  const [graoCafeteria, setGraoCafeteria] = useState('Catuaí Vermelho 88 pts');
  const [opcoesLeiteCafeteria, setOpcoesLeiteCafeteria] = useState<string[]>(['Aveia', 'Amêndoas', 'Integral']);

  // Form Pet
  const [nomePet, setNomePet] = useState('');
  const [especie, setEspecie] = useState('Cachorro');
  const [historiaPet, setHistoriaPet] = useState('');
  const [imagemPet, setImagemPet] = useState('');
  const [perfilJson, setPerfilJson] = useState('{\n  "idade_meses": 12,\n  "porte": "Médio",\n  "castrado": true,\n  "vacinado": true,\n  "convive_com_gatos": true,\n  "temperamento": "Dócil e brincalhão"\n}');

  const [salvando, setSalvando] = useState(false);
  const [msgSucesso, setMsgSucesso] = useState('');

  if (!isAdminModalOpen) return null;

  const handleSalvarProduto = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setMsgSucesso('');

    try {
      let parsedAtributos = {};
      if (modoAvancado) {
        try {
          parsedAtributos = JSON.parse(atributosJson);
        } catch (e) {
          alert('O JSON de atributos é inválido. Corrija a sintaxe.');
          setSalvando(false);
          return;
        }
      } else {
        if (categoria === 'Moda') {
          parsedAtributos = {
            tamanho: tamanhoModa,
            grade_disponivel: gradesModa.join(', '),
            cor: corModa,
            tecido: tecidoModa,
            corte: corteModa
          };
        } else if (categoria === 'Pet') {
          parsedAtributos = {
            porte: portePet,
            indicacao: indicacaoPet,
            material: materialPet,
            lavavel_em_maquina: lavavelPet ? 'Sim' : 'Não'
          };
        } else if (categoria === 'Cafeteria') {
          parsedAtributos = {
            volume: volumeCafeteria,
            temperatura: temperaturaCafeteria,
            grao: graoCafeteria,
            opcoes_leite: opcoesLeiteCafeteria.join(', ')
          };
        }
      }

      const novoProduto = await api.criarProduto({
        nome_item: nomeItem,
        categoria,
        preco: Number(preco),
        estoque: Number(estoque),
        atributos: parsedAtributos,
        imagem_url: imagemUrl || 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=800&q=80',
        descricao,
      });

      onProdutoCriado(novoProduto);
      setMsgSucesso('Produto cadastrado com sucesso com atributos JSONB!');
      setTimeout(() => {
        setMsgSucesso('');
        fecharAdminModal();
      }, 1500);
    } catch (err: any) {
      alert(err.message || 'Erro ao criar produto');
    } finally {
      setSalvando(false);
    }
  };

  const handleSalvarPet = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setMsgSucesso('');

    try {
      let parsedPerfil = {};
      try {
        parsedPerfil = JSON.parse(perfilJson);
      } catch (e) {
        alert('O JSON de perfil clínico é inválido. Corrija a sintaxe.');
        setSalvando(false);
        return;
      }

      const novoPet = await api.criarPet({
        nome_pet: nomePet,
        especie,
        perfil: parsedPerfil,
        historia: historiaPet,
        imagem_url: imagemPet || 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=800&q=80',
      });

      onPetCriado(novoPet);
      setMsgSucesso('Pet cadastrado para adoção com sucesso!');
      setTimeout(() => {
        setMsgSucesso('');
        fecharAdminModal();
      }, 1500);
    } catch (err: any) {
      alert(err.message || 'Erro ao criar pet');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-boutique-200 overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="p-6 border-b border-boutique-200 bg-boutique-50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-boutique-900 text-white rounded-xl">
              <ShieldPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif text-lg font-bold text-boutique-900">
                Painel Administrativo da Boutique
              </h3>
              <span className="text-[11px] text-boutique-600 block">
                Gerenciamento relacional com modelagem PostgreSQL & JSONB
              </span>
            </div>
          </div>

          <button
            onClick={fecharAdminModal}
            className="p-2 rounded-full hover:bg-boutique-200 text-boutique-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Abas */}
        <div className="px-6 pt-4 flex gap-2 border-b border-boutique-100">
          <button
            onClick={() => setAbaAdmin('produto')}
            className={`pb-2.5 text-xs font-bold border-b-2 transition-all ${
              abaAdmin === 'produto'
                ? 'border-boutique-900 text-boutique-900'
                : 'border-transparent text-boutique-500 hover:text-boutique-800'
            }`}
          >
            + Cadastrar Produto (JSONB)
          </button>
          <button
            onClick={() => setAbaAdmin('pet')}
            className={`pb-2.5 text-xs font-bold border-b-2 transition-all ${
              abaAdmin === 'pet'
                ? 'border-rose-600 text-rose-600'
                : 'border-transparent text-boutique-500 hover:text-boutique-800'
            }`}
          >
            + Cadastrar Pet para Adoção (JSONB)
          </button>
        </div>

        {/* Conteúdo Formulário */}
        <div className="overflow-y-auto p-6 space-y-4 flex-1">
          {msgSucesso && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{msgSucesso}</span>
            </div>
          )}

          {abaAdmin === 'produto' ? (
            <form onSubmit={handleSalvarProduto} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-boutique-800 mb-1">
                    Nome do Item *
                  </label>
                  <input
                    type="text"
                    required
                    value={nomeItem}
                    onChange={(e) => setNomeItem(e.target.value)}
                    placeholder="Ex: Saia Envelope Seda Pura"
                    className="w-full px-3 py-2 rounded-xl border border-boutique-300 text-xs outline-none focus:ring-1 focus:ring-boutique-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-boutique-800 mb-1">
                    Categoria *
                  </label>
                  <select
                    value={categoria}
                    onChange={(e) => {
                      const novaCat = e.target.value as CategoriaProduto;
                      setCategoria(novaCat);
                      if (novaCat === 'Cafeteria') {
                        setAtributosJson('{\n  "volume_ml": 250,\n  "tipo_leite": "aveia",\n  "opcoes_leite": ["Aveia", "Amêndoas", "Integral"]\n}');
                      } else if (novaCat === 'Pet') {
                        setAtributosJson('{\n  "tamanho_pet": "P/M",\n  "indicacao": "gatos e cães pequenos",\n  "material": "algodão sustentável"\n}');
                      } else {
                        setAtributosJson('{\n  "tamanho": "M",\n  "tecido": "linho puro",\n  "cor": "Areia"\n}');
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-boutique-300 text-xs outline-none bg-white"
                  >
                    <option value="Moda">Moda</option>
                    <option value="Pet">Pet</option>
                    <option value="Cafeteria">Cafeteria</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-boutique-800 mb-1">
                    Preço (R$) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={preco}
                    onChange={(e) => setPreco(e.target.value)}
                    placeholder="Ex: 189.90"
                    className="w-full px-3 py-2 rounded-xl border border-boutique-300 text-xs outline-none focus:ring-1 focus:ring-boutique-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-boutique-800 mb-1">
                    Estoque Inicial
                  </label>
                  <input
                    type="number"
                    value={estoque}
                    onChange={(e) => setEstoque(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-boutique-300 text-xs outline-none focus:ring-1 focus:ring-boutique-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-boutique-800 mb-1">
                  URL da Imagem (Unsplash ou Direta)
                </label>
                <input
                  type="url"
                  value={imagemUrl}
                  onChange={(e) => setImagemUrl(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className="w-full px-3 py-2 rounded-xl border border-boutique-300 text-xs outline-none focus:ring-1 focus:ring-boutique-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-boutique-800 mb-1">
                  Descrição Comercial
                </label>
                <textarea
                  rows={2}
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Breve descrição dos materiais e design do item..."
                  className="w-full px-3 py-2 rounded-xl border border-boutique-300 text-xs outline-none resize-none focus:ring-1 focus:ring-boutique-500"
                />
              </div>

              <div className="p-4 rounded-2xl bg-boutique-50 border border-boutique-200 space-y-3">
                <div className="flex items-center justify-between border-b border-boutique-200 pb-2">
                  <div>
                    <label className="block text-xs font-bold text-boutique-900">
                      Atributos &amp; Detalhes da Peça ({categoria})
                    </label>
                    <span className="text-[10px] text-boutique-500">Seleções rápidas sem necessidade de escrever JSON</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setModoAvancado(!modoAvancado)}
                    className="text-[11px] font-mono px-2 py-0.5 rounded border border-boutique-300 text-boutique-700 hover:bg-white"
                  >
                    {modoAvancado ? '✨ Voltar aos Seletores' : '{ } Modo JSON'}
                  </button>
                </div>

                {modoAvancado ? (
                  <textarea
                    rows={4}
                    value={atributosJson}
                    onChange={(e) => setAtributosJson(e.target.value)}
                    className="w-full p-3 rounded-xl border border-boutique-300 text-xs font-mono bg-stone-900 text-emerald-400 outline-none"
                  />
                ) : (
                  <div className="space-y-3">
                    {categoria === 'Moda' && (
                      <>
                        <div>
                          <label className="block text-[10px] font-bold text-boutique-700 uppercase mb-1">Tamanho Base:</label>
                          <div className="flex flex-wrap gap-1.5">
                            {['PP', 'P', 'M', 'G', 'GG', 'Único'].map(tam => (
                              <button
                                key={tam}
                                type="button"
                                onClick={() => setTamanhoModa(tam)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                                  tamanhoModa === tam ? 'bg-boutique-900 text-white' : 'bg-white border border-boutique-200 text-boutique-700'
                                }`}
                              >
                                {tam}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-boutique-700 uppercase mb-1">Grade em Estoque:</label>
                          <div className="flex flex-wrap gap-1.5">
                            {['PP', 'P', 'M', 'G', 'GG', 'XG'].map(grade => {
                              const ativo = gradesModa.includes(grade);
                              return (
                                <button
                                  key={grade}
                                  type="button"
                                  onClick={() => setGradesModa(ativo ? gradesModa.filter(g => g !== grade) : [...gradesModa, grade])}
                                  className={`px-2 py-0.5 rounded text-xs transition-all ${
                                    ativo ? 'bg-terracotta text-white font-bold' : 'bg-white border border-boutique-200 text-boutique-700'
                                  }`}
                                >
                                  {ativo ? '✓ ' : '+ '}{grade}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-bold text-boutique-700 uppercase mb-1">Cor:</label>
                            <input
                              type="text"
                              value={corModa}
                              onChange={(e) => setCorModa(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-boutique-300 text-xs bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-boutique-700 uppercase mb-1">Tecido:</label>
                            <input
                              type="text"
                              value={tecidoModa}
                              onChange={(e) => setTecidoModa(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-boutique-300 text-xs bg-white"
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {categoria === 'Pet' && (
                      <>
                        <div>
                          <label className="block text-[10px] font-bold text-boutique-700 uppercase mb-1">Porte:</label>
                          <div className="flex flex-wrap gap-1.5">
                            {['Mini', 'Pequeno', 'Médio', 'Grande'].map(porte => (
                              <button
                                key={porte}
                                type="button"
                                onClick={() => setPortePet(porte)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                                  portePet === porte ? 'bg-boutique-900 text-white' : 'bg-white border border-boutique-200 text-boutique-700'
                                }`}
                              >
                                {porte}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-bold text-boutique-700 uppercase mb-1">Indicação:</label>
                            <input
                              type="text"
                              value={indicacaoPet}
                              onChange={(e) => setIndicacaoPet(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-boutique-300 text-xs bg-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-boutique-700 uppercase mb-1">Material:</label>
                            <input
                              type="text"
                              value={materialPet}
                              onChange={(e) => setMaterialPet(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-boutique-300 text-xs bg-white"
                            />
                          </div>
                        </div>
                      </>
                    )}

                    {categoria === 'Cafeteria' && (
                      <>
                        <div>
                          <label className="block text-[10px] font-bold text-boutique-700 uppercase mb-1">Volume / Dose:</label>
                          <div className="flex flex-wrap gap-1.5">
                            {['Dose 50ml', 'Xícara 120ml', 'Caneca 240ml', 'Grande 350ml'].map(vol => (
                              <button
                                key={vol}
                                type="button"
                                onClick={() => setVolumeCafeteria(vol)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                                  volumeCafeteria === vol ? 'bg-boutique-900 text-white' : 'bg-white border border-boutique-200 text-boutique-700'
                                }`}
                              >
                                {vol}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-bold text-boutique-700 uppercase mb-1">Temperatura:</label>
                            <select
                              value={temperaturaCafeteria}
                              onChange={(e) => setTemperaturaCafeteria(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-boutique-300 text-xs bg-white"
                            >
                              <option value="Quente">☕ Quente</option>
                              <option value="Gelado">❄️ Gelado</option>
                              <option value="Ambiente">🥐 Ambiente</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-boutique-700 uppercase mb-1">Grão / Blend:</label>
                            <input
                              type="text"
                              value={graoCafeteria}
                              onChange={(e) => setGraoCafeteria(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg border border-boutique-300 text-xs bg-white"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={salvando}
                className="w-full py-3 rounded-2xl bg-boutique-900 text-white font-bold text-xs hover:bg-terracotta transition-all shadow-md"
              >
                {salvando ? 'Salvando...' : 'Cadastrar Produto com JSONB'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSalvarPet} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-boutique-800 mb-1">
                    Nome do Pet *
                  </label>
                  <input
                    type="text"
                    required
                    value={nomePet}
                    onChange={(e) => setNomePet(e.target.value)}
                    placeholder="Ex: Paçoca"
                    className="w-full px-3 py-2 rounded-xl border border-boutique-300 text-xs outline-none focus:ring-1 focus:ring-rose-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-boutique-800 mb-1">
                    Espécie *
                  </label>
                  <select
                    value={especie}
                    onChange={(e) => setEspecie(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-boutique-300 text-xs outline-none bg-white"
                  >
                    <option value="Cachorro">Cachorro</option>
                    <option value="Gato">Gato</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-boutique-800 mb-1">
                  URL da Foto do Pet
                </label>
                <input
                  type="url"
                  value={imagemPet}
                  onChange={(e) => setImagemPet(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className="w-full px-3 py-2 rounded-xl border border-boutique-300 text-xs outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-boutique-800 mb-1">
                  História do Pet
                </label>
                <textarea
                  rows={2}
                  value={historiaPet}
                  onChange={(e) => setHistoriaPet(e.target.value)}
                  placeholder="História de resgate, comportamento..."
                  className="w-full px-3 py-2 rounded-xl border border-boutique-300 text-xs outline-none resize-none focus:ring-1 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-boutique-800 mb-1 flex items-center justify-between">
                  <span>Perfil Clínico e Comportamental (JSONB)</span>
                  <span className="text-[10px] text-rose-600 font-normal">Indexado via GIN</span>
                </label>
                <textarea
                  rows={5}
                  value={perfilJson}
                  onChange={(e) => setPerfilJson(e.target.value)}
                  className="w-full p-3 rounded-xl border border-boutique-300 text-xs font-mono bg-stone-900 text-amber-300 outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={salvando}
                className="w-full py-3 rounded-2xl bg-rose-600 text-white font-bold text-xs hover:bg-rose-700 transition-all shadow-md shadow-rose-200"
              >
                {salvando ? 'Salvando Pet...' : 'Cadastrar Pet para Adoção'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
