# Referências para o formulário de edição FTTH

O formulário final deverá ser montado no JetFormBuilder para uso no frontend. Consulte `JETFORMBUILDER.md` e `jetformbuilder-blueprint.json` para o desenho dos dois formulários, o preset do CCT, o mapeamento dos campos e as condições.

O HTML/JavaScript abaixo é somente uma referência visual e de comportamento para revisão. Ele **não está integrado** ao popup, ao mapa, à API REST, ao JetFormBuilder ou ao salvamento do WordPress.

## Testar

Abra `demo.html` em um navegador. Os botões alternam entre um ponto e uma rota fictícios. Preencha o motivo da alteração, confirme a revisão e gere a prévia. O JSON exibido é apenas um payload de teste.

## Uso futuro

```html
<link rel="stylesheet" href="inmov-ftth-edit-form.css">
<div id="meu-formulario"></div>
<script src="inmov-ftth-edit-form.js"></script>
<script>
  const form = InmovFTTHEditForm.create({
    root: '#meu-formulario',
    kind: 'point', // ou 'route'
    data: pontoOuRotaAtual,
    onPreview: (payload) => { /* validar antes de enviar */ }
  });
</script>
```

O formulário emite três eventos no `document`:

- `inmov-ftth:edit-preview`: payload completo da prévia, sem envio automático.
- `inmov-ftth:edit-location-request`: pede que a integração habilite a seleção de um novo ponto no mapa.
- `inmov-ftth:edit-geometry-request`: pede que a integração habilite o desenho de uma nova rota.

Depois de o mapa devolver os dados, a integração futura poderá chamar:

```js
form.setLocation(latitude, longitude);
form.setGeometry([[longitude, latitude], [longitude, latitude]]);
```

O `getPayload()` mantém `original`, `values`, `changes`, `locationChange`/`geometryChange` e o motivo da alteração, facilitando uma etapa posterior de validação e persistência. Nenhuma dessas funções realiza uma requisição por conta própria.

## Campos condicionais

- Ponto: capacidade aparece para CTO, OLT, POP e caixa de emenda; notas de implantação/manutenção aparecem conforme a situação; coordenadas ficam editáveis apenas no modo manual ou aguardam o retorno do mapa.
- Rota: tipo de cabo, quantidade de FO, situação e comprimento seguem os campos usados em `rotas_fibra`; a edição de geometria é um gancho para o mapa e exige pelo menos dois vértices quando selecionada.
- Todos os campos obrigatórios, coordenadas, motivo da alteração e confirmação de revisão são validados localmente antes da prévia.
