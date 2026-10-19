# Importador do Mapa FTTH — JetEngine

Plugin administrativo para revisar arquivos KML/KMZ e importar pontos e trechos lineares para os CCTs existentes:

- `pontos_rede_ftth`
- `rotas_fibra`
- `mapa_importacoes` (lotes e resumo)

## Fluxo

1. Um administrador abre **Ferramentas → Importador do Mapa FTTH**.
2. Envia um arquivo `.kml` ou `.kmz`.
3. O servidor interpreta os dados sem inicializar Mapbox no navegador.
4. A prévia lista geometrias, localidade, classificação estimada, descrições, coordenadas, comprimento e alertas.
5. Duplicidades e dados inválidos vêm desmarcados. O administrador pode revisar e marcar linhas individualmente.
6. Só depois de confirmar, os itens são criados usando o handler de CCT do JetEngine. Um lote de importação registra totais e erros.

O preview fica em transient por 30 minutos, vinculado ao usuário autenticado. O endpoint não é público, exige `manage_options` e nonce, aceita arquivos até 20 MB e carrega XML com `LIBXML_NONET`.

## Correspondências específicas desta base

- `DOC-20250818-WA0017` → Cravolândia
- `DOC-20250818-WA0022` → Mutuípe
- O nome/localidade dos demais arquivos é inferido pelo nome do arquivo ou pelas pastas KML; a prévia permite corrigir a localidade por elemento.
- Polígonos são identificados e excluídos da gravação nesta versão: ainda não há uma camada/CCT de áreas definida.

## Camada de rotas no mapa (versão 0.3.2)

- O widget nativo JetEngine continua responsável pelos pontos e popups existentes.
- A camada adicional lê as rotas publicadas do CCT `rotas_fibra` por um endpoint REST autenticado e desenha os `LineString` no mesmo mapa Mapbox da página **Mapa da Rede FTTH** (ID 3600 / slug `mapa-da-rede-ftth`). Ela só é conectada depois dos scripts do provedor Mapbox do JetEngine; não cria nem substitui o mapa base ou os marcadores.
- A inicialização acompanha instâncias tardias ou recriadas pelo Elementor, mudanças de tamanho/orientação e recarga de estilo. Falhas temporárias ao buscar rotas são repetidas com espera progressiva; exceções da camada não interrompem a renderização nativa do mapa.
- A resposta GeoJSON usa política sem cache no navegador para que edições/importações recentes não fiquem ocultas por uma resposta antiga.
- Clicar em uma linha mostra nome, localidade, tipo, cabo, fibras e extensão. A camada é recriada quando o estilo do mapa muda.
- São exibidas rotas com status `nativa`, `em_implantacao` e `manutencao`; rotas planejadas ou inativas ficam fora da visualização.
- O endpoint exige usuário autenticado. O mapa deve continuar protegido pelas regras de acesso da página.

## Atualizações

- Na página **Plugins**, o link **Verificar atualização** força uma consulta nova à release pública do GitHub e ao atualizador nativo do WordPress.
- A versão da release é armazenada em cache por até 5 minutos; falhas de consulta, por até 1 minuto. Isso evita manter uma versão antiga por horas e permite nova tentativa rápida quando o GitHub estiver temporariamente indisponível.

## Limites

- Importa geometrias KML `Point` e `LineString`; ignora/exibe polígonos como itens de revisão.
- A classificação de pontos/rotas, quantidade de fibras e tipo de cabo é heurística. A prévia é obrigatória para revisão.
- Não atualiza itens previamente importados. `source_key` já existente é pulado; geometrias iguais são marcadas como possível duplicidade para decisão manual.
- A consulta da camada está limitada a 3.000 rotas e 100.000 vértices para evitar respostas excessivas.

## Instalação

### Estilo das rotas por FO (0.3.5)

A camada usa `rota_quantidade_fibras` (propriedade `fibers` da API), sem modificar cadastros nem inferir pelo nome do cabo. A cor importada não prevalece sobre esta convenção visual.

| FO | Cor | Espessura em pixels no zoom 14 |
| --- | --- | --- |
| 1 (Drop) | Cinza | 1,5 |
| 2 | Azul-claro | 2 |
| 4 | Verde | 2,5 |
| 6 | Azul | 3 |
| 12 | Amarelo | 3,5 |
| 24 | Laranja | 4,5 |
| 36 | Roxo | 5 |
| 48 | Vermelho | 5,5 |
| 72 ou mais | Rosa | 6 |
| Sem informação ou quantidade não tabelada | Cinza neutro | 2 |

As larguras variam de metade no zoom 8 a 1,5 vezes no zoom 18. Alterações de FO no JetEngine são refletidas no próximo carregamento. Estas cores não representam uma norma técnica de identificação dos cabos.

Compacte a pasta `importador-mapa-ftth` em ZIP e instale no WordPress em **Plugins → Adicionar novo → Enviar plugin**. Ative o plugin. O JetEngine e os três CCTs acima precisam estar ativos. A versão não modifica nem apaga CCTs existentes.

## Atualizações pelo WordPress

O plugin consulta as Releases públicas deste repositório e usa o atualizador nativo do WordPress para oferecer o botão **Atualizar agora**. Não é necessário token no site WordPress.

Para publicar uma versão: atualize a versão no cabeçalho PHP e em `Inmov_JetEngine_FTTH_Importer::VERSION`, faça commit e push, crie uma tag no formato `vMAJOR.MINOR.PATCH` e envie a tag. O GitHub Actions cria a Release e anexa `importador-mapa-ftth.zip` com a pasta interna compatível com o plugin instalado. O WordPress encontrará a atualização na próxima verificação de plugins; para solicitar uma consulta imediata, use **Plugins → Verificar atualização**.

Na instalação inicial ou para migrar uma versão antiga que ainda não tem o atualizador, é necessário instalar uma vez o ZIP da Release manualmente. Depois disso, as próximas versões aparecem no painel do WordPress. Atualizações automáticas em segundo plano continuam sob controle da opção padrão do WordPress por plugin.

## Observação para validar antes do primeiro lote

Os valores de status iniciais correspondem às opções dos CCTs: `nativo` para pontos e `nativa` para rotas. Ambos podem ser alterados antes de cada importação.
