import type {
  CreateMenyEventsParams,
  Event,
  EventsNamespace,
  Graph,
  ListEventsParams,
  Member,
  MembersNamespace,
  PageConfig,
  PaginatedResult,
  Weekday,
} from "./graph.ts";

export interface AllTypes {
  Event: Event;
  EventsNamespace: EventsNamespace;
  Graph: Graph;
  ListEventsParams: ListEventsParams;
  Member: Member;
  MembersNamespace: MembersNamespace;
  PageConfig: PageConfig;
  PaginatedResult: PaginatedResult<unknown>;
  CreateMenyEventsParams: CreateMenyEventsParams;
  Weekday: Weekday;
}
