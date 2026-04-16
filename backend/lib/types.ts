export interface ReferenceImage {
  url: string;
  mediaType: string;
  name: string;
}

export interface RemixRequest {
  strippedHtml?: string;
  dataUriMap?: string[];
  snapshotBlobId?: string;
  dataUriMapBlobId?: string;
  prompt: string;
  count: number;
  snapshotName: string;
  model?: string;
  referenceImages?: ReferenceImage[];
  /** When true, the backend loads backend/bento/* and the agent is
   *  instructed to produce Bento-styled HTML. Defaults to false. */
  useBento?: boolean;
  /** When true, the agent is instructed to only modify elements within
   *  the user's selected focus areas. Defaults to false. */
  useFocusAreas?: boolean;
}

/** Bento reference material shipped into the sandbox when useBento=true. */
export interface BentoReference {
  tokensCss: string;
  componentsCss: string;
  referenceMd: string;
  safetyCss: string;
}

export interface StoreRequest {
  html: string;
  name?: string;
}

export interface StoreResponse {
  blobId: string;
  url: string;
}

export interface SSEEvent {
  event: 'progress' | 'variation-complete' | 'done' | 'error';
  data: Record<string, unknown>;
}

export interface PlanRequest {
  snapshotBlobUrl: string;
  prompt: string;
  snapshotName?: string;
  useBento?: boolean;
  useFocusAreas?: boolean;
  referenceImageCount?: number;
  variationCount?: number;
}

export interface PlanQuestion {
  id: string;
  question: string;
  suggestedAnswer?: string;
}

export interface PlanResponse {
  plan: string[];
  questions: PlanQuestion[];
}

export interface VariationResult {
  variationNumber: number;
  blobUrl: string;
  fileName: string;
  /** Present when useBento=true. Records which fallback path the worker
   *  used to inject Bento <style> blocks. */
  bentoInjection?: 'head-start' | 'head-end' | 'html-start' | 'doc-start';
}
