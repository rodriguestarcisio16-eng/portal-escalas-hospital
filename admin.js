import { initializeStaffManagement } from "./staff-management.js?v=20261109-4";

const $ = (id) => document.getElementById(id);

let initialized = false;
let client = null;
let reference = { units: [], shifts: [], schedules: [] };
let activeSchedule = null;
let activeStaff = [];
let activeDayRows = [];
let lastProposal = null;

const monthStart = "2026-12-01";
const monthEnd = "2026-12-31";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function message(text = "", type = "info") {
  const el = $("module-message");
  if (!el) return;
  el.textContent = text;
  el.className = `module-message ${type}`;
}

function statusLabel(marker, status) {
  const code = String(marker ?? "").trim().toUpperCase();
  if (!code) return { label: "Sem marcação", css: "neutral" };
  if (code === "X" && status === "available") return { label: "Disponível", css: "success" };
  if (code === "X" && status === "pending") return { label: "X — pendente de conferência", css: "review" };
  if (code === "FO" || status === "off") return { label: "Folga", css: "neutral" };
  if (code === "REM" || status === "rem") return { label: "Remanejamento manual", css: "neutral" };
  if (code === "FR") return { label: "Férias", css: "warning" };
  if (code === "APA") return { label: "Afastamento", css: "warning" };
  if (code === "LM") return { label: "Licença médica", css: "warning" };
  if (code === "LMA") return { label: "Licença maternidade", css: "warning" };
  if (code === "TP") return { label: "Troca — revisão manual", css: "review" };
  if (status === "pending") return { label: "Pendente de identificação", css: "review" };
  return { label: `${code} — conferir`, css: "review" };
}

function renderSkeleton() {
  $("admin-content").innerHTML = `
    <div class="admin-module">
      <div id="staff-management-root"></div>
      <div class="module-heading">
        <div>
          <p class="eyebrow dark">GESTÃO OPERACIONAL</p>
          <h3>Planejamento de escalas</h3>
          <p class="module-lead">Selecione unidade, turno e dia para conferir a disponibilidade antes de montar a proposta.</p>
        </div>
        <span class="draft-pill">DEZEMBRO 2026 · RASCUNHO</span>
      </div>

      <section class="filter-card">
        <div class="filter-grid">
          <div class="field-group">
            <label for="schedule-unit">Unidade</label>
            <select id="schedule-unit"><option value="">Carregando...</option></select>
          </div>
          <div class="field-group">
            <label for="schedule-shift">Turno de 12 horas</label>
            <select id="schedule-shift"><option value="">Carregando...</option></select>
          </div>
          <div class="field-group">
            <label for="schedule-date">Dia da escala</label>
            <input id="schedule-date" type="date" min="${monthStart}" max="${monthEnd}" value="${monthStart}" />
          </div>
        </div>
        <div class="filter-actions">
          <p id="schedule-context" class="context-note">Carregando unidades e turnos...</p>
          <button id="refresh-day" class="primary-btn compact-btn" type="button">Atualizar disponibilidade <span>↻</span></button>
        </div>
        <p id="module-message" class="module-message" role="status"></p>
      </section>

      <section class="stat-grid">
        <article class="stat-card"><span>Equipe vinculada</span><strong id="stat-linked">—</strong><small>Profissionais da unidade e turno</small></article>
        <article class="stat-card"><span>Disponíveis no dia</span><strong id="stat-available">—</strong><small>Marcações X confirmadas</small></article>
        <article class="stat-card"><span>Afastamentos / folgas</span><strong id="stat-leave">—</strong><small>FR, LM, LMA e APA</small></article>
        <article class="stat-card"><span>Revisão / identificação</span><strong id="stat-review">—</strong><small>Marcações pendentes e trocas</small></article>
      </section>

      <section class="module-panel">
        <div class="panel-heading analysis-heading">
          <div>
            <h4>Pré-análise mensal</h4>
            <p>Verifica capacidade bruta, marcações pendentes e estrutura nas quatro escalas de dezembro.</p>
          </div>
          <button id="analyze-month" class="secondary-btn" type="button">Analisar mês inteiro</button>
        </div>
        <p class="module-disclaimer">Esta análise não distribui profissionais, não altera dados e não publica escalas. A quantidade de plantões prevista é preservada separadamente da contagem de X.</p>
        <p id="analysis-message" class="module-message" role="status"></p>
        <div id="month-analysis" class="analysis-results">
          <p class="empty-cell">Clique em “Analisar mês inteiro” para verificar as quatro combinações de unidade e turno.</p>
        </div>
      </section>

      <section class="module-panel">
        <div class="panel-heading">
          <div>
            <h4>Disponibilidade diária</h4>
            <p id="availability-subtitle">Aguardando seleção.</p>
          </div>
          <span id="schedule-status" class="status-chip neutral">—</span>
        </div>
        <div class="table-scroll">
          <table class="roster-table">
            <thead><tr><th>Profissional</th><th>MASP</th><th>Categoria de origem</th><th>Carga na competência</th><th>Plantões previstos</th><th>Situação no dia</th></tr></thead>
            <tbody id="availability-body"><tr><td colspan="6" class="empty-cell">Carregando dados...</td></tr></tbody>
          </table>
        </div>
        <div class="table-foot" id="roster-foot"></div>
      </section>

      <div class="module-two-columns">
        <section class="module-panel compact-panel">
          <div class="panel-heading"><div><h4>Pendências de identificação</h4><p>Marcações pendentes e trocas devem ser conferidas manualmente.</p></div></div>
          <div id="pending-list" class="pending-list"><p class="muted">Carregando...</p></div>
        </section>
        <section class="module-panel compact-panel">
          <div class="panel-heading"><div><h4>Estrutura assistencial</h4><p>Postos cadastrados para a unidade selecionada.</p></div></div>
          <div class="structure-line"><strong id="post-count">—</strong><span id="post-target">postos esperados</span></div>
          <div id="post-status" class="notice small-notice">Aguardando conferência da estrutura.</div>
          <div class="generator-box">
            <div><b>Motor de distribuição</b><p id="generator-note">Simule a distribuição da unidade e turno selecionados. A simulação não grava nem publica dados.</p></div>
            <div class="generator-actions">
              <button id="simulate-proposal" class="primary-btn compact-btn" type="button">Simular mês</button>
              <button id="generate-proposal" class="secondary-btn" type="button" disabled>Salvar para revisão</button>
              <button id="export-proposal-pdf" class="secondary-btn" type="button" disabled>Gerar PDF</button>
            </div>
          </div>
        </section>
      </div>
      <section class="module-panel proposal-panel">
        <div class="panel-heading"><div><h4>Simulação do motor</h4><p>Prévia por dia e posto. Nenhuma atribuição é gravada nesta etapa.</p></div><span class="status-chip neutral">Somente simulação</span></div>
        <p id="proposal-message" class="module-message" role="status"></p>
        <div id="proposal-preview"><p class="empty-cell">Selecione uma unidade e um turno e clique em “Simular mês”.</p></div>
        <div id="saved-proposal-history" class="saved-proposal-history"><p class="muted">O histórico de propostas aparecerá aqui.</p></div>
      </section>
      <p class="module-disclaimer">Os dados exibidos são a fonte de disponibilidade da competência. A simulação preserva jornadas e marcações originais, não aprova nem publica escalas.</p>
    </div>`;

  $("refresh-day").addEventListener("click", () => loadDay());
  $("analyze-month").addEventListener("click", () => analyzeMonth());
  $("simulate-proposal").addEventListener("click", () => simulateSelectedSchedule());
  $("generate-proposal").addEventListener("click", () => saveScheduleProposal());
  $("export-proposal-pdf").addEventListener("click", () => exportProposalPdf());
  const invalidateProposal = () => {
    lastProposal = null;
    $("generate-proposal").disabled = true;
    $("generate-proposal").textContent = "Salvar para revisão";
    $("export-proposal-pdf").disabled = true;
  };
  $("schedule-unit").addEventListener("change", () => { invalidateProposal(); loadDay(); loadSavedProposalHistory(); });
  $("schedule-shift").addEventListener("change", () => { invalidateProposal(); loadDay(); loadSavedProposalHistory(); });
  $("schedule-date").addEventListener("change", () => { invalidateProposal(); loadDay(); });
}


function analysisMessage(text = "", type = "info") {
  const el = $("analysis-message");
  if (!el) return;
  el.textContent = text;
  el.className = `module-message ${type}`;
}

async function fetchAllRows(queryFactory, pageSize = 900) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await queryFactory().range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message || "Falha ao consultar registros do mês.");
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function renderMonthAnalysis(report) {
  const scheduleCards = report.schedules.map((item) => {
    const unitName = escapeHtml(item.unitName);
    const shiftName = escapeHtml(item.shiftName);
    const shortageText = item.shortageDays === 0
      ? "Nenhum dia com insuficiência bruta de pessoas"
      : `${item.shortageDays} dia(s) com menos X confirmados do que postos`;
    return `
      <article class="analysis-card">
        <div class="analysis-card-top"><b>${unitName}</b><span class="status-chip ${item.postCount === item.expectedPosts ? "success" : "warning"}">${item.postCount}/${item.expectedPosts} postos</span></div>
        <p class="analysis-shift">${shiftName} · plantão de 12 horas</p>
        <div class="analysis-metrics">
          <div><strong>${item.linkedStaff}</strong><small>vinculados</small></div>
          <div><strong>${item.confirmedX}</strong><small>X confirmados</small></div>
          <div><strong>${item.pendingX}</strong><small>X pendentes</small></div>
          <div><strong>${item.reviewMarkers}</strong><small>revisões</small></div>
        </div>
        <p class="analysis-foot">${escapeHtml(shortageText)} · mínimo diário: ${item.minAvailable}/${item.expectedPosts}</p>
      </article>`;
  }).join("");

  const issues = [];
  if (report.missingSchedules.length) {
    issues.push({level:"blocking", title:"Escala mensal ausente", detail:`${report.missingSchedules.length} combinação(ões) de unidade/turno sem escala de dezembro.`});
  }
  if (report.invalidPostCounts.length) {
    issues.push({level:"blocking", title:"Estrutura de postos incompleta", detail:report.invalidPostCounts.map(x=>`${x.unitName}: ${x.postCount}/${x.expectedPosts}`).join(" · ")});
  }
  if (report.pendingUnidentified > 0) {
    issues.push({level:"blocking", title:"Marcações X sem identificação funcional", detail:`${report.pendingUnidentified} linha(s) diárias estão pendentes e não podem entrar na distribuição automática.`});
  }
  if (report.tpRows > 0) {
    issues.push({level:"blocking", title:"Troca de plantão para revisão manual", detail:`${report.tpRows} marcação(ões) TP permanecem fora da elegibilidade automática até conferência.`});
  }
  if (report.unknownReviewRows > 0) {
    issues.push({level:"blocking", title:"Outras marcações em revisão", detail:`${report.unknownReviewRows} linha(s) têm situação de revisão que precisa ser esclarecida.`});
  }
  if (report.utI40Count > 0) {
    issues.push({level:"blocking", title:"Continuidade do rodízio de 40h da UTI", detail:`${report.utI40Count} vínculo(s) de 40h identificados na UTI. A posição final válida de novembro ainda precisa ser vinculada inequivocamente aos profissionais de dezembro.`});
  }
  issues.push({level:"blocking",title:"Regras individuais ainda não totalmente executadas pelo motor",detail:"As regras nominativas já estão armazenadas no banco privado. A distribuição automática ainda não aplica todos os tipos de restrição e exceção; pares em blocos opostos, escolhas manuais e algumas regras de calendário permanecem em validação."});
  if (report.dailyShortages.length) {
    const sample = report.dailyShortages.slice(0,8).map(x =>
      `${x.date} · ${x.unitShort} · ${x.shiftShort}: ${x.available}/${x.posts}`
    ).join(" | ");
    issues.push({level:"warning",title:"Dias abaixo da capacidade bruta de postos",detail:`${report.dailyShortages.length} ocorrência(s) com X confirmados abaixo do total de postos. Amostra: ${sample}. Isso ainda não considera elegibilidade individual.`});
  }
  if (report.unlinkedAvailableRows > 0) {
    issues.push({level:"blocking",title:"Marcações sem vínculo de equipe",detail:`${report.unlinkedAvailableRows} marcação(ões) disponíveis não correspondem a vínculo ativo da unidade/turno.`});
  }
  if (report.duplicateDayRows > 0) {
    issues.push({level:"blocking",title:"Marcações duplicadas no mesmo dia",detail:`${report.duplicateDayRows} ocorrência(s) duplicadas para o mesmo profissional/data.`});
  }

  const issueHtml = issues.map(issue => `
    <div class="analysis-issue ${issue.level}">
      <span class="status-chip ${issue.level === "blocking" ? "review" : issue.level === "warning" ? "warning" : "neutral"}">${issue.level === "blocking" ? "Bloqueio" : "Atenção"}</span>
      <div><b>${escapeHtml(issue.title)}</b><p>${escapeHtml(issue.detail)}</p></div>
    </div>`).join("");

  const rows = report.dailyShortages.slice(0,12).map(x => `
    <tr><td>${escapeHtml(x.date)}</td><td>${escapeHtml(x.unitShort)}</td><td>${escapeHtml(x.shiftShort)}</td><td>${x.available}</td><td>${x.posts}</td><td>${x.deficit}</td></tr>`
  ).join("");

  $("month-analysis").innerHTML = `
    <div class="analysis-summary">
      <div><strong>${report.scheduleCount}</strong><span>escalas verificadas</span></div>
      <div><strong>${report.availabilityRows}</strong><span>marcações lidas</span></div>
      <div><strong>${report.confirmedX}</strong><span>X confirmados no mês</span></div>
      <div><strong>${report.pendingUnidentified}</strong><span>X pendentes sem MASP</span></div>
    </div>
    <div class="analysis-schedule-grid">${scheduleCards}</div>
    <section class="analysis-subsection">
      <div class="panel-heading"><div><h4>Pendências e condições antes da geração</h4><p>${issues.filter(i=>i.level==="blocking").length} bloqueio(s) · ${issues.filter(i=>i.level==="warning").length} aviso(s)</p></div></div>
      <div class="analysis-issues">${issueHtml}</div>
    </section>
    <section class="analysis-subsection">
      <div class="panel-heading"><div><h4>Insuficiência de capacidade bruta por dia</h4><p>Comparação entre X confirmados e total de postos. Não representa a distribuição final.</p></div></div>
      ${rows ? `<div class="table-scroll"><table class="roster-table analysis-table"><thead><tr><th>Data</th><th>Unidade</th><th>Turno</th><th>X confirmados</th><th>Postos</th><th>Diferença</th></tr></thead><tbody>${rows}</tbody></table></div><p class="table-foot">Exibindo até 12 das ${report.dailyShortages.length} ocorrências.</p>` : '<p class="no-pending">Nenhum dia abaixo do total bruto de postos.</p>'}
    </section>
    <p class="module-disclaimer">Pré-análise somente de leitura. A quantidade mensal de plantões e as horas registradas foram preservadas; divergência entre alvo e X não foi tratada como erro.</p>`;
}

async function analyzeMonth() {
  const button = $("analyze-month");
  button.disabled = true;
  button.textContent = "Analisando quatro escalas...";
  analysisMessage("Lendo as quatro escalas, os 31 dias e a estrutura assistencial. Nenhum dado será gravado.", "info");
  $("month-analysis").innerHTML = '<p class="empty-cell">Análise em andamento...</p>';

  try {
    const expected = [
      {unitCode:"UTI_ADULTO",shiftCode:"DIURNO",expectedPosts:26,unitShort:"UTI",shiftShort:"Diurno"},
      {unitCode:"UTI_ADULTO",shiftCode:"NOTURNO",expectedPosts:26,unitShort:"UTI",shiftShort:"Noturno"},
      {unitCode:"USI_ADULTO",shiftCode:"DIURNO",expectedPosts:12,unitShort:"USI",shiftShort:"Diurno"},
      {unitCode:"USI_ADULTO",shiftCode:"NOTURNO",expectedPosts:12,unitShort:"USI",shiftShort:"Noturno"},
    ];
    const resultSets = await Promise.all(expected.map(async spec => {
      const unit = reference.units.find(x=>x.code===spec.unitCode);
      const shift = reference.shifts.find(x=>x.code===spec.shiftCode);
      const schedule = reference.schedules.find(x=>x.unit_id===unit?.id && x.shift_id===shift?.id);
      if (!unit || !shift || !schedule) {
        return {spec,unit,shift,schedule:null,links:[],availability:[],targets:[],posts:[],staff:[]};
      }
      const [links,availability,targets,posts] = await Promise.all([
        fetchAllRows(()=>client.from("staff_unit_assignments").select("staff_id").eq("unit_id",unit.id).eq("shift_id",shift.id).eq("active",true).order("staff_id")),
        fetchAllRows(()=>client.from("monthly_availability").select("staff_id, work_date, original_marker, availability_status, reviewed, source_file, source_row").eq("schedule_id",schedule.id).order("work_date")),
        fetchAllRows(()=>client.from("monthly_staff_targets").select("staff_id, weekly_hours_snapshot, source_weekly_hours_raw, expected_shifts, reviewed").eq("schedule_id",schedule.id).order("staff_id")),
        fetchAllRows(()=>client.from("care_posts").select("id, code, name, post_type, sequence").eq("unit_id",unit.id).eq("active",true).order("sequence")),
      ]);
      const ids=[...new Set(links.map(x=>x.staff_id).filter(Boolean))];
      const staff=[];
      for(let i=0;i<ids.length;i+=100){
        const chunk=ids.slice(i,i+100);
        const part=await fetchAllRows(()=>client.from("staff").select("id, masp, nome, categoria, weekly_hours, active").in("id",chunk).eq("active",true).order("nome"));
        staff.push(...part);
      }
      return {spec,unit,shift,schedule,links,availability,targets,posts,staff};
    }));

    const report={
      scheduleCount:resultSets.filter(x=>x.schedule).length,
      missingSchedules:expected.filter(spec=>!resultSets.some(x=>x.spec.unitCode===spec.unitCode&&x.spec.shiftCode===spec.shiftCode&&x.schedule)),
      availabilityRows:0,confirmedX:0,pendingUnidentified:0,unlinkedAvailableRows:0,
      tpRows:0,unknownReviewRows:0,duplicateDayRows:0,utI40Count:0,
      schedules:[],invalidPostCounts:[],dailyShortages:[],
    };

    for(const set of resultSets){
      if(!set.schedule) continue;
      report.availabilityRows+=set.availability.length;
      const linkedIds=new Set(set.staff.map(x=>x.id));
      const postCount=set.posts.length;
      if(postCount!==set.spec.expectedPosts) report.invalidPostCounts.push({
        unitName:set.unit.name,postCount,expectedPosts:set.spec.expectedPosts
      });

      const byDay=new Map();
      const pairSeen=new Set();
      let confirmedX=0,pendingX=0,reviewMarkers=0;
      const perStaffX=new Map();
      for(const row of set.availability){
        const marker=String(row.original_marker??"").trim().toUpperCase();
        const date=String(row.work_date).slice(0,10);
        if(!byDay.has(date)) byDay.set(date,{ids:new Set(),confirmed:0});
        const day=byDay.get(date);
        if(row.staff_id){
          const key=`${row.staff_id}|${date}`;
          if(pairSeen.has(key)) report.duplicateDayRows++;
          pairSeen.add(key);
        }
        if(marker==="X"){
          perStaffX.set(row.staff_id,(perStaffX.get(row.staff_id)||0)+1);
          if(row.availability_status==="available" && row.staff_id && linkedIds.has(row.staff_id)){
            if(!day.ids.has(row.staff_id)){
              day.ids.add(row.staff_id);day.confirmed++;
            }
            confirmedX++;
          } else if(row.availability_status==="pending"){
            pendingX++;
            if(!row.staff_id) report.pendingUnidentified++;
            else if(!linkedIds.has(row.staff_id)) report.unlinkedAvailableRows++;
          } else if(row.availability_status==="available" && row.staff_id && !linkedIds.has(row.staff_id)){
            report.unlinkedAvailableRows++;
          }
        }
        if(marker==="TP") {reviewMarkers++;report.tpRows++;}
        else if(row.availability_status==="review") report.unknownReviewRows++;
      }
      report.confirmedX+=confirmedX;
      const leaveRows=set.availability.filter(row=>row.availability_status==="leave").length;
      const dailyCounts=[];
      for(let day=1;day<=31;day++){
        const date=`2026-12-${String(day).padStart(2,"0")}`;
        const count=byDay.get(date)?.confirmed??0;
        dailyCounts.push(count);
        if(count<set.posts.length){
          report.dailyShortages.push({
            date,unitShort:set.spec.unitShort,shiftShort:set.spec.shiftShort,
            available:count,posts:set.posts.length,deficit:set.posts.length-count
          });
        }
      }
      const minAvailable=Math.min(...dailyCounts);
      const maxAvailable=Math.max(...dailyCounts);
      const shortageDays=dailyCounts.filter(n=>n<set.posts.length).length;
      const uti40Count=set.spec.unitCode==="UTI_ADULTO"
        ? set.targets.filter(t=>Number(t.weekly_hours_snapshot)===40 || Number(t.source_weekly_hours_raw)===40).length
        : 0;
      report.utI40Count+=uti40Count;
      report.schedules.push({
        unitName:set.unit.name,shiftName:set.shift.name,
        linkedStaff:set.staff.length,confirmedX,pendingX,reviewMarkers,
        leaveRows,postCount:set.posts.length,expectedPosts:set.spec.expectedPosts,
        minAvailable,maxAvailable,shortageDays
      });
    }
    report.dailyShortages.sort((a,b)=>b.deficit-a.deficit || a.date.localeCompare(b.date));
    renderMonthAnalysis(report);
    const blockers = report.missingSchedules.length + report.invalidPostCounts.length +
      report.pendingUnidentified + report.tpRows + report.unknownReviewRows +
      report.utI40Count + report.unlinkedAvailableRows + report.duplicateDayRows + 1;
    analysisMessage(
      `Pré-análise concluída: ${report.scheduleCount}/4 escalas, ${report.availabilityRows} marcações e ${report.dailyShortages.length} ocorrências de capacidade bruta abaixo dos postos. A geração continua bloqueada por ${blockers} condição(ões) a resolver.`,
      blockers ? "info" : "success"
    );
  } catch(error) {
    $("month-analysis").innerHTML = '<p class="empty-cell">Não foi possível concluir a pré-análise. Confira as permissões e tente novamente.</p>';
    analysisMessage(error.message||"Falha na análise mensal.", "error");
  } finally {
    button.disabled=false;
    button.textContent="Analisar mês inteiro";
  }
}

async function loadReferenceData() {
  message("Carregando unidades, turnos e escalas...", "info");
  const [unitsResult, shiftsResult, schedulesResult] = await Promise.all([
    client.from("units").select("id, code, name").eq("active", true).order("code"),
    client.from("shifts").select("id, code, name, start_time, end_time").order("code"),
    client.from("monthly_schedules").select("id, competence, unit_id, shift_id, status").eq("competence", monthStart),
  ]);

  for (const result of [unitsResult, shiftsResult, schedulesResult]) {
    if (result.error) throw new Error(result.error.message || "Falha ao carregar os dados de referência.");
  }

  reference = {
    units: unitsResult.data ?? [],
    shifts: shiftsResult.data ?? [],
    schedules: schedulesResult.data ?? [],
  };

  $("schedule-unit").innerHTML = reference.units.map((unit) =>
    `<option value="${escapeHtml(unit.id)}">${escapeHtml(unit.name)}</option>`).join("");
  $("schedule-shift").innerHTML = reference.shifts.map((shift) =>
    `<option value="${escapeHtml(shift.id)}">${escapeHtml(shift.name)} · ${escapeHtml(shift.start_time.slice(0,5))}–${escapeHtml(shift.end_time.slice(0,5))}</option>`).join("");

  const uti = reference.units.find((unit) => unit.code === "UTI_ADULTO");
  const day = reference.shifts.find((shift) => shift.code === "DIURNO");
  if (uti) $("schedule-unit").value = uti.id;
  if (day) $("schedule-shift").value = day.id;

  if (!reference.units.length || !reference.shifts.length || !reference.schedules.length) {
    throw new Error("Não foram encontradas unidades, turnos ou escalas de dezembro/2026.");
  }
  message("");
  await loadDay();
  await loadSavedProposalHistory();
}

async function loadDay() {
  const unitId = $("schedule-unit").value;
  const shiftId = $("schedule-shift").value;
  const workDate = $("schedule-date").value;
  if (!unitId || !shiftId || !workDate) return;

  if (workDate < monthStart || workDate > monthEnd) {
    message("Selecione uma data entre 1 e 31 de dezembro de 2026.", "error");
    return;
  }

  activeSchedule = reference.schedules.find((schedule) =>
    schedule.unit_id === unitId && schedule.shift_id === shiftId);

  const unit = reference.units.find((item) => item.id === unitId);
  const shift = reference.shifts.find((item) => item.id === shiftId);
  $("schedule-context").textContent = `${unit?.name ?? "Unidade"} · ${shift?.name ?? "Turno"} · plantão de 12 horas`;
  $("availability-subtitle").textContent = `${new Date(`${workDate}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })} · ${unit?.name ?? ""} · ${shift?.start_time?.slice(0,5) ?? ""}–${shift?.end_time?.slice(0,5) ?? ""}`;

  if (!activeSchedule) {
    renderUnavailable("Não existe uma escala de rascunho para esta combinação.");
    return;
  }

  const refresh = $("refresh-day");
  refresh.disabled = true;
  refresh.textContent = "Consultando...";
  message("Consultando disponibilidade no banco...", "info");

  try {
    const [linksResult, availabilityResult, targetsResult, postsResult] = await Promise.all([
      client.from("staff_unit_assignments").select("staff_id").eq("unit_id", unitId).eq("shift_id", shiftId).eq("active", true),
      client.from("monthly_availability").select("staff_id, work_date, original_marker, availability_status, source_file, source_row, reviewed").eq("schedule_id", activeSchedule.id).eq("work_date", workDate),
      client.from("monthly_staff_targets").select("staff_id, weekly_hours_snapshot, source_weekly_hours_raw, expected_shifts, reviewed").eq("schedule_id", activeSchedule.id),
      client.from("care_posts").select("id, code, name, post_type, sequence").eq("unit_id", unitId).eq("active", true).order("sequence"),
    ]);

    for (const result of [linksResult, availabilityResult, targetsResult, postsResult]) {
      if (result.error) throw new Error(result.error.message || "Falha ao consultar os dados da escala.");
    }

    const staffIds = [...new Set((linksResult.data ?? []).map((item) => item.staff_id).filter(Boolean))];
    let staffRows = [];
    if (staffIds.length) {
      const staffResult = await client.from("staff")
        .select("id, masp, nome, categoria, weekly_hours, active")
        .in("id", staffIds)
        .eq("active", true)
        .order("nome");
      if (staffResult.error) throw new Error(staffResult.error.message || "Falha ao consultar o cadastro dos profissionais.");
      staffRows = staffResult.data ?? [];
    }

    activeStaff = staffRows;
    activeDayRows = availabilityResult.data ?? [];
    renderDailyData({
      unit,
      shift,
      workDate,
      staffRows,
      availabilityRows: activeDayRows,
      targets: targetsResult.data ?? [],
      posts: postsResult.data ?? [],
      schedule: activeSchedule,
    });
    message("Dados atualizados a partir do Supabase.", "success");
  } catch (error) {
    renderUnavailable("Não foi possível carregar os dados desta escala.");
    message(error.message || "Erro ao consultar a disponibilidade.", "error");
  } finally {
    refresh.disabled = false;
    refresh.innerHTML = 'Atualizar disponibilidade <span>↻</span>';
  }
}

function renderUnavailable(text) {
  $("availability-body").innerHTML = `<tr><td colspan="6" class="empty-cell">${escapeHtml(text)}</td></tr>`;
  $("stat-linked").textContent = "—";
  $("stat-available").textContent = "—";
  $("stat-leave").textContent = "—";
  $("stat-review").textContent = "—";
  $("pending-list").innerHTML = '<p class="muted">Sem dados para exibir.</p>';
  $("post-count").textContent = "0";
  $("post-status").textContent = "Estrutura não consultada.";
}

function renderDailyData({ unit, shift, workDate, staffRows, availabilityRows, targets, posts, schedule }) {
  const markerByStaff = new Map();
  for (const row of availabilityRows) {
    if (row.staff_id) markerByStaff.set(row.staff_id, row);
  }
  const targetByStaff = new Map(targets.map((target) => [target.staff_id, target]));

  const availableCount = availabilityRows.filter((row) =>
    String(row.original_marker ?? "").trim().toUpperCase() === "X" && row.availability_status === "available").length;
  const leaveCount = availabilityRows.filter((row) => row.availability_status === "leave").length;
  const reviewRows = availabilityRows.filter((row) =>
    row.availability_status === "review" || row.availability_status === "pending"
  );

  $("stat-linked").textContent = String(staffRows.length);
  $("stat-available").textContent = String(availableCount);
  $("stat-leave").textContent = String(leaveCount);
  $("stat-review").textContent = String(reviewRows.length);
  $("schedule-status").textContent = schedule.status === "draft" ? "Rascunho" : schedule.status;
  $("schedule-status").className = `status-chip ${schedule.status === "draft" ? "warning" : "neutral"}`;

  if (!staffRows.length) {
    $("availability-body").innerHTML = '<tr><td colspan="6" class="empty-cell">Nenhum profissional vinculado a esta unidade e turno.</td></tr>';
  } else {
    $("availability-body").innerHTML = staffRows.map((staff) => {
      const marker = markerByStaff.get(staff.id);
      const target = targetByStaff.get(staff.id);
      const result = statusLabel(marker?.original_marker, marker?.availability_status);
      const category = ["AUX", "AUX."].includes(String(staff.categoria ?? "").trim().toUpperCase())
        ? "Técnico de enfermagem (AUX. na origem)"
        : (staff.categoria || "Não informada");
      const contract = staff.weekly_hours ? `${staff.weekly_hours}h/sem` : "Não informada";
      const rawHours = target?.source_weekly_hours_raw ?? target?.weekly_hours_snapshot;
      const hoursDisplay = rawHours == null ? "—" : (/h/i.test(String(rawHours)) ? String(rawHours) : `${rawHours}h`);
      const shifts = target?.expected_shifts ?? "—";
      return `<tr>
        <td><strong>${escapeHtml(staff.nome)}</strong></td>
        <td class="mono">${escapeHtml(staff.masp)}</td>
        <td>${escapeHtml(category)}</td>
        <td><span class="hours-main">${escapeHtml(hoursDisplay)}</span><small class="sub-value">Contrato: ${escapeHtml(contract)}</small></td>
        <td>${escapeHtml(shifts)}</td>
        <td><span class="status-chip ${result.css}">${escapeHtml(result.label)}</span>${marker?.original_marker ? `<small class="sub-value">${escapeHtml(marker.original_marker)}</small>` : ""}</td>
      </tr>`;
    }).join("");
  }

  $("roster-foot").textContent = `${staffRows.length} profissionais vinculados · ${availabilityRows.length} marcações registradas para ${new Date(`${workDate}T12:00:00`).toLocaleDateString("pt-BR")}.`;

  if (!reviewRows.length) {
    $("pending-list").innerHTML = '<p class="no-pending">Nenhuma marcação pendente ou troca aguardando conferência neste dia.</p>';
  } else {
    const staffById = new Map(staffRows.map((staff) => [staff.id, staff]));
    $("pending-list").innerHTML = reviewRows.map((row) => {
      const staff = staffById.get(row.staff_id);
      const marker = String(row.original_marker ?? "Revisar").trim().toUpperCase();
      const label = statusLabel(marker, row.availability_status).label;
      const identity = staff ? `${staff.nome} · MASP ${staff.masp}` : "Profissional não localizado";
      return `<div class="pending-item"><span class="status-chip review">${escapeHtml(marker)}</span><div><b>${escapeHtml(identity)}</b><small>${escapeHtml(label)} · Linha ${escapeHtml(row.source_row ?? "—")} · ${escapeHtml(row.source_file ?? "arquivo não informado")}</small></div></div>`;
    }).join("");
  }

  const targetPosts = unit?.code === "UTI_ADULTO" ? 26 : 12;
  $("post-count").textContent = String(posts.length);
  $("post-target").textContent = `de ${targetPosts} postos esperados`;
  const complete = posts.length === targetPosts;
  $("post-status").textContent = complete
    ? "Quantidade de postos cadastrada. Ainda será necessário conferir regras e rodízio antes de habilitar a geração."
    : `Estrutura incompleta: encontrados ${posts.length} de ${targetPosts} postos. A geração permanece bloqueada.`;
  $("post-status").className = `notice small-notice ${complete ? "notice-ok" : "notice-warn"}`;
  $("generate-proposal").disabled = true;
  $("generator-note").textContent = complete
    ? "Postos identificados. Falta validar as regras de elegibilidade, restrições e continuidade do rodízio de 40h."
    : "Cadastre e confira todos os postos da unidade. A geração ficará bloqueada até a estrutura estar completa e as regras operacionais validadas.";
}


function normalizedName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function proposalMessage(text, type) {
  const el = $("proposal-message");
  if (!el) return;
  el.textContent = text || "";
  el.className = "module-message " + (type || "info");
}

function renderBlockedUtiProposal() {
  lastProposal = null;
  if ($("generate-proposal")) {
    $("generate-proposal").disabled = true;
    $("generate-proposal").textContent = "Salvar para revisão";
  }
  if ($("export-proposal-pdf")) $("export-proposal-pdf").disabled = true;
  const items = [
    ["Rodízio incompleto", "A UTI tem 22 postos diretos, mas a sequência dos profissionais de 40h lista somente 21. O leito 21 (UTI-11) não aparece na sequência."],
    ["Dois apoios, ciclo sem distinção", "A estrutura tem APOIO-1 (bloco A) e APOIO-2 (bloco B), mas o ciclo determina apenas “APOIO” após as sequências ímpares e pares. Não vou escolher qual dos dois usar."],
    ["Conflito de compatibilidade", "Uma restrição nominativa de função exclusiva conflita com uma regra de alocação em blocos opostos. É necessária decisão do enfermeiro."],
    ["Continuidade de novembro não integralmente verificável", "A posição final dos profissionais de 40h ainda precisa ser vinculada por identificador funcional inequívoco ao posto de novembro."],
    ["Sem gravação", "Por segurança, o motor não vai criar uma distribuição UTI até que essas regras estejam resolvidas. A tela continuará permitindo a pré-análise de cobertura."]
  ];
  const html = items.map((item, index) =>
    '<div class="engine-blocker"><span class="engine-blocker-number">' + (index + 1) +
    '</span><div><b>' + escapeHtml(item[0]) + '</b><p>' + escapeHtml(item[1]) + '</p></div></div>'
  ).join("");
  $("proposal-preview").innerHTML =
    '<div class="engine-blocker-summary"><strong>UTI bloqueada para distribuição automática</strong><p>O motor identificou conflitos em regras obrigatórias. Nenhum profissional foi alocado.</p></div>' +
    '<div class="engine-blocker-list">' + html + '</div>';
  proposalMessage("Simulação UTI interrompida antes da alocação para evitar uma escala que descumpra as regras fornecidas.", "error");
}

function renderUsiProposal(report, schedule, unit, shift) {
  let totalFilled = 0;
  let totalVacant = 0;
  let totalExtras = 0;
  const cards = report.days.map((day, index) => {
    totalFilled += day.filled;
    totalVacant += day.vacant;
    totalExtras += day.extras.length;
    const postRows = day.assignments.map(item =>
      '<tr><td><b>' + escapeHtml(item.code) + '</b><small class="sub-value">' + escapeHtml(item.name) + '</small></td>' +
      '<td>' + (item.staff ? '<strong>' + escapeHtml(item.staff.nome) + '</strong><small class="sub-value">MASP ' + escapeHtml(item.staff.masp) + '</small>' :
      '<span class="status-chip warning">SEM COBERTURA</span>') + '</td></tr>'
    ).join("");
    const materialRow = '<tr><td><b>USI-CIRC-MAT</b><small class="sub-value">Circulação e sala de material</small></td>' +
      '<td>' + (day.material ? '<strong>' + escapeHtml(day.material.nome) + '</strong><small class="sub-value">MASP ' + escapeHtml(day.material.masp) + '</small>' :
      '<span class="status-chip warning">SEM INDICAÇÃO AUTOMÁTICA</span>') + '</td></tr>';
    const extraText = day.extras.length
      ? day.extras.map(p => escapeHtml(p.nome) + ' (' + escapeHtml(p.masp) + ')').join(" · ")
      : "Nenhum excedente elegível.";
    const remText = day.rem.length
      ? day.rem.map(p => escapeHtml(p.nome) + ' (' + escapeHtml(p.masp) + ')').join(" · ")
      : "Nenhum profissional REM identificado disponível.";
    const reviewText = day.review.length
      ? day.review.map(x => escapeHtml(x.marker) + (x.staff ? " · " + escapeHtml(x.staff.nome) : " · sem MASP") + " · linha " + escapeHtml(x.source_row || "—")).join(" | ")
      : "Nenhuma marcação pendente/revisão nesta data.";
    const notes = day.notes.length
      ? '<ul class="engine-notes">' + day.notes.map(n => '<li>' + escapeHtml(n) + '</li>').join("") + '</ul>'
      : "";
    const summary = day.filled + "/11 postos diretos · " + (day.material ? "material/circulação indicado" : "material/circulação em branco") +
      " · " + day.extras.length + " excedente(s)";
    return '<details class="proposal-day"' + (index === 0 ? " open" : "") + '>' +
      '<summary><span>' + escapeHtml(day.label) + '</span><small>' + escapeHtml(summary) + '</small></summary>' +
      '<div class="proposal-day-body"><div class="table-scroll"><table class="roster-table proposal-table"><thead><tr><th>Posto</th><th>Profissional proposto</th></tr></thead><tbody>' +
      postRows + materialRow + '</tbody></table></div>' +
      '<div class="proposal-side-notes"><div><b>Disponíveis fora dos 11 postos diretos</b><p>' + extraText + '</p></div>' +
      '<div><b>REM — fora da distribuição automática</b><p>' + remText + '</p></div>' +
      '<div><b>Marcações para conferência</b><p>' + reviewText + '</p></div>' + notes + '</div></div></details>';
  }).join("");

  const warnings = report.globalIssues.length
    ? '<div class="engine-warning-list">' + report.globalIssues.map(x => '<p>' + escapeHtml(x) + '</p>').join("") + '</div>'
    : "";
  const proposalData = {
    schema_version: 1,
    algorithm: "USI_BALANCED_V1",
    generated_at: new Date().toISOString(),
    unit_code: unit.code,
    shift_code: shift.code,
    days: report.days.map(day => ({
      work_date: day.date,
      assignments: day.assignments.map(item => ({
        post_code: item.code,
        staff_id: item.staff?.id ?? null
      })),
      material: day.material
        ? { post_code: "USI-CIRC-MAT", staff_id: day.material.id }
        : null,
      extras: day.extras.map(person => ({
        staff_id: person.id, nome: person.nome, masp: person.masp
      })),
      rem: day.rem.map(person => ({
        staff_id: person.id, nome: person.nome, masp: person.masp
      })),
      review: day.review.map(item => ({
        marker: item.marker,
        staff_id: item.staff?.id ?? null,
        source_row: item.source_row ?? null
      })),
      notes: day.notes
    })),
    global_issues: report.globalIssues
  };
  const metrics = {
    algorithm: "USI_BALANCED_V1",
    days: report.days.length,
    direct_filled: totalFilled,
    direct_vacant: totalVacant,
    daily_extras: totalExtras,
    global_issues: report.globalIssues.length,
    material_filled: report.days.filter(day => Boolean(day.material)).length
  };
  lastProposal = { scheduleId: schedule.id, proposalData, metrics };
  $("generate-proposal").disabled = false;
  $("generate-proposal").textContent = "Salvar para revisão";
  $("export-proposal-pdf").disabled = false;

  $("proposal-preview").innerHTML =
    '<div class="engine-summary-grid">' +
      '<div><strong>' + report.days.length + '</strong><small>dias simulados</small></div>' +
      '<div><strong>' + totalFilled + '</strong><small>postos diretos preenchidos</small></div>' +
      '<div><strong>' + totalVacant + '</strong><small>postos diretos descobertos</small></div>' +
      '<div><strong>' + totalExtras + '</strong><small>excedentes (somatório diário)</small></div>' +
    '</div>' +
    '<div class="engine-method"><b>Critério provisório de distribuição direta</b><p>Entre os profissionais elegíveis com X confirmado, o motor equilibra a quantidade de alocações ao longo do mês, respeitando os postos em sequência. Esse critério de equilíbrio é uma proposta de trabalho, não uma regra assistencial previamente aprovada.</p><p>Material/circulação segue a prioridade nominativa informada. O apoio da USI permanece em branco. A simulação não grava na tabela assignments.</p></div>' +
    warnings + '<div class="proposal-days">' + cards + '</div>';
  proposalMessage("Simulação da USI concluída em memória. " + totalFilled + " postos diretos preenchidos e " + totalVacant + " descobertos no conjunto dos 31 dias. Nada foi gravado. A prévia pode ser salva para revisão.", "success");
}

async function loadSavedProposalHistory() {
  const root = $("saved-proposal-history");
  if (!root) return;
  const unitId = $("schedule-unit")?.value;
  const shiftId = $("schedule-shift")?.value;
  const schedule = reference.schedules.find(item =>
    item.unit_id === unitId && item.shift_id === shiftId && item.competence === monthStart
  );
  if (!schedule) {
    root.innerHTML = '<p class="muted">Não existe escala para consultar propostas nesta combinação.</p>';
    return;
  }
  root.innerHTML = '<p class="muted">Consultando histórico de propostas...</p>';
  const { data, error } = await client.from("schedule_proposals")
    .select("id, proposal_version, status, metrics, created_at")
    .eq("schedule_id", schedule.id)
    .order("proposal_version", { ascending: false })
    .limit(8);
  if (error) {
    root.innerHTML = '<p class="muted">Não foi possível carregar o histórico. Confira se a migração do gerador foi executada.</p>';
    return;
  }
  if (!data?.length) {
    root.innerHTML = '<div class="saved-proposal-heading"><b>Histórico de propostas</b><span class="status-chip neutral">0 versões</span></div><p class="muted">Nenhuma proposta salva para esta escala.</p>';
    return;
  }
  const statusLabels = {
    pending_review: "Aguardando revisão",
    reviewed: "Revisada",
    approved: "Aprovada",
    rejected: "Rejeitada",
    superseded: "Substituída"
  };
  root.innerHTML =
    '<div class="saved-proposal-heading"><b>Histórico de propostas</b><span class="status-chip neutral">' + data.length + ' versão(ões)</span></div>' +
    '<div class="saved-proposal-list">' + data.map(item => {
      const metrics = item.metrics || {};
      const timestamp = new Date(item.created_at).toLocaleString("pt-BR");
      return '<div class="saved-proposal-item"><div><b>Proposta v' + escapeHtml(item.proposal_version) +
        '</b><small>' + escapeHtml(timestamp) + '</small></div><div><span class="status-chip warning">' +
        escapeHtml(statusLabels[item.status] || item.status) + '</span><small>' +
        escapeHtml(metrics.direct_filled ?? "—") + ' postos preenchidos · ' +
        escapeHtml(metrics.direct_vacant ?? "—") + ' descobertos</small></div></div>';
    }).join("") + '</div>';
}

function exportProposalPdf() {
  if (!lastProposal) {
    proposalMessage("Simule uma proposta antes de gerar o PDF.", "error");
    return;
  }
  const preview = $("proposal-preview");
  if (!preview || !preview.innerHTML.trim()) {
    proposalMessage("A prévia da proposta não está disponível para impressão.", "error");
    return;
  }

  const schedule = reference.schedules.find(item => item.id === lastProposal.scheduleId);
  const unit = reference.units.find(item => item.id === schedule?.unit_id);
  const shift = reference.shifts.find(item => item.id === schedule?.shift_id);
  const competence = schedule
    ? new Date(String(schedule.competence).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    : "Competência não identificada";
  const generatedAt = new Date(lastProposal.proposalData.generated_at || Date.now()).toLocaleString("pt-BR");
  const proposalVersion = lastProposal.proposalVersion
    ? "Proposta v" + lastProposal.proposalVersion
    : "Prévia não salva";
  const documentTitle = [
    "proposta-escala",
    unit?.code || "unidade",
    shift?.code || "turno",
    schedule ? String(schedule.competence).slice(0, 7) : "competencia",
    lastProposal.proposalVersion ? "v" + lastProposal.proposalVersion : "previa"
  ].join("-").toLowerCase();

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    proposalMessage("O navegador bloqueou a janela do PDF. Permita pop-ups para este portal e tente novamente.", "error");
    return;
  }

  const printHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(documentTitle)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 11mm 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #1b2927; font: 10px Arial, Helvetica, sans-serif; }
    h1 { margin: 0 0 4px; font-size: 19px; letter-spacing: .2px; }
    .pdf-header { border-bottom: 2px solid #123b36; padding-bottom: 10px; margin-bottom: 12px; }
    .pdf-brand { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 11px; }
    .pdf-brand img { display: block; width: 142px; max-height: 58px; object-fit: contain; object-position: left center; }
    .pdf-brand-copy { flex: 1; text-align: right; }
    .pdf-brand-copy strong { display: block; color: #087fa8; font-size: 10px; letter-spacing: .25px; }
    .pdf-brand-copy span { display: block; margin-top: 3px; color: #5c696d; font-size: 8px; font-style: italic; }
    .pdf-institution { margin: 0 0 5px; color: #53615c; font-size: 8px; letter-spacing: .4px; text-transform: uppercase; }
    .pdf-eyebrow { margin: 0 0 5px; color: #8a7b4d; font-size: 9px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; }
    .pdf-meta { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 7px; color: #53615c; font-size: 10px; }
    .pdf-status { display: inline-block; margin-top: 8px; padding: 4px 7px; border: 1px solid #d9cfae; border-radius: 4px; color: #66572b; font-weight: 700; }
    .pdf-content .engine-summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin: 10px 0; }
    .pdf-content .engine-summary-grid > div { padding: 8px; border: 1px solid #dce3df; border-radius: 5px; }
    .pdf-content .engine-summary-grid strong { display: block; color: #123b36; font-size: 17px; }
    .pdf-content .engine-summary-grid small { color: #64726c; font-size: 8px; }
    .pdf-content .engine-method, .pdf-content .engine-warning-list { margin: 9px 0; padding: 8px 10px; border: 1px solid #dce3df; border-radius: 5px; line-height: 1.45; }
    .pdf-content .engine-method p { margin: 4px 0; }
    .pdf-content .engine-warning-list { border-color: #dfcc91; background: #fffaf0; }
    .pdf-content .engine-warning-list p { margin: 3px 0; }
    .pdf-content .proposal-day { margin: 9px 0; border: 1px solid #dce3df; border-radius: 5px; break-inside: avoid-page; page-break-inside: avoid; }
    .pdf-content .proposal-day > summary { display: block; padding: 7px 9px; background: #f1f5f3; font-weight: 700; }
    .pdf-content .proposal-day > summary small { float: right; color: #53615c; font-size: 8px; font-weight: 400; }
    .pdf-content .proposal-day > .proposal-day-body { display: block !important; padding: 5px 8px 8px; }
    .pdf-content .table-scroll { overflow: visible !important; }
    .pdf-content table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .pdf-content th, .pdf-content td { padding: 4px 6px; border-bottom: 1px solid #e5eae7; text-align: left; vertical-align: top; }
    .pdf-content th { color: #53615c; font-size: 8px; text-transform: uppercase; }
    .pdf-content td { font-size: 9px; }
    .pdf-content td:first-child { width: 39%; }
    .pdf-content td b { display: block; }
    .pdf-content .sub-value { display: block; margin-top: 2px; color: #71807a; font-size: 8px; }
    .pdf-content .status-chip { font-size: 8px; font-weight: 700; }
    .pdf-content .proposal-side-notes { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 12px; margin-top: 7px; }
    .pdf-content .proposal-side-notes > div { min-width: 0; }
    .pdf-content .proposal-side-notes b { font-size: 8px; }
    .pdf-content .proposal-side-notes p, .pdf-content .engine-notes { margin: 3px 0; color: #53615c; font-size: 8px; line-height: 1.4; }
    .pdf-content .engine-notes { padding-left: 14px; }
    .pdf-footer { margin-top: 12px; padding-top: 7px; border-top: 1px solid #dce3df; color: #71807a; font-size: 8px; line-height: 1.4; }
    .pdf-footer strong { color: #8a5b21; }
    @media print {
      details.proposal-day > .proposal-day-body { display: block !important; }
      details.proposal-day { break-inside: avoid-page; }
    }
  </style>
</head>
<body>
  <header class="pdf-header">
    <div class="pdf-brand">
      <img src="https://seeklogo.com/images/F/FHEMIG-logo-5291357251-seeklogo.com.png"
           alt="FHEMIG — Fundação Hospitalar do Estado de Minas Gerais"
           onerror="this.hidden=true">
      <div class="pdf-brand-copy">
        <strong>FUNDAÇÃO HOSPITALAR DO ESTADO DE MINAS GERAIS</strong>
        <span>Cuidar de cada vida, transformar cada futuro.</span>
      </div>
    </div>
    <p class="pdf-institution">Hospital João XXIII · Belo Horizonte — MG</p>
    <p class="pdf-eyebrow">Portal de Escalas · Documento de trabalho</p>
    <h1>Proposta de escala</h1>
    <div class="pdf-meta">
      <span><b>Unidade:</b> ${escapeHtml(unit?.name || "USI Adulto")}</span>
      <span><b>Turno:</b> ${escapeHtml(shift?.name || "—")}</span>
      <span><b>Competência:</b> ${escapeHtml(competence)}</span>
    </div>
    <div class="pdf-meta">
      <span><b>Documento:</b> ${escapeHtml(proposalVersion)}</span>
      <span><b>Gerado em:</b> ${escapeHtml(generatedAt)}</span>
    </div>
    <span class="pdf-status">PENDENTE DE REVISÃO · NÃO PUBLICADA</span>
  </header>
  <main class="pdf-content">${preview.innerHTML}</main>
  <footer class="pdf-footer">
    <strong>ATENÇÃO:</strong> este documento representa uma proposta automática para conferência da superadmin.
    Não é escala oficial, não foi aprovada e não autoriza publicação ou execução de plantões.
  </footer>
  <script>
    window.addEventListener("load", async function () {
      const logo = document.querySelector(".pdf-brand img");
      if (logo && !logo.hidden && !logo.complete) {
        await new Promise(resolve => {
          logo.addEventListener("load", resolve, { once: true });
          logo.addEventListener("error", resolve, { once: true });
        });
      }
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      window.focus();
      window.print();
    });
  </script>
</body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(printHtml);
  printWindow.document.close();
  proposalMessage("Prévia de impressão aberta. No destino da impressão, escolha “Salvar como PDF”.", "success");
}

async function saveScheduleProposal() {
  if (!lastProposal) {
    proposalMessage("Execute uma nova simulação antes de salvar a proposta.", "error");
    return;
  }
  const button = $("generate-proposal");
  button.disabled = true;
  button.textContent = "Salvando...";
  try {
    const { data, error } = await client.rpc("admin_save_schedule_proposal", {
      p_schedule_id: lastProposal.scheduleId,
      p_proposal_data: lastProposal.proposalData,
      p_metrics: lastProposal.metrics
    });
    if (error) throw new Error(error.message || "Não foi possível salvar a proposta.");
    const result = typeof data === "string" ? JSON.parse(data) : (data ?? {});
    lastProposal.proposalVersion = result.proposal_version ?? null;
    button.disabled = true;
    button.textContent = "Proposta salva";
    proposalMessage(
      "Proposta v" + (result.proposal_version ?? "—") +
      " salva para revisão. Ela não foi publicada e não alterou a escala oficial.",
      "success"
    );
    await loadSavedProposalHistory();
  } catch (error) {
    button.disabled = false;
    button.textContent = "Salvar para revisão";
    proposalMessage(error.message || "Falha ao salvar a proposta.", "error");
  }
}

async function simulateSelectedSchedule() {
  lastProposal = null;
  $("generate-proposal").disabled = true;
  $("generate-proposal").textContent = "Salvar para revisão";
  $("export-proposal-pdf").disabled = true;
  const button = $("simulate-proposal");
  button.disabled = true;
  button.textContent = "Simulando...";
  $("proposal-preview").innerHTML = '<p class="empty-cell">Preparando a simulação...</p>';
  proposalMessage("Lendo disponibilidade, vínculos e postos. Nenhuma alteração será gravada.", "info");

  try {
    const unitId = $("schedule-unit").value;
    const shiftId = $("schedule-shift").value;
    const unit = reference.units.find(x => x.id === unitId);
    const shift = reference.shifts.find(x => x.id === shiftId);
    if (!unit || !shift) throw new Error("Selecione uma unidade e um turno válidos.");

    if (unit.code === "UTI_ADULTO") {
      renderBlockedUtiProposal();
      return;
    }
    if (unit.code !== "USI_ADULTO") {
      throw new Error("Unidade não reconhecida pelo motor.");
    }

    const schedule = reference.schedules.find(x => x.unit_id === unitId && x.shift_id === shiftId && x.competence === monthStart);
    if (!schedule) throw new Error("Não existe escala de dezembro/2026 para a USI e o turno selecionados.");
    if (schedule.status === "published") throw new Error("A competência está publicada. O motor não simula sobre uma escala publicada.");

    const [links, availability, posts, targets, ruleRows, stagingRows] = await Promise.all([
      fetchAllRows(() => client.from("staff_unit_assignments").select("staff_id").eq("unit_id", unitId).eq("shift_id", shiftId).eq("active", true).order("staff_id")),
      fetchAllRows(() => client.from("monthly_availability").select("staff_id, work_date, original_marker, availability_status, reviewed, source_file, source_row").eq("schedule_id", schedule.id).order("work_date")),
      fetchAllRows(() => client.from("care_posts").select("id, code, name, post_type, sequence, manual_only").eq("unit_id", unitId).eq("active", true).order("sequence")),
      fetchAllRows(() => client.from("monthly_staff_targets").select("staff_id, expected_shifts, source_weekly_hours_raw, weekly_hours_snapshot, reviewed").eq("schedule_id", schedule.id)),
      fetchAllRows(() => client.from("staff_assignment_rules").select("staff_id, rule_code, unit_code, shift_code, rule_value, priority_rank, pair_group, pair_side, day_scope").eq("active", true)),
      fetchAllRows(() => client.from("staff_assignment_rule_staging").select("id, resolution_status, rule_code"))
    ]);

    const bedPosts = posts.filter(p => p.post_type === "bed" && p.manual_only !== true).sort((a,b) => a.sequence - b.sequence);
    const materialPost = posts.find(p => p.code === "USI-CIRC-MAT" && p.manual_only !== true);
    if (bedPosts.length !== 11 || !materialPost || posts.length !== 12) {
      throw new Error("A estrutura USI não corresponde a 11 postos diretos + 1 circulação/material. A simulação foi interrompida.");
    }

    const unresolvedRules = stagingRows.filter(row =>
      !["matched", "not_applicable"].includes(row.resolution_status)
    );
    if (unresolvedRules.length) {
      $("proposal-preview").innerHTML =
        '<div class="engine-blocker-summary"><strong>Regras funcionais ainda não conferidas</strong><p>' +
        unresolvedRules.length + ' referência(s) nominativa(s) ainda estão pendentes, não encontradas ou ambíguas. A simulação foi interrompida para não ignorar restrições.</p></div>';
      proposalMessage("Resolva a identificação das regras no banco privado antes de simular.", "error");
      return;
    }
    if (!ruleRows.length) {
      throw new Error("As regras privadas ainda não foram aplicadas. Execute a carga de regras no Supabase e aplique os vínculos confirmados.");
    }

    const linkedIds = [...new Set(links.map(x => x.staff_id).filter(Boolean))];
    const linkedSet = new Set(linkedIds);
    const staffRows = await fetchAllRows(() =>
      client.from("staff").select("id, masp, nome, categoria, weekly_hours, active").eq("active", true).order("nome")
    );
    const staffById = new Map(staffRows.map(x => [x.id, x]));
    const targetByStaff = new Map(targets.map(x => [x.staff_id, x]));
    const activeRules = ruleRows.filter(rule =>
      (!rule.unit_code || rule.unit_code === unit.code) &&
      (!rule.shift_code || rule.shift_code === shift.code)
    );
    const rulesByStaff = new Map();
    for (const rule of activeRules) {
      if (!rulesByStaff.has(rule.staff_id)) rulesByStaff.set(rule.staff_id, []);
      rulesByStaff.get(rule.staff_id).push(rule);
    }
    const rulesFor = staffId => rulesByStaff.get(staffId) || [];
    const remIds = new Set(activeRules.filter(rule => rule.rule_code === "REM").map(rule => rule.staff_id));
    const materialPriority = activeRules
      .filter(rule => rule.rule_code === "PRIORITY_POST_CODE" && rule.rule_value === "USI-CIRC-MAT")
      .sort((a,b) => (a.priority_rank ?? 9999) - (b.priority_rank ?? 9999));
    if (!materialPriority.length) {
      throw new Error("A prioridade nominativa do posto de circulação/material da USI não foi carregada.");
    }

    const unitAllowed = staffId => {
      const rules = rulesFor(staffId).filter(rule => rule.rule_code === "UNIT_ONLY");
      return !rules.length || rules.every(rule => rule.rule_value === unit.code);
    };
    const allowedForPost = (staffId, post) => {
      const rules = rulesFor(staffId);
      if (!unitAllowed(staffId)) return false;
      const onlyCodes = rules.filter(rule => rule.rule_code === "ONLY_POST_CODE");
      if (onlyCodes.length && !onlyCodes.some(rule => rule.rule_value === post.code)) return false;
      const onlyTypes = rules.filter(rule => rule.rule_code === "ONLY_POST_TYPE");
      if (onlyTypes.length && !onlyTypes.some(rule => rule.rule_value === post.post_type)) return false;
      if (rules.some(rule => rule.rule_code === "FORBID_POST_CODE" && rule.rule_value === post.code)) return false;
      if (rules.some(rule => rule.rule_code === "FORBID_POST_TYPE" && rule.rule_value === post.post_type)) return false;
      return true;
    };
    const targetRemaining = staffId => {
      const target = targetByStaff.get(staffId);
      if (!target || target.expected_shifts == null) return 0;
      return Math.max(0, Number(target.expected_shifts) - (assignmentCounts.get(staffId) || 0));
    };
    const availableByStaff = new Map();
    const availabilityByDay = new Map();
    const duplicateKeys = new Set();
    const duplicateIssues = [];
    for (const row of availability) {
      const marker = String(row.original_marker || "").trim().toUpperCase();
      const day = String(row.work_date).slice(0,10);
      if (!availabilityByDay.has(day)) availabilityByDay.set(day, []);
      availabilityByDay.get(day).push(row);
      if (marker === "X" && row.availability_status === "available" && row.staff_id && linkedSet.has(row.staff_id)) {
        availableByStaff.set(row.staff_id, (availableByStaff.get(row.staff_id) || 0) + 1);
      }
      if (row.staff_id) {
        const key = row.staff_id + "|" + day;
        if (duplicateKeys.has(key)) duplicateIssues.push("Mais de uma marcação para o mesmo profissional na data " + day + ".");
        duplicateKeys.add(key);
      }
    }
    if (duplicateIssues.length) {
      $("proposal-preview").innerHTML =
        '<div class="engine-blocker-summary"><strong>Marcações duplicadas</strong><p>Há mais de uma linha para o mesmo profissional na mesma data. A simulação foi interrompida.</p></div>' +
        '<div class="engine-blocker-list">' + duplicateIssues.slice(0,20).map(x => '<div class="engine-blocker"><div><p>' + escapeHtml(x) + '</p></div></div>').join("") + '</div>';
      proposalMessage("Simulação interrompida. Corrija ou esclareça as marcações duplicadas antes da distribuição.", "error");
      return;
    }

    const globalIssues = [];
    const missingTargets = linkedIds.filter(id => !targetByStaff.has(id));
    if (missingTargets.length) {
      globalIssues.push(missingTargets.length + " vínculo(s) ativo(s) sem meta mensal cadastrada; esses profissionais não serão alocados automaticamente.");
    }
    const unlinkedRulePeople = [...rulesByStaff.keys()].filter(id => !linkedSet.has(id) && rulesFor(id).some(rule => rule.rule_code === "MUST_ASSIGN"));
    if (unlinkedRulePeople.length) {
      globalIssues.push(unlinkedRulePeople.length + " pessoa(s) com regra de alocação obrigatória não possuem vínculo ativo nesta unidade/turno.");
    }
    const assignmentCounts = new Map();
    const reportDays = [];

    for (let dayNo = 1; dayNo <= 31; dayNo++) {
      const date = "2026-12-" + String(dayNo).padStart(2,"0");
      const dayRows = availabilityByDay.get(date) || [];
      const dayByStaff = new Map();
      const review = [];
      const unlinkedAvailable = [];
      for (const row of dayRows) {
        const marker = String(row.original_marker || "").trim().toUpperCase();
        if (marker === "TP" || row.availability_status === "review" || (marker === "X" && row.availability_status === "pending")) {
          review.push({marker: marker || "REVISAR", staff: row.staff_id ? staffById.get(row.staff_id) : null, source_row: row.source_row});
        }
        if (marker === "X" && row.availability_status === "available" && row.staff_id &&
            !linkedSet.has(row.staff_id) && !remIds.has(row.staff_id)) {
          unlinkedAvailable.push(row);
        }
        if (row.staff_id) dayByStaff.set(row.staff_id, row);
      }

      const xAvailable = staffRows.filter(person => {
        const row = dayByStaff.get(person.id);
        return linkedSet.has(person.id) && row &&
          String(row.original_marker || "").trim().toUpperCase() === "X" &&
          row.availability_status === "available";
      });
      const remToday = staffRows.filter(person => {
        const row = dayByStaff.get(person.id);
        return remIds.has(person.id) && row &&
          String(row.original_marker || "").trim().toUpperCase() === "X" &&
          row.availability_status === "available";
      });
      const availableNotRem = xAvailable.filter(person => !remIds.has(person.id));
      const assignedIds = new Set();
      const notes = [];
      if (review.length) notes.push(review.length + " marcação(ões) pendente(s)/TP mantida(s) fora da elegibilidade.");
      if (unlinkedAvailable.length) notes.push(unlinkedAvailable.length + " marcação(ões) X sem vínculo ativo na unidade/turno.");

      // O número mensal de plantões é um alvo individual da fonte: não é recalculado
      // pela carga semanal nem substituído pela contagem de X.
      const availablePriority = materialPriority
        .map(rule => ({rule, person: staffById.get(rule.staff_id)}))
        .filter(item => item.person && availableNotRem.some(person => person.id === item.person.id));
      let materialChoice = null;
      if (availablePriority.length) {
        const first = availablePriority[0];
        if (targetRemaining(first.person.id) > 0 && allowedForPost(first.person.id, materialPost)) {
          materialChoice = first.person;
          assignedIds.add(materialChoice.id);
          assignmentCounts.set(materialChoice.id, (assignmentCounts.get(materialChoice.id) || 0) + 1);
        } else {
          notes.push("O profissional prioritário para circulação/material está disponível, mas sua meta mensal foi atingida ou há conflito de elegibilidade. O posto ficou em branco para revisão.");
        }
      } else {
        notes.push("Circulação/material permaneceu em branco: nenhum profissional da ordem de prioridade está disponível com meta mensal restante.");
      }

      const directCandidates = availableNotRem.filter(person =>
        !assignedIds.has(person.id) &&
        targetRemaining(person.id) > 0 &&
        bedPosts.some(post => allowedForPost(person.id, post))
      );
      directCandidates.sort((a,b) => {
        const ca = assignmentCounts.get(a.id) || 0;
        const cb = assignmentCounts.get(b.id) || 0;
        const ta = Math.max(1, Number(targetByStaff.get(a.id)?.expected_shifts) || 1);
        const tb = Math.max(1, Number(targetByStaff.get(b.id)?.expected_shifts) || 1);
        const ra = ca / ta, rb = cb / tb;
        if (ra !== rb) return ra - rb;
        if (ca !== cb) return ca - cb;
        return normalizedName(a.nome).localeCompare(normalizedName(b.nome));
      });

      const mandatoryDirect = directCandidates.filter(person =>
        rulesFor(person.id).some(rule => rule.rule_code === "MUST_ASSIGN")
      );
      const mustConflict = mandatoryDirect.length > bedPosts.length;
      if (mustConflict) {
        notes.push("Há mais profissionais com alocação obrigatória disponíveis do que postos diretos. Nenhuma alocação direta automática foi feita neste dia.");
      }
      const mandatoryIds = new Set(mandatoryDirect.map(person => person.id));
      const remainingDirect = directCandidates.filter(person => !mandatoryIds.has(person.id));
      const orderedDirect = mandatoryDirect.concat(remainingDirect);
      const assignedDirect = new Set();
      const assignments = bedPosts.map(post => {
        if (mustConflict) return {code:post.code,name:post.name,staff:null};
        const person = orderedDirect.find(candidate =>
          !assignedDirect.has(candidate.id) &&
          targetRemaining(candidate.id) > 0 &&
          allowedForPost(candidate.id, post)
        ) || null;
        if (person) {
          assignedDirect.add(person.id);
          assignedIds.add(person.id);
          assignmentCounts.set(person.id, (assignmentCounts.get(person.id) || 0) + 1);
        }
        return {code:post.code,name:post.name,staff:person};
      });
      const extras = orderedDirect.filter(person => !assignedDirect.has(person.id));      const vacant = assignments.filter(x => !x.staff).length;
      if (vacant) notes.push(vacant + " posto(s) direto(s) sem cobertura.");
      const mandatoryMissed = availableNotRem.filter(person =>
        rulesFor(person.id).some(rule => rule.rule_code === "MUST_ASSIGN") &&
        !assignedIds.has(person.id)
      );
      if (mandatoryMissed.length) {
        notes.push(mandatoryMissed.length + " profissional(is) com regra de alocação obrigatória não foram alocados; conferir meta mensal, elegibilidade e vínculo.");
      }
      const restrictedOnly = availableNotRem.filter(person =>
        !assignedIds.has(person.id) &&
        rulesFor(person.id).some(rule => rule.rule_code === "ONLY_POST_CODE" || rule.rule_code === "ONLY_POST_TYPE")
      );
      if (restrictedOnly.length) {
        notes.push(restrictedOnly.length + " profissional(is) disponível(is) com função/posto exclusivo permaneceram fora da distribuição automática porque a prioridade específica não os selecionou.");
      }

      reportDays.push({
        date,
        label: new Date(date + "T12:00:00").toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"2-digit"}),
        assignments,
        material:materialChoice,
        filled:11-vacant,
        vacant,
        extras,
        rem:remToday,
        review,
        notes
      });
    }

    const report = {days:reportDays,globalIssues};
    renderUsiProposal(report, schedule, unit, shift);
  } catch (error) {
    $("proposal-preview").innerHTML = '<p class="empty-cell">Não foi possível concluir a simulação. Nenhuma alocação foi gravada.</p>';
    proposalMessage(error.message || "Erro ao simular a proposta.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Simular mês";
  }
}

export async function initializeAdminWorkspace(supabaseClient) {
  client = supabaseClient;
  if (initialized) return;
  initialized = true;
  renderSkeleton();
  try {
    await loadReferenceData();
    await initializeStaffManagement(client, reference);
  } catch (error) {
    message(error.message || "Não foi possível iniciar o módulo de escalas.", "error");
    renderUnavailable("Confira a conexão com o banco e as permissões do superadmin.");
  }
}
