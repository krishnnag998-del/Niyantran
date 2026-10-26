import { createContext, useContext } from "react";

export type Params = Record<string, string>;
export type Nav = { page: string; params: Params; go: (page: string, params?: Params) => void };

export const NavContext = createContext<Nav>({ page: "Dashboard", params: {}, go: () => {} });
export const useNav = () => useContext(NavContext);
