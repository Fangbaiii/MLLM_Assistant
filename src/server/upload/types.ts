export type PaddleLayoutBlock = {
  block_label?: string;
  block_content?: string;
  block_bbox?: [number, number, number, number];
  block_id?: number;
  block_order?: number | null;
};

export type PaddleLayoutResult = {
  markdown?: {
    text?: string;
  };
  prunedResult?: {
    page_count?: number | null;
    width?: number;
    height?: number;
    parsing_res_list?: PaddleLayoutBlock[];
  };
};

export type PaddleApiResponse = {
  errorCode?: number;
  errorMsg?: string;
  result?: {
    layoutParsingResults?: PaddleLayoutResult[];
  };
};
