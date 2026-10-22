# Plano JetFormBuilder — edição no frontend

Este é o plano que deve ser usado no JetFormBuilder. O arquivo `jetformbuilder-blueprint.json` é uma especificação para montagem e revisão; não deve ser tratado como um export nativo para importação automática.

## Por que dois formulários

Os pontos e as rotas estão em CCTs diferentes (`pontos_rede_ftth` e `rotas_fibra`). Portanto, a configuração mais segura é criar dois formulários JetFormBuilder:

1. **Editar ponto FTTH** → ação `Insert/Update Custom Content Type Item` apontando para `pontos_rede_ftth`.
2. **Editar rota FTTH** → ação `Insert/Update Custom Content Type Item` apontando para `rotas_fibra`.

Isso evita tentar escolher dinamicamente dois CCTs em uma única ação e mantém o mapeamento explícito.

## Preset e item a atualizar

Em cada formulário, crie um campo oculto `_inmov_item_id`. A fonte pode ser a variável de URL `ftth_item_id` ou o item CCT atual quando o formulário for exibido dentro de um contexto de item.

Na ação de envio, mapeie esse campo para **Item ID (will update the item)**. No preset, use **Custom Content Type** e o mesmo identificador do item. A futura abertura pelo popup deverá montar uma URL semelhante a:

```text
/editar-ponto/?ftth_kind=point&ftth_item_id=123
/editar-rota/?ftth_kind=route&ftth_item_id=456
```

## Campos do formulário de ponto

Mapeie diretamente para `pontos_rede_ftth`:

| Campo JetFormBuilder | Campo CCT | Tipo |
| --- | --- | --- |
| `ponto_codigo` | `ponto_codigo` | Text |
| `ponto_nome` | `ponto_nome` | Text |
| `ponto_tipo` | `ponto_tipo` | Select |
| `ponto_localidade` | `ponto_localidade` | Text |
| `ponto_endereco` | `ponto_endereco` | Text |
| `ponto_latitude` | `ponto_latitude` | Number |
| `ponto_longitude` | `ponto_longitude` | Number |
| `ponto_status` | `ponto_status` | Select |
| `ponto_capacidade_portas` | `ponto_capacidade_portas` | Number |
| `ponto_observacao` | `ponto_observacao` | Textarea |

### Condições do ponto

- Mostrar `ponto_capacidade_portas` quando `ponto_tipo` estiver em `cto`, `olt`, `pop` ou `caixa_emenda`.
- `inmov_location_mode` é um campo auxiliar, não persistido: `keep`, `manual` ou `map`.
- Mostrar latitude e longitude quando o modo for `manual` ou `map`.
- No modo `map`, o botão auxiliar dispara o hook `inmov-ftth:edit-location-request`; a integração futura preencherá os campos e validará os limites.
- `inmov_change_reason` e `inmov_reviewed` são campos de revisão e não entram no CCT.

## Campos do formulário de rota

Mapeie diretamente para `rotas_fibra`:

| Campo JetFormBuilder | Campo CCT | Tipo |
| --- | --- | --- |
| `rota_codigo` | `rota_codigo` | Text |
| `rota_nome` | `rota_nome` | Text |
| `rota_localidade` | `rota_localidade` | Text |
| `rota_tipo` | `rota_tipo` | Select |
| `rota_tipo_cabo` | `rota_tipo_cabo` | Text |
| `rota_quantidade_fibras` | `rota_quantidade_fibras` | Select |
| `rota_status` | `rota_status` | Select |
| `rota_geometria_geojson` | `rota_geometria_geojson` | Textarea/Hidden |
| `rota_comprimento_metros` | `rota_comprimento_metros` | Number read-only |
| `rota_observacao` | `rota_observacao` | Textarea |

### Condições da rota

- `inmov_geometry_mode` é auxiliar: `keep` ou `map`.
- Mostrar o editor de geometria e `rota_geometria_geojson` somente no modo `map`.
- O hook `inmov-ftth:edit-geometry-request` abre a futura ferramenta de desenho.
- A integração deve exigir pelo menos dois vértices, gravar um `LineString` válido e recalcular `rota_comprimento_metros` antes do envio.
- O comprimento não deve ser aceito como valor digitado manualmente quando a geometria for alterada.

## Integração de localização/geometria (etapa posterior)

O JetFormBuilder continua sendo responsável pelos campos, validação e ação de atualização. Um pequeno adaptador de mapa será necessário somente para:

1. ouvir o evento de seleção de posição/traçado;
2. permitir a escolha no mapa;
3. devolver latitude/longitude ou vértices para os campos do formulário;
4. recalcular e validar o resultado;
5. deixar o JetFormBuilder enviar o CCT.

Essa etapa ainda não foi conectada. O formulário não deve ser publicado para edição até que a autorização do usuário, o item ID e a validação de capacidade de edição estejam definidos.

## Rascunhos criados diretamente via MCP

Foram criados dois rascunhos no post type `jet-form-builder`, sem publicação e sem integração com o mapa:

- **Editar Ponto da Rede FTTH — Rascunho MCP** — ID `3699`
- **Editar Rota de Fibra — Rascunho MCP** — ID `3700`

Os rascunhos já contêm blocos nativos do JetFormBuilder, incluindo selects, radios, condições, campos de coordenadas/geometria e submit. A ação `Insert/Update Custom Content Type Item`, o preset do item e as permissões continuam deliberadamente pendentes para configuração e teste no editor do JetFormBuilder.

## Validação e segurança antes de ativar o envio

- Restringir a página e a ação a usuários autenticados com uma capability própria ou equivalente.
- Confirmar no servidor que o usuário pode editar o `_ID` recebido; não confiar apenas no campo oculto.
- Manter `ponto_latitude`, `ponto_longitude` e `rota_geometria_geojson` sob validação de faixa/estrutura no servidor.
- Registrar usuário, data e motivo da alteração em uma trilha de auditoria antes de permitir a atualização.
- Testar primeiro com uma cópia dos CCTs e com o Post Submit Action desabilitado.
