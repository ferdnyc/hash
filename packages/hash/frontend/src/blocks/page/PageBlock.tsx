import React, {
  Fragment,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  VoidFunctionComponent,
} from "react";
import { createPortal } from "react-dom";
import { v4 as uuid } from "uuid";
import { Schema } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { defineNewBlock, renderPM } from "./sandbox";
import { baseSchemaConfig } from "./config";
import {
  Block,
  BlockMeta,
  blockPaths,
  BlockWithoutMeta,
  componentIdToName,
  ReplacePortals,
} from "./tsUtils";
import { Text } from "../../graphql/autoGeneratedTypes";
import { useBlockProtocolUpdate } from "../../components/hooks/blockProtocolFunctions/useBlockProtocolUpdate";
import { BlockProtocolUpdatePayload } from "../../types/blockProtocol";
import { useBlockProtocolInsertIntoPage } from "../../components/hooks/blockProtocolFunctions/useBlockProtocolInsertIntoPage";

const invertedBlockPaths = Object.fromEntries(
  Object.entries(blockPaths).map(([key, value]) => [value, key])
);

type PageBlockProps = {
  contents: (Block | BlockWithoutMeta)[];
  blocksMeta: Map<string, BlockMeta>;
  pageId: string;
  namespaceId: string;
};

type PortalSet = Map<HTMLElement, { key: string; reactNode: ReactNode }>;

export const PageBlock: VoidFunctionComponent<PageBlockProps> = ({
  contents,
  blocksMeta,
  pageId,
  namespaceId,
}) => {
  const [willSave, setWillSave] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [portals, setPortals] = useState<PortalSet>(new Map());
  const { insert, insertLoading } = useBlockProtocolInsertIntoPage();
  const { update, updateLoading } = useBlockProtocolUpdate();

  const portalQueue = useRef<((set: PortalSet) => void)[]>([]);
  const portalQueueTimeout =
    useRef<ReturnType<typeof setImmediate> | null>(null);

  const replacePortal = useCallback<ReplacePortals>(
    (existingNode, nextNode, reactNode) => {
      if (portalQueueTimeout.current !== null) {
        clearImmediate(portalQueueTimeout.current);
      }

      portalQueue.current.push((nextPortals) => {
        if (existingNode && existingNode !== nextNode) {
          nextPortals.delete(existingNode);
        }

        if (nextNode && reactNode) {
          const key = nextPortals.get(nextNode)?.key ?? uuid();

          nextPortals.set(nextNode, { key, reactNode });
        }
      });

      portalQueueTimeout.current = setImmediate(() => {
        const queue = portalQueue.current;
        portalQueue.current = [];

        setPortals((portals) => {
          const nextPortals = new Map(portals);

          for (const cb of queue) {
            cb(nextPortals);
          }

          return nextPortals;
        });
      });
    },
    []
  );

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) {
        clearTimeout(saveTimer.current);
      }

      if (portalQueueTimeout.current !== null) {
        clearImmediate(portalQueueTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    setWillSave(false);

    const schema = new Schema(baseSchemaConfig);

    (window as any).triggerSave = () => {
      const blocks = view.state
        .toJSON()
        .doc.content.filter((block: any) => block.type === "block")
        .flatMap((block: any) => block.content) as any[];

      const seenEntityIds = new Set<string>();

      const mappedBlocks = blocks.map((node: any, position) => {
        const nodeType = view.state.schema.nodes[node.type];
        const meta = nodeType.defaultAttrs.meta;

        const componentId = invertedBlockPaths[meta.url] ?? meta.url;

        let entity;
        if (schema.nodes[node.type].isTextblock) {
          entity = {
            type: "Text",
            id: node.attrs.childEntityId,
            properties: {
              texts:
                node.content
                  ?.filter((child: any) => child.type === "text")
                  .map((child: any) => ({
                    text: child.text,
                    bold:
                      child.marks?.some(
                        (mark: any) => mark.type === "strong"
                      ) ?? false,
                    italics:
                      child.marks?.some((mark: any) => mark.type === "em") ??
                      false,
                    underline:
                      child.marks?.some(
                        (mark: any) => mark.type === "underlined"
                      ) ?? false,
                  })) ?? [],
            },
          };
        } else {
          const { childEntityId, ...props } = node.attrs;
          entity = {
            type: "UnknownEntity",
            id: childEntityId,
            properties: props,
          };
        }

        let block = {
          entityId: node.attrs.entityId,
          type: "Block",
          position,
          properties: {
            componentId,
            entity,
          },
        };

        if (seenEntityIds.has(block.entityId)) {
          block.entityId = null;
          entity.id = null;
        }

        seenEntityIds.add(block.entityId);

        return block;
      });

      const newBlocks = mappedBlocks.filter(
        (block) =>
          !contents.some((content) => content.entityId === block.entityId)
      );

      const existingBlocks = mappedBlocks.filter((block) =>
        contents.some((content) => content.entityId === block.entityId)
      );

      const updatedEntities = existingBlocks
        .map((block) => block.properties.entity)
        .concat(
          existingBlocks.map((block) => ({
            type: "Block",
            id: block.entityId,
            properties: {
              componentId: block.properties.componentId,
              entityType: block.properties.entity.type,
              entityId: block.properties.entity.id,
            },
          }))
        );

      const pageBlocks = existingBlocks.map((node) => {
        return {
          entityId: node.entityId,
          type: "Block",
        };
      });

      const blockIdsChange =
        JSON.stringify(contents.map((content) => content.entityId).sort()) !==
        JSON.stringify(mappedBlocks.map((block) => block.entityId).sort());

      console.log(updatedEntities);

      newBlocks
        .reduce(
          (promise, newBlock) =>
            promise
              .catch(() => {})
              .then(() =>
                insert({
                  pageId,
                  entityType: newBlock.properties.entity.type,
                  position: newBlock.position,
                  componentId: newBlock.properties.componentId,
                  entityProperties: newBlock.properties.entity.properties,
                })
              ),
          update([
            {
              entityType: "Page",
              entityId: pageId,
              data: {
                contents: pageBlocks,
              },
            },
          ])
        )
        .then(() => {
          return update([
            ...updatedEntities
              .filter(
                (entity) =>
                  (entity.type !== "Block" ||
                    (entity.properties.entityType === "Text" &&
                      entity.properties.entityId)) &&
                  entity.id
              )
              .map(
                (entity): BlockProtocolUpdatePayload<any> => ({
                  entityId: entity.id,
                  entityType: entity.type,
                  data: entity.properties,
                })
              ),
            // {
            //   entityType: "Page",
            //   entityId: pageId,
            //   data: {
            //     contents: pageBlocks,
            //   },
            // },
          ]);
        });
    };

    const savePlugin = new Plugin({
        props: {
          handleDOMEvents: {
            focus() {
              setWillSave(false);
              if (saveTimer.current) {
                clearTimeout(saveTimer.current);
                saveTimer.current = null;
              }
              return false;
            },
            blur: function () {
              if (saveTimer.current) {
                clearTimeout(saveTimer.current);
                saveTimer.current = null;
              }

              setWillSave(true);

              saveTimer.current = setTimeout((window as any).triggerSave, 500);

              return false;
            },
          },
        },
      }),
      view = renderPM(
        root.current!,
        schema.node(
          "doc",
          {},
          contents?.map((block) => {
            const { children, childEntityId = null, ...props } = block.entity;

            return schema.node(
              "async",
              {
                autofocus: false,
                asyncNodeUrl: block.componentId,
                asyncNodeProps: {
                  attrs: {
                    props,
                    entityId: block.entityId,
                    childEntityId,
                  },
                  children:
                    children?.map((child: any) => {
                      if (child.type === "text") {
                        return schema.text(
                          child.text,
                          child.marks.map((mark: string) => schema.mark(mark))
                        );
                      }

                      // @todo recursive nodes
                      throw new Error("unrecognised child");
                    }) ?? [],
                },
              },
              []
            );
          }) ?? []
        ),
        { nodeViews: {} },
        replacePortal,
        [savePlugin]
      );

    setPortals(new Map());

    for (const [url, meta] of Array.from(blocksMeta.entries())) {
      defineNewBlock(
        meta.componentMetadata,
        meta.componentSchema,
        view,
        componentIdToName(url),
        replacePortal
      );
    }

    const node = root.current!;

    return () => {
      delete (window as any).triggerSave;
      node.innerHTML = "";
    };
  }, [contents]);

  return (
    <>
      <div
        id="root"
        ref={root}
        style={
          insertLoading || updateLoading || willSave
            ? { opacity: 0.5, pointerEvents: "none" }
            : {}
        }
        // disabled={insertLoading || updateLoading || willSave}
      />
      {Array.from(portals.entries()).map(([target, { key, reactNode }]) => (
        <Fragment key={key}>{createPortal(reactNode, target)}</Fragment>
      ))}
    </>
  );
};
