export enum EPCISEventType {
  Transformation = 'transformation',
  Object = 'object',
  Aggregation = 'aggregation',
  Transaction = 'transaction',
  Association = 'association',
}

export enum EPCISEventAction {
  Observe = 'observe',
}

export enum EPCISEventDisposition {
  InTransit = 'in_transit',
}

export interface EPCISEvent {
  eventType: EPCISEventType;
  eventTime: string;
  actionCode: string;
  dispositionCode: string;
  readPointId: { id: string } | string;
  locationId: { id: string } | string;

  [key: string]: any;
}

export interface EPCIS {
  '@context': string[];
  type: string;
  schemaVersion: string;
  creationDate: string;
  epcisBody: {
    eventList: EPCISEvent[];
  };

  [key: string]: any;
}
