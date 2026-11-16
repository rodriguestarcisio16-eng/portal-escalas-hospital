-- Fluxo seguro de revisão, aprovação e publicação de propostas USI/UTI.
-- Permite acumular mais de um leito por profissional no mesmo plantão.
-- Executar no Supabase SQL Editor após as migrações anteriores.

BEGIN;

-- A unicidade por profissional/data impedia a cobertura de dois ou mais leitos.
-- A unicidade por posto/data permanece ativa.
ALTER TABLE public.assignments
  DROP CONSTRAINT IF EXISTS assignments_schedule_id_work_date_staff_id_key;

CREATE OR REPLACE FUNCTION public.admin_save_schedule_proposal(
  p_schedule_id UUID,
  p_proposal_data JSONB,
  p_metrics JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_unit_id UUID;
  v_shift_id UUID;
  v_competence DATE;
  v_schedule_status TEXT;
  v_unit_code TEXT;
  v_shift_code TEXT;
  v_days INTEGER;
  v_expected_days INTEGER;
  v_version INTEGER;
  v_proposal_id UUID;
  v_day JSONB;
  v_assignment JSONB;
  v_work_date DATE;
  v_post_id UUID;
  v_post_type TEXT;
  v_staff_id UUID;
  v_staff_count INTEGER;
  v_expected_shifts INTEGER;
  v_count INTEGER;
  v_material JSONB;
  v_expected_posts INTEGER;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_uid
      AND p.role = 'superadmin'
      AND p.active IS TRUE
      AND p.must_change_password IS FALSE
  ) THEN
    RAISE EXCEPTION 'Acesso restrito à superadmin.';
  END IF;

  SELECT ms.unit_id, ms.shift_id, ms.competence, ms.status, u.code, sh.code
    INTO v_unit_id, v_shift_id, v_competence, v_schedule_status, v_unit_code, v_shift_code
  FROM public.monthly_schedules ms
  JOIN public.units u ON u.id = ms.unit_id
  JOIN public.shifts sh ON sh.id = ms.shift_id
  WHERE ms.id = p_schedule_id
  FOR UPDATE OF ms;

  IF v_unit_id IS NULL THEN
    RAISE EXCEPTION 'Escala mensal não encontrada.';
  END IF;
  IF v_schedule_status <> 'draft' THEN
    RAISE EXCEPTION 'Somente uma competência em rascunho pode receber proposta.';
  END IF;
  IF v_unit_code NOT IN ('USI_ADULTO','UTI_ADULTO') THEN
    RAISE EXCEPTION 'Unidade não habilitada para salvar propostas.';
  END IF;
  IF COALESCE(p_proposal_data->>'unit_code','') IS DISTINCT FROM v_unit_code
     OR COALESCE(p_proposal_data->>'shift_code','') IS DISTINCT FROM v_shift_code THEN
    RAISE EXCEPTION 'A unidade ou o turno informado no conteúdo da proposta não corresponde à escala selecionada.';
  END IF;
  IF v_unit_code = 'USI_ADULTO' THEN
    v_expected_posts := 11;
    SELECT COUNT(*) INTO v_count
    FROM public.care_posts cp
    WHERE cp.unit_id = v_unit_id
      AND cp.active IS TRUE
      AND cp.post_type = 'bed'
      AND COALESCE(cp.manual_only,FALSE) IS FALSE;
    IF v_count <> 11 THEN
      RAISE EXCEPTION 'A USI precisa ter exatamente 11 postos de leito ativos; foram encontrados %.', v_count;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.care_posts cp
      WHERE cp.unit_id = v_unit_id
        AND cp.code = 'USI-CIRC-MAT'
        AND cp.active IS TRUE
    ) THEN
      RAISE EXCEPTION 'O posto combinado USI-CIRC-MAT não está cadastrado como ativo.';
    END IF;
  ELSE
    v_expected_posts := 26;
    SELECT COUNT(*) INTO v_count FROM public.care_posts cp
    WHERE cp.unit_id = v_unit_id AND cp.active IS TRUE;
    IF v_count <> 26 THEN
      RAISE EXCEPTION 'A UTI precisa ter exatamente 26 postos ativos; foram encontrados %.', v_count;
    END IF;
    SELECT COUNT(*) INTO v_count FROM public.care_posts cp
    WHERE cp.unit_id = v_unit_id AND cp.active IS TRUE
      AND cp.post_type = 'bed' AND COALESCE(cp.manual_only,FALSE) IS FALSE;
    IF v_count <> 22 THEN
      RAISE EXCEPTION 'A UTI precisa ter 22 postos de assistência direta; foram encontrados %.', v_count;
    END IF;
    SELECT COUNT(*) INTO v_count FROM public.care_posts cp
    WHERE cp.unit_id = v_unit_id AND cp.active IS TRUE AND cp.post_type = 'support';
    IF v_count <> 2 THEN
      RAISE EXCEPTION 'A UTI precisa ter dois postos de apoio distintos; foram encontrados %.', v_count;
    END IF;
    SELECT COUNT(*) INTO v_count FROM public.care_posts cp
    WHERE cp.unit_id = v_unit_id AND cp.active IS TRUE AND cp.post_type = 'material';
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'A UTI precisa ter um posto de sala de material; foram encontrados %.', v_count;
    END IF;
    SELECT COUNT(*) INTO v_count FROM public.care_posts cp
    WHERE cp.unit_id = v_unit_id AND cp.active IS TRUE AND cp.post_type = 'circulation';
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'A UTI precisa ter um posto de circulante; foram encontrados %.', v_count;
    END IF;
  END IF;
  IF jsonb_typeof(p_proposal_data) <> 'object'
     OR jsonb_typeof(p_proposal_data->'days') <> 'array' THEN
    RAISE EXCEPTION 'Estrutura da proposta inválida: era esperado um objeto com a lista days.';
  END IF;
  IF jsonb_typeof(COALESCE(p_metrics, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Os indicadores da proposta devem ser um objeto JSON.';
  END IF;

  v_expected_days := EXTRACT(DAY FROM (date_trunc('month', v_competence)::date + INTERVAL '1 month - 1 day'))::INTEGER;
  v_days := jsonb_array_length(p_proposal_data->'days');
  IF v_days <> v_expected_days THEN
    RAISE EXCEPTION 'A proposta contém % dias; a competência exige % dias.', v_days, v_expected_days;
  END IF;

  -- Cada dia precisa conter todos os postos ativos previstos para a unidade.
  FOR v_day IN SELECT value FROM jsonb_array_elements(p_proposal_data->'days')
  LOOP
    IF COALESCE(v_day->>'work_date','') = '' THEN
      RAISE EXCEPTION 'Foi encontrado um dia sem data na proposta.';
    END IF;
    v_work_date := (v_day->>'work_date')::DATE;
    IF date_trunc('month', v_work_date)::DATE <> date_trunc('month', v_competence)::DATE THEN
      RAISE EXCEPTION 'A data % não pertence à competência selecionada.', v_work_date;
    END IF;
    IF jsonb_typeof(v_day->'assignments') <> 'array'
       OR jsonb_array_length(v_day->'assignments') <> v_expected_posts THEN
      RAISE EXCEPTION 'O dia % precisa conter exatamente % postos.', v_work_date, v_expected_posts;
    END IF;
    IF (
      SELECT COUNT(DISTINCT a.value->>'post_code')
      FROM jsonb_array_elements(v_day->'assignments') AS a(value)
    ) <> v_expected_posts THEN
      RAISE EXCEPTION 'Há códigos de posto ausentes ou repetidos em %.', v_work_date;
    END IF;

    FOR v_assignment IN SELECT value FROM jsonb_array_elements(v_day->'assignments')
    LOOP
      IF COALESCE(v_assignment->>'post_code','') = '' THEN
        RAISE EXCEPTION 'Posto sem código identificado em %.', v_work_date;
      END IF;
      SELECT cp.id, cp.post_type
        INTO v_post_id, v_post_type
      FROM public.care_posts cp
      WHERE cp.unit_id = v_unit_id
        AND cp.code = v_assignment->>'post_code'
        AND cp.active IS TRUE;
      IF v_post_id IS NULL
         OR (v_unit_code = 'USI_ADULTO' AND v_post_type <> 'bed')
         OR (v_unit_code = 'UTI_ADULTO' AND v_post_type NOT IN ('bed','support','material','circulation')) THEN
        RAISE EXCEPTION 'Posto % não existe, está inativo ou possui tipo incompatível com a unidade.', v_assignment->>'post_code';
      END IF;
      IF v_unit_code = 'UTI_ADULTO'
         AND v_post_type <> 'bed'
         AND NULLIF(v_assignment->>'staff_id','') IS NOT NULL
         AND COALESCE(v_assignment->>'assignment_method','') <> 'manual_override' THEN
        RAISE EXCEPTION 'Os postos de apoio, material e circulante da UTI só podem receber indicação manual.';
      END IF;

      IF NULLIF(v_assignment->>'staff_id','') IS NOT NULL THEN
        v_staff_id := (v_assignment->>'staff_id')::UUID;
        PERFORM 1 FROM public.staff st WHERE st.id = v_staff_id AND st.active IS TRUE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Um profissional da proposta não existe ou está inativo.';
        END IF;
        PERFORM 1 FROM public.staff_unit_assignments sua
        WHERE sua.staff_id = v_staff_id
          AND sua.unit_id = v_unit_id
          AND sua.shift_id = v_shift_id
          AND sua.active IS TRUE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Um profissional proposto não possui vínculo ativo com a USI e o turno selecionado.';
        END IF;
        PERFORM 1 FROM public.monthly_availability a
        WHERE a.schedule_id = p_schedule_id
          AND a.staff_id = v_staff_id
          AND a.work_date = v_work_date
          AND UPPER(BTRIM(COALESCE(a.original_marker,''))) = 'X'
          AND a.availability_status = 'available';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Um profissional proposto não possui X confirmado em %.', v_work_date;
        END IF;
        PERFORM 1 FROM public.monthly_staff_targets t
        WHERE t.schedule_id = p_schedule_id
          AND t.staff_id = v_staff_id
          AND t.expected_shifts IS NOT NULL;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Um profissional proposto não possui meta mensal cadastrada.';
        END IF;

        -- Impede REM e respeita as restrições individuais armazenadas no banco.
        IF EXISTS (
          SELECT 1 FROM public.staff_assignment_rules r
          WHERE r.staff_id = v_staff_id AND r.active IS TRUE
            AND (r.unit_code IS NULL OR r.unit_code = v_unit_code)
            AND (r.shift_code IS NULL OR r.shift_code = v_shift_code)
            AND (
              r.rule_code = 'REM'
              OR (r.rule_code = 'UNIT_ONLY' AND r.rule_value IS DISTINCT FROM v_unit_code)
              OR (r.rule_code = 'ONLY_POST_CODE' AND r.rule_value IS DISTINCT FROM (v_assignment->>'post_code'))
              OR (r.rule_code = 'ONLY_POST_TYPE' AND r.rule_value IS DISTINCT FROM v_post_type)
              OR (r.rule_code = 'FORBID_POST_CODE' AND r.rule_value = (v_assignment->>'post_code'))
              OR (r.rule_code = 'FORBID_POST_TYPE' AND r.rule_value = v_post_type)
            )
        ) THEN
          RAISE EXCEPTION 'A proposta viola uma restrição individual ou inclui profissional REM em %.', v_work_date;
        END IF;
      END IF;
    END LOOP;

    -- A mesma pessoa pode cobrir mais de um leito no mesmo dia.
    -- Não pode acumular posto não assistencial nem o posto combinado USI-CIRC-MAT.
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_day->'assignments') AS a(value)
      JOIN public.care_posts cp
        ON cp.unit_id = v_unit_id AND cp.code = a.value->>'post_code' AND cp.active IS TRUE
      WHERE NULLIF(a.value->>'staff_id','') IS NOT NULL
      GROUP BY a.value->>'staff_id'
      HAVING COUNT(*) > 1
         AND BOOL_OR(cp.post_type <> 'bed')
    ) THEN
      RAISE EXCEPTION 'Um profissional só pode acumular postos de assistência direta (leitos), não postos de apoio/serviço, em %.', v_work_date;
    END IF;

    IF v_unit_code = 'UTI_ADULTO' AND v_day ? 'material'
       AND v_day->'material' <> 'null'::jsonb THEN
      RAISE EXCEPTION 'Na UTI, apoio, sala de material e circulante devem constar na lista assignments, não no campo material separado.';
    END IF;
    IF v_unit_code = 'USI_ADULTO' THEN
    -- A circulação/material da USI é facultativa e exige a prioridade cadastrada.
    v_material := v_day->'material';
    IF v_material IS NOT NULL AND v_material <> 'null'::jsonb
       AND NULLIF(v_material->>'staff_id','') IS NOT NULL THEN
      v_staff_id := (v_material->>'staff_id')::UUID;
      IF v_material->>'post_code' <> 'USI-CIRC-MAT' THEN
        RAISE EXCEPTION 'O posto combinado da USI deve usar o código USI-CIRC-MAT.';
      END IF;
      SELECT cp.id, cp.post_type INTO v_post_id, v_post_type
      FROM public.care_posts cp
      WHERE cp.unit_id = v_unit_id AND cp.code = 'USI-CIRC-MAT' AND cp.active IS TRUE;
      IF v_post_id IS NULL THEN
        RAISE EXCEPTION 'Posto USI-CIRC-MAT não está cadastrado como ativo.';
      END IF;
      PERFORM 1 FROM public.staff st WHERE st.id = v_staff_id AND st.active IS TRUE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Profissional indicado para circulação/material está inativo.'; END IF;
      PERFORM 1 FROM public.staff_unit_assignments sua
      WHERE sua.staff_id = v_staff_id AND sua.unit_id = v_unit_id
        AND sua.shift_id = v_shift_id AND sua.active IS TRUE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Profissional de circulação/material não possui vínculo ativo na USI/turno.'; END IF;
      PERFORM 1 FROM public.monthly_availability a
      WHERE a.schedule_id = p_schedule_id AND a.staff_id = v_staff_id
        AND a.work_date = v_work_date
        AND UPPER(BTRIM(COALESCE(a.original_marker,''))) = 'X'
        AND a.availability_status = 'available';
      IF NOT FOUND THEN RAISE EXCEPTION 'Profissional de circulação/material não possui X confirmado em %.', v_work_date; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.staff_assignment_rules r
        WHERE r.staff_id = v_staff_id AND r.active IS TRUE
          AND r.rule_code = 'PRIORITY_POST_CODE'
          AND r.rule_value = 'USI-CIRC-MAT'
          AND (r.unit_code IS NULL OR r.unit_code = v_unit_code)
          AND (r.shift_code IS NULL OR r.shift_code = v_shift_code)
      ) THEN
        RAISE EXCEPTION 'Profissional indicado para circulação/material não consta da prioridade cadastrada.';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.staff_assignment_rules r
        WHERE r.staff_id = v_staff_id AND r.active IS TRUE
          AND (r.unit_code IS NULL OR r.unit_code = v_unit_code)
          AND (r.shift_code IS NULL OR r.shift_code = v_shift_code)
          AND (
            r.rule_code = 'REM'
            OR (r.rule_code = 'UNIT_ONLY' AND r.rule_value IS DISTINCT FROM v_unit_code)
            OR (r.rule_code = 'ONLY_POST_CODE' AND r.rule_value IS DISTINCT FROM 'USI-CIRC-MAT')
            OR (r.rule_code = 'ONLY_POST_TYPE' AND r.rule_value IS DISTINCT FROM v_post_type)
            OR (r.rule_code = 'FORBID_POST_CODE' AND r.rule_value = 'USI-CIRC-MAT')
            OR (r.rule_code = 'FORBID_POST_TYPE' AND r.rule_value = v_post_type)
          )
      ) THEN
        RAISE EXCEPTION 'Profissional indicado para circulação/material possui restrição incompatível.';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_day->'assignments') AS a(value)
        WHERE a.value->>'staff_id' = v_staff_id::TEXT
      ) THEN
        RAISE EXCEPTION 'Um profissional foi indicado simultaneamente em posto direto e circulação/material em %.', v_work_date;
      END IF;
    END IF;
    END IF;
  END LOOP;

  -- Todas as datas do mês devem aparecer uma única vez.
  IF (
    SELECT COUNT(DISTINCT d.value->>'work_date')
    FROM jsonb_array_elements(p_proposal_data->'days') AS d(value)
  ) <> v_expected_days THEN
    RAISE EXCEPTION 'A proposta contém datas repetidas ou ausentes.';
  END IF;

  -- Limite mensal de plantões: conta postos diretos e o posto combinado material/circulação.
  FOR v_staff_id IN
    SELECT DISTINCT staff_id FROM (
      SELECT NULLIF(a.value->>'staff_id','')::UUID AS staff_id
      FROM jsonb_array_elements(p_proposal_data->'days') AS d(value)
      CROSS JOIN LATERAL jsonb_array_elements(d.value->'assignments') AS a(value)
      UNION ALL
      SELECT NULLIF(d.value->'material'->>'staff_id','')::UUID AS staff_id
      FROM jsonb_array_elements(p_proposal_data->'days') AS d(value)
    ) assigned
    WHERE staff_id IS NOT NULL
  LOOP
    SELECT t.expected_shifts INTO v_expected_shifts
    FROM public.monthly_staff_targets t
    WHERE t.schedule_id = p_schedule_id AND t.staff_id = v_staff_id;

    -- Meta mensal conta plantões/dias trabalhados, não quantidade de leitos
    -- acumulados no mesmo plantão.
    SELECT COUNT(DISTINCT work_date) INTO v_staff_count
    FROM (
      SELECT d.value->>'work_date' AS work_date, a.value->>'staff_id' AS staff_id
      FROM jsonb_array_elements(p_proposal_data->'days') AS d(value)
      CROSS JOIN LATERAL jsonb_array_elements(d.value->'assignments') AS a(value)
      UNION ALL
      SELECT d.value->>'work_date' AS work_date, d.value->'material'->>'staff_id' AS staff_id
      FROM jsonb_array_elements(p_proposal_data->'days') AS d(value)
    ) assigned
    WHERE assigned.staff_id = v_staff_id::TEXT;

    IF v_expected_shifts IS NULL OR v_staff_count > v_expected_shifts THEN
      RAISE EXCEPTION 'A proposta excede a meta mensal do profissional % (% de %).', v_staff_id, v_staff_count, COALESCE(v_expected_shifts,0);
    END IF;
  END LOOP;

  -- Serializa a numeração das versões por escala.
  SELECT COALESCE(MAX(sp.proposal_version),0) + 1
    INTO v_version
  FROM public.schedule_proposals sp
  WHERE sp.schedule_id = p_schedule_id;

  INSERT INTO public.schedule_proposals (
    schedule_id, proposal_version, status, proposal_data, metrics, created_by
  ) VALUES (
    p_schedule_id, v_version, 'pending_review', p_proposal_data,
    COALESCE(p_metrics,'{}'::jsonb), v_uid
  ) RETURNING id INTO v_proposal_id;

  INSERT INTO public.audit_logs (
    unit_id, schedule_id, actor_id, action, entity_table, entity_id, before_data, after_data
  ) VALUES (
    v_unit_id, p_schedule_id, v_uid,
    'SCHEDULE_PROPOSAL_SAVED', 'schedule_proposals', v_proposal_id,
    NULL,
    jsonb_build_object(
      'proposal_version', v_version,
      'status', 'pending_review',
      'metrics', COALESCE(p_metrics,'{}'::jsonb),
      'saved_for_review_only', TRUE
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'proposal_id', v_proposal_id,
    'proposal_version', v_version,
    'status', 'pending_review'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_schedule_proposal(UUID, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_schedule_proposal(UUID, JSONB, JSONB) TO authenticated;


-- Aprovação é uma etapa distinta da publicação.
CREATE OR REPLACE FUNCTION public.admin_approve_schedule_proposal(
  p_proposal_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_schedule_id UUID;
  v_unit_id UUID;
  v_status TEXT;
  v_version INTEGER;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_uid AND p.role = 'superadmin'
      AND p.active IS TRUE AND p.must_change_password IS FALSE
  ) THEN
    RAISE EXCEPTION 'Acesso restrito à superadmin.';
  END IF;

  SELECT sp.schedule_id, sp.status, sp.proposal_version, ms.unit_id
    INTO v_schedule_id, v_status, v_version, v_unit_id
  FROM public.schedule_proposals sp
  JOIN public.monthly_schedules ms ON ms.id = sp.schedule_id
  WHERE sp.id = p_proposal_id
  FOR UPDATE OF sp, ms;

  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION 'Proposta não encontrada.';
  END IF;
  IF v_status <> 'pending_review' THEN
    RAISE EXCEPTION 'Somente propostas aguardando revisão podem ser aprovadas.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.monthly_schedules ms
    WHERE ms.id = v_schedule_id AND ms.status = 'published'
  ) THEN
    RAISE EXCEPTION 'A escala já está publicada.';
  END IF;

  UPDATE public.schedule_proposals
  SET status = 'approved', reviewed_by = v_uid
  WHERE id = p_proposal_id;

  INSERT INTO public.audit_logs (
    unit_id, schedule_id, actor_id, action, entity_table, entity_id, before_data, after_data
  ) VALUES (
    v_unit_id, v_schedule_id, v_uid, 'SCHEDULE_PROPOSAL_APPROVED',
    'schedule_proposals', p_proposal_id,
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', 'approved', 'proposal_version', v_version)
  );

  RETURN jsonb_build_object(
    'success', TRUE, 'proposal_id', p_proposal_id,
    'proposal_version', v_version, 'status', 'approved'
  );
END;
$$;

-- Publica apenas a proposta aprovada mais recente.
-- Se houver posto obrigatório descoberto, retorna a lista sem gravar nada.
CREATE OR REPLACE FUNCTION public.admin_publish_schedule_proposal(
  p_proposal_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_schedule_id UUID;
  v_unit_id UUID;
  v_shift_id UUID;
  v_competence DATE;
  v_schedule_status TEXT;
  v_unit_code TEXT;
  v_proposal_status TEXT;
  v_proposal_version INTEGER;
  v_latest_version INTEGER;
  v_data JSONB;
  v_day JSONB;
  v_assignment JSONB;
  v_work_date DATE;
  v_post_id UUID;
  v_staff_id UUID;
  v_post_type TEXT;
  v_uncovered JSONB := '[]'::jsonb;
  v_before JSONB;
  v_inserted INTEGER := 0;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_uid AND p.role = 'superadmin'
      AND p.active IS TRUE AND p.must_change_password IS FALSE
  ) THEN
    RAISE EXCEPTION 'Acesso restrito à superadmin.';
  END IF;

  SELECT sp.schedule_id, sp.status, sp.proposal_version, sp.proposal_data,
         ms.unit_id, ms.shift_id, ms.competence, ms.status, u.code
    INTO v_schedule_id, v_proposal_status, v_proposal_version, v_data,
         v_unit_id, v_shift_id, v_competence, v_schedule_status, v_unit_code
  FROM public.schedule_proposals sp
  JOIN public.monthly_schedules ms ON ms.id = sp.schedule_id
  JOIN public.units u ON u.id = ms.unit_id
  WHERE sp.id = p_proposal_id
  FOR UPDATE OF sp, ms;

  IF v_schedule_id IS NULL THEN
    RAISE EXCEPTION 'Proposta não encontrada.';
  END IF;
  IF v_proposal_status <> 'approved' THEN
    RAISE EXCEPTION 'A proposta precisa estar aprovada antes da publicação.';
  END IF;
  IF v_schedule_status = 'published' THEN
    RAISE EXCEPTION 'Esta escala já está publicada.';
  END IF;
  IF v_unit_code NOT IN ('USI_ADULTO','UTI_ADULTO') THEN
    RAISE EXCEPTION 'Unidade não habilitada para publicação por este fluxo.';
  END IF;

  SELECT MAX(sp.proposal_version) INTO v_latest_version
  FROM public.schedule_proposals sp
  WHERE sp.schedule_id = v_schedule_id;
  IF v_proposal_version <> v_latest_version THEN
    RAISE EXCEPTION 'Esta não é a versão mais recente. Aprove e publique a última proposta salva.';
  END IF;

  -- Identifica todas as lacunas obrigatórias antes de qualquer alteração operacional.
  FOR v_day IN SELECT value FROM jsonb_array_elements(v_data->'days')
  LOOP
    v_work_date := (v_day->>'work_date')::date;
    FOR v_assignment IN SELECT value FROM jsonb_array_elements(v_day->'assignments')
    LOOP
      SELECT cp.post_type INTO v_post_type
      FROM public.care_posts cp
      WHERE cp.unit_id = v_unit_id
        AND cp.code = v_assignment->>'post_code'
        AND cp.active IS TRUE;

      IF NULLIF(v_assignment->>'staff_id','') IS NULL
         AND (v_unit_code = 'UTI_ADULTO' OR v_post_type IS NULL OR v_post_type = 'bed') THEN
        v_uncovered := v_uncovered || jsonb_build_array(jsonb_build_object(
          'work_date', v_work_date,
          'post_code', v_assignment->>'post_code',
          'post_name', COALESCE(v_assignment->>'post_name', v_assignment->>'post_code')
        ));
      END IF;
    END LOOP;
  END LOOP;

  IF jsonb_array_length(v_uncovered) > 0 THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'blocked', TRUE,
      'message', 'Existem postos obrigatórios descobertos. Atribua um profissional a cada posto antes de publicar.',
      'uncovered_count', jsonb_array_length(v_uncovered),
      'uncovered', v_uncovered
    );
  END IF;

  -- Revalida disponibilidade e vínculo imediatamente antes de publicar.
  FOR v_day IN SELECT value FROM jsonb_array_elements(v_data->'days')
  LOOP
    v_work_date := (v_day->>'work_date')::date;
    FOR v_assignment IN SELECT value FROM jsonb_array_elements(v_day->'assignments')
    LOOP
      IF NULLIF(v_assignment->>'staff_id','') IS NULL THEN
        CONTINUE;
      END IF;
      v_staff_id := (v_assignment->>'staff_id')::uuid;
      SELECT cp.id, cp.post_type INTO v_post_id, v_post_type
      FROM public.care_posts cp
      WHERE cp.unit_id = v_unit_id AND cp.code = v_assignment->>'post_code'
        AND cp.active IS TRUE;
      IF v_post_id IS NULL THEN
        RAISE EXCEPTION 'O posto % não existe ou está inativo.', v_assignment->>'post_code';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.staff st WHERE st.id = v_staff_id AND st.active IS TRUE) THEN
        RAISE EXCEPTION 'Um profissional da proposta está inativo.';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.staff_unit_assignments sua
        WHERE sua.staff_id = v_staff_id AND sua.unit_id = v_unit_id
          AND sua.shift_id = v_shift_id AND sua.active IS TRUE
      ) THEN
        RAISE EXCEPTION 'Um profissional não possui vínculo ativo com a unidade e o turno.';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.monthly_availability a
        WHERE a.schedule_id = v_schedule_id AND a.staff_id = v_staff_id
          AND a.work_date = v_work_date
          AND UPPER(BTRIM(COALESCE(a.original_marker,''))) = 'X'
          AND a.availability_status = 'available'
      ) THEN
        RAISE EXCEPTION 'Um profissional não possui X confirmado em %.', v_work_date;
      END IF;
    END LOOP;

    IF v_unit_code = 'USI_ADULTO'
       AND NULLIF(v_day->'material'->>'staff_id','') IS NOT NULL THEN
      v_staff_id := (v_day->'material'->>'staff_id')::uuid;
      IF NOT EXISTS (
        SELECT 1 FROM public.staff st WHERE st.id = v_staff_id AND st.active IS TRUE
      ) OR NOT EXISTS (
        SELECT 1 FROM public.staff_unit_assignments sua
        WHERE sua.staff_id = v_staff_id AND sua.unit_id = v_unit_id
          AND sua.shift_id = v_shift_id AND sua.active IS TRUE
      ) OR NOT EXISTS (
        SELECT 1 FROM public.monthly_availability a
        WHERE a.schedule_id = v_schedule_id AND a.staff_id = v_staff_id
          AND a.work_date = v_work_date
          AND UPPER(BTRIM(COALESCE(a.original_marker,''))) = 'X'
          AND a.availability_status = 'available'
      ) THEN
        RAISE EXCEPTION 'A indicação de circulação/material da USI não possui profissional ativo, vínculo e X confirmado.';
      END IF;
    END IF;
  END LOOP;

  SELECT jsonb_build_object('status', ms.status, 'published_at', ms.published_at,
                            'approved_by', ms.approved_by)
    INTO v_before
  FROM public.monthly_schedules ms WHERE ms.id = v_schedule_id;

  DELETE FROM public.assignments WHERE schedule_id = v_schedule_id;

  FOR v_day IN SELECT value FROM jsonb_array_elements(v_data->'days')
  LOOP
    v_work_date := (v_day->>'work_date')::date;
    FOR v_assignment IN SELECT value FROM jsonb_array_elements(v_day->'assignments')
    LOOP
      IF NULLIF(v_assignment->>'staff_id','') IS NULL THEN
        CONTINUE;
      END IF;
      SELECT cp.id INTO v_post_id
      FROM public.care_posts cp
      WHERE cp.unit_id = v_unit_id AND cp.code = v_assignment->>'post_code'
        AND cp.active IS TRUE;
      INSERT INTO public.assignments (
        schedule_id, work_date, care_post_id, staff_id, created_by
      ) VALUES (
        v_schedule_id, v_work_date, v_post_id,
        (v_assignment->>'staff_id')::uuid, v_uid
      );
      v_inserted := v_inserted + 1;
    END LOOP;

    IF v_unit_code = 'USI_ADULTO'
       AND NULLIF(v_day->'material'->>'staff_id','') IS NOT NULL THEN
      SELECT cp.id INTO v_post_id
      FROM public.care_posts cp
      WHERE cp.unit_id = v_unit_id AND cp.code = 'USI-CIRC-MAT'
        AND cp.active IS TRUE;
      INSERT INTO public.assignments (
        schedule_id, work_date, care_post_id, staff_id, created_by
      ) VALUES (
        v_schedule_id, v_work_date, v_post_id,
        (v_day->'material'->>'staff_id')::uuid, v_uid
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  UPDATE public.monthly_schedules
  SET status = 'published', approved_by = v_uid, published_at = now()
  WHERE id = v_schedule_id;

  INSERT INTO public.audit_logs (
    unit_id, schedule_id, actor_id, action, entity_table, entity_id, before_data, after_data
  ) VALUES (
    v_unit_id, v_schedule_id, v_uid, 'SCHEDULE_PUBLISHED',
    'monthly_schedules', v_schedule_id, v_before,
    jsonb_build_object(
      'status', 'published', 'proposal_id', p_proposal_id,
      'proposal_version', v_proposal_version, 'assignments_inserted', v_inserted
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE, 'published', TRUE,
    'schedule_id', v_schedule_id, 'proposal_id', p_proposal_id,
    'proposal_version', v_proposal_version, 'assignments_inserted', v_inserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_approve_schedule_proposal(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_publish_schedule_proposal(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_approve_schedule_proposal(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_publish_schedule_proposal(UUID) TO authenticated;

COMMIT;

-- Verificação das funções instaladas.
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'admin_save_schedule_proposal';
