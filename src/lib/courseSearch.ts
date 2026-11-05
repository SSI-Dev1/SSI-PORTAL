// Advanced Course Search: request and response shapes, and the backend calls. All matching happens
// in the database (public.search_courses); the browser only ever holds one page of results.
import { createContext, useContext } from 'react';
import { supabase } from '../auth/auth';

export interface ExamFilter {
  score?: string;
  band?: string;
}
export const EXAMS = ['IELTS', 'PTE', 'TOEFL', 'DET', 'SAT', 'ACT', 'GRE', 'GMAT'] as const;
export type Exam = (typeof EXAMS)[number];

export interface SearchFilters {
  q: string;
  levels: string[];
  countries: string[];
  states: string[];
  universities: string[];
  campuses: string[];
  study_areas: string[];
  disciplines: string[];
  durations: string[];
  modes: string[];
  currencies: string[];
  app_fees: string[];
  backlogs: string[];
  intake_months: string[];
  intake_years: string[];
  intake_labels: string[];
  availability: string[];
  flags: string[];
  deadline_from: string;
  deadline_to: string;
  tuition_min: string;
  tuition_max: string;
  scholarship_min: string;
  academic: string;
  exams: Partial<Record<Exam, ExamFilter>>;
  include_inactive: boolean;
}

export const emptyFilters = (): SearchFilters => ({
  q: '', levels: [], countries: [], states: [], universities: [], campuses: [], study_areas: [], disciplines: [], durations: [], modes: [], currencies: [], app_fees: [], backlogs: [],
  intake_months: [], intake_years: [], intake_labels: [], availability: [], flags: [], deadline_from: '', deadline_to: '', tuition_min: '', tuition_max: '', scholarship_min: '', academic: '',
  exams: {}, include_inactive: false,
});

export interface SearchIntake {
  label: string;
  status: 'Available' | 'Upcoming';
  deadline: string | null;
}
export interface SearchRow {
  id: string;
  name: string;
  level: string;
  programLevel: string | null;
  field: string | null;
  disciplineArea: string | null;
  duration: string | null;
  campus: string | null;
  studyMode: string | null;
  active: boolean;
  tuition: number;
  currency: string;
  tuitionText: string | null;
  websiteUrl: string | null;
  scholarshipUrl: string | null;
  hasScholarship: boolean;
  scholarship: string | null;
  averageScholarship: string | null;
  applicationFee: string | null;
  feeWaiver: boolean | null;
  stem: boolean | null;
  ielts: number | null;
  ieltsBand: number | null;
  toefl: number | null;
  toeflBand: number | null;
  pte: number | null;
  pteBand: number | null;
  det: number | null;
  sat: number | null;
  act: number | null;
  gre: number | null;
  gmat: number | null;
  englishWaiver: string | null;
  university: { id: string; name: string; country: string; state: string | null; city: string | null; ranking: number | null };
  intakes: SearchIntake[];
}
export interface SearchResult {
  total: number;
  rows: SearchRow[];
}
export interface Facets {
  levels: string[];
  countries: string[];
  states: string[];
  universities: { id: string; name: string }[];
  campuses: string[];
  studyAreas: string[];
  disciplines: string[];
  durations: string[];
  modes: string[];
  currencies: { currency: string; min: number; max: number; scholarshipMax: number | null }[];
  appFees: string[];
  backlogs: string[];
  exams: Record<Exam, { count: number; bands: boolean }>;
  flags: Record<string, boolean>;
  intakeMonths: number[];
  intakeYears: number[];
  intakeLabels: string[];
}
export type SearchSort = 'name' | 'tuition_asc' | 'tuition_desc' | 'ranking';

const NUMBER = /^\d{1,12}(\.\d{1,4})?$/;
const SCORE = /^\d{1,5}(\.\d{1,2})?$/;

/**
 * The request sent to the server: empty values and incomplete numbers are left out. A fee range
 * only means something in one currency, so it applies to `currency` and is dropped without one.
 */
export function toPayload(f: SearchFilters, currency: string | null) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (Array.isArray(v) ? v.length : typeof v === 'string' ? v.trim() : false) out[k] = typeof v === 'string' ? v.trim() : v;
  }
  if (f.include_inactive) out.include_inactive = true;
  for (const k of ['tuition_min', 'tuition_max', 'scholarship_min'] as const) if (!currency || !NUMBER.test(f[k].trim())) delete out[k];
  if (currency && (out.tuition_min || out.tuition_max || out.scholarship_min) && !f.currencies.length) out.currencies = [currency];
  const exams: Record<string, ExamFilter> = {};
  for (const [e, v] of Object.entries(f.exams)) {
    const x: ExamFilter = {};
    if (v?.score && SCORE.test(v.score.trim())) x.score = v.score.trim();
    if (v?.band && SCORE.test(v.band.trim())) x.band = v.band.trim();
    exams[e] = x;
  }
  if (Object.keys(exams).length) out.exams = exams;
  return out;
}

export interface CourseSearchApi {
  search(filters: Record<string, unknown>, sort: SearchSort, limit: number, offset: number): Promise<SearchResult>;
  facets(filters: { countries: string[]; states: string[]; universities: string[]; study_areas: string[] }): Promise<Facets>;
}

const supabaseApi: CourseSearchApi = {
  async search(filters, sort, limit, offset) {
    const { data, error } = await supabase!.rpc('search_courses', { p_filters: filters, p_sort: sort, p_limit: limit, p_offset: offset });
    if (error) throw error;
    return data as SearchResult;
  },
  async facets(filters) {
    const { data, error } = await supabase!.rpc('course_search_facets', { p_filters: filters });
    if (error) throw error;
    return data as Facets;
  },
};

export const CourseSearchApiContext = createContext<CourseSearchApi>(supabaseApi);
export const useCourseSearchApi = () => useContext(CourseSearchApiContext);
