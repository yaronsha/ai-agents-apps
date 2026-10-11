import type { TripState } from "@trip/shared";

/** What the screens know about the server's latest check. Lives here, not in App.tsx, so screens don't import App. */
export interface Live {
  state: TripState | null;
  offline: boolean;
  /** The server answered, but its data is old (the cron may have stopped). */
  stale?: boolean;
  error?: string;
  loading: boolean;
}
