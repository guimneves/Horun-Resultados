import type { ReactNode } from 'react'

/* Conteúdo do Manual (aba "Manual") — separado do layout (routes/ManualPage.tsx)
   para ser fácil de atualizar. Mudou uma tela? Atualize aqui no mesmo commit
   (Prompt_Horun_Modulo.md, seção 12). Nomes de botões em negrito, exatamente
   como aparecem na tela. Sem dados reais nos exemplos. */

export interface ManualSection {
  id: string
  title: string
  body: ReactNode
}

export const MANUAL_TITLE = 'Manual do Horun · Resultados'

export const MANUAL_INTRO = (
  <p>
    Passo a passo para quem usa o módulo no laboratório: alunos, técnicos, pesquisadores e coordenadores. Use o índice abaixo ou digite uma
    palavra na busca.
  </p>
)

const Steps = ({ children }: { children: ReactNode }) => <ol className="ml-5 list-decimal space-y-1">{children}</ol>
const Bullets = ({ children }: { children: ReactNode }) => <ul className="ml-5 list-disc space-y-1">{children}</ul>
const Tip = ({ children }: { children: ReactNode }) => (
  <p className="rounded-md px-3 py-2 text-sm" style={{ background: 'var(--color-surface)' }}>
    {children}
  </p>
)

export const MANUAL_SECTIONS: ManualSection[] = [
  {
    id: 'para-que-serve',
    title: 'Para que serve',
    body: (
      <>
        <p>
          O Resultados junta, num lugar só, os resultados das análises das amostras de cada projeto: <strong>CHNSO</strong>,{' '}
          <strong>LECO</strong>, <strong>Rock-Eval</strong>, cromatografia do gás (<strong>GC-FID</strong>, <strong>GC-TCD</strong> e a
          planilha de cálculo de gás) e <strong>Py-GC-MS</strong> da rocha.
        </p>
        <p>
          Você envia os arquivos que os equipamentos (ou as planilhas do laboratório) já produzem; o módulo reconhece o formato, junta as
          réplicas de cada amostra e mostra tabelas e gráficos por temperatura — por exemplo, COT ou H/C da rocha hidropirolisada e da
          extraída ao longo das temperaturas da série. Ele não substitui o Amostras (fila de análises) nem o RE7S (operação do Rock-Eval): é
          onde os resultados se encontram e onde fica o <strong>banco de experimentos válidos</strong>.
        </p>
      </>
    ),
  },
  {
    id: 'quem-pode',
    title: 'Quem pode fazer o quê',
    body: (
      <>
        <p>
          O seu papel vem do seu <strong>cargo no Horun</strong> e vale em todos os projetos que você vê. Ele aparece no alto da tela, ao
          lado do seu nome. Coordenadores e o administrador máximo veem <strong>todos</strong> os projetos; pesquisadores, técnicos e ICs só
          veem os projetos em que foram adicionados (veja <strong>Pessoas do projeto</strong>).
        </p>
        <Bullets>
          <li>
            <strong>Somente leitura</strong> (técnico e IC): vê tudo — tabelas, séries, gráficos, detalhe das amostras, condições
            experimentais — e exporta CSV/XLSX, mas não importa nem altera nada. Os botões de importar, criar, editar e excluir não
            aparecem.
          </li>
          <li>
            <strong>Colaborador(a)</strong> (pesquisador): vê tudo, importa arquivos, cria amostras e experimentos, corrige os dados deles,
            liga nomes lembrados, marca amostras e medições como <strong>válidas</strong> ou <strong>inválidas</strong> e exclui medições,
            amostras e experimentos (uma a uma ou várias de uma vez). Nos projetos em que está, adiciona e remove técnicos e ICs.
          </li>
          <li>
            <strong>Coordenador(a)</strong> (administrador máximo e coordenadores do Horun): tudo isso e mais — cria, edita e arquiva
            projetos, escolhe quem acessa cada projeto e vê o <strong>Histórico</strong> (quem fez o quê).
          </li>
          <li>
            <strong>Administrador máximo</strong>: é o único que pode <strong>Excluir</strong> um projeto inteiro (digitando o nome do
            projeto para confirmar).
          </li>
        </Bullets>
        <p>O módulo não tem senha própria: quem entra pelo Horun já está identificado.</p>
      </>
    ),
  },
  {
    id: 'codigos',
    title: 'Como o módulo lê os códigos das amostras',
    body: (
      <>
        <p>Ao importar, o módulo sugere temperatura, experimento e fração a partir do código. Você sempre pode corrigir. Exemplos:</p>
        <Bullets>
          <li>
            <strong>HP320H</strong> — rocha hidropirolisada a 320 °C (<strong>H</strong> = hidropirolisada, sem extração).
          </li>
          <li>
            <strong>HP320E</strong> — rocha hidropirolisada e <strong>extraída</strong> (E).
          </li>
          <li>
            <strong>HP280SE</strong> — <strong>SE = sem extração</strong>: rocha hidropirolisada, não extraída. Nos gráficos entra na mesma
            linha de H.
          </li>
          <li>
            <strong>HP300NA</strong> — o experimento: 300 °C, <strong>N</strong> = atmosfera de nitrogênio, <strong>A</strong> = réplica A
            do experimento (B, C = outras corridas independentes na mesma temperatura). <strong>HP320NA2</strong> = segundo lote da réplica
            A (o número faz parte do código).
          </li>
          <li>
            <strong>HP355NBE</strong> — rocha do experimento HP355NB (355 °C, nitrogênio, réplica B), extraída.
          </li>
          <li>
            <strong>-1, -2, -3</strong> no fim (HP300H-2) — réplica de análise no equipamento. Todas entram na mesma amostra.
          </li>
          <li>
            <strong>.1, .2</strong> (HP320E.1, HP320E.2) — <strong>alíquotas</strong> da mesma amostra. Entram na mesma amostra HP320E; o
            detalhe da amostra mostra também a média de cada alíquota.
          </li>
          <li>
            <strong>RO-1</strong>, <strong>ROA</strong>, <strong>Rocha virgem 80 mesh</strong> — rocha original (não aquecida); aparece nos
            gráficos como linha de referência tracejada.
          </li>
          <li>
            Padrões (<strong>Sulphanilamide</strong>, <strong>Cistina</strong>, <strong>BBOT</strong>...) ficam marcados como padrão, fora
            das séries. Códigos que não seguem o padrão entram como amostra "Outra".
          </li>
          <li>
            <strong>HP280</strong> ou <strong>HP280-1</strong>, sem letra de fração, entram como "HP sem sufixo" — o significado ainda vai
            ser confirmado com o laboratório; corrija a fração se souber.
          </li>
        </Bullets>
      </>
    ),
  },
  {
    id: 'criar-projeto',
    title: 'Como criar um projeto',
    body: (
      <Steps>
        <li>
          Na tela inicial (<strong>Projetos</strong>), toque em <strong>+ Novo projeto</strong> (só coordenadores veem este botão).
        </li>
        <li>Digite o nome, uma descrição curta e escolha uma cor.</li>
        <li>
          Toque em <strong>Criar projeto</strong>. Ele aparece na lista e na barra lateral.
        </li>
      </Steps>
    ),
  },
  {
    id: 'cadastrar-antes',
    title: 'Como cadastrar amostras e experimentos antes',
    body: (
      <>
        <p>
          Dá para cadastrar as amostras primeiro e depois só ligar os resultados a elas na importação (é o jeito recomendado quando a série
          já está planejada).
        </p>
        <Steps>
          <li>
            Na aba <strong>Amostras</strong>, toque em <strong>Criar várias</strong>.
          </li>
          <li>
            Cole os códigos, um por linha (ex.: HP300H, HP300E, HP355NBE). Fração, temperatura e experimento são lidos do código; o
            experimento é criado se ainda não existir. HP320E.1 e HP320E.2 viram a mesma amostra HP320E.
          </li>
          <li>
            Toque em <strong>Criar</strong>. Os códigos que já existiam aparecem na lista e não são mexidos.
          </li>
        </Steps>
        <p>
          Para uma só, use <strong>+ Nova amostra</strong>. As corridas de hidropirólise não se cadastram à mão: vêm da planilha de cálculo
          de gás.
        </p>
      </>
    ),
  },
  {
    id: 'importar',
    title: 'Como importar resultados de uma análise',
    body: (
      <>
        <Steps>
          <li>
            Abra o projeto e toque em <strong>Importar resultados</strong> (no alto, à direita). Técnicos e ICs não veem esse botão — só
            pesquisadores e coordenadores importam.
          </li>
          <li>
            Em <strong>1. Qual análise você vai importar?</strong>, toque no tipo: <strong>CHNSO</strong>, <strong>LECO</strong>,{' '}
            <strong>Rock-Eval</strong>, <strong>GC-FID (gás)</strong>, <strong>GC-TCD (gás)</strong>, <strong>Balanço de gás</strong> ou{' '}
            <strong>Py-GC-MS</strong> (ou <strong>Vários / não sei</strong> para mandar arquivos misturados ou um .zip).
          </li>
          <li>
            Em <strong>2. Escolha o(s) arquivo(s)</strong>, escolha um ou vários arquivos e toque em <strong>Ler arquivos</strong>. Se o
            arquivo não parecer do tipo escolhido, aparece um aviso — confira antes de seguir.
          </li>
          <li>
            Em <strong>3. Arquivos lidos</strong> aparecem só os arquivos com aviso: "ignorado" (não é de resultados, ex.: relatório de
            calibração), "erro" (não foi possível ler) e "já importado" (o mesmo arquivo já entrou — a tela mostra em quais amostras).
          </li>
          <li>
            Em <strong>4. Atribua os resultados às amostras</strong> há uma linha por nome escrito no arquivo, com o número de medições e os
            valores principais (ex.: C, H, S ou COT, HI, Tmax). As réplicas -1, -2, -3 já vêm juntas. Em cada linha escolha{' '}
            <strong>Atribuir a amostra existente</strong> (digite parte do código para buscar), <strong>Criar nova amostra</strong> (confira
            código, fração, temperatura e experimento sugeridos) ou <strong>Ignorar</strong>.
          </li>
          <li>
            Toque em <strong>Confirmar importação</strong>. O resumo mostra o que foi ligado a cada amostra. Os coordenadores recebem um
            aviso no sininho do Horun.
          </li>
        </Steps>
        <p>Ferramentas para muitas linhas de uma vez:</p>
        <Bullets>
          <li>
            Marque várias linhas (caixinhas), escolha a amostra e toque em <strong>Atribuir selecionadas</strong> — por exemplo, HP320E.1 e
            HP320E.2 na mesma amostra HP320E (viram alíquotas dela). <strong>Ignorar selecionadas</strong> faz o mesmo para ignorar.
          </li>
          <li>
            <strong>Aplicar sugestões a todos</strong> volta todas as linhas para o que o módulo sugeriu.
          </li>
          <li>
            <strong>Só linhas sem atribuição</strong> esconde as que já estão ligadas a uma amostra existente. A contagem no alto mostra
            quantas estão atribuídas, a criar, ignoradas e sem amostra escolhida (estas impedem a confirmação).
          </li>
          <li>Padrões e brancos ficam num grupo fechado à parte, ignorados — abra o grupo se quiser guardá-los.</li>
        </Bullets>
        <Tip>
          O módulo lembra: quando você atribui um nome do arquivo (ex.: "Rocha A lote 2") a uma amostra, esse nome fica guardado nela
          ("Nomes lembrados nos arquivos", no detalhe da amostra). Na próxima importação o mesmo nome já vem atribuído. Para esquecer, toque
          no ✕ ao lado do nome.
        </Tip>
        <p>Quais arquivos enviar de cada equipamento:</p>
        <Bullets>
          <li>
            <strong>CHNSO</strong>: o PDF <strong>Results Summary for Element %</strong> (a corrida inteira). Os PDFs{' '}
            <strong>Single Sample Result</strong> também servem. Relatórios de Área, K-Factor, calibração e parâmetros são recusados com
            aviso. Se vierem duas impressões do mesmo relatório, vale a mais nova.
          </li>
          <li>
            <strong>LECO</strong>: o <strong>CSV</strong> exportado do Cornerstone. O PDF e o .zip de diagnóstico do aparelho não são
            resultados.
          </li>
          <li>
            <strong>Rock-Eval</strong>: o relatório <strong>.htm</strong> (Job report do GeoWorks) — traz a tabela e os pirogramas.
          </li>
          <li>
            <strong>Gás</strong>: as planilhas <strong>Dados FID</strong>, <strong>Dados TCD</strong> e a{' '}
            <strong>Planilha cálculo gás</strong> de cada experimento. O experimento é lido do nome da pasta/arquivo (ex.: "HP300NA"); se a
            célula da planilha disser outra coisa, aparece um aviso para conferir.
          </li>
          <li>
            <strong>Py-GC-MS</strong>: a planilha com uma aba por amostra (picos com "Identificação").
          </li>
        </Bullets>
        <Tip>
          Reimportar não duplica: o mesmo arquivo é reconhecido e pulado, e uma nova impressão do mesmo relatório (mesma corrida e posição)
          atualiza os valores em vez de criar outra medição.
        </Tip>
      </>
    ),
  },
  {
    id: 'amostras',
    title: 'Como consultar a tabela de amostras',
    body: (
      <>
        <Steps>
          <li>
            Na aba <strong>Amostras</strong>, a <strong>Lista</strong> mostra cada amostra com a fração, a temperatura, as técnicas que já
            têm resultado e a validade. Use a busca; toque em <strong>Filtros</strong> para filtrar por fração, técnica e validade.
          </li>
          <li>
            Toque numa amostra para ver os detalhes. Primeiro vêm os <strong>Gráficos</strong> (só os que a amostra tem dados para):
            pirograma do Rock-Eval (escolha o eixo X — <strong>Temperatura</strong> ou <strong>Tempo</strong> — e o sinal: HC, CO, CO2...),
            distribuição de n-alcanos (Py-GC-MS), composição do gás, composição elementar do CHNSO, <strong>HI × Tmax</strong> e{' '}
            <strong>Van Krevelen</strong> com a amostra em destaque entre as outras do projeto, <strong>Na série</strong> (o parâmetro
            escolhido nas amostras da mesma fração, por temperatura) e <strong>Réplicas</strong> (cada medição e a média). Todo gráfico tem{' '}
            <strong>Ver tabela</strong> e <strong>Baixar PNG</strong>.
          </li>
          <li>
            No final ficam os <strong>Valores principais</strong> de cada técnica (média ± desvio-padrão de todas as réplicas e alíquotas)
            e, recolhido, <strong>Todos os valores e medições</strong>: todos os parâmetros, as alíquotas e cada medição com o arquivo de
            origem.
          </li>
          <li>
            Para comparar números lado a lado, troque para <strong>Valores</strong>: a tabela ganha uma coluna por parâmetro, e em{' '}
            <strong>Colunas</strong> você escolhe quais mostrar. A tela lembra a última escolha.
          </li>
          <li>
            Para baixar o que está na tela, toque em <strong>Mais</strong> → <strong>Exportar CSV</strong> ou <strong>Exportar XLSX</strong>
            .
          </li>
        </Steps>
        <p>
          Padrões e amostras "Outra" ficam escondidos por padrão — em <strong>Filtros</strong>, marque{' '}
          <strong>Mostrar padrões e outras</strong>. No celular, cada amostra vira um cartão.
        </p>
      </>
    ),
  },
  {
    id: 'validar',
    title: 'Como validar amostras e medições (pesquisadores e coordenadores)',
    body: (
      <>
        <Steps>
          <li>
            Na aba <strong>Amostras</strong>, toque na amostra.
          </li>
          <li>
            Toque em <strong>Válida</strong> ou <strong>Inválida</strong>. Para desfazer, <strong>Voltar a pendente</strong>. Editar os
            dados e excluir a amostra ficam em <strong>Mais</strong>, no detalhe da amostra.
          </li>
          <li>
            Uma medição ruim (ex.: uma réplica fora) pode ser tirada sozinha: no cartão da medição, <strong>Invalidar</strong> (e{' '}
            <strong>Reativar</strong> para voltar).
          </li>
        </Steps>
        <p>
          Amostra nova entra como <strong>pendente</strong>. Nos gráficos, o padrão é "válidas e pendentes" (as inválidas ficam de fora);
          "Só as validadas" mostra o banco de experimentos válidos; "Todas" inclui as inválidas.
        </p>
      </>
    ),
  },
  {
    id: 'varias-amostras',
    title: 'Excluir ou validar várias amostras de uma vez',
    body: (
      <>
        <Steps>
          <li>
            Na aba <strong>Amostras</strong>, toque em <strong>Mais</strong> → <strong>Selecionar várias</strong> e marque a caixinha à
            esquerda de cada amostra. A caixinha do cabeçalho (no celular, <strong>Selecionar todas</strong>) marca todas as que aparecem
            com os filtros atuais.
          </li>
          <li>
            Aparece uma barra embaixo: <strong>N selecionada(s)</strong>, <strong>Marcar como válida</strong>,{' '}
            <strong>Marcar como inválida</strong>, <strong>Excluir selecionadas</strong> e <strong>Limpar seleção</strong>.
          </li>
          <li>
            Em <strong>Excluir selecionadas</strong>, confira a lista com os códigos e quantas medições cada amostra tem, e toque em{' '}
            <strong>Excluir N amostra(s)</strong>.
          </li>
        </Steps>
        <p>
          Excluir <strong>não dá para desfazer</strong>: saem as amostras, as medições, os valores, as curvas e os nomes lembrados delas. Um
          arquivo original que também tem medições de outras amostras continua guardado; um arquivo que fica sem nenhuma medição sai do
          servidor e pode ser importado de novo. As ações valem só para as amostras selecionadas que estão aparecendo — mudou o filtro,
          confira o número na barra. Para sair, <strong>Mais</strong> → <strong>Parar de selecionar</strong>. Técnicos e ICs não veem essa
          opção.
        </p>
      </>
    ),
  },
  {
    id: 'experimentos',
    title: 'Como ver as condições experimentais',
    body: (
      <>
        <p>
          As corridas de hidropirólise vêm da <strong>planilha de cálculo de gás</strong>: ao importá-la (Importar resultados →{' '}
          <strong>Balanço de gás</strong>), a corrida é criada com tudo o que a planilha traz.
        </p>
        <Steps>
          <li>
            Na aba <strong>Condições experimentais</strong>, a lista à esquerda mostra as corridas por temperatura. A etiqueta{' '}
            <strong>planilha</strong> indica que a planilha já foi importada; <strong>sem planilha</strong>, que ainda não.
          </li>
          <li>
            Toque numa corrida para ver a ficha. No alto, o bloco <strong>Massas</strong> da réplica: <strong>gás gerado</strong> (com a
            etiqueta <strong>planilha</strong>, quando vem da planilha de cálculo de gás, ou <strong>editado</strong>, quando alguém digitou
            outro valor), <strong>óleo</strong> e <strong>betume</strong>. Ao lado, a <strong>Média da amostra</strong> (ex.: HP300NA, NB e
            NC → <strong>HP300N</strong>): o valor de cada réplica e a média ± desvio (n) de cada massa.{' '}
            <strong>Valores 0 ou vazios não entram na média.</strong> A mesma média aparece, resumida, abaixo da temperatura na lista de
            corridas.
          </li>
          <li>
            Pesquisadores e coordenadores tocam em <strong>Editar massas</strong> e digitam as massas em gramas (vírgula ou ponto). No gás,
            o campo vazio usa o valor da planilha; o valor digitado substitui o da planilha, mesmo se ela for importada de novo. Para voltar
            ao valor da planilha, toque em <strong>Usar planilha</strong> e salve. Cada mudança fica no Histórico. Técnicos e ICs veem as
            massas, mas não editam.
          </li>
          <li>
            Mais abaixo, a ficha organizada como a planilha: massa inicial, gás por massa de rocha e fechamento do balanço; depois os blocos{' '}
            <strong>Dados do experimento</strong>, <strong>Reator</strong>, <strong>Inicial</strong>, <strong>Final</strong> e{' '}
            <strong>Verificação da cromatografia</strong>, e a composição do gás.
          </li>
          <li>
            Algo veio errado? Em <strong>Mais</strong> → <strong>Corrigir dados</strong>. Para ligar uma amostra a uma corrida, abra a
            amostra e use <strong>Mais</strong> → <strong>Editar dados</strong>.
          </li>
        </Steps>
      </>
    ),
  },
  {
    id: 'series',
    title: 'Como ver os gráficos de série',
    body: (
      <>
        <Steps>
          <li>
            Na aba <strong>Séries</strong>, os gráficos aparecem todos juntos, em grupos: <strong>Matéria orgânica</strong> (COT, C total,
            HI, OI, Tmax, S1, S2, HI × Tmax e <strong>COT (Rock-Eval) × C total (LECO)</strong>, com a reta ajustada e o <strong>R²</strong>
            ), <strong>Elementar</strong> (H/C, O/C, N, S, Van Krevelen), <strong>Py-GC-MS</strong> e <strong>Pirogramas</strong>. Só
            aparecem os que têm dados no projeto. Use os botões do alto para ver um grupo só.
          </li>
          <li>
            No alto da aba, troque <strong>Parâmetros</strong> por <strong>Balanço de massas</strong> (a escolha fica guardada neste
            navegador). Lá ficam três gráficos separados, em gramas × temperatura: <strong>Massa de óleo</strong>,{' '}
            <strong>Massa de gás</strong> e <strong>Massa de betume</strong>, com a média ± desvio das réplicas de cada amostra (pontos
            cheios) e cada réplica (pontos vazados); valores 0 ou vazios não entram. Com mais de uma atmosfera, cada uma ganha uma linha com
            traço diferente. Os dados vêm de <strong>Condições experimentais</strong> (gás: planilha ou valor editado). Abaixo, os gráficos
            do gás que antes ficavam no grupo Gás: massa de gás gerada (só o valor da planilha), gás por massa de rocha, wetness e
            composição do gás.
          </li>
          <li>
            Falta algum? <strong>+ Gráfico</strong>: escolha a técnica e o parâmetro e toque em <strong>Adicionar</strong>. Ele vai para{' '}
            <strong>Meus gráficos</strong> (guardado neste navegador).
          </li>
          <li>
            Cada gráfico e cada grupo mostram, em etiquetas, de qual análise e equipamento vêm os dados (ex.: <strong>Rock-Eval 7S</strong>,{' '}
            <strong>LECO SC832</strong>, <strong>CHNSO · EuroVector EA</strong>).
          </li>
          <li>
            Nos gráficos que não são por temperatura (HI × Tmax, Van Krevelen, COT × C total), cada ponto traz o nome da amostra e, ao lado
            e em cinza, a réplica do experimento (ex.: HP300N <span style={{ color: 'var(--color-text-muted)' }}>A</span>). Toque no ponto
            para ver os valores.
          </li>
          <li>
            Em <strong>Opções</strong> → <strong>Tratar apenas</strong>, escolha <strong>Só as extraídas</strong> ou{' '}
            <strong>Só as normais, sem extração</strong> (H, SE, HP). Gás e rocha original continuam aparecendo. Um aviso no alto lembra
            quando o filtro está ligado.
          </li>
          <li>Cada linha é uma fração (hidropirolisada, extraída...). Cada ponto é a média ± desvio (barra) na temperatura.</li>
          <li>
            Réplicas do experimento (A, B, C) na mesma temperatura entram juntas no ponto. Para ver cada uma separada, em{' '}
            <strong>Opções</strong> marque <strong>Separar réplicas A, B, C</strong> — cada réplica ganha um tipo de traço.
          </li>
          <li>
            <strong>Ver tabela</strong> mostra os números do gráfico; <strong>Baixar PNG</strong> salva a imagem.
          </li>
        </Steps>
        <Tip>
          Pirogramas e n-alcanos: toque nas amostras (até 12) para escolher quais sobrepor. No pirograma, escolha o eixo X (temperatura ou
          tempo) e o sinal.
        </Tip>
      </>
    ),
  },
  {
    id: 'comparar',
    title: 'Como comparar amostras',
    body: (
      <Steps>
        <li>
          Na aba <strong>Comparar</strong>, toque nas amostras que quer ver lado a lado (até 16).
        </li>
        <li>A tabela mostra todos os parâmetros que elas têm. Escolha um parâmetro para ver o gráfico de barras.</li>
        <li>Se houver Rock-Eval ou Py-GC-MS, os pirogramas e a distribuição de n-alcanos dessas amostras aparecem embaixo.</li>
      </Steps>
    ),
  },
  {
    id: 'arquivar',
    title: 'Como arquivar ou excluir um projeto',
    body: (
      <>
        <p>
          No projeto, toque em <strong>Projeto ▾</strong> (no alto, à direita). <strong>Arquivar</strong> (coordenador): o projeto sai da
          lista e fica só para leitura; nada é apagado. <strong>Desarquivar</strong> devolve. Para ver os arquivados, marque{' '}
          <strong>Mostrar arquivados</strong> na tela de projetos.
        </p>
        <p>
          <strong>Excluir</strong> (só administrador máximo): apaga para sempre o projeto e tudo dentro dele. É preciso digitar o nome do
          projeto para confirmar.
        </p>
      </>
    ),
  },
  {
    id: 'pessoas',
    title: 'Pessoas do projeto (quem acessa cada projeto)',
    body: (
      <>
        <p>
          Coordenadores e o administrador máximo veem e abrem todos os projetos. Pesquisadores, técnicos e ICs só veem os projetos em que
          estão na lista de <strong>Pessoas do projeto</strong> — quem não está nem vê o projeto.
        </p>
        <Steps>
          <li>
            No projeto, toque em <strong>Projeto ▾</strong> → <strong>Pessoas do projeto</strong>.
          </li>
          <li>
            Toque em <strong>+ Adicionar pessoa</strong>, busque pelo nome, usuário ou cargo e toque em <strong>Adicionar</strong>. A pessoa
            passa a ver o projeto na hora.
          </li>
          <li>
            Para tirar alguém, toque em <strong>Remover</strong> ao lado do nome.
          </li>
        </Steps>
        <Bullets>
          <li>
            <strong>Coordenadores</strong> adicionam e removem pesquisadores, técnicos e ICs.
          </li>
          <li>
            <strong>Pesquisadores</strong>, nos projetos em que estão, adicionam e removem <strong>técnicos e ICs</strong> (não outros
            pesquisadores).
          </li>
          <li>
            <strong>Técnicos e ICs</strong> só consultam a lista.
          </li>
        </Bullets>
        <p>
          Só aparece na busca quem já abriu o Resultados pelo Horun ao menos uma vez. Se a pessoa não aparece, peça para ela abrir o módulo
          uma vez e tente de novo. Quem entrou e quem saiu fica no <strong>Histórico</strong>.
        </p>
      </>
    ),
  },
  {
    id: 'historico',
    title: 'Histórico e arquivos originais',
    body: (
      <p>
        Para o <strong>administrador máximo</strong> e os <strong>coordenadores</strong>: em <strong>Projeto ▾</strong> →{' '}
        <strong>Histórico</strong> veem quem importou, validou, editou ou excluiu, quem entrou ou saiu do projeto, e quando. Ao lado, a
        lista de arquivos importados — toque no nome para baixar o original.
      </p>
    ),
  },
  {
    id: 'duvidas',
    title: 'Dúvidas frequentes',
    body: (
      <Bullets>
        <li>
          <strong>Importei e a amostra não aparece nos gráficos.</strong> Confira se ela tem temperatura e fração (abra a amostra), se não
          está inválida e se a fração entra nas séries (padrões e "Outra" não entram).
        </li>
        <li>
          <strong>A "Massa de gás gerada" veio vazia.</strong> A planilha foi salva sem o valor calculado da fórmula. Abra no Excel, salve e
          importe de novo — a importação atualiza.
        </li>
        <li>
          <strong>O experimento do gás veio errado.</strong> O módulo usa primeiro o nome da pasta, depois o nome do arquivo, depois a
          célula da planilha. Corrija o experimento na prévia antes de confirmar.
        </li>
        <li>
          <strong>Enviei o PDF errado do CHNSO.</strong> Sem problema: ele é recusado com aviso. Envie o "Results Summary for Element %".
        </li>
        <li>
          <strong>Quem procurar:</strong> a coordenação do laboratório ou o mantenedor do Horun.
        </li>
      </Bullets>
    ),
  },
]
