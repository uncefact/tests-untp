export enum EPCISEventType {
  Transformation = 'transformation',
  Object = 'object',
  Aggregation = 'aggregation',
  Transaction = 'transaction',
  Association = 'association',
}

export enum EPCISEventAction {
  Observe = 'observe',
  Add = 'add',
  Delete = 'delete',
}

export enum EPCISEventDisposition {
  InTransit = 'in_transit',
}

export enum EPCISBusinessStepCode {
  Commissioning = 'commissioning',
  Inspecting = 'inspecting',
  Shipping = 'shipping',
  Packing = 'packing',
  Unpacking = 'unpacking',
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
