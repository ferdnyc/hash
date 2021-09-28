import { Schema } from "prosemirror-model";

export const createSchema = () =>
  new Schema({
    nodes: {
      doc: {
        content: "((block|blockItem)+)|blank",
      },
      blank: {
        toDOM: () => ["div", 0] as const,
      },
      block: {
        content: "entity",
        /**
         * These properties are necessary for copy and paste (which is necessary for drag and drop)
         */
        toDOM: () => {
          return [
            "div",
            {
              // @todo this isn't applied because of the node view
              "data-hash-type": "block",
            },
          ] as const;
        },
        parseDOM: [
          {
            // @todo is this necessary
            tag: 'div[data-hash-type="block"]',
          },
        ],
      },
      entity: {
        content: "blockItem",
        // @todo remove this
        attrs: {
          temp: { default: null },
        },
        toDOM: (node) => {
          return [
            "div",
            { "data-hash-type": "entity", "data-hash-temp": node.attrs.temp },
            0,
          ] as const;
        },
        parseDOM: [
          {
            tag: 'div[data-hash-type="entity"]',
          },
        ],
      },
      text: {},
      async: {
        group: "blockItem",
        attrs: {
          // @todo rename these props
          asyncNodeProps: { default: {} },
          asyncComponentId: { default: null },
          autofocus: { default: true },
        },
      },
    },
    marks: {
      strong: {
        toDOM: () => ["strong", { style: "font-weight:bold;" }, 0] as const,
      },
      em: {
        toDOM: () => ["em", 0] as const,
      },
      underlined: {
        toDOM: () => ["u", 0] as const,
      },
    },
  });

export const createInitialDoc = (schema: Schema) =>
  schema.node("doc", {}, [schema.node("blank")]);
