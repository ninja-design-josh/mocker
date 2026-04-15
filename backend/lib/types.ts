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
}

/** Bento reference material shipped into the sandbox when useBento=true. */
export interface BentoReference {
  tokensCss: string;
  componentsCss: string;
  referenceMd: string;
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

export interface VariationResult {
  variationNumber: number;
  blobUrl: string;
  fileName: string;
}
