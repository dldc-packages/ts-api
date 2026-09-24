import { fn } from "../../server.ts";
import * as db from "./database.ts";
import { graph } from "./graph.ts";
import type { Event, Member } from "./schema.ts";

const membersListResolver = fn(
  graph.Graph.members.list,
  () => {
    const members = db.listMembers();
    return members.map((member) => enrichMember(member));
  },
);

const createMemberResolver = fn(
  graph.Graph.members.create,
  (_ctx, [name]) => {
    const member = db.createMember(name);
    return enrichMember(member);
  },
);

const listEventsResolver = fn(
  graph.Graph.events.list,
  (_ctx, [params = {}, pageConfig = {}]) => {
    const { page = 1, pageSize = 5 } = pageConfig;
    const events = db.listEvents(params);
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return {
      total: events.length,
      data: events.slice(startIndex, endIndex).map((event) =>
        enrichEvent(event)
      ),
    };
  },
);

const createManyEventsResolver = fn(
  graph.Graph.events.createMany,
  (_ctx, [events]) => {
    const createdEvents = events.map(({ title, day, memberId }) =>
      db.createEvent(title, day, memberId)
    );
    return createdEvents.map((event) => enrichEvent(event));
  },
);

function enrichMember(member: db.DbMember): Member {
  return {
    id: member.id,
    name: member.name,
  };
}

function enrichEvent(event: db.DbEvent): Event {
  const memberData = db.getMember(event.memberId);
  return {
    id: event.id,
    title: event.title,
    day: event.day,
    member: memberData ? enrichMember(memberData) : { id: "", name: "" },
  };
}

export const resolvers = [
  membersListResolver,
  createMemberResolver,
  listEventsResolver,
  createManyEventsResolver,
];
