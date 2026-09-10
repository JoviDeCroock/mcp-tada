// Tool definitions, declared once. The server registers them; the client can derive its types
// from them directly with `IntrospectionOf<typeof tools>`, or from a CLI-generated snapshot.
import { defineTool, defineTools } from "mcp-tada-server";

type Note = { id: number; title: string; body: string };
const notes = new Map<number, Note>();
let nextId = 1;

const noteSchema = {
  type: "object",
  properties: {
    id: { type: "integer" },
    title: { type: "string" },
    body: { type: "string" },
  },
  required: ["id", "title", "body"],
} as const;

export const tools = defineTools([
  defineTool({
    name: "add_note",
    description: "Store a note and return it with its assigned id.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title" },
        body: { type: "string", description: "Note contents" },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
    outputSchema: noteSchema,
    handler: ({ title, body }) => {
      const note: Note = { id: nextId++, title, body };
      notes.set(note.id, note);
      return note;
    },
  }),
  defineTool({
    name: "get_note",
    description: "Fetch one note by id. Returns an error result when the id is unknown.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
    },
    outputSchema: noteSchema,
    handler: ({ id }) => {
      const note = notes.get(id);
      if (!note) throw new Error(`No note with id ${id}`);
      return note;
    },
  }),
  defineTool({
    name: "list_notes",
    description: "List every stored note.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: { notes: { type: "array", items: noteSchema } },
      required: ["notes"],
    },
    handler: () => ({ notes: [...notes.values()] }),
  }),
  defineTool({
    name: "clear_notes",
    description: "Delete every note. Returns plain text, no structured output.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: { type: "object", properties: {} },
    handler: () => {
      const count = notes.size;
      notes.clear();
      return { content: [{ type: "text", text: `Deleted ${count} note(s)` }] };
    },
  }),
]);
