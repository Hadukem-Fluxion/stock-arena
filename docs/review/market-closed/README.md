# Mercado fechado — capturas para revisão

- [Mobile, 360px](mobile.png): Higher or Lower pausado, reabertura em UTC e últimos preços.
- [Desktop, 1440px](desktop.png): último preço no Stock of the Day e painel de preços,
  ambos com `Market closed`, além do aviso de reabertura.

Build de produção, Playwright no Edge local. Login, ranking, preços e agenda são
dados fictícios; o stream usa um servidor HTTP local de teste. A data exibida
é uma fixture, não uma confirmação do horário do mercado real. O navegador foi
configurado em Los Angeles para verificar que o aviso continua em UTC.

Os testes cobrem 3 e 30 ativos em 360px e 1440px, sem consumir runs nem conceder
pontos. O teste real no Discord fica para depois do merge/deploy e da migration
`0005`, que permite ao worker persistir o `nextChangeAt` recebido da fonte.
