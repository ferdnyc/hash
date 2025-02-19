import {
  type OntologyElementMetadata as OntologyElementMetadataBp,
  DataTypeWithMetadata as DataTypeWithMetadataBp,
  EntityTypeWithMetadata as EntityTypeWithMetadataBp,
  PropertyTypeWithMetadata as PropertyTypeWithMetadataBp,
} from "@blockprotocol/graph/temporal";
import {
  DataType,
  EntityType,
  PropertyType,
  validateBaseUrl,
  VersionedUrl,
} from "@blockprotocol/type-system/slim";
import { Brand } from "@local/advanced-types/brand";
import { Subtype } from "@local/advanced-types/subtype";

import {
  BaseUrl,
  ExclusiveLimitedTemporalBound,
  InclusiveLimitedTemporalBound,
  OwnedById,
  ProvenanceMetadata,
  TimeInterval,
  Timestamp,
  Unbounded,
} from "../shared";

/**
 * The second component of the [{@link BaseUrl}, RevisionId] tuple needed to identify a specific ontology type vertex
 * within a {@link Subgraph}. This should be the version number as a string.
 */
export type OntologyTypeRevisionId = Brand<
  `${number}`,
  "OntologyTypeRevisionId"
>;

export type OntologyTypeRecordId = {
  baseUrl: BaseUrl;
  version: number;
};

export const ontologyTypeRecordIdToVersionedUrl = (
  ontologyTypeRecordId: OntologyTypeRecordId,
): VersionedUrl => {
  return `${ontologyTypeRecordId.baseUrl}v/${ontologyTypeRecordId.version}`;
};

export const isOntologyTypeRecordId = (
  editionId: object,
): editionId is OntologyTypeRecordId => {
  return (
    "baseId" in editionId &&
    typeof editionId.baseId === "string" &&
    validateBaseUrl(editionId.baseId).type !== "Err" &&
    "version" in editionId &&
    typeof editionId.version === "number" &&
    Number.isInteger(editionId.version)
  );
};

/** @todo-0.3 - Consider redefining `EntityType` and `PropertyType` to use the branded `BaseUrl`s inside them */

export type OwnedOntologyElementMetadata = {
  recordId: OntologyTypeRecordId;
  custom: {
    ownedById: OwnedById;
    provenance: ProvenanceMetadata;
    temporalVersioning: {
      transactionTime: TimeInterval<
        InclusiveLimitedTemporalBound,
        ExclusiveLimitedTemporalBound | Unbounded
      >;
    };
  };
};

export type ExternalOntologyElementMetadata = {
  recordId: OntologyTypeRecordId;
  custom: {
    fetchedAt: Timestamp;
    provenance: ProvenanceMetadata;
    temporalVersioning: {
      transactionTime: TimeInterval<
        InclusiveLimitedTemporalBound,
        ExclusiveLimitedTemporalBound | Unbounded
      >;
    };
  };
};

export type OntologyElementMetadata = Subtype<
  OntologyElementMetadataBp,
  OwnedOntologyElementMetadata | ExternalOntologyElementMetadata
>;

export type EntityTypeMetadata = OntologyElementMetadata & {
  custom: { labelProperty?: BaseUrl };
};

export type DataTypeWithMetadata = Subtype<
  DataTypeWithMetadataBp,
  {
    schema: DataType;
    metadata: OntologyElementMetadata;
  }
>;

export type PropertyTypeWithMetadata = Subtype<
  PropertyTypeWithMetadataBp,
  {
    schema: PropertyType;
    metadata: OntologyElementMetadata;
  }
>;

export type EntityTypeWithMetadata = Subtype<
  EntityTypeWithMetadataBp,
  {
    schema: EntityType;
    metadata: EntityTypeMetadata;
  }
>;

export const isExternalOntologyElementMetadata = (
  metadata: OntologyElementMetadata,
): metadata is ExternalOntologyElementMetadata =>
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- this can be undefined if the cast is wrong
  (metadata as ExternalOntologyElementMetadata).custom.fetchedAt !== undefined;

export const isOwnedOntologyElementMetadata = (
  metadata: OntologyElementMetadata,
): metadata is OwnedOntologyElementMetadata =>
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- this can be undefined if the cast is wrong
  (metadata as OwnedOntologyElementMetadata).custom.ownedById !== undefined;
