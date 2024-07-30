---
sidebar_position: 16
title: Json Form
---

import Disclaimer from '../.././\_disclaimer.mdx';

<Disclaimer />

## Description

The JsonForm component renders a dynamic form based on a provided JSON schema. It allows for flexible form creation and data entry, supporting various field types and structures defined in the schema. The component can be initialised with default data and customised with CSS classes and styles. It also supports advanced features like data construction rules and external schema references, making it suitable for complex form scenarios.

## Definitions

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| name | Yes | The name of the component (should be "JsonForm") | String |
| type | Yes | The type of the component (should be "EntryData") | [ComponentType](/docs/mock-apps/common/component-type) |
| props | Yes | The properties for the JsonForm component | [Props](/docs/mock-apps/components/json-form#props) |

## Props

| Property | Required | Description | Type |
|----------|----------|-------------|------|
| schema | Yes | The JSON schema that defines the structure of the form | Object or `{ url: string }` |
| constructData | No | Defines the schema for constructing event data, including field mappings, default values, and data generation rules. | [ConstructData](/docs/mock-apps/common/construct-data) |
| data | No | The initial data for the form | Object |
| className | No | CSS class name for styling the form | String |
| style | No | CSS styles to apply to the form | Object |

## Example

```json
{
    "name": "JsonForm",
    "type": "EntryData",
    "props": {
        "schema": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "sourceParty": {
                "$ref": "#/$defs/Party",
                "description": "The source party for this supply chain transaction - typically the seller party"
                },
                "destinationParty": {
                "$ref": "#/$defs/Party",
                "description": "The destination party for this supply chain transaction - typically the buyer party."
                },
                "epcList": {
                "type": "array",
                "items": { "$ref": "#/$defs/Item" },
                "description": "The list of uniquely identified trade items included in this supply chain transaction."
                },
                "quantityList": {
                "type": "array",
                "items": { "$ref": "#/$defs/QuantityElement" },
                "description": "List of quantified product classes that are included in this transaction.  Used when the trade items do not have unique identifiers (eg 100 reels of yarn)"
                },
                "referenceDocument": {
                "$ref": "#/$defs/TradeDocument",
                "description": "The supply chain document reference for this transaction event - eg the invoice, order, or dispatch advice"
                },
                "eventID": {
                "x-jargon-isKey": true,
                "readOnly": true,
                "type": "string",
                "description": "The unique identifier of this event - SHOULD be a UUID"
                },
                "eventTime": {
                "type": "string",
                "format": "date-time",
                "description": "The ISO-8601 date time when the event occurred."
                },
                "action": {
                "type": "string",
                "enum": ["observe", "add", "delete"],
                "example": "observe",
                "description": "Code describing how an event relates to the lifecycle of the entity impacted by the event."
                },
                "disposition": {
                "type": "string",
                "x-external-enumeration": "https://ref.gs1.org/cbv/Disp",
                "description": "Disposition code describing the state of the item after the event. \n\n    This is an enumerated value, but the list of valid values are too big, or change too often to include here. You can access the list of allowable values at this URL:  https://ref.gs1.org/cbv/Disp\n    "
                },
                "bizStep": {
                "type": "string",
                "x-external-enumeration": "https://ref.gs1.org/cbv/BizStep",
                "description": "A business step code drawn from a controlled vocabulary. \n\n    This is an enumerated value, but the list of valid values are too big, or change too often to include here. You can access the list of allowable values at this URL:  https://ref.gs1.org/cbv/BizStep\n    "
                },
                "bizLocation": {
                "type": "string",
                "format": "uri",
                "description": "A Business Location is a uniquely identified and discretely recorded geospatial location that is meant to designate the specific place where an object is assumed to be following an EPCIS event until it is reported to be at a different Business Location by a subsequent EPCIS event. The bizLocation must be a resolvable URI that links to facility information and geolocation data."
                },
                "sensorElementList": {
                "type": "array",
                "items": { "$ref": "#/$defs/SensorElement" },
                "description": "An array (one for each sensor) of sensor device data sets associated with the event. "
                }
            },
            "description": "Transaction represents an event in which one or more objects become associated or disassociated with one or more identified business transactions - such as the purchase / shipment of goods between buyer and seller.",
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$defs": {
                "TransactionEvent": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "sourceParty": {
                    "$ref": "#/$defs/Party",
                    "description": "The source party for this supply chain transaction - typically the seller party"
                    },
                    "destinationParty": {
                    "$ref": "#/$defs/Party",
                    "description": "The destination party for this supply chain transaction - typically the buyer party."
                    },
                    "epcList": {
                    "type": "array",
                    "items": { "$ref": "#/$defs/Item" },
                    "description": "The list of uniquely identified trade items included in this supply chain transaction."
                    },
                    "quantityList": {
                    "type": "array",
                    "items": { "$ref": "#/$defs/QuantityElement" },
                    "description": "List of quantified product classes that are included in this transaction.  Used when the trade items do not have unique identifiers (eg 100 reels of yarn)"
                    },
                    "referenceDocument": {
                    "$ref": "#/$defs/TradeDocument",
                    "description": "The supply chain document reference for this transaction event - eg the invoice, order, or dispatch advice"
                    },
                    "eventID": {
                    "x-jargon-isKey": true,
                    "readOnly": true,
                    "type": "string",
                    "description": "The unique identifier of this event - SHOULD be a UUID"
                    },
                    "eventTime": {
                    "type": "string",
                    "format": "date-time",
                    "description": "The ISO-8601 date time when the event occurred."
                    },
                    "action": {
                    "type": "string",
                    "enum": ["observe", "add", "delete"],
                    "example": "observe",
                    "description": "Code describing how an event relates to the lifecycle of the entity impacted by the event."
                    },
                    "disposition": {
                    "type": "string",
                    "x-external-enumeration": "https://ref.gs1.org/cbv/Disp",
                    "description": "Disposition code describing the state of the item after the event. \n\n    This is an enumerated value, but the list of valid values are too big, or change too often to include here. You can access the list of allowable values at this URL:  https://ref.gs1.org/cbv/Disp\n    "
                    },
                    "bizStep": {
                    "type": "string",
                    "x-external-enumeration": "https://ref.gs1.org/cbv/BizStep",
                    "description": "A business step code drawn from a controlled vocabulary. \n\n    This is an enumerated value, but the list of valid values are too big, or change too often to include here. You can access the list of allowable values at this URL:  https://ref.gs1.org/cbv/BizStep\n    "
                    },
                    "bizLocation": {
                    "type": "string",
                    "format": "uri",
                    "description": "A Business Location is a uniquely identified and discretely recorded geospatial location that is meant to designate the specific place where an object is assumed to be following an EPCIS event until it is reported to be at a different Business Location by a subsequent EPCIS event. The bizLocation must be a resolvable URI that links to facility information and geolocation data."
                    },
                    "sensorElementList": {
                    "type": "array",
                    "items": { "$ref": "#/$defs/SensorElement" },
                    "description": "An array (one for each sensor) of sensor device data sets associated with the event. "
                    }
                },
                "description": "Transaction represents an event in which one or more objects become associated or disassociated with one or more identified business transactions - such as the purchase / shipment of goods between buyer and seller."
                },
                "Party": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "id": {
                    "type": "string",
                    "description": "The decentralised identifier of the party - must be a W3C DID."
                    },
                    "name": {
                    "type": "string",
                    "description": "The name of the organization or company, represented as a text string."
                    },
                    "identifiers": {
                    "type": "array",
                    "items": { "$ref": "#/$defs/Identifier" },
                    "description": "A list of unique business identifiers assigned to the party - such as tax registration numbers."
                    }
                },
                "description": "The Party class represents an entity such as an organization, or a company that manufactured the product."
                },
                "Identifier": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "scheme": {
                    "type": "string",
                    "format": "uri",
                    "description": "the identifier scheme as defined by the registrar that manages the identifier registry. If the identifier scheme is registered with UNTP then this URI can use used to dicsover the resolution method (to get more data) and the verification method (to prove ownership)."
                    },
                    "identifierValue": {
                    "type": "string",
                    "description": "The value of the identifier within the scheme"
                    },
                    "binding": {
                    "$ref": "#/$defs/Evidence",
                    "description": "Link to evidence that attests to the validity and ownership of the identifer. "
                    }
                },
                "description": "An identifier of a party, product, or facility that is defined by an identifier scheme and idenfier value and, optinally, verification evidence "
                },
                "Evidence": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "type": {
                    "type": "string",
                    "enum": ["w3c_vc", "iso_mdl", "document", "website", "other"],
                    "example": "w3c_vc",
                    "description": "Format of the evidence (verifiable credential, document, website, etc)"
                    },
                    "assuranceLevel": {
                    "type": "string",
                    "enum": ["Self", "Commercial", "Buyer", "Membership", "Unspecified", "3rdParty"],
                    "example": "Self",
                    "description": "The assurance level of the evidence (self declaration, 2nd party, 3rd party, accredited auditor)"
                    },
                    "reference": {
                    "type": "string",
                    "format": "uri",
                    "description": "The URL at which the evidence data can be found.  "
                    }
                },
                "description": "Evidence to support a conformity or identity claim. "
                },
                "Item": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "itemID": {
                    "x-jargon-isKey": true,
                    "type": "string",
                    "format": "uri",
                    "description": "The globally unique identifier (eg GS1 GTIN or digital link) of the product item.  "
                    },
                    "name": {
                    "type": "string",
                    "description": "The name of the product class to which the product item belongs.  "
                    }
                },
                "description": "A specific trade item /product code which could be either a product serial number or a consignment identifier "
                },
                "QuantityElement": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "epcClass": {
                    "type": "string",
                    "format": "uri",
                    "description": "THe identifier of a product class (as opposed to a product instance) such as a GTIN code for a manufactured product."
                    },
                    "quantity": {
                    "type": "number",
                    "description": "The numeric quantity of the product class (eg 100 kg of cotton)"
                    },
                    "uom": {
                    "type": "string",
                    "x-external-enumeration": "https://vocabulary.uncefact.org/UnitMeasureCode",
                    "description": "The unit of measure for the quantity value (eg Kg or meters etc) using the UNECE Rec 20 unit of measure codelist.\n\n    This is an enumerated value, but the list of valid values are too big, or change too often to include here. You can access the list of allowable values at this URL:  https://vocabulary.uncefact.org/UnitMeasureCode\n    "
                    }
                },
                "description": "The quantity element is used to define the quantities (eg 100), units of measure (eg Kg) and product class (eg GTIN or other class identifier) of products that are inputs or outputs or the subject of supply chain events.  ",
                "required": ["quantity"]
                },
                "TradeDocument": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "type": {
                    "type": "string",
                    "x-external-enumeration": "https://ref.gs1.org/cbv/BTT",
                    "description": "The document type representing the trade transaction drawn from the business transaction type vocabulary.\n\n    This is an enumerated value, but the list of valid values are too big, or change too often to include here. You can access the list of allowable values at this URL:  https://ref.gs1.org/cbv/BTT\n    "
                    },
                    "identifier": {
                    "type": "string",
                    "description": "The identifier of the trade transaction document - eg an invoice number or bill of lading number.  Must be unique for a given source party"
                    },
                    "documentURL": {
                    "type": "string",
                    "format": "uri",
                    "description": "The URL of the referenced trade document. For integrity reasons, it is recommended (but not required) that the documentURL is a hashlink (https://w3c-ccg.github.io/hashlink/) so that if the document the URL is changed then the hash verification will fail."
                    }
                },
                "description": "A trade transaction between two parties such as an invoice, purchase order, or shipping notification."
                },
                "SensorElement": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "sensorMetadata": {
                    "$ref": "#/$defs/Sensor",
                    "description": "Data that describes the physical sensor that recorded the sensor data set."
                    },
                    "sensorReport": {
                    "type": "array",
                    "items": { "$ref": "#/$defs/SensorData" },
                    "description": "A list of sensor readings from the given sensor relevant to the traceability event context."
                    },
                    "sensorIntegrityProof": {
                    "type": "string",
                    "format": "uri",
                    "description": "An optional reference to a verifiable credential signed by the sensor device or device manufacturer that contains the digitally signed raw data associated with this sensor report."
                    }
                },
                "description": "A SensorElement is used to carry data related to an event that is captured one sensor such as an IoT device. Include one sensor property and an array of sensor data values."
                },
                "Sensor": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "device": {
                    "$ref": "#/$defs/Item",
                    "description": "The device Identifier for the sensor as a URI (typically an EPC)"
                    },
                    "dataProcessingMethod": {
                    "type": "string",
                    "format": "uri",
                    "description": "The data processing method used by the sensor - should reference a documented standard criteria as a URI"
                    }
                },
                "description": "A physical sensor that records a sensor data set."
                },
                "SensorData": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "time": {
                    "type": "string",
                    "format": "date-time",
                    "description": "the timestamp at which the sensor reading was made."
                    },
                    "type": {
                    "type": "string",
                    "format": "uri",
                    "description": "the measurement type of the sensor reading, as a URI reference to a measurement method specification."
                    },
                    "value": { "type": "number", "description": "the sensor reading" },
                    "uom": {
                    "type": "string",
                    "x-external-enumeration": "https://vocabulary.uncefact.org/UnitMeasureCode",
                    "description": "the unit of measure for the sensor reading\n\n    This is an enumerated value, but the list of valid values are too big, or change too often to include here. You can access the list of allowable values at this URL:  https://vocabulary.uncefact.org/UnitMeasureCode\n    "
                    }
                },
                "description": "A data point read by a sensor."
                }
            }
        }
    },
    "constructData": {
        "mappingFields": [
        {
            "sourcePath": "/vc/credentialSubject/productIdentifier/0/identifierValue",
            "destinationPath": "/eventID"
        },
        {
            "sourcePath": "/vc/credentialSubject/productIdentifier/0/identifierValue",
            "destinationPath": "/epcList/index/name"
        },
        {
            "sourcePath": "/linkResolver",
            "destinationPath": "/epcList/index/itemID"
        }
        ],
        "dummyFields": [
        {
            "path": "/action",
            "data": "observe"
        },
        {
            "path": "/disposition",
            "data": "https://ref.gs1.org/cbv/Disp/in_transit"
        },
        {
            "path": "/bizStep",
            "data": "https://ref.gs1.org/cbv/BizStep/receiving"
        },
        {
            "path": "/bizLocation",
            "data": "https://example.com/warehouse"
        },
        {
            "path": "/sourceParty",
            "data": {
            "id": "did:web:example.com",
            "name": "Steel Mill 1",
            "identifiers": [
                {
                "scheme": "https://example.com/scheme/source",
                "identifierValue": "SRC123456",
                "binding": {
                    "type": "w3c_vc",
                    "assuranceLevel": "3rdParty",
                    "reference": "https://example.com/source_evidence"
                }
                }
            ]
            }
        },
        {
            "path": "/destinationParty",
            "data": {
            "id": "did:web:example.com",
            "name": "Steel Processor",
            "identifiers": [
                {
                "scheme": "https://example.com/scheme/destination",
                "identifierValue": "DST7891011",
                "binding": {
                    "type": "w3c_vc",
                    "assuranceLevel": "3rdParty",
                    "reference": "https://example.com/destination_evidence"
                }
                }
            ]
            }
        }
        ],
        "generationFields": [
        {
            "path": "/eventID",
            "handler": "generateIdWithSerialNumber"
        },
        {
            "path": "/eventTime",
            "handler": "generateCurrentDatetime"
        }
        ]
    }
}
```
