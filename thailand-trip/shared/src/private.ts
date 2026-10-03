// Server-side only: merges the git-ignored hotels and flights into the itinerary.
// Never import this from the app, or the private file ends up in the public bundle.
import type { TripPrivate } from "./types";
import { publicTrip, withPrivate } from "./itinerary";
import tripPrivate from "./trip-private.json";

export const tripPrivateData = tripPrivate as TripPrivate;
export const trip = withPrivate(publicTrip, tripPrivateData);
