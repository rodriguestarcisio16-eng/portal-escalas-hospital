const $ = (id) => document.getElementById(id);

let client = null;
let reference = { units: [], shifts: [], schedules: [] };
let staffRows = [];
let selectedStaffId = null;
let markerData = [];
let loadingMonth = false;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function notify(text = "", type = "info") {
  const el = $("staff-manager-message");
  if (!el) return;
  el.textContent = text;
  el.className = `module-message ${type}`;
}

function scheduleLabel(schedule) {
  const unit = reference.units.find((x) => x.id === schedule.unit_id);
  const shift = reference.shifts.find((x) => x.id === schedule.shift_id);
  const date = new Date(`${String(schedule.competence).slice(0, 10)}T12:00:00`);
  return `${unit?.name ?? schedule.unit_code ?? "Unidade"} · ${shift?.name ?? schedule.shift_code ?? "Turno"} · ${date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`;
}

function scheduleFor(id) {
  return reference.schedules.find((x) => x.id === id);
}

function assignmentKey(unitCode, shiftCode) {
  return `${unitCode}|${shiftCode}`;
}

function selectedAssignments() {
  return [...document.querySelectorAll("[data-staff-assignment]:checked")].map((input) => {
    const [unit_code, shift_code] = input.value.split("|");
    return { unit_code, shift_code };
  });
}

function renderManagementShell() {
  const root = $("staff-management-root");
  if (!root) return;
  root.innerHTML = `
    <section class="module-panel staff-manager-panel">
      <div class="panel-heading staff-manager-heading">
        <div>
          <p class="eyebrow dark">ADMINISTRAÇÃO DA EQUIPE</p>
          <h4>Gestão de profissionais</h4>
          <p>Cadastre, atualize vínculos, carga contratual e informações mensais. As alterações ficam registradas no histórico.</p>
        </div>
        <button id="staff-new" type="button" class="primary-btn compact-btn">+ Novo profissional</button>
      </div>
      <div class="staff-manager-notice">
        <b>Cadastro funcional e escala são informações separadas.</b>
        <span>O cadastro não cria disponibilidade automaticamente. Para cada competência, informe a meta de plantões e marque somente os dias confirmados. O MASP é obrigatório e não pode ser alterado depois do cadastro por esta tela.</span>
      </div>
      <p id="staff-manager-message" class="module-message" role="status"></p>
      <div class="staff-manager-layout">
        <aside class="staff-directory">
          <div class="staff-directory-head">
            <h5>Profissionais cadastrados</h5>
            <span id="staff-directory-count" class="status-chip neutral">—</span>
          </div>
          <input id="staff-search" type="search" placeholder="Buscar por nome ou MASP" aria-label="Buscar profissional" />
          <div id="staff-directory-list" class="staff-directory-list"><p class="muted">Carregando cadastro...</p></div>
        </aside>
        <section class="staff-editor">
          <div class="staff-editor-head">
            <div><h5 id="staff-editor-title">Novo profissional</h5><p>Preencha os dados funcionais e selecione os vínculos ativos.</p></div>
            <span id="staff-editor-mode" class="status-chip neutral">Novo cadastro</span>
          </div>
          <form id="staff-management-form">
            <input id="staff-id" type="hidden" />
            <div class="staff-form-grid staff-form-grid-three">
              <div class="field-group"><label for="staff-masp">MASP *</label><input id="staff-masp" inputmode="numeric" maxlength="20" placeholder="Somente números" required /></div>
              <div class="field-group staff-span-two"><label for="staff-name">Nome completo *</label><input id="staff-name" maxlength="180" required placeholder="Nome do profissional" /></div>
              <div class="field-group"><label for="staff-category">Categoria *</label><input id="staff-category" list="staff-category-options" maxlength="30" required placeholder="TE, TEC, AUX..." /><datalist id="staff-category-options"><option value="TE"><option value="TEC"><option value="AUX"><option value="AUX."></datalist></div>
              <div class="field-group"><label for="staff-weekly-hours">Carga contratual semanal</label><select id="staff-weekly-hours"><option value="">Não informada</option><option value="20">20 horas</option><option value="30">30 horas</option><option value="40">40 horas</option></select></div>
              <div class="field-group staff-check-field"><label><input id="staff-contract-marker" type="checkbox" /> Marcador CA</label><label><input id="staff-active" type="checkbox" checked /> Cadastro ativo</label></div>
            </div>
            <div class="staff-form-section">
              <div class="staff-form-section-head"><h6>Vínculos de unidade e turno</h6><small>Marque cada combinação em que o profissional pode integrar a equipe.</small></div>
              <div class="staff-assignment-grid">
                ${["UTI_ADULTO", "USI_ADULTO"].map((unitCode) => {
                  const unit = reference.units.find((x) => x.code === unitCode);
                  return `<div class="staff-assignment-unit"><b>${esc(unit?.name ?? unitCode)}</b>${["DIURNO", "NOTURNO"].map((shiftCode) => {
                    const shift = reference.shifts.find((x) => x.code === shiftCode);
                    return `<label><input type="checkbox" data-staff-assignment value="${unitCode}|${shiftCode}" /> ${esc(shift?.name ?? shiftCode)}</label>`;
                  }).join("")}</div>`;
                }).join("")}
              </div>
            </div>
            <div class="staff-form-section">
              <div class="staff-form-section-head"><h6>Escala mensal e disponibilidade</h6><small>Escolha a competência e o turno. O calendário é preenchido manualmente.</small></div>
              <div class="staff-form-grid staff-form-grid-three">
                <div class="field-group"><label for="staff-schedule">Competência / unidade / turno</label><select id="staff-schedule"></select></div>
                <div class="field-group"><label for="staff-competence-hours">Horas registradas na competência</label><input id="staff-competence-hours" type="number" min="0" max="200" step="1" placeholder="Ex.: 31" /></div>
                <div class="field-group"><label for="staff-expected-shifts">Plantões previstos no mês</label><input id="staff-expected-shifts" type="number" min="0" max="31" step="1" placeholder="Ex.: 15" /></div>
              </div>
              <p class="staff-month-note">Carga contratual semanal, horas registradas na competência e plantões previstos são três informações independentes. O portal não calcula uma a partir da outra.</p>
              <p id="staff-month-note" class="staff-month-note">Sem competência selecionada.</p>
              <div class="staff-period-panel">
                <div class="staff-form-section-head">
                  <h6>Lançar afastamento por período</h6>
                  <small>Informe o tipo e as datas. O portal preencherá o intervalo no calendário; depois clique em Salvar alterações para gravar.</small>
                </div>
                <div class="staff-period-grid">
                  <div class="field-group">
                    <label for="staff-period-code">Situação</label>
                    <select id="staff-period-code">
                      <option value="FR">FR — Férias</option>
                      <option value="LM">LM — Licença médica</option>
                      <option value="LMA">LMA — Licença maternidade</option>
                      <option value="APA">APA — Afastamento preliminar</option>
                      <option value="FO">FO — Folga</option>
                      <option value="REV">REV — Outro afastamento / conferir</option>
                    </select>
                  </div>
                  <div class="field-group">
                    <label for="staff-period-start">Data inicial</label>
                    <input id="staff-period-start" type="date" />
                  </div>
                  <div class="field-group">
                    <label for="staff-period-end">Data final</label>
                    <input id="staff-period-end" type="date" />
                  </div>
                  <div class="field-group staff-period-action">
                    <label>&nbsp;</label>
                    <button id="staff-apply-period" type="button" class="secondary-btn">Aplicar período</button>
                  </div>
                </div>
                <p id="staff-period-note" class="staff-month-note">Selecione uma competência e um intervalo dentro do mês.</p>
              </div>
              <div id="staff-calendar" class="staff-calendar"><p class="muted">Selecione uma competência para abrir o calendário.</p></div>
              <div class="staff-marker-legend"><b>Marcações:</b> X = disponível · FO = folga · FR = férias · LM = licença médica · LMA = licença maternidade · APA = afastamento preliminar · REM = remanejamento manual · TP/REV = revisão. Períodos aplicados são gravados ao salvar as alterações.</div>
            </div>
            <div class="staff-form-actions">
              <button id="staff-reset" type="button" class="secondary-btn">Limpar formulário</button>
              <button id="staff-save" type="submit" class="primary-btn compact-btn">Salvar cadastro</button>
            </div>
          </form>
        </section>
      </div>
    </section>`;

  const scheduleSelect = $("staff-schedule");
  scheduleSelect.innerHTML = `<option value="">Não configurar competência agora</option>` + reference.schedules.map((schedule) => {
    const disabled = schedule.status !== "draft" ? "disabled" : "";
    return `<option value="${esc(schedule.id)}" ${disabled}>${esc(scheduleLabel(schedule))}${schedule.status !== "draft" ? " · somente leitura" : ""}</option>`;
  }).join("");
  scheduleSelect.value = "";

  $("staff-new").addEventListener("click", () => resetForm(true));
  $("staff-reset").addEventListener("click", () => resetForm(true));
  $("staff-search").addEventListener("input", renderDirectory);
  $("staff-schedule").addEventListener("change", () => loadSelectedMonth());
  $("staff-apply-period").addEventListener("click", () => applyPeriodToCalendar());
  $("staff-active").addEventListener("change", (event) => {
    if (!event.target.checked) notify("Ao inativar o cadastro, os vínculos ativos também serão desativados. O histórico e as escalas anteriores serão preservados.", "info");
  });
  $("staff-management-form").addEventListener("submit", saveStaff);
}

async function loadDirectory() {
  notify("Consultando cadastro funcional...", "info");
  const { data, error } = await client.rpc("admin_list_staff_management");
  if (error) throw new Error(error.message || "Não foi possível consultar os profissionais.");
  const payload = data ?? {};
  staffRows = Array.isArray(payload.staff) ? payload.staff : [];
  reference.units = Array.isArray(payload.units) && payload.units.length ? payload.units : reference.units;
  reference.shifts = Array.isArray(payload.shifts) && payload.shifts.length ? payload.shifts : reference.shifts;
  if (Array.isArray(payload.schedules) && payload.schedules.length) reference.schedules = payload.schedules;
  renderDirectory();
  notify(`${staffRows.length} profissional(is) carregado(s).`, "success");
}

function renderDirectory() {
  const list = $("staff-directory-list");
  if (!list) return;
  const query = String($("staff-search")?.value ?? "").trim().toLocaleLowerCase("pt-BR");
  const filtered = staffRows.filter((person) =>
    !query || String(person.nome ?? "").toLocaleLowerCase("pt-BR").includes(query) || String(person.masp ?? "").includes(query)
  );
  $("staff-directory-count").textContent = `${filtered.length} / ${staffRows.length}`;
  if (!filtered.length) {
    list.innerHTML = '<p class="muted">Nenhum profissional encontrado.</p>';
    return;
  }
  list.innerHTML = filtered.map((person) => {
    const combos = (person.assignments ?? []).map((a) => `${a.unit_code === "UTI_ADULTO" ? "UTI" : "USI"} ${a.shift_code === "DIURNO" ? "D" : "N"}`).join(" · ") || "Sem vínculo ativo";
    const active = person.active === true;
    return `<button type="button" class="staff-directory-item ${person.id === selectedStaffId ? "selected" : ""}" data-staff-edit="${esc(person.id)}">
      <span class="staff-directory-item-top"><b>${esc(person.nome)}</b><span class="status-chip ${active ? "success" : "neutral"}">${active ? "Ativo" : "Inativo"}</span></span>
      <small>MASP ${esc(person.masp)} · ${esc(person.categoria ?? "Sem categoria")}</small>
      <small>${esc(combos)}</small>
    </button>`;
  }).join("");
  list.querySelectorAll("[data-staff-edit]").forEach((button) => {
    button.addEventListener("click", () => editStaff(button.dataset.staffEdit));
  });
}

function setPeriodControlsEnabled(enabled, schedule = null) {
  ["staff-period-code", "staff-period-start", "staff-period-end", "staff-apply-period"].forEach(id => {
    const control = $(id);
    if (control) control.disabled = !enabled;
  });
  const start = $("staff-period-start");
  const end = $("staff-period-end");
  if (schedule) {
    const first = String(schedule.competence).slice(0, 10);
    const [year, month] = first.split("-").map(Number);
    const last = year + "-" + String(month).padStart(2, "0") + "-" +
      String(new Date(year, month, 0).getDate()).padStart(2, "0");
    if (start) { start.min = first; start.max = last; }
    if (end) { end.min = first; end.max = last; }
  }
}

function applyPeriodToCalendar() {
  const schedule = scheduleFor($("staff-schedule")?.value);
  if (!schedule || schedule.status !== "draft") {
    notify("Selecione uma competência em rascunho antes de lançar um período.", "error");
    return;
  }
  const code = $("staff-period-code")?.value;
  const start = $("staff-period-start")?.value;
  const end = $("staff-period-end")?.value;
  if (!code || !start || !end) {
    $("staff-period-note").textContent = "Informe a situação, a data inicial e a data final.";
    return notify("Preencha o tipo de afastamento e as duas datas.", "error");
  }
  if (start > end) return notify("A data inicial não pode ser posterior à data final.", "error");
  const first = String(schedule.competence).slice(0, 10);
  const [year, month] = first.split("-").map(Number);
  const last = year + "-" + String(month).padStart(2, "0") + "-" +
    String(new Date(year, month, 0).getDate()).padStart(2, "0");
  if (start < first || end > last) {
    return notify("O período precisa estar inteiramente dentro da competência selecionada.", "error");
  }

  const controls = [...document.querySelectorAll("[data-day-marker]")];
  const selected = controls.filter(control => control.dataset.dayMarker >= start && control.dataset.dayMarker <= end);
  if (!selected.length) return notify("Não encontrei dias do intervalo no calendário atual.", "error");
  const conflicts = selected.filter(control => control.value && control.value !== code);
  if (conflicts.length) {
    const sample = conflicts.slice(0, 5).map(control =>
      control.dataset.dayMarker.slice(8, 10) + " (" + control.value + ")"
    ).join(", ");
    const more = conflicts.length > 5 ? " e mais " + (conflicts.length - 5) + " dia(s)" : "";
    const accepted = window.confirm(
      "O intervalo contém " + conflicts.length + " dia(s) com marcação existente: " +
      sample + more + ".\n\nSubstituir essas marcações por " + code +
      "? A alteração será registrada como manual quando você salvar o profissional."
    );
    if (!accepted) {
      $("staff-period-note").textContent = "Período não aplicado. As marcações existentes foram mantidas.";
      return;
    }
  }
  selected.forEach(control => {
    control.value = code;
    control.closest(".staff-day-cell")?.classList.add("period-filled");
  });
  $("staff-period-note").textContent =
    code + " aplicado de " + new Date(start + "T12:00:00").toLocaleDateString("pt-BR") +
    " a " + new Date(end + "T12:00:00").toLocaleDateString("pt-BR") +
    " (" + selected.length + " dia(s)). Clique em Salvar alterações para gravar.";
  notify("Período aplicado ao calendário. Salve o cadastro para registrar as alterações.", "success");
}

function renderCalendar(schedule, values = new Map()) {
  const calendar = $("staff-calendar");
  if (!schedule) {
    calendar.innerHTML = '<p class="muted">Não há competência disponível para edição.</p>';
    $("staff-month-note").textContent = "Sem escala mensal em rascunho.";
    return;
  }
  const competence = String(schedule.competence).slice(0, 10);
  const [year, month] = competence.split("-").map(Number);
  const days = new Date(year, month, 0).getDate();
  const options = [
    ["", "Sem marcação"], ["X", "X — disponível"], ["FO", "FO — folga"],
    ["FR", "FR — férias"], ["LM", "LM — licença médica"],
    ["LMA", "LMA — licença maternidade"], ["APA", "APA — afastamento"],
    ["REM", "REM — remanejamento manual"], ["TP", "TP — troca/revisão"],
    ["REV", "REV — conferir / tirar da elegibilidade"],
  ];
  calendar.innerHTML = Array.from({ length: days }, (_, index) => {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`;
    const value = values.get(date) ?? "";
    return `<label class="staff-day-cell"><span>${String(index + 1).padStart(2, "0")}/${String(month).padStart(2, "0")}</span><select data-day-marker="${date}">${options.map(([key, label]) => `<option value="${key}" ${value === key ? "selected" : ""}>${label}</option>`).join("")}</select></label>`;
  }).join("");
  const unit = reference.units.find((x) => x.id === schedule.unit_id);
  const shift = reference.shifts.find((x) => x.id === schedule.shift_id);
  $("staff-month-note").textContent = `${unit?.name ?? schedule.unit_code} · ${shift?.name ?? schedule.shift_code} · ${days} dias. Dias sem marcação permanecem sem confirmação e não entram na distribuição.`;
}

async function loadSelectedMonth() {
  if (loadingMonth) return;
  const scheduleId = $("staff-schedule")?.value;
  const schedule = scheduleFor(scheduleId);
  if (!schedule) {
    $("staff-expected-shifts").value = "";
    $("staff-competence-hours").value = "";
    $("staff-expected-shifts").disabled = true;
    $("staff-competence-hours").disabled = true;
    renderCalendar(null);
    setPeriodControlsEnabled(false);
    return;
  }
  if (schedule.status !== "draft") {
    renderCalendar(schedule);
    $("staff-calendar").innerHTML = '<p class="muted">Esta competência não está em rascunho e não pode ser editada.</p>';
    $("staff-expected-shifts").disabled = true;
    $("staff-competence-hours").disabled = true;
    setPeriodControlsEnabled(false);
    return;
  }
  $("staff-expected-shifts").disabled = false;
  $("staff-competence-hours").disabled = false;
  setPeriodControlsEnabled(true, schedule);
  if (!selectedStaffId) {
    $("staff-expected-shifts").value = "";
    $("staff-competence-hours").value = "";
    renderCalendar(schedule);
    return;
  }

  loadingMonth = true;
  try {
    const { data, error } = await client.rpc("admin_get_staff_month_data", {
      p_staff_id: selectedStaffId,
      p_schedule_id: scheduleId,
    });
    if (error) throw new Error(error.message || "Não foi possível carregar a disponibilidade mensal.");
    const payload = data ?? {};
    const target = payload.target ?? null;
    $("staff-expected-shifts").value = target?.expected_shifts ?? "";
    $("staff-competence-hours").value = target?.weekly_hours_snapshot ?? "";
    const values = new Map((payload.markers ?? []).map((row) => [String(row.work_date).slice(0, 10), String(row.marker ?? "").toUpperCase()]));
    markerData = payload.markers ?? [];
    renderCalendar(schedule, values);
    const overridden = Boolean(target?.manual_override) || markerData.some((row) => row.manual_override);
    if (overridden) $("staff-month-note").textContent += " Há alterações manuais registradas nesta competência.";
  } catch (error) {
    notify(error.message || "Falha ao carregar os dados do mês.", "error");
    renderCalendar(schedule);
  } finally {
    loadingMonth = false;
  }
}

function resetForm(clearNotice = false) {
  selectedStaffId = null;
  markerData = [];
  $("staff-management-form").reset();
  $("staff-id").value = "";
  $("staff-active").checked = true;
  $("staff-editor-title").textContent = "Novo profissional";
  $("staff-editor-mode").textContent = "Novo cadastro";
  $("staff-masp").readOnly = false;
  $("staff-masp").classList.remove("readonly-field");
  $("staff-save").textContent = "Salvar cadastro";
  $("staff-expected-shifts").value = "";
  $("staff-competence-hours").value = "";
  $("staff-schedule").value = "";
  setPeriodControlsEnabled(false);
  $("staff-expected-shifts").disabled = true;
  $("staff-competence-hours").disabled = true;
  // Novo cadastro inicia sem vínculo nem competência presumidos; o responsável escolhe as combinações.
  document.querySelectorAll("[data-staff-assignment]").forEach((input) => { input.checked = false; });
  renderCalendar(scheduleFor($("staff-schedule").value));
  renderDirectory();
  if (clearNotice) notify("Formulário pronto para um novo cadastro. Nenhum dado foi salvo.", "info");
}

async function editStaff(id) {
  const person = staffRows.find((x) => x.id === id);
  if (!person) return;
  selectedStaffId = person.id;
  $("staff-id").value = person.id;
  $("staff-masp").value = person.masp ?? "";
  $("staff-masp").readOnly = true;
  $("staff-masp").classList.add("readonly-field");
  $("staff-name").value = person.nome ?? "";
  $("staff-category").value = person.categoria ?? "TE";
  $("staff-weekly-hours").value = person.weekly_hours ?? "";
  $("staff-contract-marker").checked = person.contract_marker === true;
  $("staff-active").checked = person.active === true;
  document.querySelectorAll("[data-staff-assignment]").forEach((input) => {
    input.checked = (person.assignments ?? []).some((a) => assignmentKey(a.unit_code, a.shift_code) === input.value);
  });
  const assignment = (person.assignments ?? [])[0];
  const schedule = reference.schedules.find((x) => x.unit_id === reference.units.find((u) => u.code === assignment?.unit_code)?.id &&
    x.shift_id === reference.shifts.find((sh) => sh.code === assignment?.shift_code)?.id && x.status === "draft")
    || reference.schedules.find((x) => x.status === "draft");
  if (schedule) $("staff-schedule").value = schedule.id;
  $("staff-editor-title").textContent = person.nome;
  $("staff-editor-mode").textContent = "Editando cadastro";
  $("staff-save").textContent = "Salvar alterações";
  renderDirectory();
  notify(`Editando ${person.nome}. As marcações e metas existentes serão carregadas para a competência selecionada.`, "info");
  await loadSelectedMonth();
}

async function saveStaff(event) {
  event.preventDefault();
  const button = $("staff-save");
  const masp = $("staff-masp").value.trim();
  const nome = $("staff-name").value.trim();
  const categoria = $("staff-category").value;
  const weeklyHours = $("staff-weekly-hours").value;
  const active = $("staff-active").checked;
  const assignments = selectedAssignments();
  const schedule = scheduleFor($("staff-schedule").value);
  if (!/^[0-9]{1,20}$/.test(masp)) return notify("Informe um MASP numérico válido.", "error");
  if (!nome) return notify("Informe o nome completo.", "error");
  if (!categoria) return notify("Informe a categoria profissional.", "error");
  if (active && !assignments.length) return notify("Selecione pelo menos uma unidade/turno para o profissional ativo.", "error");
  if (schedule && schedule.status !== "draft") return notify("A competência selecionada não está em rascunho.", "error");
  if (active && schedule) {
    const scheduleUnit = reference.units.find((x) => x.id === schedule.unit_id);
    const scheduleShift = reference.shifts.find((x) => x.id === schedule.shift_id);
    if (!assignments.some((a) => a.unit_code === scheduleUnit?.code && a.shift_code === scheduleShift?.code)) {
      return notify("Marque o vínculo correspondente à unidade e ao turno da competência selecionada.", "error");
    }
  }
  // É possível cadastrar o profissional e configurar a competência posteriormente.
  const scheduleToSave = active ? schedule : null;
  const expectedRaw = $("staff-expected-shifts").value;
  const expected = expectedRaw === "" ? null : Number(expectedRaw);
  if (expected !== null && (!Number.isInteger(expected) || expected < 0 || expected > 31)) {
    return notify("A meta mensal deve ser um número inteiro entre 0 e 31.", "error");
  }
  const competenceHoursRaw = $("staff-competence-hours").value;
  const competenceHours = competenceHoursRaw === "" ? null : Number(competenceHoursRaw);
  if (competenceHours !== null && (!Number.isInteger(competenceHours) || competenceHours < 0 || competenceHours > 200)) {
    return notify("As horas registradas na competência devem ser um número inteiro entre 0 e 200.", "error");
  }
  const markers = scheduleToSave ? [...document.querySelectorAll("[data-day-marker]")]
    .map((input) => ({ work_date: input.dataset.dayMarker, marker: input.value })) : [];

  button.disabled = true;
  button.textContent = "Salvando...";
  notify("Gravando cadastro, vínculos e dados da competência...", "info");
  try {
    const { data, error } = await client.rpc("admin_save_staff_management", {
      p_staff_id: selectedStaffId || null,
      p_masp: masp,
      p_nome: nome,
      p_categoria: categoria,
      p_contract_weekly_hours: weeklyHours === "" ? null : Number(weeklyHours),
      p_competence_hours_snapshot: scheduleToSave ? competenceHours : null,
      p_contract_marker: $("staff-contract-marker").checked,
      p_active: active,
      p_assignments: assignments,
      p_schedule_id: scheduleToSave?.id ?? null,
      p_expected_shifts: scheduleToSave ? expected : null,
      p_markers: scheduleToSave ? markers : [],
    });
    if (error) throw new Error(error.message || "Não foi possível salvar o profissional.");
    await loadDirectory();
    const savedId = data?.staff_id ?? selectedStaffId;
    if (savedId) await editStaff(savedId);
    notify("Cadastro e dados mensais salvos. A disponibilidade informada foi registrada sem gerar ou publicar a escala.", "success");
    document.dispatchEvent(new CustomEvent("staff-management-updated"));
  } catch (error) {
    notify(error.message || "Erro ao salvar o cadastro.", "error");
  } finally {
    button.disabled = false;
    button.textContent = selectedStaffId ? "Salvar alterações" : "Salvar cadastro";
  }
}

export async function initializeStaffManagement(supabaseClient, sharedReference) {
  client = supabaseClient;
  reference = sharedReference ?? reference;
  renderManagementShell();
  try {
    await loadDirectory();
    resetForm(false);
  } catch (error) {
    notify(error.message || "Não foi possível iniciar a gestão de profissionais.", "error");
    $("staff-directory-list").innerHTML = '<p class="muted">O módulo não conseguiu carregar o cadastro.</p>';
  }
}