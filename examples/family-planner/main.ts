import { query, queryToObject, type TQuery } from "../../client.ts";
import { server } from "./server.ts";
import type { AllTypes } from "./types/graph.exposed.ts";

/**
 * This our query builder
 */
const q = query<AllTypes>();

/**
 * This is our client
 */
async function executeQuery<R>(query: TQuery<R>): Promise<R> {
  return await server(queryToObject(query));
}

// Now we can interact with the server

/**
 * Let's start by listing all the members
 */
const membersIds = await executeQuery(
  q.Graph.members.list(),
);
console.log("Member ids:\n", membersIds.map((m) => m.id)); // [] we don't have any members yet

/**
 * Let's add some members
 */
const homer = await executeQuery(q.Graph.members.create("Homer"));
console.log({ homerId: homer.id });
const marge = await executeQuery(q.Graph.members.create("Marge"));
console.log({ margeId: marge.id });
const bart = await executeQuery(q.Graph.members.create("Bart"));
console.log({ bartId: bart.id });
const lisa = await executeQuery(q.Graph.members.create("Lisa"));
console.log({ lisaId: lisa.id });
const maggie = await executeQuery(q.Graph.members.create("Maggie"));
console.log({ maggieId: maggie.id });

/**
 * Let's list the members again
 */
const members = await executeQuery(q.Graph.members.list());
console.log("Members:\n", members.map((m) => ({ id: m.id, name: m.name })));

/**
 * Let's add some events before we continue
 */
const createdEvents = await executeQuery(
  q.Graph.events.createMany([
    // Monday
    { memberId: bart.id, title: "School", day: "Monday" },
    { memberId: lisa.id, title: "School", day: "Monday" },
    { memberId: homer.id, title: "Work", day: "Monday" },
    { memberId: marge.id, title: "Work", day: "Monday" },
    { memberId: lisa.id, title: "Read books", day: "Monday" },
    { memberId: marge.id, title: "Grocery shopping", day: "Monday" },

    // Tuesday
    { memberId: bart.id, title: "School", day: "Tuesday" },
    { memberId: lisa.id, title: "School", day: "Tuesday" },
    { memberId: homer.id, title: "Work", day: "Tuesday" },
    { memberId: marge.id, title: "Work", day: "Tuesday" },
    { memberId: homer.id, title: "Eat donuts", day: "Tuesday" },

    // Wednesday
    { memberId: bart.id, title: "School", day: "Wednesday" },
    { memberId: lisa.id, title: "School", day: "Wednesday" },
    { memberId: homer.id, title: "Work", day: "Wednesday" },
    { memberId: marge.id, title: "Work", day: "Wednesday" },
    { memberId: marge.id, title: "Buy more donuts", day: "Wednesday" },

    // Thursday
    { memberId: bart.id, title: "School", day: "Thursday" },
    { memberId: lisa.id, title: "School", day: "Thursday" },
    { memberId: homer.id, title: "Work", day: "Thursday" },
    { memberId: marge.id, title: "Work", day: "Thursday" },
    { memberId: bart.id, title: "Skateboarding", day: "Thursday" },

    // Friday
    { memberId: bart.id, title: "School", day: "Friday" },
    { memberId: lisa.id, title: "School", day: "Friday" },
    { memberId: homer.id, title: "Work", day: "Friday" },
    { memberId: marge.id, title: "Work", day: "Friday" },
    // Movie night
    { memberId: homer.id, title: "Watch a movie", day: "Friday" },
    { memberId: marge.id, title: "Watch a movie", day: "Friday" },
    { memberId: bart.id, title: "Watch a movie", day: "Friday" },
    { memberId: lisa.id, title: "Watch a movie", day: "Friday" },
  ]),
);
console.log("Created events ids:", createdEvents.map((e) => e.id));

/**
 * Let's list the events!
 * The list events function uses some filters as well as pagination
 */
const events = await executeQuery(
  q.Graph.events.list({}, { pageSize: 5, page: 1 }),
);
console.log("Events:\n", {
  total: events.total,
  data: events.data.map((e) => ({
    id: e.id,
    title: e.title,
    day: e.day,
    memberName: e.member.name,
  })),
});

/**
 * We can extract the events query to a function to make it reusable
 */
function listEvents(page: number) {
  return q.Graph.events.list({}, { pageSize: 5, page });
}

const page1 = await executeQuery(listEvents(1));
console.log("Page 1:\n", {
  total: page1.total,
  data: page1.data.map((e) => ({ id: e.id, title: e.title, day: e.day })),
});

const page2 = await executeQuery(listEvents(2));
console.log("Page 2:\n", {
  total: page2.total,
  data: page2.data.map((e) => ({ id: e.id, title: e.title, day: e.day })),
});
