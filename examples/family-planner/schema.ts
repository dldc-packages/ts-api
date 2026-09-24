/**
 * This Typescript file is used as the definition of the graph
 * Here we are defining the Graph for an application called Family Planner
 * We have a list of members and events, each event is linked to a member (a member can have multiple events)
 */

export type Weekday =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export interface Member {
  id: string;
  name: string;
}

export interface MembersNamespace {
  list: () => Member[];
  create: (name: string) => Member;
  rename: (id: string, name: string) => Member;
  remove: (id: string) => null;
}

export interface Event {
  id: string;
  title: string;
  day: Weekday;
  member: Member;
}

export interface ListEventsParams {
  search?: string;
  memberIds?: string[];
  weekdays?: Weekday[];
}

export interface EventNamespace {
  rename: (id: string, title: string) => Event;
  remove: (id: string) => null;
  transfer: (id: string, memberId: string) => Event;
}

export interface CreateMenyEventsParams {
  title: string;
  day: Weekday;
  memberId: string;
}

export interface PageConfig {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<ResultItem> {
  data: ResultItem[];
  total: number;
}

export interface EventsNamespace {
  list: (
    params?: ListEventsParams,
    page?: PageConfig,
  ) => PaginatedResult<Event>;
  create: (title: string, memberId: string) => Event;
  createMany: (events: CreateMenyEventsParams[]) => Event[];
  rename: (id: string, title: string) => Event;
  remove: (id: string) => null;
  transfer: (id: string, memberId: string) => Event;
}

export interface Graph {
  members: MembersNamespace;
  events: EventsNamespace;
}
