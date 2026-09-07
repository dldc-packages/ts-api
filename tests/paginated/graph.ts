export interface Stuff {
  data: string;
  num: number;
}

export interface PageConfig {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<ResultItem> {
  data: ResultItem[];
  total: number;
}

export interface Namespace {
  listStuff: (search?: string, page?: PageConfig) => PaginatedResult<Stuff>;
}

export interface Graph {
  sub: Namespace;
}
