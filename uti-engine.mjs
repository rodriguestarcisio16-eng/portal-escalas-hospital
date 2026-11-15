export function simulateUtiPreview({
  staff = [],
  linkedStaffIds = [],
  availability = [],
  targets = [],
  posts = [],
  rules = [],
  staging = [],
  competence = "2026-12-01",
}) {
  const linked = new Set(linkedStaffIds);
  const staffById = new Map(staff.map(person => [person.id, person]));
  const targetById = new Map(targets.map(target => [target.staff_id, target]));
  const rulesById = new Map();
  for (const rule of rules) {
    if (!rulesById.has(rule.staff_id)) rulesById.set(rule.staff_id, []);
    rulesById.get(rule.staff_id).push(rule);
  }
  const rulesFor = id => rulesById.get(id) || [];
  const start = String(competence).slice(0, 10);
  const [year, month] = start.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const postList = [...posts].sort((a, b) => Number(a.sequence ?? 9999) - Number(b.sequence ?? 9999));
  const issues = [];
  if (postList.length !== 26) issues.push(`A estrutura da UTI possui ${postList.length} posto(s) ativo(s); eram esperados 26. Conferir a estrutura antes da aprovação.`);
  const unresolved = staging.filter(row => !["matched", "not_applicable"].includes(row.resolution_status));
  if (unresolved.length) issues.push(`${unresolved.length} regra(s) nominativa(s) ainda precisam de conferência. A prévia será gerada sem presumir a resolução.`);

  const byDay = new Map();
  for (const row of availability) {
    const date = String(row.work_date).slice(0, 10);
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push(row);
  }

  const allocationCounts = new Map();
  const days = [];
  const normalized = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const isFortyHour = person => Number(person.weekly_hours) === 40 ||
    Number(targetById.get(person.id)?.weekly_hours_snapshot) === 40 ||
    Number(targetById.get(person.id)?.source_weekly_hours_raw) === 40;

  const allowedForPost = (person, post) => {
    const personRules = rulesFor(person.id);
    if (personRules.some(rule => rule.rule_code === "UNIT_ONLY" && rule.rule_value !== "UTI_ADULTO")) return false;
    const onlyCodes = personRules.filter(rule => rule.rule_code === "ONLY_POST_CODE");
    if (onlyCodes.length && !onlyCodes.some(rule => rule.rule_value === post.code)) return false;
    const onlyTypes = personRules.filter(rule => rule.rule_code === "ONLY_POST_TYPE");
    if (onlyTypes.length && !onlyTypes.some(rule => rule.rule_value === post.post_type)) return false;
    if (personRules.some(rule => rule.rule_code === "FORBID_POST_CODE" && rule.rule_value === post.code)) return false;
    if (personRules.some(rule => rule.rule_code === "FORBID_POST_TYPE" && rule.rule_value === post.post_type)) return false;
    return true;
  };
  const requiresManualRotation = person => {
    const personRules = rulesFor(person.id);
    return isFortyHour(person) &&
      !personRules.some(rule => rule.rule_code === "ONLY_POST_CODE" || rule.rule_code === "PRIORITY_POST_CODE");
  };
  const targetRemaining = id => {
    const target = targetById.get(id);
    if (!target || target.expected_shifts == null) return 0;
    return Math.max(0, Number(target.expected_shifts) - (allocationCounts.get(id) || 0));
  };
  const hasPairRule = person => rulesFor(person.id).some(rule =>
    rule.pair_group != null || rule.pair_side != null || rule.day_scope != null
  );

  for (let dayNo = 1; dayNo <= daysInMonth; dayNo++) {
    const date = `${start.slice(0, 7)}-${String(dayNo).padStart(2, "0")}`;
    const rows = byDay.get(date) || [];
    const rowByStaff = new Map();
    const duplicateIds = new Set();
    const review = [];
    const rem = [];
    const dayNotes = [];
    for (const row of rows) {
      if (!row.staff_id) {
        const marker = String(row.original_marker ?? "").trim().toUpperCase();
        if (marker || row.availability_status === "review" || row.availability_status === "pending") {
          review.push({ marker: marker || "SEM IDENTIFICAÇÃO", staff_id: null, source_row: row.source_row ?? null });
        }
        continue;
      }
      if (rowByStaff.has(row.staff_id)) duplicateIds.add(row.staff_id);
      rowByStaff.set(row.staff_id, row);
      const marker = String(row.original_marker ?? "").trim().toUpperCase();
      const person = staffById.get(row.staff_id) ?? null;
      if (marker === "REM") rem.push({ staff_id: row.staff_id, nome: person?.nome ?? "Profissional não localizado", masp: person?.masp ?? null });
      if (marker === "TP" || marker === "REV" || row.availability_status === "review" ||
          (marker === "X" && row.availability_status === "pending")) {
        review.push({ marker, staff_id: row.staff_id, nome: person?.nome ?? "Profissional não localizado", source_row: row.source_row ?? null });
      }
    }
    if (duplicateIds.size) dayNotes.push(`${duplicateIds.size} profissional(is) com mais de uma marcação no dia; conferir antes da aprovação.`);

    const eligible = staff.filter(person => {
      const row = rowByStaff.get(person.id);
      return linked.has(person.id) && person.active !== false && row &&
        String(row.original_marker ?? "").trim().toUpperCase() === "X" &&
        row.availability_status === "available" &&
        !duplicateIds.has(person.id);
    });
    const assignedIds = new Set();
    const assignments = [];

    const assign = (post, person, method) => {
      assignments.push({
        post_code: post.code,
        post_name: post.name,
        post_type: post.post_type,
        staff_id: person?.id ?? null,
        nome: person?.nome ?? null,
        masp: person?.masp ?? null,
        assignment_method: method,
      });
      if (person) {
        assignedIds.add(person.id);
        allocationCounts.set(person.id, (allocationCounts.get(person.id) || 0) + 1);
      }
    };

    const autoPosts = postList.filter(post => post.manual_only !== true && post.post_type === "bed");
    const manualPosts = postList.filter(post => post.manual_only === true || post.post_type !== "bed");
    if (manualPosts.length) dayNotes.push(`${manualPosts.length} posto(s) de apoio/serviço ou configurado(s) para lançamento manual foram preservados para decisão do responsável.`);
    const orderedCandidates = eligible.filter(person =>
      targetRemaining(person.id) > 0 &&
      !hasPairRule(person) &&
      !requiresManualRotation(person)
    );
    const heldForReview = eligible.filter(person =>
      hasPairRule(person) || requiresManualRotation(person) || targetRemaining(person.id) <= 0
    );
    if (heldForReview.some(person => requiresManualRotation(person))) {
      dayNotes.push("Profissionais de 40h sem vínculo inequívoco de continuidade do rodízio foram preservados para conferência manual.");
    }
    if (heldForReview.some(person => hasPairRule(person))) {
      dayNotes.push("Há regras de bloco/par que exigem conferência manual; o motor não presumiu a combinação.");
    }

    // Regras de posto explicitamente nominativas têm precedência sobre a distribuição geral.
    const priorityRules = rules.filter(rule =>
      rule.rule_code === "PRIORITY_POST_CODE" && (!rule.unit_code || rule.unit_code === "UTI_ADULTO")
    ).sort((a, b) => Number(a.priority_rank ?? 9999) - Number(b.priority_rank ?? 9999));
    for (const post of autoPosts) {
      const prioritized = priorityRules
        .filter(rule => rule.rule_value === post.code)
        .map(rule => staffById.get(rule.staff_id))
        .filter(Boolean)
        .find(person => orderedCandidates.some(candidate => candidate.id === person.id) &&
          !assignedIds.has(person.id) && targetRemaining(person.id) > 0 && allowedForPost(person, post));
      if (prioritized) assign(post, prioritized, "priority_rule");
    }

    // Pessoas com posto exclusivo explícito são alocadas antes dos candidatos gerais.
    for (const person of orderedCandidates) {
      if (assignedIds.has(person.id)) continue;
      const onlyCodes = rulesFor(person.id).filter(rule => rule.rule_code === "ONLY_POST_CODE");
      if (onlyCodes.length !== 1) continue;
      const post = autoPosts.find(item => item.code === onlyCodes[0].rule_value && !assignments.some(a => a.post_code === item.code));
      if (post && allowedForPost(person, post)) assign(post, person, "exclusive_post_rule");
    }

    const remainingPeople = orderedCandidates.filter(person => !assignedIds.has(person.id));
    remainingPeople.sort((a, b) => {
      const aMust = rulesFor(a.id).some(rule => rule.rule_code === "MUST_ASSIGN");
      const bMust = rulesFor(b.id).some(rule => rule.rule_code === "MUST_ASSIGN");
      if (aMust !== bMust) return aMust ? -1 : 1;
      const aOptions = autoPosts.filter(post => !assignments.some(x => x.post_code === post.code) && allowedForPost(a, post)).length;
      const bOptions = autoPosts.filter(post => !assignments.some(x => x.post_code === post.code) && allowedForPost(b, post)).length;
      if (aOptions !== bOptions) return aOptions - bOptions;
      const ar = (allocationCounts.get(a.id) || 0) / Math.max(1, Number(targetById.get(a.id)?.expected_shifts) || 1);
      const br = (allocationCounts.get(b.id) || 0) / Math.max(1, Number(targetById.get(b.id)?.expected_shifts) || 1);
      if (ar !== br) return ar - br;
      return normalized(a.nome).localeCompare(normalized(b.nome));
    });
    for (const post of autoPosts) {
      if (assignments.some(item => item.post_code === post.code)) continue;
      const person = remainingPeople.find(candidate =>
        !assignedIds.has(candidate.id) && targetRemaining(candidate.id) > 0 && allowedForPost(candidate, post)
      );
      assign(post, person ?? null, "balanced_candidate");
    }
    assignments.sort((a, b) => Number(postList.find(p => p.code === a.post_code)?.sequence ?? 9999) - Number(postList.find(p => p.code === b.post_code)?.sequence ?? 9999));
    for (const post of manualPosts) {
      assignments.push({
        post_code: post.code, post_name: post.name, post_type: post.post_type,
        staff_id: null, nome: null, masp: null, assignment_method: "manual_only",
      });
    }
    const unfilled = assignments.filter(item => !item.staff_id);
    if (unfilled.length) dayNotes.push(`${unfilled.length} posto(s) sem indicação automática; encaminhados para revisão manual.`);
    const mandatoryMissed = eligible.filter(person =>
      rulesFor(person.id).some(rule => rule.rule_code === "MUST_ASSIGN") && !assignedIds.has(person.id)
    );
    if (mandatoryMissed.length) {
      dayNotes.push(`${mandatoryMissed.length} profissional(is) com alocação obrigatória não foram indicados automaticamente; conferir restrições, meta e quantidade de postos.`);
    }
    const extras = eligible.filter(person => !assignedIds.has(person.id) &&
      !heldForReview.some(x => x.id === person.id) && !mandatoryMissed.some(x => x.id === person.id))
      .map(person => ({ staff_id: person.id, nome: person.nome, masp: person.masp }));
    const manualCandidates = [
      ...heldForReview.map(person => ({
        staff_id: person.id, nome: person.nome, masp: person.masp,
        reason: requiresManualRotation(person) ? "Continuidade do rodízio de 40h" :
          hasPairRule(person) ? "Regra de bloco/par" : "Meta mensal atingida ou ausente",
      })),
      ...mandatoryMissed.filter(person => !heldForReview.some(x => x.id === person.id)).map(person => ({
        staff_id: person.id, nome: person.nome, masp: person.masp,
        reason: "Alocação obrigatória não resolvida automaticamente",
      }))
    ];
    days.push({
      work_date: date,
      assignments,
      filled: assignments.filter(item => item.staff_id).length,
      vacant: unfilled.length,
      extras,
      rem,
      review,
      manual_candidates: manualCandidates,
      notes: dayNotes,
    });
  }

  const staffRoster = staff.filter(person => linked.has(person.id)).map(person => ({
    staff_id: person.id, nome: person.nome, masp: person.masp, categoria: person.categoria,
    expected_shifts: targetById.get(person.id)?.expected_shifts ?? null,
  }));
  return {
    days,
    globalIssues: issues,
    staffRoster,
    availabilitySnapshot: availability.map(row => ({
      work_date: String(row.work_date).slice(0, 10),
      staff_id: row.staff_id ?? null,
      marker: String(row.original_marker ?? "").trim().toUpperCase(),
      status: row.availability_status,
    })),
    algorithm: "UTI_PREVIEW_V1",
  };
}
