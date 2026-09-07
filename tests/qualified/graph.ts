export interface Graph {
  birthday: () => Temporal.PlainDate;
  daysBetween: (from: Temporal.PlainDate, to: Temporal.PlainDate) => number;
}
