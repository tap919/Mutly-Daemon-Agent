import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "mutly-daemon",
  eventKey: process.env.INNGEST_EVENT_KEY,
  retry: {
    default: { maxAttempts: 3, minTimeout: 1000, maxTimeout: 30000 },
  },
});
