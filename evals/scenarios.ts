import { incidents, type Incident } from "../seed/incidents.js";

export interface Scenario {
  id: string;
  symptom: string;
  rubric: string;
  expectedRootCause: string;
  expectedTools: string[];
  expectedTables: string[];
}

export const scenarios: Scenario[] = incidents.map((i: Incident) => ({
  id: i.id,
  symptom: i.symptom,
  rubric: i.rubric,
  expectedRootCause: i.expectedRootCause,
  expectedTools: i.expectedTools,
  expectedTables: i.expectedTables,
}));
