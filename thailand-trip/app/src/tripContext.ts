import { createContext, useContext } from "react";
import { publicTrip, type Trip } from "@trip/shared";

/** The itinerary plus hotels and flights, once the worker has sent them (see api.loadPrivate). */
export const TripContext = createContext<Trip>(publicTrip);
export const useTrip = () => useContext(TripContext);
