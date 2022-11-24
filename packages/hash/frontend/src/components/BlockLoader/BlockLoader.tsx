import { UnknownRecord } from "@blockprotocol/core";
import {
  Entity as BpEntity,
  BlockGraphProperties,
  EntityType as BpEntityType,
  LinkedAggregation as BpLinkedAggregation,
} from "@blockprotocol/graph";
import { HashBlockMeta } from "@hashintel/hash-shared/blocks";
import { BlockEntity } from "@hashintel/hash-shared/entity";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  FunctionComponent,
} from "react";
import { uniqBy } from "lodash";

import { useLocalstorageState } from "rooks";
import { JsonSchema } from "@hashintel/hash-shared/json-utils";
import { EntityId } from "@hashintel/hash-subgraph";

import {
  convertApiEntityToBpEntity,
  convertApiEntityTypesToBpEntityTypes,
  convertApiEntityTypeToBpEntityType,
  convertApiLinkedAggregationToBpLinkedAggregation,
  convertApiLinkGroupsToBpLinkGroups,
} from "../../lib/entities";
import { fetchEmbedCode } from "./fetchEmbedCode";
import { RemoteBlock } from "../RemoteBlock/RemoteBlock";
import { useBlockLoadedContext } from "../../blocks/onBlockLoaded";
import { useBlockProtocolAggregateEntities } from "../hooks/blockProtocolFunctions/knowledge/useBlockProtocolAggregateEntities";
import { useBlockProtocolCreateLinkedAggregation } from "../hooks/blockProtocolFunctions/useBlockProtocolCreateLinkedAggregation";
import { useBlockProtocolDeleteLinkedAggregation } from "../hooks/blockProtocolFunctions/useBlockProtocolDeleteLinkedAggregation";
import { useBlockProtocolFileUpload } from "../hooks/blockProtocolFunctions/useBlockProtocolFileUpload";
import { useBlockProtocolUpdateLinkedAggregation } from "../hooks/blockProtocolFunctions/useBlockProtocolUpdateLinkedAggregation";
import { DeprecatedEntityType as ApiEntityType } from "../../graphql/apiTypes.gen";
import { useReadonlyMode } from "../../shared/readonly-mode";
import { DataMapEditor } from "./data-map-editor";
import { mapData, SchemaMap } from "./shared";
import { useBlockContext } from "../../blocks/page/BlockContext";
import { useAuthenticatedUser } from "../hooks/useAuthenticatedUser";

// @todo consolidate these properties, e.g. take all entityX, linkX into a single childEntity prop
// @see https://app.asana.com/0/1200211978612931/1202807842439190/f
type BlockLoaderProps = {
  blockEntityId: string;
  blockMetadata: HashBlockMeta;
  blockSchema: JsonSchema;
  editableRef: (node: HTMLElement | null) => void;
  entityId: EntityId;
  entityType?: Pick<ApiEntityType, "entityId" | "properties">;
  entityTypeId: string;
  entityProperties: {};
  linkGroups: BlockEntity["properties"]["entity"]["linkGroups"];
  linkedEntities: BlockEntity["properties"]["entity"]["linkedEntities"];
  linkedAggregations: BlockEntity["properties"]["entity"]["linkedAggregations"];
  onBlockLoaded: () => void;
  // shouldSandbox?: boolean;
};

// const sandboxingEnabled = !!process.env.NEXT_PUBLIC_SANDBOX;

/**
 * Converts API data to Block Protocol-formatted data (e.g. entities, links),
 * and passes the correctly formatted data to RemoteBlock, along with message callbacks
 */
export const BlockLoader: FunctionComponent<BlockLoaderProps> = ({
  blockEntityId,
  blockMetadata,
  blockSchema,
  editableRef,
  entityId,
  entityType,
  entityTypeId,
  entityProperties,
  linkGroups,
  linkedEntities,
  linkedAggregations,
  onBlockLoaded,
  // shouldSandbox,
}) => {
  const { authenticatedUser } = useAuthenticatedUser();
  const accountId = authenticatedUser?.userAccountId;

  const { readonlyMode } = useReadonlyMode();
  const { aggregateEntities } = useBlockProtocolAggregateEntities();
  const { createLinkedAggregation } =
    useBlockProtocolCreateLinkedAggregation(readonlyMode);
  const { deleteLinkedAggregation } =
    useBlockProtocolDeleteLinkedAggregation(readonlyMode);
  const { uploadFile } = useBlockProtocolFileUpload(accountId, readonlyMode);
  const { updateLinkedAggregation } =
    useBlockProtocolUpdateLinkedAggregation(readonlyMode);

  const { showDataMappingUi, setShowDataMappingUi } = useBlockContext();

  // Storing these in local storage is a temporary solution – we want them in the db soon
  // Known issue: this hook always sets _some_ value in local storage, so we end up with unnecessary things stored there
  const mapId = `${entityTypeId}:${blockMetadata.source}`;
  const [schemaMap, setSchemaMap] = useLocalstorageState<SchemaMap>(
    `map:${mapId}`,
    { mapId },
  );

  const graphProperties = useMemo<
    Required<BlockGraphProperties<UnknownRecord>["graph"]>
  >(() => {
    const convertedEntityTypesForProvidedEntities: BpEntityType[] = [];

    if (entityType) {
      convertedEntityTypesForProvidedEntities.push(
        convertApiEntityTypeToBpEntityType(entityType),
      );
    }

    const convertedLinkedEntities: BpEntity[] = [];
    for (const entity of linkedEntities ?? []) {
      convertedLinkedEntities.push(convertApiEntityToBpEntity(entity));
      convertedEntityTypesForProvidedEntities.push(
        convertApiEntityTypeToBpEntityType(entity.entityType),
      );
    }

    const convertedLinkedAggregations: BpLinkedAggregation[] = [];
    for (const linkedAggregation of linkedAggregations ?? []) {
      convertedLinkedAggregations.push(
        convertApiLinkedAggregationToBpLinkedAggregation(linkedAggregation),
      );
      convertedEntityTypesForProvidedEntities.push(
        ...convertApiEntityTypesToBpEntityTypes(
          linkedAggregation.results.map(
            /** @todo this any type coercion is incorrect, we need to adjust typings https://app.asana.com/0/0/1203099452204542/f */
            ({ entityType: resultEntityType }: { entityType: any }) =>
              resultEntityType,
          ),
        ),
      );
    }

    const blockGraph = {
      depth: 1,
      linkGroups: convertApiLinkGroupsToBpLinkGroups(linkGroups),
      linkedEntities: convertedLinkedEntities,
    };

    const blockEntity = convertApiEntityToBpEntity({
      entityId: entityId ?? "entityId-not-yet-set", // @todo ensure blocks always get sent an entityId
      entityTypeId,
      properties: entityProperties,
    });

    if (
      typeof schemaMap === "object" &&
      Object.keys(schemaMap.transformations ?? {}).length > 0
    ) {
      blockEntity.properties = mapData(
        blockEntity,
        blockGraph,
        schemaMap.transformations,
      );
    }

    return {
      blockEntity,
      blockGraph,
      entityTypes: uniqBy(
        convertedEntityTypesForProvidedEntities,
        "entityTypeId",
      ),
      linkedAggregations: convertedLinkedAggregations,
      readonly: readonlyMode,
    };
  }, [
    entityType,
    entityId,
    entityProperties,
    entityTypeId,
    linkGroups,
    linkedEntities,
    linkedAggregations,
    readonlyMode,
    schemaMap,
  ]);

  const functions = {
    aggregateEntities,
    createLinkedAggregation,
    deleteLinkedAggregation,
    /**
     * @todo remove this when embed block no longer relies on server-side oEmbed calls
     * @see https://app.asana.com/0/1200211978612931/1202509819279267/f
     */
    getEmbedBlock: fetchEmbedCode,
    uploadFile,
    updateLinkedAggregation,
  };

  const onBlockLoadedFromContext = useBlockLoadedContext()?.onBlockLoaded;
  const onBlockLoadedRef = useRef(onBlockLoaded);

  useLayoutEffect(() => {
    onBlockLoadedRef.current = onBlockLoaded;
  });

  const onRemoteBlockLoaded = useCallback(() => {
    onBlockLoadedFromContext(blockEntityId);
    onBlockLoadedRef?.current();
  }, [blockEntityId, onBlockLoadedFromContext]);

  // @todo upgrade sandbox for BP 0.2 and remove feature flag
  // if (sandboxingEnabled && (shouldSandbox || sourceUrl.endsWith(".html"))) {
  //   return (
  //     <BlockFramer
  //       sourceUrl={sourceUrl}
  //       blockProperties={{
  //         ...blockProperties,
  //         entityId: blockProperties.entityId ?? null,
  //         entityTypeId: blockProperties.entityTypeId ?? null,
  //       }}
  //       onBlockLoaded={onRemoteBlockLoaded}
  //       {...functions}
  //     />
  //   );
  // }

  if (showDataMappingUi) {
    return (
      <DataMapEditor
        onClose={() => setShowDataMappingUi(false)}
        schemaMap={schemaMap}
        sourceBlockEntity={{
          ...graphProperties.blockEntity,
          properties: entityProperties,
        }}
        sourceBlockGraph={graphProperties.blockGraph}
        targetSchema={blockSchema}
        transformedTree={graphProperties.blockEntity.properties}
        onSchemaMapChange={setSchemaMap}
      />
    );
  }

  return (
    <RemoteBlock
      blockMetadata={blockMetadata}
      editableRef={editableRef}
      graphCallbacks={functions}
      graphProperties={graphProperties}
      onBlockLoaded={onRemoteBlockLoaded}
    />
  );
};
