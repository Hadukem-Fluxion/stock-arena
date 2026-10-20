# T26 — evidências de revisão

Capturas de testes Playwright no Edge, com login Telegram simulado, preços,
catálogo e usuário fictícios. Não contêm perguntas do quiz, credenciais ou dados
do Supabase. Não substituem a aceitação real na Activity após o deploy.

| Estado                           | Celular (360px)                     | Desktop (1440px)                     |
| -------------------------------- | ----------------------------------- | ------------------------------------ |
| Previsão pendente, 3 ativos      | [Celular](prediction-mobile-3.png)  | [Desktop](prediction-desktop-3.png)  |
| Previsão pendente, 30 ativos     | [Celular](prediction-mobile-30.png) | [Desktop](prediction-desktop-30.png) |
| Resultado com preços e variação  | [Celular](result-mobile.png)        | [Desktop](result-desktop.png)        |
| Mercado fechado, abertura em UTC | [Celular](queued-mobile.png)        | [Desktop](queued-desktop.png)        |

O navegador verifica três slots, Up/Down, retomada após reload, countdown,
resultado vindo da API, saldo atualizado, espera por abertura e ausência de
overflow horizontal com 3 e 30 ativos. O relógio local nunca concede pontos.
Os testes de resultado verificam duas casas decimais (`+1.00%`, `-0.37%` e
`0.00%`). As capturas de resultado foram atualizadas após a revisão.

O ajuste de revisão também cobre leitura, Next e Pick com oferta que ficou
inelegível (pausa manual, divergência, halt ou preço desatualizado): a API troca
a ação sem transferir o palpite antigo nem alterar pontos, limites ou expiração.
Sem alternativa, `HL_UNAVAILABLE` preserva todo o estado. Previsões já bloqueadas
não são trocadas pela API.

Os testes com PGlite cobrem preços exatos, janelas, pausas, halt, reabertura
atrasada, anulação em 6h, três sequências, meia-noite UTC, limite de dez acertos,
expiração, idempotência e migração de Classic sem reescrever o ledger. Um teste
fecha/reabre o banco persistente após capturar o início, remove a amostra original
e confirma liquidação única com diferença decimal inferior à precisão de float.

Revisar o contrato de retry: a espera não desloca a janela final de 120 segundos.
As amostras antigas sem validade registrada não participam de novas previsões.
Nenhuma migration ou previsão real foi executada no staging por este PR.
