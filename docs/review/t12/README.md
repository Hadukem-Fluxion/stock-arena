# T12 — capturas para revisão

- [Mobile, 360px](mobile.png): filtros, ranking e posição do jogador.
- [Desktop, 1440px](desktop.png): tela de Leaderboard.
- [Preços e top 5 no desktop](prices-desktop.png): cotações recebidas por SSE,
  incluindo estado de mercado fechado por ativo.

Build de produção, Playwright no Edge local, login e ranking simulados. O SSE é
servido por um servidor HTTP local de teste para validar streaming e reconexão.
Todos os jogadores, preços e pontos são fictícios; nenhum segredo é usado.
Os testes cobrem 3 e 30 ativos em 360px e 1440px, troca de filtros, temporada
encerrada e reconexão com uma nova cotação após queda do stream.

Estas capturas não representam teste real dentro do Discord ou Telegram.
O smoke test real no Discord fica para depois do merge e do deploy.
