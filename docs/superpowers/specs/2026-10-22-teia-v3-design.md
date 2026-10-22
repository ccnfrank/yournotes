# yourNotes v3: teia de notas — Design

Data: 2026-10-22
Status: aguardando revisão do usuário

## Objetivo

Criar a versão 3 do yourNotes, em que as notas de uma pasta aparecem como uma teia: cada nota é um ponto, e pontos ligados formam uma rede visual semelhante à referência `ref2.png`.

## Escopo

- Nova pasta `editor/v3/` com `index.html`, `app.js` e `style.css`, partindo da estrutura da v2.
- A v2 (`editor/v2/`) não é alterada.
- Sem dependências externas: HTML, CSS e JavaScript puros, como a v2.

## Modelo

- **Ponto:** cada arquivo de texto da pasta escolhida (`.txt`, `.md`, `.text`, `.log`) é um ponto. O rótulo é o nome do arquivo.
- **Ligação automática:** duas notas com a mesma tag se ligam. As tags são extraídas pela regra já existente em `extractTags` (`#palavra` no texto, sem diferenciar maiúsculas).
- **Ligação manual:** o usuário liga ou desliga duas notas. Ligações manuais são guardadas em `links.json` na pasta escolhida.
- **Notas protegidas** (criptografadas) aparecem como ponto sem tags, como na v2. Não entram em ligações automáticas, mas podem ter ligações manuais, identificadas pelo nome do arquivo.

### Formato de `links.json`

```json
{
  "version": 1,
  "links": [
    ["ideias.txt", "trabalho.txt"],
    ["receita.md", "mercado.md"]
  ]
}
```

- Cada par é ordenado alfabeticamente antes de ser gravado, e não há pares repetidos.
- Ausência do arquivo significa "nenhuma ligação manual".
- Um `links.json` inválido ou ilegível é tratado como vazio, e a mensagem de status informa o erro. Ele não é sobrescrito antes de o usuário criar uma nova ligação.

## Visual

- Tela cheia, fundo escuro na noite e claro no dia, seguindo o tema da v2 (`yournotes-theme`).
- Renderização em `<canvas>`.
- Simulação de forças feita à mão: repulsão entre todos os pontos, mola entre pontos ligados e atração leve ao centro. A teia se acomoda sozinha ao carregar e ao mudar a estrutura.
- Ligações são linhas finas. Os rótulos dos pontos ficam ao lado de cada um.
- Campo de busca no centro da tela, como na referência.

## Interações

- **Arrastar um ponto:** reposiciona o ponto. A simulação continua e a teia se reajusta.
- **Clicar em um ponto:** abre a nota no painel de edição, usando o mesmo carregamento da v2 (`loadFile`).
- **Shift + clicar em dois pontos:** cria a ligação manual entre eles, ou remove se já existir. A alteração é gravada em `links.json` imediatamente.
- **Busca:** o termo digitado destaca os pontos que casam com o nome ou a tag, e esmaece os demais. A regra de busca é a mesma da v2 (`#` busca só tags).
- **Roda do mouse:** zoom centrado no cursor.

## Estrutura de código

- `app.js` mantém o estado das notas e o carregamento/gravação, herdados da v2.
- Lógica pura, sem DOM, em funções separadas:
  - `extractTags(text)`
  - `automaticLinks(notes)`: pares de notas com tags em comum
  - `normalizeLinks(list, existingNames)`: ordena os pares, remove duplicatas e ignora nomes que não existem
  - `toggleLink(links, a, b)`: adiciona ou remove um par
- Simulação e desenho em `graph.js`, separado do restante, para que o `app.js` não cresça além do necessário.

## Tratamento de erros e casos de borda

- **Sem pasta escolhida ou navegador sem seletor de pastas:** a teia mostra a mesma mensagem da lista da v2 e não é desenhada.
- **Pasta sem notas:** mensagem no centro da tela.
- **Ligação para nota que não existe mais** (apagada fora do app): ignorada ao carregar e removida na próxima gravação de `links.json`.
- **Renomear ou apagar nota pelo app:** os pares que citam o nome antigo são atualizados ou removidos antes de gravar `links.json`.
- **Falha ao gravar `links.json`:** mensagem de erro na barra de status; a ligação continua visível na tela até o próximo carregamento.

## Testes

- **Funções puras** (`extractTags`, `automaticLinks`, `normalizeLinks`, `toggleLink`): testes automatizados com casos de borda, como tags repetidas, nomes inexistentes, pares invertidos e arquivo vazio.
- **Simulação e interação:** verificação manual no navegador com um conjunto de notas de exemplo, incluindo arrastar, Shift + clique, busca, tema dia/noite e pasta vazia.

## Fora de escopo

- Ligações por similaridade de texto.
- Ligações com tipo ou rótulo.
- Zoom por gesto de pinça no trackpad.
- Mudanças na v2.

## Pontos em aberto

Nenhum. As decisões de conexão, armazenamento e layout foram tomadas na conversa.
