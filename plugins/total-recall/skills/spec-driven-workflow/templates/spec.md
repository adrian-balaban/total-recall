# <System name>: specification

System ID (used in ADL `DEFINE SYSTEM … AS <id>` and in memories): `<id>`

## Context

Who uses the system, and what problem it solves. One paragraph.

## Requirements

Each requirement has a stable ID. Never reuse an ID; mark a dropped one as withdrawn.

| ID | Requirement | Priority | Architecture elements |
|---|---|---|---|
| REQ-1 | … | must | `adl:<domain>.<component>` |
| REQ-2 | … | should | `calm:<node>` |

## Quality attributes

| ID | Attribute | Measure | Checked by (assertion ID) |
|---|---|---|---|
| QA-1 | Availability | … | `[<ID>-R1]` |

## Constraints

Regulatory, organisational and technical constraints, each with its reason.

## Open questions

Store each one with `status="proposed"` so it shows up in `get_architecture_context`.
