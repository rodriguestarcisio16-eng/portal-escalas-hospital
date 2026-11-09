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
              <div class="field-group"><label for="staff-category">Categoria *</label><select id="staff-category" required><option value="TE">TE</option><option value="TEC">TEC</option><option value="AUX">AUX</option><option value="AUX.">AUX.</option></select></div>
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
                <div class="field-group staff-span-two"><label for="staff-schedule">Competência / unidade / turno</label><select id="staff-schedule"></select></div>
                <div class="field-group"><label for="staff-expected-shifts">Plantões previstos no mês</label><input id="staff-expected-shifts" type="number" min="0" max="31" step="1" placeholder="Não informado" /></div>
              </div>
              <p id="staff-month-note" class="staff-month-note">Sem competência selecionada.</p>
              <div id="staff-calendar" class="staff-calendar"><p class="muted">Selecione uma competência para abrir o calendário.</p></div>
              <div class="staff-marker-legend"><b>Marcações:</b> X = disponível · FO = folga · FR = férias · LM = licença médica · LMA = licença maternidade · APA = afastamento preliminar · REM = remanejamento manual · TP/REV = revisão. Campo vazio não confirma disponibilidade.</div>
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
  scheduleSelect.innerHTML = reference.schedules.map((schedule) => {
    const disabled = schedule.status !== "draft" ? "disabled" : "";
    return `<option value="${esc(schedule.id)}" ${disabled}>${esc(scheduleLabel(schedule))}${schedule.status !== "draft" ? " · somente leitura" : ""}</option>`;
  }).join("");
  const firstDraft = reference.schedules.find((x) => x.status === "draft");
  if (firstDraft) scheduleSelect.value = firstDraft.id;

  $("staff-new").addEventListener("click", () => resetForm(true));
  $("staff-reset").addEventListener("click", () => resetForm(true));
  $("staff-search").addEventListener("input", renderDirectory);
  $("staff-schedule").addEventListener("change", () => loadSelectedMonth());
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
    renderCalendar(null);
    return;
  }
  if (schedule.status !== "draft") {
    renderCalendar(schedule);
    $("staff-calendar").innerHTML = '<p class="muted">Esta competência não está em rascunho e não pode ser editada.</p>';
    $("staff-expected-shifts").disabled = true;
    return;
  }
  $("staff-expected-shifts").disabled = false;
  if (!selectedStaffId) {
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
  const defaultSchedule = reference.schedules.find((x) => x.status === "draft") || reference.schedules[0];
  if (defaultSchedule) $("staff-schedule").value = defaultSchedule.id;
  // Novo cadastro inicia sem vínculo presumido; o responsável escolhe as combinações.
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
  if (active && !assignments.length) return notify("Selecione pelo menos uma unidade/turno para o profissional ativo.", "error");
  if (!schedule) return notify("Selecione uma competência mensal válida.", "error");
  if (active && schedule.status !== "draft") return notify("A competência selecionada não está em rascunho.", "error");
  const scheduleUnit = reference.units.find((x) => x.id === schedule.unit_id);
  const scheduleShift = reference.shifts.find((x) => x.id === schedule.shift_id);
  if (active && !assignments.some((a) => a.unit_code === scheduleUnit?.code && a.shift_code === scheduleShift?.code)) {
    return notify("Marque o vínculo correspondente à unidade e ao turno da competência selecionada.", "error");
  }
  // Cadastro inativo pode ser salvo sem gravar alterações em competência mensal.
  const scheduleToSave = active ? schedule : null;
  const expectedRaw = $("staff-expected-shifts").value;
  const expected = expectedRaw === "" ? null : Number(expectedRaw);
  if (expected !== null && (!Number.isInteger(expected) || expected < 0 || expected > 31)) {
    return notify("A meta mensal deve ser um número inteiro entre 0 e 31.", "error");
  }
  const markers = [...document.querySelectorAll("[data-day-marker]")]
    .map((input) => ({ work_date: input.dataset.dayMarker, marker: input.value }))
    .filter((item) => item.marker !== "");

  button.disabled = true;
  button.textContent = "Salvando...";
  notify("Gravando cadastro, vínculos e dados da competência...", "info");
  try {
    const { data, error } = await client.rpc("admin_save_staff_management", {
      p_staff_id: selectedStaffId || null,
      p_masp: masp,
      p_nome: nome,
      p_categoria: categoria,
      p_weekly_hours: weeklyHours === "" ? null : Number(weeklyHours),
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