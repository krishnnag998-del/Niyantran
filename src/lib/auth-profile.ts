import type { Role } from "./types";

export type AuthProfile = {
  uid: string;
  name: string;
  email: string;
  phone: string;
  jobTitle: string;
  region: string;
  institutionAffiliation: string;
  role: Role;
};
