// hand-written fixture for combine.test-d.ts / combine.test.ts: a second, unrelated server
// whose "echo" tool collides by name with the "everything" fixture's "echo" tool, to exercise
// namespacing in combineMcpTada.
export type introspection = { tools: {
  "echo": {
    "inputSchema": {
      "type": "object",
      "properties": {
        "text": {
          "type": "string",
          "description": "Text to echo back, unrelated to the other server's echo"
        }
      },
      "required": [
        "text"
      ]
    }
  },
  "search": {
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Search query"
        }
      },
      "required": [
        "query"
      ]
    },
    "outputSchema": {
      "type": "object",
      "properties": {
        "results": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "results"
      ],
      "additionalProperties": false
    }
  }
} };
