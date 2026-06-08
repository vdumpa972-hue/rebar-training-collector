export type Confidence = "High" | "Medium" | "Low";
export type ReviewStatus = "Collected" | "Reviewed" | "Approved" | "Rejected";

export type CropRef = {
  id: string;
  label: string;
  elementType: string;
  pageNumber: number;
  sourceNote: string;
  confidence: Confidence;
  imageDataUrl?: string;
  driveFileId?: string;
  driveWebViewLink?: string;
  createdAtIso: string;
};

export type FoundationSegment = {
  id: string;
  segmentName: string;
  lengthText: string;
  turnAngle: string;
  sourceNote: string;
  confidence: Confidence;
  /** Evidence for this row. Use "TEXT" when the value came from plan text/dimensions instead of a crop image. */
  sourceIds?: string[];
  cropId?: string;
};

export type PierItem = {
  id: string;
  pierName: string;
  diameter: string;
  height: string;
  centerX: string;
  centerY: string;
  rebarSpec: string;
  typical: boolean;
  sourceNote: string;
  confidence: Confidence;
  /** Evidence for this row. Use "TEXT" when the value came from plan text/dimensions instead of a crop image. */
  sourceIds?: string[];
  cropId?: string;
};

export type RebarItem = {
  id: string;
  section: "Footing" | "Stem Wall" | "Pier" | "General";
  itemName: string;
  layer: string;
  barSize: string;
  count: string;
  spacing: string;
  lap: string;
  cover: string;
  bendType: string;
  typical: boolean;
  sourceNote: string;
  confidence: Confidence;
  /** Evidence for this row. Use "TEXT" when the value came from plan text/dimensions instead of a crop image. */
  sourceIds?: string[];
  cropId?: string;
};

export type TrainingRecord = {
  id?: string;
  projectName: string;
  pdfFileName: string;
  pdfDriveFileId?: string;
  pdfDriveWebViewLink?: string;
  pageNumber: string;
  collectorName: string;
  reviewerName: string;
  approverName: string;
  foundationType: string;
  referenceDimension: string;
  referenceSourceNote: string;
  status: ReviewStatus;
  notes: string;
  crops: CropRef[];
  foundationSegments: FoundationSegment[];
  piers: PierItem[];
  rebarItems: RebarItem[];
  createdByUid?: string;
  createdByEmail?: string;
  createdAtIso?: string;
  updatedAtIso?: string;
};

export const confidenceOptions: Confidence[] = ["High", "Medium", "Low"];
export const statusOptions: ReviewStatus[] = ["Collected", "Reviewed", "Approved", "Rejected"];

export function newSegment(n: number): FoundationSegment {
  return { id: crypto.randomUUID(), segmentName: `S${n}`, lengthText: "", turnAngle: "90", sourceNote: "", confidence: "High", sourceIds: ["TEXT"] };
}

export function newPier(n: number): PierItem {
  return { id: crypto.randomUUID(), pierName: `P${n}`, diameter: "", height: "", centerX: "", centerY: "", rebarSpec: "", typical: true, sourceNote: "", confidence: "High", sourceIds: ["TEXT"] };
}

export function newRebar(section: RebarItem["section"] = "Footing"): RebarItem {
  return { id: crypto.randomUUID(), section, itemName: "", layer: "", barSize: "", count: "", spacing: "", lap: "", cover: "", bendType: "", typical: true, sourceNote: "", confidence: "High", sourceIds: ["TEXT"] };
}

export function emptyTrainingRecord(): TrainingRecord {
  return {
    projectName: "",
    pdfFileName: "",
    pageNumber: "",
    collectorName: "",
    reviewerName: "",
    approverName: "",
    foundationType: "Stem wall + footing",
    referenceDimension: "",
    referenceSourceNote: "",
    status: "Collected",
    notes: "",
    crops: [],
    foundationSegments: [newSegment(1), newSegment(2), newSegment(3), newSegment(4)],
    piers: [newPier(1)],
    rebarItems: [
      { ...newRebar("Footing"), itemName: "Longitudinal", layer: "Bottom" },
      { ...newRebar("Stem Wall"), itemName: "Horizontal", layer: "N/A" },
      { ...newRebar("Stem Wall"), itemName: "Vertical", layer: "N/A" }
    ]
  };
}
