export type Language = 'pt-BR' | 'en';

const english: Record<string, string> = {
  'Helios: painel local de monitoramento de energia solar.': 'Helios: local solar energy dashboard.',
  'Navegação': 'Navigation', 'Helios, início': 'Helios, home', 'Navegação móvel': 'Mobile navigation',
  'Idioma': 'Language', 'Carregando…': 'Loading…',
  'brilhe': 'shine', 'como': 'like', 'o': 'the', 'sol.': 'sun.',
  'Painel solar': 'Solar dashboard', 'Visão geral': 'Overview', 'Histórico': 'History', 'Análises': 'Insights', 'Equipamento': 'Equipment',
  'Visão geral da geração': 'Solar overview', 'Dispositivos': 'Devices',
  'Atualizar agora': 'Refresh now', 'Fechar assistente': 'Close setup',
  'ETAPA 1 DE 2 · DISPOSITIVO': 'STEP 1 OF 2 · DEVICE', 'Encontre o coletor': 'Find your data logger',
  'Selecione o S3-WIFI-ST na lista. O MAC é uma pista; a resposta Solis confirma o coletor. Outros endereços não recebem a senha.': 'Select the S3-WIFI-ST from the list. Its MAC address is a clue; a Solis response confirms the data logger. Your password is never sent to other addresses.',
  'Buscar novamente': 'Scan again', 'Ou informe o IP manualmente': 'Or enter its IP address', 'Continuar': 'Continue',
  '← Voltar aos dispositivos': '← Back to devices', 'ETAPA 2 DE 2 · ACESSO': 'STEP 2 OF 2 · ACCESS',
  'Conectar ao S3-WIFI-ST': 'Connect to S3-WIFI-ST', 'IP do coletor': 'Data logger IP address',
  'Qual senha usar?': 'Which password should I use?',
  'Depois de entrar no Wi-Fi da casa, alguns S3-WIFI-ST passam a usar a': 'After joining your home Wi-Fi, some S3-WIFI-ST units use the',
  'senha desse Wi-Fi': 'Wi-Fi password',
  'para abrir a página local do coletor. Use a senha que funciona nessa página.': 'to open the data logger’s local page. Use the password that works on that page.',
  'Senha da página do coletor': 'Data logger page password', 'Digite a senha local': 'Enter the local password',
  'Deixe em branco apenas para reutilizar a senha salva neste computador.': 'Leave blank only to reuse the password saved on this computer.',
  'Conectar': 'Connect', '01 / MONITORAMENTO': '01 / MONITORING',
  'Acompanhe a geração e o estado do seu inversor.': 'Track solar production and the status of your inverter.',
  'Conectando': 'Connecting', 'Geração atual': 'Current production', 'POTÊNCIA AGORA': 'POWER NOW',
  'Leitura em tempo real do inversor': 'Live reading from the inverter', 'Uso da capacidade nominal': 'Share of rated capacity',
  'de 6,0 kW': 'of 6.0 kW', 'Energia gerada': 'Energy produced', 'Hoje': 'Today', 'Este mês': 'This month',
  'Desde o início': 'All time', 'kWh gerados': 'kWh produced', 'kWh registrados': 'kWh recorded', 'kWh acumulados': 'kWh total',
  'Como estes números são obtidos': 'Where these numbers come from',
  'Direto do coletor:': 'From the data logger:',
  'potência, energia de hoje, temperatura e alerta, consultados aproximadamente a cada minuto.': 'power, today’s energy, temperature, and alerts, checked about once a minute.',
  'Calculado pelo painel:': 'Calculated by Helios:',
  'pico observado, comparações, energia mensal e valor estimado. Esses indicadores dependem das leituras guardadas neste computador; lacunas no histórico ficam vazias.': 'peak power, comparisons, monthly energy, and estimated value. These figures depend on readings saved on this computer; missing readings leave gaps in the history.',
  'Limite atual:': 'Current limitation:',
  'a energia acumulada não aparece quando o coletor devolve um valor inválido. O painel não substitui um medidor certificado nem foi calibrado com a sua fatura.': 'total energy is hidden when the data logger returns an invalid value. Helios does not replace a certified meter and has not been calibrated against your bill.',
  'CONTEXTO': 'AT A GLANCE', 'Como está a geração': 'Production at a glance', 'Histórico local': 'Local history',
  'Ontem': 'Yesterday', 'Sem histórico anterior': 'No earlier history',
  'Média dos últimos 7 dias': '7-day average', 'Dias completos registrados': 'Full days recorded',
  'Pico de potência hoje': 'Peak power today', 'Aguardando leituras': 'Waiting for readings',
  'Tempo com geração observada': 'Time producing power', 'Minutos registrados acima de 50 W': 'Recorded minutes above 50 W',
  'DESEMPENHO': 'PERFORMANCE', 'Geração ao longo do tempo': 'Production over time',
  'Dia': 'Day', 'Mês': 'Month', 'Ano': 'Year', 'Período do gráfico': 'Chart period', 'Potência · kW': 'Power · kW', 'Energia · kWh': 'Energy · kWh',
  'Gráfico de geração': 'Production chart',
  'O histórico será preenchido conforme novas leituras forem registradas.': 'The chart will fill in as new readings are recorded.',
  'HISTÓRICO DIÁRIO': 'DAILY HISTORY', 'Geração no mês': 'Production this month',
  'Navegar pelos meses': 'Browse months', 'Mês anterior': 'Previous month', 'Próximo mês': 'Next month',
  'Escolher mês': 'Choose month', 'Mês atual': 'Current month',
  'Selecione um dia para ver a curva de geração. Dias sem leitura ficam em branco.': 'Select a day to see its production curve. Days without readings are left blank.',
  'PRÓXIMOS 7 DIAS': 'NEXT 7 DAYS', 'Previsão de geração': 'Production forecast', 'Estimativa pelo histórico': 'Estimate from history',
  'TOTAL ESTIMADO': 'ESTIMATED TOTAL', 'FAIXA HISTÓRICA': 'HISTORICAL RANGE', 'kWh em 7 dias': 'kWh in 7 days',
  'Previsão diária': 'Daily forecast', 'Aguardando histórico para calcular a previsão.': 'Waiting for enough history to calculate a forecast.',
  'Geração diária no mês': 'Daily production this month', 'Os dias sem leitura ficam em branco.': 'Days without readings are left blank.',
  'COMPORTAMENTO': 'TODAY’S PATTERN', 'Temperatura e potência hoje': 'Temperature and power today',
  'Temperatura': 'Temperature', 'Potência': 'Power', 'Temperatura e potência ao longo do dia': 'Temperature and power throughout the day',
  'O gráfico aparecerá após as primeiras leituras.': 'The chart will appear after the first readings.',
  'CONEXÃO': 'CONNECTION', 'Leituras do coletor': 'Data logger readings',
  'Última leitura válida': 'Last valid reading', 'Tempo sem leitura': 'Time since last reading',
  'Sucesso nas últimas 24 h': 'Successful reads in the last 24 h', 'Falhas registradas': 'Recorded failures',
  'A taxa considera somente as tentativas feitas enquanto o painel estava ligado.': 'The rate includes only attempts made while Helios was running.',
  'ESTIMATIVA': 'ESTIMATE', 'Valor da energia gerada': 'Value of energy produced',
  'Tarifa de referência (R$/kWh)': 'Reference rate (BRL/kWh)', 'Ex.: 0,90': 'E.g. 0.90', 'Salvar': 'Save',
  'Valor bruto estimado pela energia produzida. A economia real depende do consumo e da compensação na rede.': 'Gross value estimated from energy produced. Actual savings depend on use and grid credits.',
  'DADOS': 'DATA', 'Importar e exportar leituras': 'Import and export readings',
  'CSV · Excel e LibreOffice': 'CSV · Excel and LibreOffice',
  'Exporte as leituras registradas neste computador. Ao importar um CSV do painel, os registros existentes são preservados e as duplicatas são ignoradas.': 'Export readings saved on this computer. When you import a Helios CSV, existing readings stay in place and duplicates are skipped.',
  'Backup completo': 'Full backup', 'Backup deste mês': 'This month’s backup', 'Resumo diário': 'Daily summary',
  'Importar backup CSV': 'Import a CSV backup', 'Importar leituras': 'Import readings',
  'O resumo diário é para análise em planilhas. Para restaurar dados no painel, importe um arquivo de backup de leituras.': 'The daily summary is for spreadsheet analysis. To restore readings in Helios, import a readings backup.',
  'EQUIPAMENTO': 'EQUIPMENT', 'Inversor': 'Inverter', 'Modelo': 'Model', 'Número de série': 'Serial number',
  'Firmware do coletor': 'Data logger firmware', 'Última leitura': 'Last reading',
  'ATIVIDADE': 'ACTIVITY', 'Estado e alertas': 'Status and alerts', 'Nenhum alerta ativo': 'No active alerts',
  'O coletor não informou falhas.': 'The data logger reported no faults.',
  'O S3-WIFI-ST fornece um alerta resumido. Dados elétricos detalhados exigem outro método de leitura.': 'The S3-WIFI-ST provides a summary alert. Detailed electrical data requires another reading method.',
  'Painel local · Dados lidos diretamente do coletor na sua rede': 'Local dashboard · Readings from the data logger on your network',
  'Prévia com dados de exemplo.': 'Preview with sample data.',
  'Use “Dispositivos” para conectar o S3-WIFI-ST. Os números exibidos nesta prévia não são do seu inversor.': 'Use “Devices” to connect the S3-WIFI-ST. The figures in this preview are not from your inverter.',
  'Exibindo a última leitura válida.': 'Showing the last valid reading.',
  'Verifique a configuração do coletor.': 'Check the data logger settings.',
  'A reconexão automática continuará em segundo plano.': 'Automatic reconnection will continue in the background.',
  'indisponível': 'unavailable', 'Buscando na rede local…': 'Scanning the local network…', 'A busca falhou.': 'The scan failed.',
  'uma rede local detectada': 'a detected local network', 'MAC compartilhado por outros IPs': 'MAC shared by other IP addresses',
  'mesmo MAC salvo': 'same saved MAC', 'Coletor Solis': 'Solis data logger', 'sem interface HTTP': 'no HTTP interface',
  'Selecionar →': 'Select →', 'Não identificado': 'Unidentified',
  'coletor Solis': 'Solis data logger', 'coletores Solis': 'Solis data loggers',
  'endereço detectado': 'address found', 'endereços detectados': 'addresses found',
  'Nenhum dispositivo respondeu em {network}. Você pode informar o IP manualmente.': 'No device responded on {network}. You can enter the IP address manually.',
  'Em operação': 'Running', 'Dados de exemplo': 'Sample data', 'Sem conexão': 'Disconnected',
  'Alerta ativo': 'Active alert', 'Leitura desatualizada': 'Outdated reading',
  'Simulação visual · sem conexão com o inversor': 'Sample view · no inverter connection',
  'Última potência registrada': 'Last recorded power',
  'Leitura direta do S3-WIFI-ST': 'Reading from the S3-WIFI-ST', 'Aguardando leitura': 'Waiting for a reading',
  'Atualizado {time}': 'Updated {time}',
  'Prévia': 'Preview', 'Com base no histórico local': 'Based on local history',
  'Sem dias anteriores registrados': 'No earlier days recorded', 'Sem leituras hoje': 'No readings today',
  '{delta}% · hoje ainda em andamento': '{delta}% · today is still in progress',
  'Base: {days} de 7 dias anteriores': 'Based on {days} of the previous 7 days',
  'Às {time}': 'At {time}',
  '{day} de {month}: {energy}': '{month} {day}: {energy}',
  'Melhor dia registrado: {date} · {energy} kWh. Dias sem leitura ficam em branco.': 'Best recorded day: {date} · {energy} kWh. Days without readings are left blank.',
  'Melhor dia registrado: {date} · {energy} kWh. Selecione um dia para ver a curva.': 'Best recorded day: {date} · {energy} kWh. Select a day to see its curve.',
  '{date} · {energy} kWh · {samples} leituras registradas': '{date} · {energy} kWh · {samples} recorded readings',
  'Conecte o coletor para calcular uma previsão com seus dados.': 'Connect the data logger to calculate a forecast from your readings.',
  'Base: {days} dias registrados nos últimos 30. Mediana e faixa de 20% a 80%; sem previsão do tempo. Leituras incompletas podem reduzir a estimativa.': 'Based on {days} recorded days in the last 30. Median and 20th–80th percentile range; no weather forecast. Incomplete readings may lower the estimate.',
  'São necessários 5 dias registrados nos últimos 30 para estimar a geração. Disponíveis: {days}.': 'At least 5 recorded days in the last 30 are needed for a forecast. Available: {days}.',
  'Não foi possível carregar este mês sem conexão.': 'This month could not be loaded offline.',
  'Os dias sem leitura ficam em branco. O histórico começa quando o painel registra a primeira leitura.': 'Days without readings are left blank. History starts with the first recorded reading.',
  '{count} leituras hoje. Temperatura entre {min} e {max} graus Celsius; potência na escala de zero a seis quilowatts.': '{count} readings today. Temperature from {min} to {max} degrees Celsius; power on a scale of zero to six kilowatts.',
  'Menos de 1 min': 'Less than 1 min',
  'A última leitura válida ocorreu há {minutes} minutos.': 'The last valid reading was {minutes} minutes ago.',
  '{count} leituras de {measure} em {date}.': '{count} {measure} readings on {date}.',
  'Sem acesso ao painel local. Exibindo a cópia salva em {time}. Os valores não são em tempo real.': 'Cannot reach the local dashboard. Showing the copy saved at {time}. Values are not live.',
  'Offline · salvo {time}': 'Offline · saved {time}',
  'leitura importada': 'reading imported', 'leituras importadas': 'readings imported',
  'duplicata ignorada': 'duplicate skipped', 'duplicatas ignoradas': 'duplicates skipped',
  'A última leitura tem mais de 3 minutos. Confira o coletor e a rede.': 'The last reading is over 3 minutes old. Check the data logger and network.',
  'A última tentativa de leitura falhou. Confira o estado do coletor.': 'The last reading attempt failed. Check the data logger.',
  'Alerta informado pelo coletor': 'Alert from the data logger', 'Sem leitura atual': 'No current reading',
  'Leitura atrasada': 'Delayed reading', 'Estado de exemplo.': 'Sample status.',
  'Ainda não há histórico para este período.': 'There is no history for this period yet.',
  'Cópia offline': 'Offline copy', 'Painel indisponível.': 'Dashboard unavailable.',
  'Não foi possível conectar ao painel local. Conecte-se à rede Wi-Fi da instalação para atualizar.': 'Could not reach the local dashboard. Connect to the site’s Wi-Fi to refresh.',
  'Configuração indisponível.': 'Settings unavailable.', 'Selecione um arquivo CSV.': 'Select a CSV file.',
  'O CSV deve ter até 100 MB.': 'The CSV file must be 100 MB or smaller.',
  'Validando e importando leituras…': 'Checking and importing readings…',
  'Não foi possível importar o CSV.': 'Could not import the CSV file.',
  'Informe uma tarifa válida maior que zero.': 'Enter a valid rate greater than zero.',
  'Salvando…': 'Saving…', 'Não foi possível salvar a tarifa.': 'Could not save the rate.',
  'Tarifa salva neste computador.': 'Rate saved on this computer.',
  'Informe um endereço IPv4 válido.': 'Enter a valid IPv4 address.',
  'Conectando ao coletor…': 'Connecting to the data logger…',
  'Não foi possível salvar a senha.': 'Could not save the password.',
  'Não foi possível ler o coletor.': 'Could not read the data logger.',
  'Seg': 'Mon', 'Ter': 'Tue', 'Qua': 'Wed', 'Qui': 'Thu', 'Sex': 'Fri', 'Sáb': 'Sat', 'Dom': 'Sun',
  'sem leitura': 'no reading', 'potência': 'power', 'energia': 'energy',
};

const serverErrors: Record<string, string> = {
  'O coletor retornou uma página de login. Verifique usuário e senha.': 'The data logger returned a sign-in page. Check the username and password.',
  'O coletor não retornou os dados esperados em /inverter.cgi.': 'The data logger did not return the expected data.',
  'O inversor ainda não enviou dados válidos ao coletor.': 'The inverter has not sent valid data to the data logger yet.',
  'Os dados recebidos do coletor estão incompletos.': 'The data logger returned incomplete data.',
  'O coletor retornou valores inválidos.': 'The data logger returned invalid values.',
  'Configure um endereço IPv4 válido para o S3-WIFI-ST.': 'Enter a valid IPv4 address for the S3-WIFI-ST.',
  'Não foi possível alcançar o S3-WIFI-ST pela rede. Confira o IP e a conexão Wi-Fi.': 'Could not reach the S3-WIFI-ST. Check its IP address and Wi-Fi connection.',
  'O coletor rejeitou usuário ou senha. Alguns S3-WIFI-ST passam a usar a senha do Wi-Fi da casa na página local.': 'The data logger rejected the username or password. Some S3-WIFI-ST units use your home Wi-Fi password for their local page.',
  'O IP não respondeu como coletor Solis. A senha não foi enviada.': 'That IP address did not respond as a Solis data logger. Your password was not sent.',
  'Configuração permitida apenas neste computador.': 'Settings can only be changed on this computer.',
  'Informe um IP válido do coletor.': 'Enter a valid data logger IP address.',
  'Importação permitida apenas neste computador.': 'Import is only available on this computer.',
  'Exportação permitida apenas neste computador.': 'Export is only available on this computer.',
  'Informe a senha do coletor no painel para iniciar a leitura.': 'Enter the data logger password in Helios to start reading.',
  'Busca permitida apenas neste computador.': 'Scanning is only available on this computer.',
  'Informe a senha do coletor.': 'Enter the data logger password.',
  'Informe uma tarifa entre R$ 0 e R$ 100 por kWh.': 'Enter a rate between BRL 0 and BRL 100 per kWh.',
  'Conecte um coletor antes de importar leituras.': 'Connect a data logger before importing readings.',
  'Envie um arquivo CSV.': 'Send a CSV file.',
  'O CSV ultrapassa o limite de 500 mil leituras.': 'The CSV file exceeds the limit of 500,000 readings.',
  'Configuração muito grande.': 'The settings request is too large.',
  'Configuração inválida.': 'Invalid settings.',
  'Página não encontrada.': 'Page not found.',
  'Erro ao carregar o painel.': 'Could not load the dashboard.',
  'Método não permitido.': 'Method not allowed.',
  'O CSV contém um campo entre aspas sem fechamento.': 'The CSV file has an unclosed quoted field.',
  'Cabeçalho CSV diferente do formato exportado pelo painel.': 'The CSV header does not match the Helios export format.',
  'O CSV contém leituras de mais de um inversor.': 'The CSV file contains readings from more than one inverter.',
  'O CSV não contém leituras para importar.': 'The CSV file has no readings to import.',
  'O número de série não corresponde ao inversor já registrado.': 'The serial number does not match the registered inverter.',
  'Envie um JSON válido.': 'Send valid JSON.',
};

let language: Language = 'pt-BR';
export function getLanguage() { return language; }
export function setLanguage(next: Language) { language = next; document.documentElement.lang = next; }
export function t(source: string): string {
  if (language !== 'en') return source;
  const exact = english[source] ?? serverErrors[source];
  if (exact) return exact;
  const patterns: [RegExp, string][] = [
    [/^CSV inválido próximo da linha (\d+)\.$/, 'Invalid CSV near line $1.'],
    [/^Valor inválido na coluna (.+)\.$/, 'Invalid value in column $1.'],
    [/^Data inválida na linha (\d+)\.$/, 'Invalid date on line $1.'],
    [/^Identificação inválida na linha (\d+)\.$/, 'Invalid identification on line $1.'],
    [/^O número de série na linha (\d+) não corresponde ao inversor conectado\.$/, 'The serial number on line $1 does not match the connected inverter.'],
    [/^A linha (\d+) tem (\d+) colunas; eram esperadas (\d+)\.$/, 'Line $1 has $2 columns; $3 were expected.'],
    [/^Data fora do intervalo permitido na linha (\d+)\.$/, 'Date outside the allowed range on line $1.'],
    [/^Leitura fora do intervalo esperado na linha (\d+)\.$/, 'Reading outside the expected range on line $1.'],
    [/^O coletor respondeu HTTP (\d+)\.$/, 'The data logger returned HTTP $1.'],
  ];
  for (const [pattern, replacement] of patterns) if (pattern.test(source)) return source.replace(pattern, replacement);
  return source;
}
export function tf(source: string, values: Record<string, string | number>): string {
  return t(source).replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
}
export function translateStatic(root: ParentNode = document) {
  // Portuguese text in the HTML is the fallback before JavaScript loads.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.parentElement?.closest('script, style')) continue;
    const source = (node as Text & { sourceText?: string }).sourceText ?? node.textContent ?? '';
    (node as Text & { sourceText?: string }).sourceText = source;
    const trimmed = source.trim().replace(/\s+/g, ' ');
    if (!trimmed || !(trimmed in english)) continue;
    const start = source.match(/^\s*/)?.[0] ?? '';
    const end = source.match(/\s*$/)?.[0] ?? '';
    node.textContent = start + t(trimmed) + end;
  }
  for (const element of root.querySelectorAll<HTMLElement>('[aria-label], [title], [placeholder], meta[name="description"]')) {
    for (const attr of ['aria-label', 'title', 'placeholder', 'content']) {
      const sourceAttr = `data-source-${attr}`;
      const source = element.getAttribute(sourceAttr) ?? element.getAttribute(attr);
      if (!source || !(source in english)) continue;
      element.setAttribute(sourceAttr, source);
      element.setAttribute(attr, t(source));
    }
  }
}
