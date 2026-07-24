export type IncomingEvent = {
  eventId: string;
  eventType: string;
  aggregateId: string;
  payload: {
    filmId?: number;
    storeId?: number;
  };
};
