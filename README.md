<div align="center">

<img src="assets/icon.png" width="80" alt="Ícone do JourneyHub">

# JourneyHub

**Sistema desktop para registro e análise da jornada de trabalho**

Windows x64 · Versão 0.4.3 · Português e inglês

[Baixar o instalador](https://github.com/guilherme-dope/JourneyHub-Desktop/releases/tag/v0.4.3) · [Instalação](#instalacao) · [Requisitos funcionais](#requisitos) · [Arquitetura](#arquitetura)

</div>

## 1. Apresentação

O JourneyHub é um aplicativo de uso pessoal para Windows. Sua origem está em uma dificuldade prática do controle por planilha: representar várias pausas no mesmo dia, corrigir um lançamento e ainda conseguir explicar como se chegou ao saldo de horas. O sistema registra cada entrada, pausa, retorno e saída e usa esses eventos tanto na consulta diária quanto no relatório Excel.

O objetivo é permitir que a pessoa registre sua jornada mesmo sem internet, recupere o trabalho em andamento após uma interrupção e consulte as alterações feitas posteriormente. A versão 0.4.3 contempla o uso individual. Seus indicadores expressam tempo de trabalho segundo a referência configurada pelo usuário. Cálculo de remuneração e sincronização entre dispositivos estão fora desse escopo.

<a id="instalacao"></a>
## 2. Instalação no Windows

| Requisito | Para usar a versão instalada |
|---|---|
| Plataforma | Windows de 64 bits (x64) |
| Armazenamento padrão | SQLite incluído no aplicativo |
| Acesso ao download | Download público pelo GitHub Releases |
| Ambiente de desenvolvimento | Node.js e ferramentas de compilação são necessários apenas para desenvolver a partir do código-fonte |

1. Abra a [release 0.4.3](https://github.com/guilherme-dope/JourneyHub-Desktop/releases/tag/v0.4.3). Na seção **Assets**, baixe o instalador com extensão **.exe**. O arquivo **SHA256SUMS.txt** contém o resumo para conferência de integridade.
2. Execute o instalador e conclua a instalação para seu usuário do Windows. O pacote desta versão está sem assinatura digital e o Windows pode exibir um aviso de editor desconhecido.
3. Abra **JourneyHub** pelo menu Iniciar. Em uma instalação nova, o armazenamento local é preparado automaticamente.
4. Em **Minha jornada**, clique em **Iniciar jornada**. Ao fazer uma pausa, informe o motivo. Use **Registrar retorno** quando voltar e **Encerrar jornada** ao terminar o trabalho.

**Para quem já usa SQL Server.** Em **Configurações**, selecione a opção de usar o SQL Server existente e escolha seu arquivo de conexão. O aplicativo verifica a conexão e passa a exibir as jornadas desse banco na mesma janela. Os históricos SQLite e SQL Server são independentes. Ao procurar registros antigos, selecione um período que inclua as datas desejadas. O [modelo de configuração](.env.example) descreve os campos e os modos de autenticação. Guarde o arquivo preenchido em local privado e use uma conta com permissões restritas.

<a id="requisitos"></a>
## 3. Requisitos funcionais

| ID | Função | Comportamento esperado |
|---|---|---|
| RF01 | Registrar a jornada | Registrar entrada e saída e recuperar uma jornada aberta ao reiniciar o aplicativo. |
| RF02 | Registrar pausas | Associar motivo, início e retorno a cada pausa, admitindo múltiplas pausas na mesma jornada. |
| RF03 | Corrigir lançamentos | Editar horários e motivos e cadastrar jornadas anteriores, com validação de datas e sobreposições. |
| RF04 | Consultar auditoria | Exibir a sequência operacional com os dados corrigidos e manter os valores anteriores no histórico administrativo. |
| RF05 | Excluir e restaurar | Exigir duas confirmações para enviar à lixeira e permitir restauração quando não houver conflito com outra jornada. |
| RF06 | Consultar indicadores | Filtrar por datas, selecionar períodos rápidos ou informar a quantidade em **Últimos dias** e confirmar em **Aplicar dias**. |
| RF07 | Personalizar a referência | Ajustar a carga diária para os cálculos futuros, respeitando a regra vigente na data de cada jornada. |
| RF08 | Exportar relatórios | Exportar o resumo de horas ou escolher explicitamente a planilha completa com histórico administrativo. |
| RF09 | Lembrar o início | Configurar dias e horários e oferecer as opções de iniciar, adiar ou ignorar. A entrada depende de confirmação. |
| RF10 | Operar em segundo plano | Manter os lembretes ativos na bandeja e permitir inicialização opcional com o Windows. |
| RF11 | Preservar dados | Criar e restaurar backups do SQLite e acessar um SQL Server previamente configurado. |
| RF12 | Adaptar a apresentação | Alternar entre português e inglês e escolher o formato regional de exibição. |

## 4. Regras de cálculo

O tempo trabalhado corresponde ao intervalo entre entrada e saída, descontada a soma das pausas. Nas jornadas encerradas, o tempo acima da referência conta como extra e o tempo abaixo dela conta como déficit. Uma jornada aberta exibe valores parciais. Dias sem lançamento não geram déficit.

| Exemplo | Tempo trabalhado | Referência | Resultado |
|---|---:|---:|---|
| Segunda, 09h–18h, pausa de 1h | 8h | 8h | Saldo zero |
| Terça, 09h–19h, pausas de 1h e 30min | 8h30 | 8h | 30min extras |
| Sábado, 18h–20h, sem pausa | 2h | 0h | 2h extras |

O padrão é de 8 horas em dias úteis e zero aos fins de semana. Uma nova referência, entre 1 minuto e 24 horas, passa a valer a partir do dia seguinte no calendário de trabalho. Os registros armazenam instantes em UTC e usam **America/Sao_Paulo** como fuso de trabalho. A escolha de idioma altera a apresentação das datas e durações.

<a id="arquitetura"></a>
## 5. Arquitetura e persistência

A interface solicita operações específicas por uma ponte entre os processos do Electron. O processo principal valida os pedidos e concentra o acesso ao banco e aos arquivos. Os dois modos de armazenamento compartilham as regras de jornada e cálculo.

~~~mermaid
flowchart LR
    UI[Interface React] --> P[Ponte IPC]
    P --> M[Processo principal Electron]
    M --> D[Regras de jornada]
    M --> R[Repositório ativo]
    R --> S[(SQLite local)]
    R --> Q[(SQL Server)]
    M --> E[Exportação Excel]
~~~

| Componente | Responsabilidade |
|---|---|
| [Interface](src/renderer) | Registro, histórico, preferências e notificações |
| [Ponte IPC](src/preload) e [contratos](src/shared) | Operações disponíveis à interface e formatos aceitos |
| [Domínio](src/domain) | Estados da jornada, pausas, referência diária e cálculos |
| [Processo principal](src/main) | Persistência, ciclo de vida no Windows, backup e exportação com ExcelJS |
| [Testes](tests) | Validação automatizada do domínio e da persistência com Vitest |

## 6. Atualização, backup e recuperação

- **Atualizar o aplicativo.** Faça backup do banco ativo, encerre o JourneyHub pelo menu do ícone próximo ao relógio e execute o novo instalador na mesma pasta. Na versão 0.4.3, a atualização é manual.
- **Proteger o histórico.** Para SQLite, use a função de backup nas configurações e guarde a cópia fora do computador. Restaurar recupera o estado da data da cópia. Para SQL Server, use o backup do próprio servidor e valide a restauração em um banco separado. A planilha Excel serve para consulta e análise.
- **Retomar após uma interrupção.** Ao reabrir o aplicativo com o mesmo banco, confira a jornada em andamento. A última entrada ou pausa já gravada mantém seu horário. Registre o próximo evento conforme o que realmente aconteceu.
- **Personalizar a referência em SQL Server.** O administrador pode habilitar o recurso com o [script da referência diária](sql/003-daily-reference.sql), após validar uma cópia de segurança. A instalação do aplicativo não executa essa migração. Sem ela, o histórico continua disponível com a referência padrão.

## 7. Desenvolvimento e validação

Para trabalhar com o código-fonte no Windows, use Node.js 24 e npm. Execute os comandos na raiz do repositório.

~~~powershell
npm ci
node node_modules/electron/install.js
npm run dev
~~~

| Comando | Finalidade |
|---|---|
| npm run typecheck | Verificar os tipos TypeScript |
| npm test | Executar a suíte padrão de testes |
| npm run build | Compilar a interface e os processos do Electron |
| npm run installer:win | Gerar o instalador Windows na pasta release da versão |

Na linha 0.4.x, foram executados 101 testes automatizados com bancos isolados. O executável empacotado também foi validado com SQLite e SQL Server isolado, incluindo filtros, correções, lixeira, restauração e exportação. Testes de integração que gravam jornadas exigem um banco exclusivo de testes. A validação em Windows limpo e a atualização entre dois instaladores permanecem pendentes nesta versão.

## Privacidade e backups

O resumo de horas omite observações, motivos de pausa e versões anteriores. Use uma base SQL exclusiva por pessoa. A validação de backups SQLite aceita arquivos de até 512 MiB e tem prazo de 30 segundos por operação. A atualização é manual. Faça backup antes de instalar uma nova versão.
