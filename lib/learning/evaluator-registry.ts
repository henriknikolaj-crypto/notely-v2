export type LearningSourceType = "trainer" | "simulator" | "oral";

export type EvaluatorDefinition = {
  id: string;
  source_type: LearningSourceType;
  subject_family: string;
  task_type: string;
  assessment_mode: string;
  label: string;
};

export type ResolveEvaluatorDefinitionOptions = {
  subject_family?: string | null;
  task_type?: string | null;
  assessment_mode?: string | null;
};

const DEFAULT_EVALUATOR_REGISTRY: Record<LearningSourceType, EvaluatorDefinition> = {
  trainer: {
    id: "trainer.generic.formative.free_response.v1",
    source_type: "trainer",
    subject_family: "generic",
    task_type: "free_response",
    assessment_mode: "formative",
    label: "Trainer frit-svar",
  },
  simulator: {
    id: "simulator.generic.summative.written_exam.v1",
    source_type: "simulator",
    subject_family: "generic",
    task_type: "written_exam",
    assessment_mode: "summative",
    label: "Skriftlig simulator",
  },
  oral: {
    id: "oral.generic.summative.oral_exam.v1",
    source_type: "oral",
    subject_family: "generic",
    task_type: "oral_exam",
    assessment_mode: "summative",
    label: "Mundtlig evaluering",
  },
};

const SPECIALIZED_EVALUATORS: EvaluatorDefinition[] = [
  {
    id: "trainer.samfund.trainer.samfund_redegoer_analyser.v1",
    source_type: "trainer",
    subject_family: "samfund",
    task_type: "samfund_redegoer_analyser",
    assessment_mode: "trainer",
    label: "Samfund: redegør og analyser",
  },
  {
    id: "trainer.samfund.trainer.samfund_vurder_losning.v1",
    source_type: "trainer",
    subject_family: "samfund",
    task_type: "samfund_vurder_losning",
    assessment_mode: "trainer",
    label: "Samfund: vurder løsning",
  },
  {
    id: "trainer.samfund.trainer.samfund_diskuter_konsekvenser.v1",
    source_type: "trainer",
    subject_family: "samfund",
    task_type: "samfund_diskuter_konsekvenser",
    assessment_mode: "trainer",
    label: "Samfund: diskuter konsekvenser",
  },
  {
    id: "trainer.dansk.trainer.dansk_fortolk_tekst.v1",
    source_type: "trainer",
    subject_family: "dansk",
    task_type: "dansk_fortolk_tekst",
    assessment_mode: "trainer",
    label: "Dansk: fortolk tekst",
  },
  {
    id: "trainer.dansk.trainer.dansk_analyser_virkemidler.v1",
    source_type: "trainer",
    subject_family: "dansk",
    task_type: "dansk_analyser_virkemidler",
    assessment_mode: "trainer",
    label: "Dansk: analyser virkemidler",
  },
  {
    id: "trainer.dansk.trainer.dansk_fortolk_og_dokumenter.v1",
    source_type: "trainer",
    subject_family: "dansk",
    task_type: "dansk_fortolk_og_dokumenter",
    assessment_mode: "trainer",
    label: "Dansk: fortolk og dokumenter",
  },
  {
    id: "trainer.matematik.trainer.matematik_beregn_og_vis_metode.v1",
    source_type: "trainer",
    subject_family: "matematik",
    task_type: "matematik_beregn_og_vis_metode",
    assessment_mode: "trainer",
    label: "Matematik: beregn og vis metode",
  },
  {
    id: "trainer.matematik.trainer.matematik_fortolk_graf_eller_funktion.v1",
    source_type: "trainer",
    subject_family: "matematik",
    task_type: "matematik_fortolk_graf_eller_funktion",
    assessment_mode: "trainer",
    label: "Matematik: fortolk graf eller funktion",
  },
  {
    id: "trainer.matematik.trainer.matematik_begrund_eller_bevis.v1",
    source_type: "trainer",
    subject_family: "matematik",
    task_type: "matematik_begrund_eller_bevis",
    assessment_mode: "trainer",
    label: "Matematik: begrund eller bevis",
  },
  {
    id: "trainer.okonomi.trainer.okonomi_forklar_sammenhaeng.v1",
    source_type: "trainer",
    subject_family: "okonomi",
    task_type: "okonomi_forklar_sammenhaeng",
    assessment_mode: "trainer",
    label: "Økonomi: forklar sammenhæng",
  },
  {
    id: "trainer.okonomi.trainer.okonomi_vurder_case_eller_tiltag.v1",
    source_type: "trainer",
    subject_family: "okonomi",
    task_type: "okonomi_vurder_case_eller_tiltag",
    assessment_mode: "trainer",
    label: "Økonomi: vurder case eller tiltag",
  },
  {
    id: "trainer.okonomi.trainer.okonomi_beregn_og_fortolk.v1",
    source_type: "trainer",
    subject_family: "okonomi",
    task_type: "okonomi_beregn_og_fortolk",
    assessment_mode: "trainer",
    label: "Økonomi: beregn og fortolk",
  },
  {
    id: "trainer.history.trainer.history_kildeanalyse.v1",
    source_type: "trainer",
    subject_family: "history",
    task_type: "history_kildeanalyse",
    assessment_mode: "trainer",
    label: "Historie: kildeanalyse",
  },
  {
    id: "trainer.history.trainer.history_aarsag_virkning.v1",
    source_type: "trainer",
    subject_family: "history",
    task_type: "history_aarsag_virkning",
    assessment_mode: "trainer",
    label: "Historie: årsag og virkning",
  },
  {
    id: "trainer.history.trainer.history_sammenligning.v1",
    source_type: "trainer",
    subject_family: "history",
    task_type: "history_sammenligning",
    assessment_mode: "trainer",
    label: "Historie: sammenligning",
  },
  {
    id: "trainer.fysik.trainer.fysik_beregn_og_forklar.v1",
    source_type: "trainer",
    subject_family: "fysik",
    task_type: "fysik_beregn_og_forklar",
    assessment_mode: "trainer",
    label: "Fysik: beregn og forklar",
  },
  {
    id: "trainer.fysik.trainer.fysik_fortolk_resultat.v1",
    source_type: "trainer",
    subject_family: "fysik",
    task_type: "fysik_fortolk_resultat",
    assessment_mode: "trainer",
    label: "Fysik: fortolk resultat",
  },
  {
    id: "trainer.fysik.trainer.fysik_modellering_eller_antagelse.v1",
    source_type: "trainer",
    subject_family: "fysik",
    task_type: "fysik_modellering_eller_antagelse",
    assessment_mode: "trainer",
    label: "Fysik: modellering eller antagelse",
  },
];

export function resolveEvaluatorDefinition(
  sourceType: LearningSourceType,
  options?: ResolveEvaluatorDefinitionOptions,
): EvaluatorDefinition {
  const match = SPECIALIZED_EVALUATORS.find((candidate) => {
    if (candidate.source_type !== sourceType) return false;
    if (options?.subject_family && candidate.subject_family !== options.subject_family) return false;
    if (options?.task_type && candidate.task_type !== options.task_type) return false;
    if (options?.assessment_mode && candidate.assessment_mode !== options.assessment_mode) return false;
    return true;
  });

  return match ?? DEFAULT_EVALUATOR_REGISTRY[sourceType];
}

export function listEvaluatorDefinitions(): EvaluatorDefinition[] {
  return [...Object.values(DEFAULT_EVALUATOR_REGISTRY), ...SPECIALIZED_EVALUATORS];
}
