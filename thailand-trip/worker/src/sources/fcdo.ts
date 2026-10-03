// UK Foreign Office travel advice for Thailand, via the GOV.UK Content API. Free, no key.
import { getJson } from "./http";

interface Content {
  public_updated_at: string;
  description?: string;
  details?: { change_description?: string };
}

export const FCDO_PAGE = "https://www.gov.uk/foreign-travel-advice/thailand";

export async function fetchAdvisory(): Promise<{ updatedAt: string; description: string; url: string }> {
  const c = await getJson<Content>("https://www.gov.uk/api/content/foreign-travel-advice/thailand");
  return {
    updatedAt: c.public_updated_at,
    description: c.details?.change_description ?? c.description ?? "",
    url: FCDO_PAGE,
  };
}
