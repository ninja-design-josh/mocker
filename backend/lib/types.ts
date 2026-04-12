export interface RemixRequest {
  strippedHtml?: string;
  dataUriMap?: string[];
  snapshotBlobId?: string;
  dataUriMapBlobId?: string;
  prompt: string;
  count: number;
  snapshotName: string;
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
