# T25 — revisão visual

Capturas locais do build de produção, com login e respostas da API simulados.
O stream SSE usa um servidor local de teste. Nenhuma credencial, pergunta real
ou dado do Supabase aparece nas imagens. Não substituem o teste real no Discord.

- `mobile.png`: rodada Last session em 360px, antes da resposta.
- `mobile-feedback.png`: feedback com o mesmo selo e a variação revelada.
- `mobile-prices.png`: último preço primário e cotação da pool separada, com horário UTC.
- `desktop.png`: rodada e painel de preços em 1440px.

Os testes Playwright cobrem 3 e 30 ativos nas duas larguras, mercado fechado com
histórico, ausência de histórico e o preço on-chain somente informativo. As fotos
selecionadas usam o catálogo simulado de 3 ativos.

Ativação em produção: as migrations 0006 e 0007 são aplicadas pelo pre-deploy da API após
o merge; o worker precisa observar um fechamento confirmado. O histórico antigo
não registra esse instante, portanto uma estreia já durante o fechamento pode
permanecer pausada até o próximo fechamento observado. Nenhum calendário é inferido.

Revisão: a sessão fica gravada fora da retenção em `ticker_status.last_session`.
O worker pode confirmar o fechamento no primeiro poll válido mesmo após mais de
120s de interrupção, desde que as amostras primárias respeitem a tolerância.
Testes de integração exercitam 60h com retenção real removendo as amostras
originais e jogo disponível no domingo à noite, além de restart/falha de metadados
por 10 minutos. A interface não mudou; as capturas acima continuam válidas.
