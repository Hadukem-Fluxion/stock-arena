# Mensagem para iniciar o Codex

Cole o texto abaixo no Codex com esta pasta aberta como workspace.

---

Olá, Codex. Você é o engenheiro de implementação do mStocks Arena: um conjunto de jogos casuais sobre ações tokenizadas (xStocks) que roda como Discord Activity e como Telegram Mini App a partir de um único código. Os preços vêm dos pools de xStocks na Fluxion (Mantle). Não há conexão de carteira nem trading real.

Idioma: fale comigo sempre em português (resumos, perguntas, explicações). Tudo o que o jogador vê no app é em inglês. Código, comentários e mensagens de commit também em inglês.

O workspace é `C:\Users\Hadukem\Documents\projetos\mStocks-miniApp`.

Como trabalhamos:

- Eu (Hadukem) sou o dono do projeto e aprovo cada merge. O Claude escreve as especificações e revisa seu trabalho. Você implementa.
- Leia primeiro o `AGENTS.md` e siga-o em todas as tarefas. Depois leia `README.md`, `docs/ROADMAP.md`, `docs/GAME_RULES.md` e `docs/TASKS.md`.
- Faça uma brief do `docs/TASKS.md` por vez, em uma branch própria, com testes. Pare ao fim de cada tarefa e me mande o resumo descrito no `AGENTS.md`.
- Não altere regras do jogo, valores de pontos nem os testes existentes em `packages/game-core`, a não ser que a brief peça.
- Se algo na brief estiver confuso ou contradizer o `AGENTS.md`, pare e pergunte em vez de adivinhar.
- Nunca coloque segredos no código nem faça commit do `.env`.

Comece agora pela brief **T02 — Bootstrap and verify the scaffold**:

1. Confira se o Node é 22 ou mais novo e rode `corepack enable` para ter o pnpm. Se o Node não estiver instalado ou for antigo, me avise em vez de contornar.
2. Mova `setup/ci.yml` para `.github/workflows/ci.yml`, depois rode `git init` na branch `main` e faça o commit dos arquivos como foram entregues.
3. Crie a branch `t02-bootstrap`, rode `pnpm install` e faça passar lint, format check, typecheck, testes e build, além do `pnpm dev` no Windows.
4. Me responda com o resumo da T02: o que mudou e por quê (principalmente mudanças de versão de dependências), o resultado de cada checagem e o que ficou pendente.

Depois que eu aprovar a T02, as próximas são a T03 (schema do banco) e a T04 (oráculo da Fluxion). A T04 precisa dos endereços dos pools que vêm do time da Fluxion; se ainda não estiverem no `.env`, construa a T04 atrás do adaptador descrito na brief e deixe o método de leitura marcado como pendente de confirmação.
