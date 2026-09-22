export type PageBundle = {
  pageNo: number;
  text: string;
  /** Absolute path to page image on disk */
  imagePath: string;
  /** Relative storage_path under COSTING_DATA_DIR */
  imageStoragePath: string;
  textStoragePath?: string;
};

export type PreprocessOptions = {
  projectId: string;
  sourceStoragePath: string;
  contentType: string;
  fileName: string;
};
