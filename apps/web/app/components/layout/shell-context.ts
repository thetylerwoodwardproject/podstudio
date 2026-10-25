import { createContext, useContext } from "react";

// The studio shell knows the (single) show; screens read its slug from here
// rather than each loading it, e.g. for "View public page" links.
export const ShowSlugContext = createContext<string | null>(null);
export const useShowSlug = () => useContext(ShowSlugContext);
