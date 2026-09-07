export interface Member {
  id: string;
  name: string;
  nameUpper: string;
  family: Family;
  emails: string[];
}

export interface Family {
  id: string;
  name: string;
}

export interface Graph {
  member: () => Member;
  members: () => Member[];
  family: () => Family;
  families: () => Family[];
}
