---
"mcp-tada": minor
---

Snapshots record a server's static resources and resource templates, and the typed client gains `readResource` (URIs completed, `contents[].mimeType` narrowed), `readResourceTemplate` (params typed from the template's RFC 6570 variables), `listResources`, and `listResourceTemplates`; `check` reports resource and template drift.
